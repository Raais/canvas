import { describe, expect, test } from 'bun:test';
import { ARCHIVE_LIMITS, ARCHIVE_VERSION } from '../archive/format';
import { addNodes, createEmbeddedImageNode, createEmptyBoard } from '../domain/board';
import { GRAPH_CLIPBOARD_VERSION } from '../domain/graph-clipboard';
import { createHistory, pushHistory, undoHistory } from '../domain/history';
import { SCHEMA_VERSION, type AssetRecord } from '../domain/types';
import { partitionIncoming } from '../ingest/admission';
import { ingestClipboard, ingestFileList } from '../ingest/browser';
import { interpretClipboard } from '../ingest/clipboard';
import { createImageOptimizer, type OptimizerPort } from '../ingest/image-optimizer';
import {
  OPTIMIZE_IMAGES_KEY,
  WEBP_OPTIMIZER_V1,
  classifyDimensions,
  classifyPngAnimation,
  createBatchGuard,
  describeOptimization,
  gateIncomingImage,
  isOptimizableMime,
  keepsOriginalMime,
  mayPlaceImages,
  mayReplaceBoard,
  readOptimizeImages,
  scaledDimensions,
  settleOptimization,
  writeOptimizeImages,
  type PreferenceStorage,
} from '../ingest/image-optimizer-config';
import { createAssetRecord } from '../persistence/db';
import { SaveQueue } from '../persistence/save-queue';
import { decidePwaUpdate, shouldActivateWorker, type PwaUpdateInput } from './pwa-update';

const now = '2026-11-14T00:00:00.000Z';
const Mib = 1024 * 1024;

function memory(initial?: string | null): PreferenceStorage {
  const values = new Map<string, string>();
  if (initial) values.set(OPTIMIZE_IMAGES_KEY, initial);
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => {
      values.set(key, value);
    },
  };
}

function portFactory() {
  const created: MockPort[] = [];
  return {
    created,
    create(): OptimizerPort {
      const next = new MockPort();
      created.push(next);
      return next;
    },
  };
}

class MockPort implements OptimizerPort {
  sent: Array<{ id: number }> = [];
  terminated = 0;
  onmessage: ((event: { data: unknown }) => void) | null = null;
  onerror: ((event: Event) => void) | null = null;
  postMessage(message: unknown) {
    this.sent.push(message as { id: number });
  }
  terminate() {
    this.terminated += 1;
  }
  deliver(data: unknown) {
    this.onmessage?.({ data });
  }
  fail() {
    this.onerror?.(new Event('error'));
  }
}

function webp(bytes: number, width = 10, height = 10) {
  return {
    ok: true as const,
    blob: new Blob([new Uint8Array(bytes)], { type: 'image/webp' }),
    width,
    height,
    sourceWidth: width,
    sourceHeight: height,
  };
}

const ready: PwaUpdateInput = {
  editingNote: false,
  editingRelationship: false,
  confirming: false,
  ingesting: false,
  adjustingRotation: false,
  focusedField: false,
  readOnly: false,
  saveStatus: 'saved',
  hasUnpersisted: false,
  hasRecovery: false,
  expectationMatches: true,
};

describe('image optimization preference', () => {
  test('stays off until the user enables it', () => {
    expect(readOptimizeImages(memory())).toBe(false);
    expect(readOptimizeImages(memory('off'))).toBe(false);
    expect(readOptimizeImages(memory('yes'))).toBe(false);
    expect(readOptimizeImages(null)).toBe(false);
    const storage = memory();
    writeOptimizeImages(storage, true);
    expect(readOptimizeImages(storage)).toBe(true);
    writeOptimizeImages(storage, false);
    expect(readOptimizeImages(storage)).toBe(false);
    const broken: PreferenceStorage = {
      getItem: () => { throw new Error('blocked'); },
      setItem: () => { throw new Error('blocked'); },
    };
    expect(readOptimizeImages(broken)).toBe(false);
    writeOptimizeImages(broken, true);
    const board = createEmptyBoard(now);
    expect(JSON.stringify(board).includes(OPTIMIZE_IMAGES_KEY)).toBe(false);
    const remembered = memory();
    writeOptimizeImages(remembered, true);
    expect(JSON.stringify(createEmptyBoard(now)).includes(OPTIMIZE_IMAGES_KEY)).toBe(false);
    expect(readOptimizeImages(remembered)).toBe(true);
    expect(SCHEMA_VERSION).toBe(15);
    expect(ARCHIVE_VERSION).toBe(2);
    expect(GRAPH_CLIPBOARD_VERSION).toBe(1);
  });
});

describe('webp resize and format choice', () => {
  test('scales down without upscaling or changing the ratio', () => {
    expect(scaledDimensions(400, 300)).toEqual({ width: 400, height: 300 });
    expect(scaledDimensions(4000, 3000)).toEqual({ width: 2560, height: 1920 });
    expect(scaledDimensions(3000, 4000)).toEqual({ width: 1920, height: 2560 });
    expect(scaledDimensions(1000, 10000)).toEqual({ width: 256, height: 2560 });
    expect(scaledDimensions(10000, 1000)).toEqual({ width: 2560, height: 256 });
    expect(scaledDimensions(1, 1)).toEqual({ width: 1, height: 1 });
    expect(scaledDimensions(0, 10)).toBeNull();
    expect(scaledDimensions(10, Number.NaN)).toBeNull();
    expect(scaledDimensions(Number.POSITIVE_INFINITY, 10)).toBeNull();
    expect(classifyDimensions(8000, 8000)).toBe('too-many-pixels');
    expect(isOptimizableMime('image/png')).toBe(true);
    expect(isOptimizableMime('image/jpeg')).toBe(true);
    expect(keepsOriginalMime('image/gif')).toBe(true);
    expect(keepsOriginalMime('image/webp')).toBe(true);
    expect(keepsOriginalMime('image/avif')).toBe(true);
    expect(isOptimizableMime('image/gif')).toBe(false);
    const external = interpretClipboard({ imageKeys: [], html: null, plainText: 'https://example.com/photo.png' });
    expect(external.actions[0]).toEqual({ type: 'external-image', url: 'https://example.com/photo.png' });
  });
});

describe('webp savings and archive admission', () => {
  test('keeps a webp only when it saves enough and still fits', () => {
    expect(settleOptimization({ originalBytes: 1000, encoded: { bytes: 500, mimeType: 'image/webp', width: 10, height: 10 } })).toBe('accept');
    expect(settleOptimization({ originalBytes: 1000, encoded: { bytes: 850, mimeType: 'image/webp', width: 10, height: 10 } })).toBe('accept');
    expect(settleOptimization({ originalBytes: 1000, encoded: { bytes: 900, mimeType: 'image/webp', width: 10, height: 10 } })).toBe('preserve');
    expect(settleOptimization({ originalBytes: 1000, encoded: { bytes: 1100, mimeType: 'image/webp', width: 10, height: 10 } })).toBe('preserve');
    expect(settleOptimization({ originalBytes: 1000, encoded: { bytes: 0, mimeType: 'image/webp', width: 10, height: 10 } })).toBe('preserve');
    expect(settleOptimization({ originalBytes: 1000, encoded: { bytes: 100, mimeType: 'image/png', width: 10, height: 10 } })).toBe('preserve');
    expect(settleOptimization({ originalBytes: 1000, encoded: null })).toBe('preserve');
    expect(settleOptimization({ originalBytes: 80 * Mib, encoded: null })).toBe('reject');
    expect(settleOptimization({ originalBytes: 80 * Mib, encoded: { bytes: 4 * Mib, mimeType: 'image/webp', width: 2560, height: 1440 } })).toBe('accept');
    expect(settleOptimization({ originalBytes: 10 * Mib, encoded: { bytes: 70 * Mib, mimeType: 'image/webp', width: 2560, height: 1440 } })).toBe('preserve');
    expect(WEBP_OPTIMIZER_V1.quality).toBe(0.82);
    expect(WEBP_OPTIMIZER_V1.maxDimension).toBe(2560);
    expect(ARCHIVE_LIMITS.maxFileBytes).toBe(64 * Mib);
    expect(ARCHIVE_LIMITS.maxTotalBytes).toBe(256 * Mib);
    expect(gateIncomingImage({ optimize: true, mimeType: 'image/png', bytes: 80 * Mib, name: 'photo.png', png: 'still' }).action).toBe('optimize');
    expect(gateIncomingImage({ optimize: false, mimeType: 'image/png', bytes: 80 * Mib, name: 'photo.png' }).action).toBe('reject');
    expect(gateIncomingImage({ optimize: true, mimeType: 'image/gif', bytes: 80 * Mib, name: 'move.gif' }).action).toBe('reject');
    const board = createEmptyBoard(now);
    const fitted = partitionIncoming({
      board,
      existingBytes: 0,
      existingCount: 0,
      incoming: [{ key: '0', name: 'photo', bytes: 4 * Mib }],
    });
    expect(fitted.accepted).toEqual(['0']);
    const oversized = partitionIncoming({
      board,
      existingBytes: 0,
      existingCount: 0,
      incoming: [{ key: '0', name: 'photo', bytes: 65 * Mib }],
    });
    expect(oversized.accepted).toHaveLength(0);
    const partial = partitionIncoming({
      board,
      existingBytes: 200 * Mib,
      existingCount: 4,
      incoming: [
        { key: '0', name: 'a', bytes: 20 * Mib },
        { key: '1', name: 'b', bytes: 30 * Mib },
      ],
    });
    expect(partial.accepted).toEqual(['0']);
    expect(partial.warnings).toHaveLength(1);
  });
});

describe('image optimizer worker queue', () => {
  test('runs one job at a time and ignores stale replies', async () => {
    const factory = portFactory();
    const optimizer = createImageOptimizer(factory.create, 20);
    expect(optimizer.started).toBe(false);
    expect(factory.created).toHaveLength(0);
    const first = optimizer.optimize({ blob: new Blob(['a']), width: 8, height: 8 });
    const second = optimizer.optimize({ blob: new Blob(['b']), width: 8, height: 8 });
    const third = optimizer.optimize({ blob: new Blob(['c']), width: 8, height: 8 });
    expect(factory.created).toHaveLength(1);
    expect(factory.created[0]?.sent).toHaveLength(1);
    expect(factory.created[0]?.sent[0]?.id).toBe(1);
    factory.created[0]?.deliver({ id: 99, ok: true, blob: new Blob(['no']), width: 1, height: 1, sourceWidth: 1, sourceHeight: 1 });
    const waiting = await Promise.race([first.then(() => 'done'), new Promise((resolve) => setTimeout(() => resolve('wait'), 10))]);
    expect(waiting).toBe('wait');
    const accepted = webp(4, 8, 8);
    factory.created[0]?.deliver({ id: 1, ok: true, blob: accepted.blob, width: accepted.width, height: accepted.height, sourceWidth: 8, sourceHeight: 8 });
    const firstResult = await first;
    expect(firstResult.ok).toBe(true);
    if (firstResult.ok) expect(firstResult.width).toBe(8);
    expect(factory.created[0]?.sent).toHaveLength(2);
    factory.created[0]?.fail();
    const secondResult = await second;
    expect(secondResult.ok).toBe(false);
    expect(factory.created).toHaveLength(2);
    factory.created[1]?.deliver({ id: 3, ok: true, blob: webp(4).blob, width: 8, height: 8, sourceWidth: 8, sourceHeight: 8 });
    const thirdResult = await third;
    expect(thirdResult.ok).toBe(true);
    const stale = optimizer.optimize({ blob: new Blob(['d']), width: 4, height: 4 });
    optimizer.cancel();
    const cancelled = await stale;
    expect(cancelled.ok).toBe(false);
    if (!cancelled.ok) expect(cancelled.reason).toBe('cancelled');
    optimizer.dispose();
    expect((factory.created[1]?.terminated ?? 0) + (factory.created[2]?.terminated ?? 0)).toBeGreaterThan(0);
  });

  test('a timed-out job does not block the following job', async () => {
    const factory = portFactory();
    const optimizer = createImageOptimizer(factory.create, 15);
    const stalled = optimizer.optimize({ blob: new Blob(['a']), width: 2, height: 2 });
    const stalledResult = await stalled;
    expect(stalledResult.ok).toBe(false);
    if (!stalledResult.ok) expect(stalledResult.reason).toBe('timeout');
    const next = optimizer.optimize({ blob: new Blob(['b']), width: 2, height: 2 });
    expect(factory.created.length).toBeGreaterThan(1);
    factory.created[factory.created.length - 1]?.deliver({
      id: factory.created[factory.created.length - 1]?.sent[0]?.id,
      ok: true,
      blob: webp(2).blob,
      width: 2,
      height: 2,
      sourceWidth: 2,
      sourceHeight: 2,
    });
    const nextResult = await next;
    expect(nextResult.ok).toBe(true);
    optimizer.dispose();
  });
});

describe('optimized ingestion', () => {
  test('converts eligible pictures and leaves the other formats alone', async () => {
    const calls: string[] = [];
    const stillBytes = pngBytes(ihdrChunk(), pngChunk('IDAT', new Uint8Array(40)));
    const png = pngFile(stillBytes, 'photo.png');
    const converted = await ingestFileList([png], {
      optimize: true,
      measure: async () => ({ width: 20, height: 10 }),
      optimizer: {
        optimize: async () => {
          calls.push('png');
          return { ok: true, blob: new Blob([new Uint8Array(40)], { type: 'image/webp' }), width: 20, height: 10, sourceWidth: 20, sourceHeight: 10 };
        },
      },
    });
    expect(calls).toEqual(['png']);
    expect(converted.items).toHaveLength(1);
    const image = converted.items[0];
    expect(image?.type).toBe('image');
    if (image?.type === 'image') {
      expect(image.mimeType).toBe('image/webp');
      expect(image.intrinsicWidth).toBe(20);
      expect(image.intrinsicHeight).toBe(10);
      expect(image.blob.size).toBe(40);
    }
    expect(converted.summary).toBe(`Optimized 1 image · saved ${stillBytes.length - 40} B`);
    const kept = await ingestFileList([png], {
      optimize: true,
      optimizer: {
        optimize: async () => ({ ok: true, blob: new Blob([new Uint8Array(95)], { type: 'image/webp' }), width: 12, height: 8, sourceWidth: 12, sourceHeight: 8 }),
      },
    });
    const original = kept.items[0];
    expect(original?.type).toBe('image');
    if (original?.type === 'image') {
      expect(original.mimeType).toBe('image/png');
      expect(original.intrinsicWidth).toBe(12);
      expect(original.blob.size).toBe(stillBytes.length);
    }
    const gif = new File([new Uint8Array([1, 2, 3])], 'move.gif', { type: 'image/gif' });
    const animated = await ingestFileList([gif], {
      optimize: true,
      measure: async () => ({ width: 16, height: 16 }),
      optimizer: { optimize: async () => { calls.push('gif'); return { ok: false, reason: 'failed' }; } },
    });
    expect(calls).toEqual(['png']);
    expect(animated.items[0]?.type).toBe('image');
    if (animated.items[0]?.type === 'image') expect(animated.items[0].mimeType).toBe('image/gif');
    const disabled = await ingestFileList([png], {
      optimize: false,
      measure: async () => ({ width: 4, height: 4 }),
      optimizer: { optimize: async () => { calls.push('off'); return { ok: false, reason: 'failed' }; } },
    });
    expect(calls).toEqual(['png']);
    if (disabled.items[0]?.type === 'image') expect(disabled.items[0].mimeType).toBe('image/png');
    const failed = await ingestFileList([png], {
      optimize: true,
      measure: async () => ({ width: 6, height: 6 }),
      optimizer: { optimize: async () => ({ ok: false, reason: 'failed' }) },
    });
    expect(failed.summary).toBe('One image could not be optimized and was kept unchanged.');
    if (failed.items[0]?.type === 'image') expect(failed.items[0].mimeType).toBe('image/png');
    const text = await ingestFileList([new File(['hello'], 'notes.txt', { type: 'text/plain' })]);
    expect(text.items[0]?.type).toBe('text');
    expect(text.items[0]?.type === 'text' ? text.items[0].presentation : '').toBe('text');
    const guard = createBatchGuard();
    const token = guard.capture();
    guard.invalidate();
    expect(guard.current(token)).toBe(false);
    expect(mayPlaceImages(true)).toBe(false);
    expect(mayPlaceImages(false)).toBe(true);
    expect(mayReplaceBoard(true)).toBe(false);
    expect(mayReplaceBoard(false)).toBe(true);
    expect(describeOptimization({ optimized: 4, unchanged: 2, failedKept: 0, savedBytes: Math.round(5.2 * Mib) })).toContain('Optimized 4 of 6 images');
  });
});

describe('optimized image save safety', () => {
  test('one batch is one undo step and recovery keeps the accepted bytes', () => {
    const before = createEmptyBoard(now);
    const nodes = [0, 1].map((index) => createEmbeddedImageNode({
      center: { x: index * 40, y: 20 },
      assetId: `asset-${index}`,
      intrinsicWidth: 2560,
      intrinsicHeight: 1440,
    }));
    const next = addNodes(before, nodes, now);
    const undone = undoHistory(pushHistory(createHistory(), before), next);
    expect(next.nodes).toHaveLength(2);
    expect(undone?.board.nodes).toHaveLength(0);
    const blob = new Blob([new Uint8Array(32)], { type: 'image/webp' });
    const asset = createAssetRecord(blob, 'image/webp', now);
    const queue = new SaveQueue({} as never, () => next, () => {}, () => {});
    queue.adopt(next);
    queue.addAssets([asset]);
    queue.pauseForConflict();
    const recovered = queue.recovery();
    expect(recovered === null).toBe(false);
    expect(recovered?.assets[0]?.mimeType).toBe('image/webp');
    expect(recovered?.assets[0]?.blob.size).toBe(32);
    expect(recovered?.assets.map((entry: AssetRecord) => entry.byteSize)).toEqual([32]);
    expect(decidePwaUpdate({ ...ready, ingesting: true }).action).toBe('block');
    expect(shouldActivateWorker(decidePwaUpdate({ ...ready, ingesting: true }))).toBe(false);
    expect(decidePwaUpdate({ ...ready, hasUnpersisted: true }).action).toBe('flush');
    expect(decidePwaUpdate({ ...ready, saveStatus: 'error' }).action).toBe('block');
    expect(mayReplaceBoard(true)).toBe(false);
  });
});

function pngChunk(type: string, data = new Uint8Array(0)): Uint8Array {
  const bytes = new Uint8Array(12 + data.length);
  new DataView(bytes.buffer).setUint32(0, data.length);
  for (let index = 0; index < 4; index += 1) bytes[4 + index] = type.charCodeAt(index);
  bytes.set(data, 8);
  return bytes;
}

function pngBytes(...chunks: Uint8Array[]): Uint8Array {
  const bytes = new Uint8Array(8 + chunks.reduce((sum, chunk) => sum + chunk.length, 0));
  bytes.set([137, 80, 78, 71, 13, 10, 26, 10]);
  let offset = 8;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.length;
  }
  return bytes;
}

function pngFile(bytes: Uint8Array, name: string): File {
  const copy = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(copy).set(bytes);
  return new File([copy], name, { type: 'image/png' });
}

function ihdrChunk(): Uint8Array {
  const data = new Uint8Array(13);
  const view = new DataView(data.buffer);
  view.setUint32(0, 32);
  view.setUint32(4, 16);
  data[8] = 8;
  return pngChunk('IHDR', data);
}

describe('animated png preservation', () => {
  test('does not flatten an apng or a png with a broken chunk length', async () => {
    const still = pngBytes(ihdrChunk(), pngChunk('IDAT', new Uint8Array([1, 2])));
    const animated = pngBytes(ihdrChunk(), pngChunk('acTL', new Uint8Array(8)), pngChunk('IDAT', new Uint8Array([1])));
    expect(classifyPngAnimation(still)).toBe('still');
    expect(classifyPngAnimation(animated)).toBe('animated');
    expect(gateIncomingImage({ optimize: true, mimeType: 'image/png', bytes: still.length, name: 'still.png', png: 'still' }).action).toBe('optimize');
    const broken = new Uint8Array(24);
    broken.set([137, 80, 78, 71, 13, 10, 26, 10]);
    new DataView(broken.buffer).setUint32(8, 0xffffffff);
    expect(classifyPngAnimation(broken)).toBe('ambiguous');
    const oversized = gateIncomingImage({
      optimize: true,
      mimeType: 'image/png',
      bytes: ARCHIVE_LIMITS.maxFileBytes + 1,
      name: 'anim.png',
      png: 'animated',
    });
    expect(oversized.action).toBe('reject');
    if (oversized.action === 'reject') expect(oversized.warning).toContain('64 MiB');
    const calls: string[] = [];
    const optimizer = {
      optimize: async () => {
        calls.push('worker');
        return { ok: false as const, reason: 'failed' as const };
      },
    };
    const measure = async () => ({ width: 32, height: 16 });
    const preserved = await ingestFileList([pngFile(animated, 'anim.png')], { optimize: true, optimizer, measure });
    expect(calls).toHaveLength(0);
    expect(preserved.summary).toBeNull();
    const preservedImage = preserved.items[0];
    expect(preservedImage?.type).toBe('image');
    if (preservedImage?.type === 'image') {
      expect(preservedImage.mimeType).toBe('image/png');
      expect(preservedImage.blob.size).toBe(animated.length);
      expect(preservedImage.intrinsicWidth).toBe(32);
      expect(preservedImage.intrinsicHeight).toBe(16);
    }
    const eligible = await ingestFileList([pngFile(still, 'still.png')], {
      optimize: true,
      measure,
      optimizer: {
        optimize: async () => {
          calls.push('still');
          return { ok: true as const, blob: new Blob([new Uint8Array(4)], { type: 'image/webp' }), width: 32, height: 16, sourceWidth: 32, sourceHeight: 16 };
        },
      },
    });
    expect(calls).toEqual(['still']);
    if (eligible.items[0]?.type === 'image') expect(eligible.items[0].mimeType).toBe('image/webp');
    const ambiguous = await ingestFileList([pngFile(broken, 'bad.png')], { optimize: true, optimizer, measure });
    expect(calls).toEqual(['still']);
    if (ambiguous.items[0]?.type === 'image') expect(ambiguous.items[0].mimeType).toBe('image/png');
    let binary = '';
    for (const byte of animated) binary += String.fromCharCode(byte);
    const pasted = await ingestClipboard({
      html: `<img src="data:image/png;base64,${btoa(binary)}">`,
      plainText: null,
      files: [],
    }, 'clipboard', { optimize: true, optimizer, measure });
    expect(calls).toEqual(['still']);
    if (pasted.items[0]?.type === 'image') {
      expect(pasted.items[0].mimeType).toBe('image/png');
      expect(pasted.items[0].blob.size).toBe(animated.length);
    }
    expect(keepsOriginalMime('image/gif')).toBe(true);
    expect(keepsOriginalMime('image/webp')).toBe(true);
    expect(keepsOriginalMime('image/avif')).toBe(true);
    expect(WEBP_OPTIMIZER_V1.quality).toBe(0.82);
    expect(WEBP_OPTIMIZER_V1.maxDimension).toBe(2560);
    expect(scaledDimensions(4000, 3000)).toEqual({ width: 2560, height: 1920 });
    expect(settleOptimization({ originalBytes: 1000, encoded: { bytes: 850, mimeType: 'image/webp', width: 10, height: 10 } })).toBe('accept');
  });
});

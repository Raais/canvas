import { describe, expect, test } from 'bun:test';
import { unzipSync, zipSync, strToU8 } from 'fflate';
import { ARCHIVE_LIMITS, ARCHIVE_VERSION } from '../archive/format';
import { buildArchive, readArchive } from '../archive/zip';
import { entryProblem, sha256 } from '../archive/validate';
import {
  addNodes,
  createEmptyBoard,
  createEmbeddedImageNode,
  createFileNode,
  createTextNode,
  createVoiceNode,
  parseBoard,
  referencedAssetIds,
  renameVoice,
} from '../domain/board';
import { connectNodes } from '../domain/graph';
import { GRAPH_CLIPBOARD_VERSION, encodeGraphClipboard, pasteGraph, selectionClosure } from '../domain/graph-clipboard';
import { deleteSelection, duplicateSelection, groupSelection, ungroup } from '../domain/groups';
import { createHistory, pushHistory, redoHistory, retainedAssetIds, undoHistory } from '../domain/history';
import { buildSearchIndex, searchNodes } from '../domain/search';
import { classifyXray } from '../domain/xray';
import { VoiceCapture, type CaptureRecorder, type CaptureStream } from '../domain/voice-capture';
import {
  audioFilename,
  canonicalAudioMime,
  defaultVoiceTitle,
  preferredRecorderMime,
  recordingSupport,
  voiceSaveProblem,
} from '../domain/voice';
import { dragBodyUpdates } from '../editor/pulling';
import { EMBEDDED_ASSET_BUDGET } from '../ingest/admission';
import { ACTIVE_BOARD_KEY, createAssetRecord, planAssetWrite, readSession, writeBoardSnapshot } from '../persistence/db';
import { createAudioUrlKeeper, createObjectUrlRegistry } from '../persistence/object-urls';
import { SaveQueue } from '../persistence/save-queue';
import { buildContentIndex, queryBoard } from '../search/query';
import { createNodeProjection } from '../components/flow-projection';
import type { AssetRecord, Board, VoiceNode } from '../domain/types';
import { SCHEMA_VERSION, VOICE_MAX_MS, VOICE_MIN_HEIGHT, VOICE_MIN_WIDTH } from '../domain/types';

declare const Bun: { file(path: URL): { text(): Promise<string> } };

const now = '2026-11-15T09:00:00.000Z';
const marker = 'VOICEBYTES29';

describe('voice notes', () => {
  test('validates a voice node and migrates schema 15 to 16', () => {
    expect(SCHEMA_VERSION).toBe(16);
    expect(ARCHIVE_VERSION).toBe(2);
    expect(GRAPH_CLIPBOARD_VERSION).toBe(1);
    const voice = voiceOn(createEmptyBoard(now), 'asset-voice', 'Harbor', 2400);
    const parsed = parseBoard(JSON.parse(JSON.stringify(voice)));
    const node = parsed?.nodes.find((entry) => entry.kind === 'voice');
    expect(node?.kind === 'voice' ? node.title : '').toBe('Harbor');
    expect(node?.kind === 'voice' ? node.durationMs : 0).toBe(2400);
    expect(node?.kind === 'voice' ? node.assetId : '').toBe('asset-voice');
    expect(JSON.stringify(parsed).includes(marker)).toBe(false);
    expect(parseBoard({ ...createEmptyBoard(now), schemaVersion: 15 })?.schemaVersion).toBe(16);
    expect(parseBoard({ ...createEmptyBoard(now), schemaVersion: 2 })?.schemaVersion).toBe(16);
    expect(parseBoard({ ...createEmptyBoard(now), schemaVersion: 17 })).toBeNull();
    const legacy = voiceOn(createEmptyBoard(now), 'asset-voice', 'Harbor', 2400);
    expect(parseBoard({ ...legacy, schemaVersion: 15 })).toBeNull();
    expect(parseBoard(badVoice(voice, { title: '  Harbor' }))).toBeNull();
    expect(parseBoard(badVoice(voice, { title: 'a'.repeat(121) }))).toBeNull();
    expect(parseBoard(badVoice(voice, { title: 'Har\u0000bor' }))).toBeNull();
    expect(parseBoard(badVoice(voice, { durationMs: 0 }))).toBeNull();
    expect(parseBoard(badVoice(voice, { durationMs: VOICE_MAX_MS + 1 }))).toBeNull();
    expect(parseBoard(badVoice(voice, { durationMs: 1.5 }))).toBeNull();
    expect(parseBoard(badVoice(voice, { x: Number.NaN }))).toBeNull();
    expect(parseBoard(badVoice(voice, { assetId: '' }))).toBeNull();
    expect(parseBoard(badVoice(voice, { lastEditedAt: 'yesterday' }))).toBeNull();
    expect(parseBoard(badVoice(voice, { width: VOICE_MIN_WIDTH - 1 }))).toBeNull();
    expect(parseBoard(badVoice(voice, { height: VOICE_MIN_HEIGHT - 1 }))).toBeNull();
    expect(defaultVoiceTitle(new Date(2026, 10, 15))).toBe('Voice note · Nov 15, 2026');
    expect(canonicalAudioMime('audio/webm;codecs=opus')).toBe('audio/webm;codecs=opus');
    expect(canonicalAudioMime('audio/mp4')).toBe('audio/mp4');
    expect(canonicalAudioMime('video/webm')).toBeNull();
    expect(audioFilename('Harbor note', 'audio/mp4')).toBe('Harbor-note.m4a');
    expect(preferredRecorderMime((mime) => mime === 'audio/mp4')).toBe('audio/mp4');
    expect(recordingSupport({ isSecureContext: false, mediaDevices: { getUserMedia() {} }, MediaRecorder: function Recorder() {} }).ok).toBe(false);
    expect(voiceSaveProblem(0, 0)).toBe('The recording was empty.');
    expect(voiceSaveProblem(0, ARCHIVE_LIMITS.maxFileBytes + 1)).toBe('The recording is too large to keep.');
    expect(voiceSaveProblem(EMBEDDED_ASSET_BUDGET, 1)).toBe('This board does not have room for that recording.');
    expect(entryProblem('assets/a.bin', ARCHIVE_LIMITS.maxFileBytes + 1, new Set(), 0)).toBe('The archive is too large to import.');
  });

  test('records only after start and releases the microphone on every exit', async () => {
    const denied = harness({ manual: true });
    denied.capture.start();
    expect(denied.calls).toBe(1);
    denied.reject(new DOMException('no', 'NotAllowedError'));
    await flush();
    expect(denied.capture.snapshot().phase).toBe('error');
    expect(denied.capture.snapshot().error).toBe('Microphone permission was denied.');
    expect(denied.capture.recording()).toBeNull();

    const missing = harness({ getUserMedia: undefined });
    expect(missing.calls).toBe(0);
    missing.capture.start();
    expect(missing.capture.snapshot().error).toBe('This browser cannot record audio.');

    const late = harness({ manual: true });
    expect(late.calls).toBe(0);
    late.capture.start();
    expect(late.calls).toBe(1);
    late.capture.cancel();
    const abandoned = late.resolve();
    await flush();
    expect(abandoned.tracks[0]?.stopped).toBe(true);
    expect(late.capture.snapshot().phase).toBe('idle');
    expect(late.capture.recording()).toBeNull();

    const recorded = harness({ manual: true });
    recorded.capture.start();
    const stream = recorded.resolve();
    await flush();
    expect(recorded.capture.snapshot().phase).toBe('recording');
    expect(recorded.capture.elapsed()).toBe(0);
    recorded.clock = 1500;
    expect(recorded.capture.elapsed()).toBe(1500);
    recorded.capture.start();
    expect(recorded.calls).toBe(1);
    recorded.capture.stop();
    recorded.capture.stop();
    expect(recorded.capture.snapshot().phase).toBe('ready');
    expect(recorded.capture.recording()?.blob.size).toBe(marker.length);
    expect([...new Uint8Array(await recorded.capture.recording()!.blob.arrayBuffer())]).toEqual([...new TextEncoder().encode(marker)]);
    expect(stream.tracks[0]?.stopped).toBe(true);

    const empty = harness({ manual: true, bytes: new Uint8Array() });
    empty.capture.start();
    empty.resolve();
    await flush();
    empty.clock = 20;
    empty.capture.stop();
    expect(empty.capture.snapshot().error).toBe('The recording was empty.');
    expect(empty.capture.recording()).toBeNull();
    expect(empty.streams[0]?.tracks[0]?.stopped).toBe(true);

    const broken = harness({ manual: true, mimeType: 'audio/xyz' });
    broken.capture.start();
    broken.resolve();
    await flush();
    broken.clock = 20;
    broken.capture.stop();
    expect(broken.capture.snapshot().error).toContain('audio format');
    expect(broken.streams[0]?.tracks[0]?.stopped).toBe(true);

    const failed = harness({ manual: true, failConstructor: true });
    failed.capture.start();
    failed.resolve();
    await flush();
    expect(failed.capture.snapshot().phase).toBe('error');
    expect(failed.streams[0]?.tracks[0]?.stopped).toBe(true);

    const errored = harness({ manual: true });
    errored.capture.start();
    const live = errored.resolve();
    await flush();
    errored.recorder?.emitError();
    expect(errored.capture.snapshot().phase).toBe('error');
    expect(live.tracks[0]?.stopped).toBe(true);

    const ended = harness({ manual: true });
    ended.capture.start();
    const ending = ended.resolve();
    await flush();
    ended.clock = 40;
    ending.tracks[0]?.end();
    expect(ended.capture.snapshot().phase).toBe('ready');
    expect(ending.tracks[0]?.stopped).toBe(true);

    const capped = harness({ manual: true, maxDurationMs: 1000 });
    capped.capture.start();
    capped.resolve();
    await flush();
    capped.clock = 1000;
    capped.capture.enforceTimeLimit();
    expect(capped.capture.snapshot().phase).toBe('ready');

    const heavy = harness({ manual: true, maxBytes: 4, bytes: new Uint8Array(8) });
    heavy.capture.start();
    heavy.resolve();
    await flush();
    heavy.recorder?.emit(new Blob([new Uint8Array(8)], { type: 'audio/webm' }));
    expect(heavy.capture.snapshot().error).toBe('The recording is too large to keep.');
    expect(heavy.capture.recording()).toBeNull();
    expect(heavy.streams[0]?.tracks[0]?.stopped).toBe(true);

    const stale = harness({ manual: true, deferStop: true });
    stale.capture.start();
    const firstWait = stale.pending[0]?.resolve;
    stale.capture.cancel();
    stale.capture.start();
    const first = new FakeStream();
    const second = new FakeStream();
    firstWait?.(first);
    stale.pending[1]?.resolve(second);
    await flush();
    expect(first.tracks[0]?.stopped).toBe(true);
    expect(second.tracks[0]?.stopped).toBe(false);
    expect(stale.capture.snapshot().phase).toBe('recording');
    stale.capture.stop();
    stale.capture.interrupt();
    stale.recorder?.finish();
    await flush();
    expect(stale.capture.recording()).toBeNull();
    expect(second.tracks[0]?.stopped).toBe(true);
  });

  test('keeps audio through history, duplication, IndexedDB, and object URLs', async () => {
    const blob = new Blob([marker], { type: 'audio/webm' });
    const asset = createAssetRecord(blob, 'audio/webm', now);
    let board = voiceOn(createEmptyBoard(now), asset.id, 'Harbor', 1800);
    const node = board.nodes.find((entry) => entry.kind === 'voice') as VoiceNode;
    expect(referencedAssetIds(board).has(asset.id)).toBe(true);
    expect(planAssetWrite(board, [asset], []).upserts.map((entry) => entry.id)).toEqual([asset.id]);
    const renamed = renameVoice(board, node.id, 'Harbor west', now);
    expect(renamed.nodes.find((entry) => entry.id === node.id)?.kind === 'voice' ? (renamed.nodes.find((entry) => entry.id === node.id) as VoiceNode).title : '').toBe('Harbor west');
    const history = pushHistory(createHistory(), board);
    const removed = deleteSelection(renamed, [node.id], now);
    expect(removed.removedAssetIds).toEqual([asset.id]);
    expect(retainedAssetIds(removed.board, history).has(asset.id)).toBe(true);
    const undone = undoHistory(history, removed.board);
    expect(undone?.board.nodes.some((entry) => entry.id === node.id && entry.kind === 'voice')).toBe(true);
    const redone = undone ? redoHistory(undone.history, undone.board) : null;
    expect(redone?.board.nodes.some((entry) => entry.kind === 'voice')).toBe(false);
    const copied = duplicateSelection(board, [node.id], now);
    const twins = copied.nodes.filter((entry) => entry.kind === 'voice');
    expect(twins).toHaveLength(2);
    expect(twins.every((entry) => entry.kind === 'voice' && entry.assetId === asset.id)).toBe(true);
    const one = deleteSelection(copied, [twins[0]!.id], now);
    expect(one.removedAssetIds).toHaveLength(0);
    expect(referencedAssetIds(one.board).has(asset.id)).toBe(true);
    const grouped = groupSelection(board, [node.id], now);
    const groupedVoice = 'error' in grouped ? null : grouped.board.nodes.find((entry) => entry.kind === 'voice');
    expect(groupedVoice?.kind === 'voice' ? groupedVoice.assetId : 'error' in grouped ? grouped.error : '').toBe(asset.id);
    const groupId = 'error' in grouped ? '' : grouped.board.nodes.find((entry) => entry.kind === 'group')?.id ?? '';
    const opened = 'error' in grouped ? grouped : { board: ungroup(grouped.board, [groupId], now) };
    expect('error' in opened ? '' : opened.board.nodes.find((entry) => entry.kind === 'voice')?.assetId).toBe(asset.id);
    const text = createTextNode({ x: 400, y: 40 }, 'Pier', now);
    const linkedBoard = addNodes(board, [text], now);
    const voice = linkedBoard.nodes.find((entry) => entry.kind === 'voice');
    const linked = voice ? connectNodes(linkedBoard, voice.id, text.id, 'right', 'left', now) : null;
    expect(linked?.edges).toHaveLength(1);
    expect(dragBodyUpdates([{ type: 'position', id: node.id, dragging: true }], [{ id: node.id, kind: 'voice' }])).toEqual([{ id: node.id, dragging: true }]);

    const database = memoryDatabase();
    await writeBoardSnapshot(database, board, [asset], [], { id: board.id, revision: board.revision });
    const loaded = await readSession(database);
    const restored = loaded?.assets.find((entry) => entry.id === asset.id);
    expect(restored ? await restored.blob.text() : '').toBe(marker);
    expect(loaded?.board.nodes.some((entry) => entry.kind === 'voice' && entry.assetId === asset.id)).toBe(true);

    const failing = failingDatabase(board, 'QuotaExceededError');
    const statuses: string[] = [];
    const queue = new SaveQueue(failing, () => board, (status) => statuses.push(status));
    queue.adopt(board);
    queue.addAssets([asset]);
    queue.saveNow();
    await queue.idle();
    expect(statuses[statuses.length - 1]).toBe('error');
    expect(statuses.includes('saved')).toBe(false);
    expect(queue.pendingSummary().upserts).toBe(1);

    const registry = createObjectUrlRegistry();
    expect(registry.remember(asset)).toBeNull();
    const keeper = createAudioUrlKeeper();
    const first = keeper.acquire(asset);
    const second = keeper.acquire(asset);
    expect(first).toBe(second);
    expect(keeper.size()).toBe(1);
    keeper.release(asset.id);
    expect(keeper.size()).toBe(1);
    keeper.release(asset.id);
    expect(keeper.size()).toBe(0);
    keeper.revokeAll();

    const projection = createNodeProjection();
    const missing = projection.project([node], projectionInput(new Map(), true))[0];
    expect(missing?.type).toBe('voice');
    expect(missing?.type === 'voice' ? missing.data.missing : false).toBe(true);
    expect(missing?.type === 'voice' ? missing.data.readOnly : false).toBe(true);
    const present = projection.project([node], projectionInput(new Map([[asset.id, asset]]), false))[0];
    expect(present?.type === 'voice' ? present.data.missing : true).toBe(false);
  });

  test('round-trips voice bytes in ZIP v2 and refuses a broken clipboard asset', async () => {
    const bytes = new TextEncoder().encode(marker);
    const board = voiceOn(createEmptyBoard(now), 'voice-1', 'Harbor', 900);
    const fileBoard = addNodes(board, [createFileNode({ center: { x: 20, y: 20 }, assetId: 'file-1', filename: 'notes.pdf', now })], now);
    const imageBoard = addNodes(fileBoard, [createEmbeddedImageNode({ center: { x: 80, y: 80 }, assetId: 'image-1', intrinsicWidth: 40, intrinsicHeight: 20, now })], now);
    const assets = [
      asset('voice-1', 'audio/webm', bytes),
      asset('file-1', 'application/pdf', new Uint8Array([1, 2, 3, 4])),
      asset('image-1', 'image/png', new Uint8Array([137, 80, 78, 71])),
    ];
    const packed = await buildArchive(imageBoard, assets, now);
    const opened = await readArchive(packed);
    if ('error' in opened) throw new Error(opened.error);
    expect(opened.summary.voices).toBe(1);
    expect(opened.summary.files).toBe(1);
    expect(opened.summary.embedded).toBe(1);
    const restored = opened.assets.find((entry) => entry.id === 'voice-1');
    expect(restored?.mimeType).toBe('audio/webm');
    expect(restored ? [...new Uint8Array(await restored.blob.arrayBuffer())] : []).toEqual([...bytes]);
    const legacy = await readArchive(await versionOne(packed));
    expect('error' in legacy ? legacy.error : 'ok').toBe('ok');
    const tampered = await readArchive(await withBadChecksum(packed, 'assets/voice-1.bin'));
    expect('error' in tampered ? tampered.error : '').toBe('An archived file does not match its checksum.');
    const stripped = await readArchive(await withoutAsset(packed, 'assets/voice-1.bin'));
    expect('error' in stripped ? stripped.error : '').toContain('missing');
    const wrong = await readArchive(await withMime(packed, 'voice-1', 'image/png'));
    expect('error' in wrong ? wrong.error : '').toBe('A voice note does not match its recording.');
    let inconsistent = '';
    try {
      await buildArchive(addNodes(board, [createFileNode({ center: { x: 0, y: 0 }, assetId: 'voice-1', filename: 'same.bin', now })], now), assets, now);
    } catch (error) {
      inconsistent = error instanceof Error ? error.message : '';
    }
    expect(inconsistent).toBe('An attachment is stored in an inconsistent way.');

    const voice = board.nodes.find((entry) => entry.kind === 'voice');
    const closure = voice ? selectionClosure(board, [voice.id]) : null;
    const encoded = closure ? encodeGraphClipboard(closure) : '';
    expect(encoded.includes(marker)).toBe(false);
    expect(encoded.includes('audio/webm')).toBe(false);
    const pasted = closure ? pasteGraph(board, closure, { x: 30, y: 30 }, new Set(['voice-1']), 0, now) : null;
    const copy = pasted && !('error' in pasted) ? pasted.nodes.find((entry) => entry.kind === 'voice' && entry.id !== voice?.id) : null;
    expect(copy?.kind === 'voice' ? copy.assetId : '').toBe('voice-1');
    const rejected = closure ? pasteGraph(createEmptyBoard(now), closure, { x: 0, y: 0 }, new Set(), 0, now) : null;
    expect(rejected && 'error' in rejected ? rejected.error : '').toBe('That copy refers to a recording that is not on this board.');
  });

  test('searches titles and dates, and keeps recording edits behind the read-only gate', async () => {
    const board = voiceOn(createEmptyBoard(now), 'voice-1', 'Harbor bell', 1000);
    const voice = board.nodes.find((entry) => entry.kind === 'voice') as VoiceNode;
    const index = buildSearchIndex(board.nodes);
    expect(searchNodes(index, 'harbor').map((hit) => hit.kind)).toEqual(['voice']);
    const dated = queryBoard(board.nodes, buildContentIndex(board.nodes), 'Nov 15, 2026', new Date('2026-11-15T12:00:00.000Z'));
    expect(dated.results.some((result) => result.kind === 'voice' && result.title === 'Harbor bell')).toBe(true);
    expect(dated.matchIds).toContain(voice.id);
    const scene = classifyXray({
      nodes: board.nodes.map((node) => ({ id: node.id, parentId: 'parentId' in node ? node.parentId : undefined })),
      edges: [],
      matchIds: dated.matchIds,
      enabled: true,
      showConnections: true,
      active: true,
    });
    expect(scene.nodes.get(voice.id)).toBe('match');
    const text = createTextNode({ x: 300, y: 0 }, 'Pier', now);
    const linked = connectNodes(addNodes(board, [text], now), voice.id, text.id, 'right', 'left', now);
    const connected = classifyXray({
      nodes: linked?.nodes.map((node) => ({ id: node.id, parentId: 'parentId' in node ? node.parentId : undefined })) ?? [],
      edges: linked?.edges.map((edge) => ({ id: edge.id, sourceId: edge.sourceId, targetId: edge.targetId })) ?? [],
      matchIds: [voice.id],
      enabled: true,
      showConnections: true,
      active: true,
    });
    expect(connected.nodes.get(text.id)).toBe('context');
    const search = await Bun.file(new URL('../domain/search.ts', import.meta.url)).text();
    expect(search.includes('isProtectedTextNode(node)')).toBe(true);
    expect(search.includes("node.kind === 'image' || node.kind === 'drawing'")).toBe(true);
    const view = await Bun.file(new URL('../components/BoardView.tsx', import.meta.url)).text();
    expect(view.includes('if (readOnly) setVoiceOpen(false)')).toBe(true);
    expect(view.includes('if (blockedRef.current) return;')).toBe(true);
    const toolbar = await Bun.file(new URL('../components/Toolbar.tsx', import.meta.url)).text();
    expect(toolbar.includes('aria-label="Record voice note"')).toBe(true);
    expect(toolbar.includes('disabled={readOnly}')).toBe(true);
    const node = await Bun.file(new URL('../components/VoiceNoteNode.tsx', import.meta.url)).text();
    expect(node.includes('nodrag nopan')).toBe(true);
    expect(node.includes('Audio unavailable')).toBe(true);
  });
});

function voiceOn(board: Board, assetId: string, title: string, durationMs: number): Board {
  return addNodes(board, [createVoiceNode({ center: { x: 0, y: 0 }, assetId, title, durationMs, now })], now);
}

function badVoice(board: Board, patch: Record<string, unknown>): Board {
  return {
    ...board,
    nodes: board.nodes.map((node) => (node.kind === 'voice' ? { ...node, ...patch } : node)),
  };
}

function asset(id: string, mimeType: string, bytes: Uint8Array): AssetRecord {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return { id, mimeType, byteSize: copy.byteLength, createdAt: now, blob: new Blob([copy.buffer], { type: mimeType }) };
}

function projectionInput(library: Map<string, AssetRecord>, readOnly: boolean) {
  return {
    selected: new Set<string>(),
    editingId: null,
    readOnly,
    unlocked: new Map<string, { text: string }>(),
    registry: null,
    library,
  };
}

function flush(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

class FakeTrack {
  readyState = 'live';
  stopped = false;
  private ended: Array<() => void> = [];
  stop(): void {
    this.readyState = 'ended';
    this.stopped = true;
  }
  addEventListener(type: 'ended', listener: () => void): void {
    if (type === 'ended') this.ended.push(listener);
  }
  end(): void {
    this.readyState = 'ended';
    for (const listener of this.ended) listener();
  }
}

class FakeStream implements CaptureStream {
  tracks = [new FakeTrack()];
  getTracks(): FakeTrack[] {
    return this.tracks;
  }
}

class FakeRecorder implements CaptureRecorder {
  state = 'inactive';
  mimeType: string;
  private listeners: Record<'dataavailable' | 'stop' | 'error', Array<(event: { data?: Blob }) => void>> = {
    dataavailable: [],
    stop: [],
    error: [],
  };
  constructor(mimeType: string, private readonly bytes: Uint8Array, private readonly deferStop: boolean) {
    this.mimeType = mimeType;
  }
  start(): void {
    this.state = 'recording';
  }
  stop(): void {
    if (this.state === 'inactive') return;
    this.state = 'inactive';
    if (this.deferStop) return;
    this.finish();
  }
  addEventListener(type: 'dataavailable' | 'stop' | 'error', listener: (event: { data?: Blob }) => void): void {
    this.listeners[type].push(listener);
  }
  emit(data: Blob): void {
    for (const listener of this.listeners.dataavailable) listener({ data });
  }
  emitError(): void {
    for (const listener of this.listeners.error) listener({});
  }
  finish(): void {
    const copy = new Uint8Array(this.bytes.byteLength);
    copy.set(this.bytes);
    this.emit(new Blob([copy.buffer], { type: this.mimeType }));
    for (const listener of this.listeners.stop) listener({});
  }
}

function harness(options: {
  manual?: boolean;
  getUserMedia?: undefined;
  mimeType?: string;
  bytes?: Uint8Array;
  maxBytes?: number;
  maxDurationMs?: number;
  failConstructor?: boolean;
  deferStop?: boolean;
} = {}) {
  const streams: FakeStream[] = [];
  const pending: Array<{ resolve: (stream: FakeStream) => void; reject: (error: unknown) => void }> = [];
  let calls = 0;
  let clock = 0;
  let recorder: FakeRecorder | null = null;
  const capture = new VoiceCapture({
    getUserMedia: options.getUserMedia === undefined && Object.prototype.hasOwnProperty.call(options, 'getUserMedia')
      ? undefined
      : () => {
          calls += 1;
          if (options.manual) {
            return new Promise((resolve, reject) => pending.push({ resolve, reject }));
          }
          const stream = new FakeStream();
          streams.push(stream);
          return Promise.resolve(stream);
        },
    createRecorder: (stream, mimeType) => {
      if (options.failConstructor) throw new Error('no recorder');
      recorder = new FakeRecorder(options.mimeType ?? mimeType ?? 'audio/webm', options.bytes ?? new TextEncoder().encode(marker), options.deferStop === true);
      streams.push(stream as FakeStream);
      return recorder;
    },
    now: () => clock,
    isTypeSupported: (mime) => mime === 'audio/webm;codecs=opus',
    preferredMime: preferredRecorderMime,
    maxDurationMs: options.maxDurationMs ?? VOICE_MAX_MS,
    maxBytes: options.maxBytes ?? ARCHIVE_LIMITS.maxFileBytes,
  });
  return {
    capture,
    pending,
    streams,
    get calls() {
      return calls;
    },
    get clock() {
      return clock;
    },
    set clock(value: number) {
      clock = value;
    },
    get recorder() {
      return recorder;
    },
    resolve() {
      const stream = new FakeStream();
      streams.push(stream);
      pending.shift()?.resolve(stream);
      return stream;
    },
    reject(error: unknown) {
      pending.shift()?.reject(error);
    },
  };
}

function failingDatabase(board: Board, name: string) {
  const error = new Error('storage unavailable');
  error.name = name;
  return {
    transaction() {
      return {
        objectStore() {
          return { get: () => Promise.resolve(board), put: () => undefined, delete: () => undefined };
        },
        abort() {},
        done: Promise.reject(error),
      };
    },
  } as unknown as ConstructorParameters<typeof SaveQueue>[0];
}

function memoryDatabase() {
  const boards = new Map<string, unknown>();
  const assets = new Map<string, AssetRecord>();
  return {
    async get(store: string, key: string) {
      return store === 'board' ? boards.get(key) : assets.get(key);
    },
    async getAll(store: string) {
      return store === 'assets' ? [...assets.values()] : [...boards.values()];
    },
    async delete() {},
    transaction() {
      return {
        objectStore(name: string) {
          return {
            get: (key: string) => Promise.resolve(name === 'board' ? boards.get(key) : assets.get(key)),
            put: (value: AssetRecord | Board, key?: string) => {
              if (name === 'board') boards.set(key ?? ACTIVE_BOARD_KEY, value);
              else if (value && typeof value === 'object' && 'id' in value) assets.set(value.id, value as AssetRecord);
            },
            delete: (id: string) => {
              assets.delete(id);
            },
          };
        },
        abort() {},
        done: Promise.resolve(),
      };
    },
  } as unknown as ConstructorParameters<typeof SaveQueue>[0];
}

async function versionOne(bytes: Uint8Array): Promise<Uint8Array> {
  const files = unzipSync(bytes);
  const manifest = JSON.parse(new TextDecoder().decode(files['manifest.json'] ?? new Uint8Array())) as { archiveVersion: number };
  manifest.archiveVersion = 1;
  files['manifest.json'] = strToU8(JSON.stringify(manifest));
  return zipSync(files);
}

async function withBadChecksum(bytes: Uint8Array, path: string): Promise<Uint8Array> {
  const files = unzipSync(bytes);
  const manifest = JSON.parse(new TextDecoder().decode(files['manifest.json'] ?? new Uint8Array())) as { assets: Array<{ path: string; sha256: string }> };
  const target = manifest.assets.find((entry) => entry.path === path);
  if (!target) throw new Error('missing asset');
  target.sha256 = await sha256(Uint8Array.from([1]));
  files['manifest.json'] = strToU8(JSON.stringify(manifest));
  return zipSync(files);
}

async function withoutAsset(bytes: Uint8Array, path: string): Promise<Uint8Array> {
  const files = unzipSync(bytes);
  delete files[path];
  return zipSync(files);
}

async function withMime(bytes: Uint8Array, id: string, mimeType: string): Promise<Uint8Array> {
  const files = unzipSync(bytes);
  const manifest = JSON.parse(new TextDecoder().decode(files['manifest.json'] ?? new Uint8Array())) as { assets: Array<{ id: string; mimeType: string }> };
  const target = manifest.assets.find((entry) => entry.id === id);
  if (!target) throw new Error('missing asset');
  target.mimeType = mimeType;
  files['manifest.json'] = strToU8(JSON.stringify(manifest));
  return zipSync(files);
}

import { describe, expect, test } from 'bun:test';
import { ARCHIVE_VERSION } from '../archive/format';
import { buildArchive, readArchive } from '../archive/zip';
import { createEdgeProjection, createNodeProjection } from '../components/flow-projection';
import { addNodes, createEmbeddedImageNode, createEmptyBoard, createFileNode, createTextNode } from '../domain/board';
import { connectNodes } from '../domain/graph';
import { GRAPH_CLIPBOARD_VERSION, selectionClosure } from '../domain/graph-clipboard';
import { groupSelection } from '../domain/groups';
import { relaxBoard } from '../domain/physics';
import { buildSearchIndex, searchNodes } from '../domain/search';
import { finalizeCulledEdgeLabel, isFinalUnmount, nextOwnedSession, textCleanupAction, type OwnedSession } from '../editor/cull-edit';
import { relaxDrag } from '../editor/pulling';
import { readRasterDimensions } from '../ingest/image-optimizer-config';
import { SYNTHETIC_PNG } from './synthetic-png';
import { createObjectUrlRegistry, isDisplayAsset } from '../persistence/object-urls';
import { SCHEMA_VERSION, type AssetRecord, type BoardNode, type TextNode } from '../domain/types';

declare const Bun: { file(path: URL): { text(): Promise<string> } };

const now = '2026-11-15T00:00:00.000Z';

describe('viewport projection', () => {
  test('reuses unchanged nodes and refreshes selection, editing, protection, and assets', () => {
    const keep = note('keep', 0, 'Keep this');
    const other = note('other', 300, 'Other');
    const projection = createNodeProjection();
    const input = blankInput();
    const first = projection.project([keep, other], input);
    const nextOther = { ...other, text: 'Changed' };
    const second = projection.project([keep, nextOther], input);
    expect(second[0]).toBe(first[0]);
    expect(second.find((node) => node.id === 'other')?.data && 'text' in second.find((node) => node.id === 'other')!.data ? (second.find((node) => node.id === 'other')!.data as { text: string }).text : '').toBe('Changed');
    const selected = projection.project([keep, nextOther], { ...input, selected: new Set(['keep']) });
    expect(selected.find((node) => node.id === 'keep')?.selected).toBe(true);
    expect(selected.find((node) => node.id === 'other')).toBe(second.find((node) => node.id === 'other'));
    const editing = projection.project([keep, nextOther], { ...input, editingId: 'keep' });
    const editingNode = editing.find((node) => node.id === 'keep');
    expect(editingNode?.type === 'text' ? editingNode.data.editing : false).toBe(true);
    expect(editingNode?.draggable).toBe(false);
    const locked = protectedNote();
    const hidden = projection.project([locked], input);
    expect(hidden[0]?.type === 'text' ? hidden[0].data.text : 'x').toBe('');
    expect(hidden[0]?.type === 'text' ? hidden[0].data.unlocked : true).toBe(false);
    const shown = projection.project([locked], { ...input, unlocked: new Map([['locked', { text: 'secret note' }]]) });
    expect(shown[0]?.type === 'text' ? shown[0].data.text : '').toBe('secret note');
    expect(shown[0]?.type === 'text' ? shown[0].data.unlocked : false).toBe(true);
    const image = createEmbeddedImageNode({ center: { x: 20, y: 20 }, assetId: 'pic', intrinsicWidth: 20, intrinsicHeight: 20, now });
    image.id = 'pic-node';
    const library = new Map([['pic', asset('pic', 'image/png', 4)]]);
    let url = 'blob:one';
    const withUrl = projection.project([image], { ...input, library, registry: { get: () => url } });
    expect(withUrl[0]?.type === 'image' ? withUrl[0].data.src : '').toBe('blob:one');
    url = 'blob:two';
    const replaced = projection.project([image], { ...input, library, registry: { get: () => url } });
    expect(replaced[0]?.type === 'image' ? replaced[0].data.src : '').toBe('blob:two');
    const gone = projection.project([image], { ...input, library, registry: { get: () => null } });
    expect(gone[0]?.type === 'image' ? gone[0].data.src : 'x').toBeNull();
  });

  test('keeps group geometry, movement, and file metadata without stale entries', async () => {
    const child = note('child', 100, 'inside');
    const outside = note('outside', 900, 'outside');
    const framed = groupSelection(addNodes(createEmptyBoard(now), [child, outside], now), ['child'], now);
    if ('error' in framed) throw new Error(framed.error);
    const projection = createNodeProjection();
    const projected = projection.project(framed.board.nodes, blankInput());
    const childFlow = projected.find((node) => node.id === 'child');
    expect(childFlow?.parentId).toBe(framed.board.nodes.find((node) => node.kind === 'group')?.id);
    expect(childFlow?.position.x).toBe(20);
    expect(childFlow?.position.y).toBe(20);
    const moved = framed.board.nodes.map((node) => node.id === 'outside' ? { ...node, x: node.x + 40, width: node.width + 12 } : node);
    const again = projection.project(moved, blankInput());
    const outsideFlow = again.find((node) => node.id === 'outside');
    expect(outsideFlow?.position.x).toBe((projected.find((node) => node.id === 'outside')?.position.x ?? 0) + 40);
    expect(outsideFlow?.width).toBe((projected.find((node) => node.id === 'outside')?.width ?? 0) + 12);
    expect(again.find((node) => node.id === 'child')).toBe(childFlow);
    const many = Array.from({ length: 40 }, (_, index) => note(`n${index}`, index * 20, `body ${index}`));
    const crowded = projection.project(many, blankInput());
    const trimmed = projection.project(many.slice(1).map((node, index) => index === 0 ? { ...node, text: 'fresh' } : node), blankInput());
    expect(trimmed.some((node) => node.id === 'n0')).toBe(false);
    expect(trimmed.find((node) => node.id === 'n1')?.type === 'text' ? (trimmed.find((node) => node.id === 'n1')?.data as { text: string }).text : '').toBe('fresh');
    expect(trimmed.find((node) => node.id === 'n2')).toBe(crowded.find((node) => node.id === 'n2'));
    const file = createFileNode({ center: { x: 0, y: 0 }, assetId: 'bin', filename: 'report.pdf', now });
    const board = addNodes(createEmptyBoard(now), [file], now);
    const packed = await buildArchive(board, [asset('bin', 'application/pdf', 3)], now);
    const opened = await readArchive(packed);
    if ('error' in opened) throw new Error(opened.error);
    const imported = projection.project(opened.board.nodes, {
      ...blankInput(),
      library: new Map(opened.assets.map((entry) => [entry.id, entry])),
    });
    const fileFlow = imported.find((node) => node.type === 'file');
    expect(fileFlow?.type === 'file' ? fileFlow.data.filename : '').toBe('report.pdf');
    expect(fileFlow?.type === 'file' ? fileFlow.data.missing : true).toBe(false);
  });

  test('projects relationship labels, styles, and selection, and enables viewport culling', async () => {
    const edges = createEdgeProjection();
    const plain = { id: 'e1', sourceId: 'a', targetId: 'b', sourceHandle: 'right' as const, targetHandle: 'left' as const, restLength: 10, label: 'sees', style: 'red-string' as const };
    const other = { ...plain, id: 'e2', label: undefined, style: 'dashed' as const };
    const first = edges.project([plain, other], new Set(['e1']));
    expect(first[0]?.data && typeof first[0].data === 'object' && 'label' in first[0].data ? first[0].data.label : '').toBe('sees');
    expect(first[0]?.className).toBe('relationship-string');
    expect(first[0]?.selected).toBe(true);
    expect(first[1]?.className).toBe('relationship-dashed');
    const again = edges.project([plain, other], new Set(['e1']));
    expect(again).toBe(first);
    expect(again[1]).toBe(first[1]);
    const source = await Bun.file(new URL('../components/BoardView.tsx', import.meta.url)).text();
    expect(source.includes('onlyRenderVisibleElements')).toBe(true);
    expect(SCHEMA_VERSION).toBe(12);
    expect(ARCHIVE_VERSION).toBe(2);
    expect(GRAPH_CLIPBOARD_VERSION).toBe(1);
  });
});

describe('culled editing', () => {
  test('commits a culled edge draft once and finishes a culled text edit once', async () => {
    expect(isFinalUnmount(1, 1)).toBe(true);
    expect(isFinalUnmount(1, 2)).toBe(false);
    expect(finalizeCulledEdgeLabel({ finalUnmount: false, closed: false, cancelled: false, owns: true })).toBe('ignore');
    expect(finalizeCulledEdgeLabel({ finalUnmount: true, closed: true, cancelled: false, owns: true })).toBe('ignore');
    expect(finalizeCulledEdgeLabel({ finalUnmount: true, closed: false, cancelled: true, owns: true })).toBe('clear');
    expect(finalizeCulledEdgeLabel({ finalUnmount: true, closed: false, cancelled: false, owns: true })).toBe('commit');
    expect(finalizeCulledEdgeLabel({ finalUnmount: true, closed: false, cancelled: false, owns: false })).toBe('commit-only');
    expect(finalizeCulledEdgeLabel({ finalUnmount: true, closed: false, cancelled: true, owns: false })).toBe('ignore');
    const switched = switchEditingSessions();
    expect(switched.duringNextSession.textBefore).toBe('b');
    expect(switched.duringNextSession.saves).toEqual([]);
    expect(switched.afterClose.saves).toEqual(['b']);
    expect(switched.afterClose.history).toEqual(['b']);
    expect(switched.edgeOpen).toBe(true);
    expect(switched.edgeOwner).toBe('edge-b');
    expect(switched.committed).toEqual(['edge-a']);
  });

  test('uses a decodable png in the performance fixture', async () => {
    expect(readRasterDimensions(SYNTHETIC_PNG, 'image/png')).toEqual({ width: 1, height: 1 });
    const stream = new DecompressionStream('deflate');
    const writer = stream.writable.getWriter();
    const reader = stream.readable.getReader();
    const read = reader.read().then(async (first) => {
      const bytes = first.value ? [...first.value] : [];
      while (true) {
        const next = await reader.read();
        if (next.done) break;
        if (next.value) bytes.push(...next.value);
      }
      return bytes;
    });
    const idat = pngChunk(SYNTHETIC_PNG, 'IDAT');
    const copy = new Uint8Array(idat.byteLength);
    copy.set(idat);
    await writer.write(copy);
    await writer.close();
    expect(await read).toEqual([0, 255, 0, 0]);
    const fixture = await Bun.file(new URL('../../scripts/make-perf-board.ts', import.meta.url)).text();
    expect(fixture.includes('SYNTHETIC_PNG')).toBe(true);
    expect(fixture.includes('intrinsicWidth: 1, intrinsicHeight: 1')).toBe(true);
  });
});

describe('physics and display urls', () => {
  test('matches the previous tension results for links, groups, and offscreen endpoints', () => {
    const board = linked([['a', 0, 0], ['b', 800, 40]], 'a', 'b', 120);
    const stretched = relaxBoard(board, ['a'], 40);
    close(position(stretched, 'a').x, -120);
    close(position(stretched, 'a').y, -70);
    close(position(stretched, 'b').x, 288.4049598949714);
    close(position(stretched, 'b').y, -57.97107429321632);
    const far = linked([['c', 0, 0], ['d', 4000, -2000]], 'c', 'd', 200);
    const farRelaxed = relaxBoard(far, ['c'], 40);
    close(position(farRelaxed, 'd').x, 3472.1129561686894);
    close(position(farRelaxed, 'd').y, -1853.038806472708);
    const loose = relaxBoard(board, [], 40);
    close(position(loose, 'a').x, 99.93753634357456);
    close(position(loose, 'b').x, 460.0624636564254);
    const child = note('e', 100, 'e');
    const outsider = note('f', 900, 'f');
    const framed = groupSelection(addNodes(createEmptyBoard(now), [child, outsider], now), ['e'], now);
    if ('error' in framed) throw new Error(framed.error);
    const joined = connectNodes(framed.board, 'e', 'f', 'right', 'left', now);
    if (!joined) throw new Error('missing link');
    const grouped = relaxBoard({ ...joined, edges: joined.edges.map((edge) => ({ ...edge, restLength: 80 })) }, ['f'], 40);
    const group = grouped.nodes.find((node) => node.kind === 'group');
    close(position(grouped, 'e').x, 20);
    close(position(grouped, 'e').y, 20);
    close(position(grouped, 'f').x, 780);
    close(group?.x ?? 0, 278.27317362892273);
    close(group?.y ?? 0, 21.366899058175804);
    expect(relaxDrag(board, ['a'], { projectEnabled: true, shiftHeld: true, draggedNodeCount: 1, live: true, settle: true })).toBe(board);
    const pulling = relaxDrag(board, ['a'], { projectEnabled: true, shiftHeld: false, draggedNodeCount: 1, live: true, settle: true });
    expect(position(pulling, 'a').x).toBe(-120);
    expect(position(pulling, 'b').x < 680).toBe(true);
  });

  test('skips display urls for file attachments and still serves images', () => {
    installUrlStub();
    expect(isDisplayAsset({ mimeType: 'application/pdf' })).toBe(false);
    expect(isDisplayAsset({ mimeType: 'image/png' })).toBe(true);
    const registry = createObjectUrlRegistry();
    const file = asset('file', 'application/octet-stream', 2);
    const image = asset('image', 'image/png', 2);
    expect(registry.remember(file)).toBeNull();
    expect(registry.get(file.id)).toBeNull();
    const url = registry.remember(image);
    expect(typeof url).toBe('string');
    registry.revoke(image.id);
    expect(registry.get(image.id)).toBeNull();
    const restored = registry.remember(image);
    expect(typeof restored).toBe('string');
    registry.revokeAll();
    expect(registry.get(image.id)).toBeNull();
  });

  test('search and clipboard still include nodes outside any viewport', () => {
    const near = note('near', 0, 'desk');
    const far = note('far', 12000, 'lighthouse');
    const file = createFileNode({ center: { x: 14000, y: 0 }, assetId: 'bin', filename: 'chart.pdf', now });
    const board = addNodes(createEmptyBoard(now), [near, far, file], now);
    const hits = searchNodes(buildSearchIndex(board.nodes), 'lighthouse');
    expect(hits.some((hit) => hit.id === 'far')).toBe(true);
    const files = searchNodes(buildSearchIndex(board.nodes), 'chart.pdf');
    expect(files.some((hit) => hit.id === file.id)).toBe(true);
    const copied = selectionClosure(board, ['far', file.id]);
    expect(copied?.nodes.map((node) => node.id).sort()).toEqual(['far', file.id].sort());
  });
});

function blankInput() {
  return {
    selected: new Set<string>(),
    editingId: null,
    readOnly: false,
    unlocked: new Map<string, { text: string }>(),
    registry: null,
    library: new Map<string, AssetRecord>(),
  };
}

function note(id: string, x: number, text: string): BoardNode {
  const node = createTextNode({ x, y: x === 100 ? 100 : x === 900 ? 120 : 0 }, text, now);
  node.id = id;
  return node;
}

function protectedNote(): TextNode {
  const node = createTextNode({ x: 0, y: 0 }, 'hidden', now);
  node.id = 'locked';
  node.text = '';
  node.protection = { version: 1 } as NonNullable<TextNode['protection']>;
  return node;
}

function linked(points: Array<[string, number, number]>, source: string, target: string, restLength: number) {
  const nodes = points.map(([id, x, y]) => {
    const node = createTextNode({ x, y }, id, now);
    node.id = id;
    return node;
  });
  const board = addNodes(createEmptyBoard(now), nodes, now);
  const joined = connectNodes(board, source, target, 'right', 'left', now);
  if (!joined) throw new Error('missing link');
  return { ...joined, edges: joined.edges.map((edge) => ({ ...edge, restLength })) };
}

function position(board: { nodes: readonly BoardNode[] }, id: string) {
  const node = board.nodes.find((entry) => entry.id === id);
  return { x: node?.x ?? Number.NaN, y: node?.y ?? Number.NaN };
}

function close(actual: number, expected: number) {
  expect(Math.abs(actual - expected) < 0.000001).toBe(true);
}

function asset(id: string, mimeType: string, size: number): AssetRecord {
  return { id, mimeType, byteSize: size, createdAt: now, blob: new Blob([new Uint8Array(size)]) };
}

function switchEditingSessions() {
  let serial = 0;
  let session: OwnedSession | null = null;
  let textBefore: string | null = null;
  const saves: string[] = [];
  const history: string[] = [];
  function begin(id: string) {
    const opened = nextOwnedSession(serial, id);
    serial = opened.token;
    session = opened.session;
    textBefore = id;
    return opened.token;
  }
  function end(token: number) {
    if (textCleanupAction(session, token) === 'ignore') return;
    const snapshot = textBefore;
    textBefore = null;
    const id = session?.id ?? '';
    session = null;
    if (snapshot) history.push(snapshot);
    saves.push(id);
  }
  const first = begin('a');
  const second = begin('b');
  end(first);
  const duringNextSession = { textBefore, saves: [...saves], history: [...history] };
  end(second);
  end(second);
  const afterClose = { saves: [...saves], history: [...history] };

  let edgeSerial = 0;
  let edge: OwnedSession | null = null as OwnedSession | null;
  let edgeOpen = false;
  const committed: string[] = [];
  function claim(id: string) {
    const opened = nextOwnedSession(edgeSerial, id);
    edgeSerial = opened.token;
    edge = opened.session;
    edgeOpen = true;
    return opened.token;
  }
  function cleanup(id: string, token: number, cancelled: boolean) {
    const owner = edge;
    const action = finalizeCulledEdgeLabel({
      finalUnmount: true,
      closed: false,
      cancelled,
      owns: owner?.id === id && owner.token === token,
    });
    if (action === 'ignore') return;
    if ((action === 'commit' || action === 'clear') && owner?.id === id && owner.token === token) {
      edge = null;
      edgeOpen = false;
    }
    if (action === 'commit' || action === 'commit-only') committed.push(id);
  }
  const edgeA = claim('edge-a');
  claim('edge-b');
  cleanup('edge-a', edgeA, false);
  const owner = edge;
  return { duringNextSession, afterClose, edgeOpen, edgeOwner: owner ? owner.id : '', committed };
}

function pngChunk(bytes: Uint8Array, type: string): Uint8Array {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let offset = 8;
  while (offset + 8 <= bytes.length) {
    const length = view.getUint32(offset);
    const name = String.fromCharCode(bytes[offset + 4] ?? 0, bytes[offset + 5] ?? 0, bytes[offset + 6] ?? 0, bytes[offset + 7] ?? 0);
    if (name === type) return bytes.slice(offset + 8, offset + 8 + length);
    offset += 12 + length;
  }
  return new Uint8Array();
}

function installUrlStub() {
  const urlApi = URL as unknown as { createObjectURL?: (blob: Blob) => string; revokeObjectURL?: (url: string) => void };
  if (urlApi.createObjectURL && urlApi.revokeObjectURL) return;
  let count = 0;
  urlApi.createObjectURL = () => `blob:test-${count += 1}`;
  urlApi.revokeObjectURL = () => undefined;
}

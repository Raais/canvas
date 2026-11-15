import { describe, expect, test } from 'bun:test';
import { ARCHIVE_VERSION } from '../archive/format';
import { buildArchive, readArchive } from '../archive/zip';
import { WEBP_OPTIMIZER_V1 } from '../ingest/image-optimizer-config';
import {
  addNodes,
  applyPhysicsPreference,
  createEmbeddedImageNode,
  createEmptyBoard,
  createExternalImageNode,
  createTextNode,
  parseBoard,
  physicsIsEnabled,
  setImageRotation,
  setPhysicsEnabled,
} from '../domain/board';
import { connectNodes } from '../domain/graph';
import { GRAPH_CLIPBOARD_VERSION } from '../domain/graph-clipboard';
import { createHistory, pushHistory, undoHistory } from '../domain/history';
import { formatStoredMegabytes, lookupEmbeddedByteSize, nodeDateLabelText, nodeDateTitle } from '../domain/image-size';
import { imageContentTransform } from '../domain/image-rotation';
import { formatNodeDate } from '../domain/node-date';
import { relaxBoard } from '../domain/physics';
import { buildSearchIndex, searchNodes } from '../domain/search';
import { groupSelection } from '../domain/groups';
import { gesturePhase } from '../editor/interaction';
import {
  FLOW_MULTI_SELECTION_KEYS,
  FLOW_SELECTION_KEY,
  dragBodyUpdates,
  effectivePullingForce,
  nextShiftHeld,
  relaxDrag,
  shouldRelaxDrag,
  syncDragLedger,
} from '../editor/pulling';
import { SCHEMA_VERSION, type Board, type BoardNode } from '../domain/types';

declare const Bun: { file(path: URL): { text(): Promise<string> } };

const now = '2026-11-15T09:00:00.000Z';
const later = '2026-11-15T10:00:00.000Z';

function text(id: string, x: number): BoardNode {
  return { id, kind: 'text', x, y: 0, width: 40, height: 40, text: id, lastEditedAt: now };
}

function stretched(): Board {
  const linked = connectNodes(addNodes(createEmptyBoard(now), [text('a', 0), text('b', 400)], now), 'a', 'b', 'right', 'left', now);
  if (!linked) throw new Error('expected a link');
  return { ...linked, edges: linked.edges.map((edge) => ({ ...edge, restLength: 0 })) };
}

function xOf(board: Board, id: string): number {
  return board.nodes.find((node) => node.id === id)?.x ?? -1;
}

describe('project pulling force', () => {
  test('defaults on for new boards and legacy documents', () => {
    const created = createEmptyBoard(now);
    expect(SCHEMA_VERSION).toBe(17);
    expect(created.schemaVersion).toBe(17);
    expect(created.physicsEnabled).toBe(undefined);
    expect(physicsIsEnabled(created)).toBe(true);
    const legacy = parseBoard({
      schemaVersion: 1,
      id: 'board-1',
      title: 'Kept',
      createdAt: now,
      updatedAt: now,
      revision: 2,
      viewport: { x: 1, y: 2, zoom: 1 },
      nodes: [text('n', 0)],
      edges: [],
    });
    expect(legacy?.schemaVersion).toBe(17);
    expect(physicsIsEnabled(legacy ?? created)).toBe(true);
    for (const schemaVersion of [2, 3, 4, 5, 6, 7, 8, 9, 10, 11]) {
      const parsed = parseBoard({ ...created, schemaVersion });
      expect(parsed?.schemaVersion).toBe(17);
      expect(parsed?.physicsEnabled).toBe(undefined);
      expect(physicsIsEnabled(parsed ?? created)).toBe(true);
    }
  });

  test('persists off, restores on, and rejects invalid values without touching nodes', () => {
    const board = addNodes(createEmptyBoard(now), [text('a', 4)], now);
    const off = setPhysicsEnabled(board, false, later);
    expect(off.physicsEnabled).toBe(false);
    expect(off.nodes).toBe(board.nodes);
    expect(off.edges).toBe(board.edges);
    expect(off.nodes[0]?.kind === 'text' ? off.nodes[0].lastEditedAt : '').toBe(now);
    expect(parseBoard(JSON.parse(JSON.stringify(off)))?.physicsEnabled).toBe(false);
    const on = setPhysicsEnabled(off, true, later);
    expect(on.physicsEnabled).toBe(undefined);
    expect(physicsIsEnabled(on)).toBe(true);
    expect(setPhysicsEnabled(on, true, later)).toBe(on);
    expect(setPhysicsEnabled(off, false, later)).toBe(off);
    expect(parseBoard({ ...board, physicsEnabled: true })?.physicsEnabled).toBe(undefined);
    for (const physicsEnabled of ['off', 0, 1, null, []]) {
      expect(parseBoard({ ...board, physicsEnabled })).toBeNull();
    }
    const contours = parseBoard({
      ...createEmptyBoard(now),
      schemaVersion: 7,
      backgroundPattern: 'topographic-contours',
      topographicContours: { seed: 4, rendererVersion: 1 },
    });
    const atlas = parseBoard({
      ...createEmptyBoard(now),
      schemaVersion: 9,
      backgroundPattern: 'dither-atlas',
      ditherAtlas: { seed: 3, rendererVersion: 3 },
    });
    expect(contours?.topographicContours).toEqual({ seed: 4, rendererVersion: 1 });
    expect(atlas?.ditherAtlas).toEqual({ seed: 3, rendererVersion: 3 });
    expect(physicsIsEnabled(contours ?? board)).toBe(true);
    expect(physicsIsEnabled(atlas ?? board)).toBe(true);
    expect(parseBoard({ schemaVersion: 15, id: 'x', nodes: [], edges: [] })).toBeNull();
  });

  test('keeps the preference through a zip and through undo', async () => {
    const off = setPhysicsEnabled(addNodes(createEmptyBoard(now), [text('a', 0), text('b', 80)], now), false, later);
    const archive = await readArchive(await buildArchive(off, [], now));
    expect('error' in archive ? '' : archive.board.physicsEnabled).toBe(false);
    expect(ARCHIVE_VERSION).toBe(2);
    expect(GRAPH_CLIPBOARD_VERSION).toBe(1);
    const undone = undoHistory(pushHistory(createHistory(), off), setPhysicsEnabled(off, true, later));
    expect(physicsIsEnabled(undone?.board ?? off)).toBe(true);
    const keptOff = undoHistory(pushHistory(createHistory(), createEmptyBoard(now)), off);
    expect(keptOff?.board.physicsEnabled).toBe(false);
    expect(applyPhysicsPreference(true, off, true, later)).toBe(off);
    expect(applyPhysicsPreference(false, off, true, later).physicsEnabled).toBe(undefined);
  });
});

describe('shift drag gate', () => {
  test('inverts only a single dragged body and gates live and final pulling', () => {
    expect(effectivePullingForce(true, false, 1)).toBe(true);
    expect(effectivePullingForce(true, true, 1)).toBe(false);
    expect(effectivePullingForce(false, false, 1)).toBe(false);
    expect(effectivePullingForce(false, true, 1)).toBe(true);
    expect(effectivePullingForce(true, true, 2)).toBe(true);
    expect(effectivePullingForce(false, true, 3)).toBe(false);
    expect(FLOW_SELECTION_KEY).toBe('Shift');
    expect([...FLOW_MULTI_SELECTION_KEYS]).toEqual(['Meta', 'Control']);
    const board = stretched();
    const rest = board.edges[0]?.restLength;
    const pulled = relaxDrag(board, ['a'], { projectEnabled: true, shiftHeld: false, draggedNodeCount: 1, live: true, settle: false });
    expect(xOf(pulled, 'b')).toBe(xOf(relaxBoard(board, ['a'], 4), 'b'));
    expect(xOf(pulled, 'b') < 400).toBe(true);
    expect(xOf(pulled, 'a')).toBe(0);
    expect(pulled.edges[0]?.restLength).toBe(rest);
    const released = relaxDrag(board, ['a'], { projectEnabled: false, shiftHeld: true, draggedNodeCount: 1, live: false, settle: true });
    expect(xOf(released, 'b')).toBe(xOf(relaxBoard(board, ['a'], 40), 'b'));
    const held = relaxDrag(board, ['a'], { projectEnabled: true, shiftHeld: true, draggedNodeCount: 1, live: true, settle: true });
    expect(held).toBe(board);
    expect(xOf(held, 'b')).toBe(400);
    const multi = relaxDrag(board, ['a', 'b'], { projectEnabled: false, shiftHeld: true, draggedNodeCount: 2, live: true, settle: true });
    expect(multi).toBe(board);
    const ledger = new Set<string>();
    expect(syncDragLedger(ledger, [{ id: 'group', dragging: true }])).toBe(1);
    expect(effectivePullingForce(true, nextShiftHeld(false, 'shift-down'), ledger.size)).toBe(false);
    expect(effectivePullingForce(false, nextShiftHeld(false, 'shift-down'), ledger.size)).toBe(true);
    expect(effectivePullingForce(false, nextShiftHeld(true, 'shift-up'), ledger.size)).toBe(false);
    expect(syncDragLedger(ledger, [{ id: 'group', dragging: false }])).toBe(1);
    expect(ledger.size).toBe(0);
    expect(nextShiftHeld(true, 'blur')).toBe(false);
    expect(nextShiftHeld(true, 'hide')).toBe(false);
    expect(nextShiftHeld(true, 'cancel')).toBe(false);
    expect(nextShiftHeld(false, { pointer: true })).toBe(true);
    const nodes = [
      { id: 'group', kind: 'group' },
      { id: 'child', kind: 'text', parentId: 'group' },
      { id: 'other', kind: 'image' },
    ];
    expect(dragBodyUpdates([{ type: 'position', id: 'note', dragging: true }], [{ id: 'note', kind: 'text' }])).toEqual([{ id: 'note', dragging: true }]);
    expect(dragBodyUpdates([{ type: 'position', id: 'picture', dragging: true }], [{ id: 'picture', kind: 'image' }])).toEqual([{ id: 'picture', dragging: true }]);
    expect(dragBodyUpdates([
      { type: 'position', id: 'group', dragging: true },
      { type: 'position', id: 'child', dragging: true },
    ], nodes)).toEqual([{ id: 'group', dragging: true }]);
    expect(dragBodyUpdates([
      { type: 'position', id: 'note', dragging: true },
      { type: 'position', id: 'other', dragging: true },
    ], [{ id: 'note', kind: 'text' }, { id: 'other', kind: 'image' }])).toHaveLength(2);
    expect(dragBodyUpdates([{ type: 'select', id: 'note' }], [{ id: 'note', kind: 'text' }])).toHaveLength(0);
    expect(dragBodyUpdates([{ type: 'dimensions', id: 'note', dragging: true }], [{ id: 'note', kind: 'text' }])).toHaveLength(0);
    expect(shouldRelaxDrag(false, false)).toBe(false);
    expect(shouldRelaxDrag(true, false)).toBe(true);
    expect(shouldRelaxDrag(false, true)).toBe(true);
    const grouped = groupSelection(addNodes(createEmptyBoard(now), [text('child', 40), text('out', 500)], now), ['child'], now);
    if ('error' in grouped) throw new Error(grouped.error);
    expect(dragBodyUpdates([
      { type: 'position', id: grouped.board.nodes.find((node) => node.kind === 'group')?.id ?? '', dragging: true },
      { type: 'position', id: 'child', dragging: true },
    ], grouped.board.nodes).map((update) => update.id)).toEqual([grouped.board.nodes.find((node) => node.kind === 'group')?.id ?? '']);
  });

  test('uses one history entry when shift changes during the drag', async () => {
    const board = stretched();
    let current = board;
    let beforeSettle = board;
    let tracking = false;
    let history = createHistory();
    const steps = [
      { shiftHeld: false, live: true, settle: false },
      { shiftHeld: true, live: true, settle: false },
      { shiftHeld: false, live: true, settle: false },
      { shiftHeld: true, live: false, settle: true },
    ];
    for (const step of steps) {
      const next = relaxDrag(current, ['a'], { projectEnabled: true, shiftHeld: step.shiftHeld, draggedNodeCount: 1, live: step.live, settle: step.settle });
      const phase = gesturePhase({
        sawDrag: step.live,
        dragFinished: step.settle,
        resizeActive: false,
        resizeFinished: false,
        barePosition: false,
        changed: next !== current,
        tracking,
      });
      if (phase === 'live') tracking = true;
      if (phase === 'commit') {
        history = pushHistory(history, board);
        tracking = false;
      }
      if (step.settle) beforeSettle = current;
      current = next;
    }
    expect(history.past).toHaveLength(1);
    expect(xOf(current, 'b')).toBe(xOf(beforeSettle, 'b'));
    expect(xOf(current, 'b') < 400).toBe(true);
    const source = await Bun.file(new URL('../components/BoardView.tsx', import.meta.url)).text();
    expect(source.includes('relaxDrag(')).toBe(true);
    expect(source.includes('syncDragLedger(')).toBe(true);
    expect(source.includes('dragBodyUpdates(')).toBe(true);
    expect(source.includes('shouldRelaxDrag(')).toBe(true);
    expect(source.includes('selectionKeyCode={FLOW_SELECTION_KEY}')).toBe(true);
    expect(source.includes('multiSelectionKeyCode={[...FLOW_MULTI_SELECTION_KEYS]}')).toBe(true);
    expect(source.includes("selectionKeyCode=\"Shift\"")).toBe(false);
  });
});

describe('image size labels', () => {
  test('formats stored megabytes and omits unknown sizes', () => {
    expect(formatStoredMegabytes(300_000)).toBe('0.3MB');
    expect(formatStoredMegabytes(1_500_000)).toBe('1.5MB');
    expect(formatStoredMegabytes(1_700_000)).toBe('1.7MB');
    expect(formatStoredMegabytes(2_750_000)).toBe('2.8MB');
    expect(formatStoredMegabytes(4_200_000)).toBe('4.2MB');
    expect(formatStoredMegabytes(10_000_000)).toBe('10.0MB');
    expect(formatStoredMegabytes(800_000)).toBe('0.8MB');
    expect(formatStoredMegabytes(0)).toBe('0.0MB');
    expect(formatStoredMegabytes(1)).toBe('<0.1MB');
    expect(formatStoredMegabytes(99_999)).toBe('<0.1MB');
    expect(formatStoredMegabytes(100_000)).toBe('0.1MB');
    expect(formatStoredMegabytes(undefined)).toBeNull();
    expect(formatStoredMegabytes(null)).toBeNull();
    expect(formatStoredMegabytes(Number.NaN)).toBeNull();
    expect(formatStoredMegabytes(Number.POSITIVE_INFINITY)).toBeNull();
    expect(formatStoredMegabytes(-5)).toBeNull();
    const library = new Map([
      ['png', { byteSize: 300_000 }],
      ['jpeg', { byteSize: 1_700_000 }],
      ['webp', { byteSize: 800_000 }],
      ['gif', { byteSize: 4_200_000 }],
      ['avif', { byteSize: 2_750_000 }],
    ]);
    for (const [id, label] of [['png', '0.3MB'], ['jpeg', '1.7MB'], ['webp', '0.8MB'], ['gif', '4.2MB'], ['avif', '2.8MB']] as const) {
      expect(formatStoredMegabytes(lookupEmbeddedByteSize({ type: 'embedded', assetId: id }, library))).toBe(label);
    }
    expect(lookupEmbeddedByteSize({ type: 'embedded', assetId: 'png' }, library)).toBe(lookupEmbeddedByteSize({ type: 'embedded', assetId: 'png' }, library));
    expect(lookupEmbeddedByteSize({ type: 'embedded', assetId: 'missing' }, library)).toBe(undefined);
    expect(lookupEmbeddedByteSize({ type: 'external' }, library)).toBe(undefined);
    expect(nodeDateLabelText('-', 300_000)).toBe('0.3MB | -');
    expect(nodeDateLabelText('-', undefined)).toBe('-');
    expect(nodeDateTitle('No date', 300_000)).toBe('No date · 300000 bytes');
    expect(nodeDateTitle('No date', undefined)).toBe('No date');
    const clock = new Date(2026, 10, 15, 12, 0, 0);
    const dated = formatNodeDate(new Date(clock.getTime() - 3 * 60_000).toISOString(), clock);
    expect(dated.label).toBe('3m ago | 15/11');
    expect(nodeDateLabelText(dated.label, 300_000)).toBe('0.3MB | 3m ago | 15/11');
    expect(nodeDateLabelText('3m ago | 15/11', undefined)).toBe('3m ago | 15/11');
    expect(WEBP_OPTIMIZER_V1.quality).toBe(0.82);
    expect(imageContentTransform({ width: 120, height: 80, degrees: 0, flipX: false, flipY: false })).toBe('scale(1, 1)');
  });

  test('reads the stored asset from a zip and leaves timestamps alone', async () => {
    const bytes = new Uint8Array(300_000);
    const blob = new Blob([bytes], { type: 'image/png' });
    const image = createEmbeddedImageNode({ center: { x: 20, y: 20 }, assetId: 'asset-1', intrinsicWidth: 40, intrinsicHeight: 30, now });
    const rotated = setImageRotation(addNodes(createEmptyBoard(now), [image], now), image.id, 15, later);
    expect(rotated.nodes[0]?.kind === 'image' ? rotated.nodes[0].lastEditedAt : '').toBe(now);
    const archive = await readArchive(await buildArchive(rotated, [{ id: 'asset-1', mimeType: 'image/png', byteSize: blob.size, createdAt: now, blob }], now));
    if ('error' in archive) throw new Error(archive.error);
    const restored = archive.assets[0];
    expect(restored?.byteSize).toBe(300_000);
    const library = new Map(archive.assets.map((asset) => [asset.id, asset]));
    const source = archive.board.nodes[0]?.kind === 'image' ? archive.board.nodes[0].source : { type: 'external' };
    expect(lookupEmbeddedByteSize(source, library)).toBe(300_000);
    expect(formatStoredMegabytes(lookupEmbeddedByteSize(source, library))).toBe('0.3MB');
    const copy = archive.board.nodes[0];
    expect(copy?.kind === 'image' ? lookupEmbeddedByteSize(copy.source, library) : 0).toBe(300_000);
    const external = createExternalImageNode({ center: { x: 0, y: 0 }, url: 'https://example.com/a.png', intrinsicWidth: 10, intrinsicHeight: 10, sizedFromImage: true, now });
    expect(lookupEmbeddedByteSize(external.source, library)).toBe(undefined);
    const sizeSource = await Bun.file(new URL('../domain/image-size.ts', import.meta.url)).text();
    expect(sizeSource.includes('fetch(')).toBe(false);
    const before = archive.board.revision;
    nodeDateLabelText(formatNodeDate(now, new Date(now)).label, restored?.byteSize);
    expect(archive.board.revision).toBe(before);
    expect(archive.board.nodes[0]?.kind === 'image' ? archive.board.nodes[0].lastEditedAt : '').toBe(now);
    const hits = searchNodes(buildSearchIndex([createTextNode({ x: 0, y: 0 }, 'alpha note', now)]), 'alpha');
    expect(hits).toHaveLength(1);
    const css = await Bun.file(new URL('../styles/app.css', import.meta.url)).text();
    expect(css.includes('.text-note:hover > .node-date')).toBe(true);
    expect(css.includes('.image-note.is-selected > .node-date')).toBe(true);
    expect(css.includes('opacity: 0')).toBe(true);
    expect(css.includes('.node-date { transition: none; }')).toBe(true);
  });
});

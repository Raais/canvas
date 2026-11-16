import { describe, expect, test } from 'bun:test';
import { ARCHIVE_VERSION } from '../archive/format';
import { buildArchive, readArchive } from '../archive/zip';
import { seedFromProjectName } from '../backgrounds/atlas-seed';
import { addNodes, createEmptyBoard, createTextNode, parseBoard, renameBoard, setBackgroundPattern } from '../domain/board';
import { cameraDuration, clampCamera, farthestZoom, noteJumpZoom } from '../domain/camera';
import { worldBounds } from '../domain/geometry';
import { connectNodes } from '../domain/graph';
import { GRAPH_CLIPBOARD_VERSION, decodeGraphClipboard, encodeGraphClipboard, selectionClosure } from '../domain/graph-clipboard';
import { duplicateSelection, groupSelection } from '../domain/groups';
import { createHistory, pushHistory, redoHistory, undoHistory } from '../domain/history';
import { labelGestureCommits, nextLabelAction, setEdgeLabel, setEdgeStyle } from '../domain/relationships';
import { addSavedView, deleteSavedView, editSavedView, nextViewName, recallViewport, renameSavedView, updateSavedView } from '../domain/saved-views';
import { SEARCH_LIMIT, buildSearchIndex, centerOf, fold, noteTitle, resultBounds, searchNodes } from '../domain/search';
import { plainShortcutBlocked, searchShortcut } from '../editor/shortcuts';
import type { BoardNode } from '../domain/types';

declare const Bun: { file(path: URL): { text(): Promise<string> } };

const now = '2026-11-14T00:00:00.000Z';

function text(id: string, x: number, y: number, value: string): BoardNode {
  return { id, kind: 'text', x, y, width: 180, height: 80, text: value };
}

function linked() {
  let board = addNodes(createEmptyBoard(now), [text('a', 0, 0, 'Alice'), text('b', 240, 0, 'Bob')], now);
  const next = connectNodes(board, 'a', 'b', 'right', 'left', now);
  if (!next) throw new Error('link');
  board = next;
  const edge = board.edges[0];
  if (!edge) throw new Error('edge');
  return { board, edge };
}

describe('schema v6', () => {
  test('new boards are atlas v3 with an empty view list', () => {
    const board = createEmptyBoard(now);
    expect(board.schemaVersion).toBe(18);
    expect(board.backgroundPattern).toBe('dither-atlas');
    expect(board.ditherAtlas).toEqual({ seed: seedFromProjectName('Untitled board'), rendererVersion: 3 });
    expect(board.savedViews).toEqual([]);
    expect(parseBoard(board)?.schemaVersion).toBe(18);
  });

  test('older boards keep their background, edges, and gain an empty view list', () => {
    const legacy = parseBoard({
      schemaVersion: 5,
      id: 'old',
      title: 'Dots',
      createdAt: now,
      updatedAt: now,
      revision: 2,
      appearance: 'light',
      backgroundPattern: 'grid',
      nodes: [text('a', 0, 0, 'Kept')],
      edges: [{ id: 'e', sourceId: 'a', targetId: 'a', sourceHandle: 'right', targetHandle: 'left', restLength: 1 }],
      viewport: { x: 3, y: 4, zoom: 1 },
    });
    expect(legacy).toBeNull();
    const dots = parseBoard({
      schemaVersion: 4,
      id: 'old',
      title: 'Dots',
      createdAt: now,
      updatedAt: now,
      revision: 2,
      appearance: 'dark',
      backgroundPattern: 'dots',
      nodes: [text('a', 1, 2, 'Kept')],
      edges: [],
      viewport: { x: 3, y: 4, zoom: 1.2 },
    });
    expect(dots?.schemaVersion).toBe(18);
    expect(dots?.backgroundPattern).toBe('dots');
    expect(dots?.ditherAtlas).toBe(undefined);
    expect(dots?.savedViews).toEqual([]);
    expect(dots?.edges).toEqual([]);
    for (const pattern of ['grid', 'cross', 'blank'] as const) {
      const parsed = parseBoard({ ...createEmptyBoard(), schemaVersion: 3, backgroundPattern: pattern, ditherAtlas: undefined });
      expect(parsed?.backgroundPattern).toBe(pattern);
    }
    const atlas = parseBoard({
      ...createEmptyBoard(),
      schemaVersion: 5,
      backgroundPattern: 'dither-atlas',
      ditherAtlas: { seed: 42, rendererVersion: 1 },
    });
    expect(atlas?.ditherAtlas).toEqual({ seed: 42, rendererVersion: 1 });
    expect(parseBoard({ ...createEmptyBoard(), ditherAtlas: { seed: 7, rendererVersion: 2 } })?.ditherAtlas?.rendererVersion).toBe(2);
    expect(parseBoard({ schemaVersion: 8, id: 'x', nodes: [], edges: [], savedViews: [] })).toBeNull();
  });

  test('v6 rejects bad labels, styles, and saved views', () => {
    const base = createEmptyBoard();
    const edge = { id: 'e', sourceId: 'a', targetId: 'b', sourceHandle: 'right', targetHandle: 'left', restLength: 10 };
    const nodes = [text('a', 0, 0, 'A'), text('b', 20, 0, 'B')];
    const good = parseBoard({ ...base, nodes, edges: [{ ...edge, label: 'paid', style: 'dashed' }] });
    expect(good?.edges[0]?.label).toBe('paid');
    expect(good?.edges[0]?.style).toBe('dashed');
    expect(parseBoard({ ...base, nodes, edges: [{ ...edge, label: 'x'.repeat(81) }] })).toBeNull();
    expect(parseBoard({ ...base, nodes, edges: [{ ...edge, label: 'bad\nlabel' }] })).toBeNull();
    expect(parseBoard({ ...base, nodes, edges: [{ ...edge, style: 'wavy' }] })).toBeNull();
    const view = { id: 'v', name: 'Overview', viewport: { x: 1, y: 2, zoom: 1 } };
    expect(parseBoard({ ...base, savedViews: [view] })?.savedViews).toEqual([view]);
    expect(parseBoard({ ...base, savedViews: [view, { ...view }] })).toBeNull();
    expect(parseBoard({ ...base, savedViews: [{ ...view, name: '   ' }] })).toBeNull();
    expect(parseBoard({ ...base, savedViews: [{ ...view, viewport: { x: Number.NaN, y: 0, zoom: 1 } }] })).toBeNull();
    expect(parseBoard({ ...base, savedViews: [{ ...view, viewport: { x: 0, y: 0, zoom: 0.05 } }] })).toBeNull();
    expect(parseBoard({ ...base, savedViews: [{ ...view, viewport: { x: 0, y: 0, zoom: 7 } }] })).toBeNull();
    expect(parseBoard({ ...base, savedViews: undefined })).toBeNull();
    const many = Array.from({ length: 33 }, (_, index) => ({ id: `v${index}`, name: `View ${index + 1}`, viewport: { x: 0, y: 0, zoom: 1 } }));
    expect(parseBoard({ ...base, savedViews: many })).toBeNull();
  });
});

describe('search', () => {
  test('ranks titles ahead of body text and stays stable', () => {
    const nodes = [
      text('deep', 0, 0, 'A long note\nmentions atlas later'),
      text('title', 10, 0, 'Atlas plan'),
      text('empty', 20, 0, ''),
      text('code', 30, 0, 'function atlas() { return 1 }'),
      text('md', 40, 0, '# Atlas\n- [ ] task'),
      text('copy', 50, 0, 'Atlas plan'),
      { id: 'group', kind: 'group' as const, x: 0, y: 80, width: 200, height: 100, label: 'Atlas cluster' },
    ];
    const grouped = { ...nodes[2], parentId: 'group' } as BoardNode;
    nodes[2] = grouped;
    const index = buildSearchIndex(nodes);
    const hits = searchNodes(index, 'atlas');
    expect(hits.map((hit) => hit.id)).toEqual(['title', 'copy', 'group', 'code', 'md', 'deep']);
    expect(hits[0]?.title).toBe('Atlas plan');
    expect(searchNodes(index, 'ATLAS')[0]?.id).toBe('title');
    expect(searchNodes(index, 'atl')[0]?.id).toBe('title');
    expect(searchNodes(index, 'atlas plan')[0]?.id).toBe('title');
    expect(noteTitle('')).toBe('Untitled note');
    expect(searchNodes(index, 'untitled')[0]?.id).toBe('empty');
    expect(searchNodes(index, 'function')[0]?.id).toBe('code');
    expect(searchNodes(index, 'task')[0]?.id).toBe('md');
    expect(searchNodes(index, 'cluster')[0]?.kind).toBe('group');
    expect(searchNodes(index, 'missing')).toEqual([]);
    expect(fold('É') === fold('e\u0301')).toBe(true);
    const many = Array.from({ length: 30 }, (_, index) => text(`n${index}`, index, 0, 'alpha'));
    expect(searchNodes(buildSearchIndex(many), 'alpha')).toHaveLength(SEARCH_LIMIT);
    const board = { ...createEmptyBoard(), nodes };
    expect(searchNodes(buildSearchIndex(board.nodes), 'atlas')).toHaveLength(hits.length);
    expect(board.revision).toBe(createEmptyBoard().revision);
  });

  test('uses world bounds for a grouped child and does not take over editing keys', () => {
    const note = createTextNode({ x: 30, y: 40 }, 'Hidden child');
    const grouped = groupSelection(addNodes(createEmptyBoard(), [note]), [note.id]);
    if ('error' in grouped) throw new Error(grouped.error);
    const child = grouped.board.nodes.find((node) => node.id === note.id);
    const group = grouped.board.nodes.find((node) => node.kind === 'group');
    if (!child || child.kind === 'group' || !group) throw new Error('group');
    const bounds = resultBounds(grouped.board.nodes, child.id);
    const world = worldBounds(grouped.board.nodes, child);
    expect(bounds).toEqual(world);
    expect(bounds?.x).toBe(group.x + child.x);
    expect(bounds?.y).toBe(group.y + child.y);
    expect(centerOf(world)).toEqual({ x: world.x + world.width / 2, y: world.y + world.height / 2 });
    const frame = resultBounds(grouped.board.nodes, group.id);
    expect(frame).toEqual(worldBounds(grouped.board.nodes, group));
    expect(noteJumpZoom(0.2)).toBe(1);
    expect(noteJumpZoom(1.4)).toBe(1.4);
    const far = farthestZoom({ x: 0, y: 0, zoom: 1 }, 1000, 800);
    expect(far.zoom).toBe(0.1);
    expect(far.x).toBe(450);
    expect(far.y).toBe(360);
    expect(searchShortcut({ key: 'k', meta: true, ctrl: false, alt: false, shift: false, composing: false, repeat: false, editingField: false, confirming: false, editing: false })).toBe(true);
    expect(searchShortcut({ key: 'k', meta: false, ctrl: true, alt: false, shift: false, composing: false, repeat: false, editingField: true, confirming: false, editing: false })).toBe(false);
    expect(searchShortcut({ key: 'k', meta: true, ctrl: false, alt: false, shift: false, composing: true, repeat: false, editingField: false, confirming: true, editing: true })).toBe(false);
    expect(plainShortcutBlocked({
      defaultPrevented: false, composing: false, repeat: false, meta: false, ctrl: false, alt: false, shift: false,
      tag: 'INPUT', editable: false, inOverlay: true, editing: false, blocked: false,
    })).toBe(true);
    expect(cameraDuration(250) === 0 || cameraDuration(250) === 250).toBe(true);
  });
});

describe('relationships', () => {
  test('labels and styles change presentation only', () => {
    const { board, edge } = linked();
    expect(edge.style).toBe(undefined);
    expect(edge.label).toBe(undefined);
    const named = setEdgeLabel(board, edge.id, '  paid  ');
    if (!named) throw new Error('label');
    expect(named.edges[0]?.label).toBe('paid');
    expect(named.edges[0]?.sourceId).toBe(edge.sourceId);
    expect(named.edges[0]?.targetId).toBe(edge.targetId);
    expect(named.edges[0]?.sourceHandle).toBe(edge.sourceHandle);
    expect(named.edges[0]?.targetHandle).toBe(edge.targetHandle);
    expect(named.edges[0]?.restLength).toBe(edge.restLength);
    const cleared = setEdgeLabel(named, edge.id, '   ');
    expect(cleared?.edges[0]?.label).toBe(undefined);
    expect(setEdgeLabel(board, edge.id, 'x'.repeat(81))).toBeNull();
    expect(setEdgeLabel(board, edge.id, 'bad\nlabel')).toBeNull();
    expect(setEdgeLabel(named, edge.id, 'paid')).toBe(named);
    const dashed = setEdgeStyle(named, edge.id, 'dashed');
    const string = dashed ? setEdgeStyle(dashed, edge.id, 'red-string') : null;
    const solid = string ? setEdgeStyle(string, edge.id, 'solid') : null;
    expect(dashed?.edges[0]?.style).toBe('dashed');
    expect(string?.edges[0]?.style).toBe('red-string');
    expect(solid?.edges[0]?.style).toBe(undefined);
    expect(solid?.edges[0]?.restLength).toBe(edge.restLength);
    expect(setEdgeStyle(named, edge.id, 'wavy' as 'solid')).toBeNull();
    expect(labelGestureCommits('escape', false)).toBe(false);
    expect(labelGestureCommits('enter', false)).toBe(true);
    expect(labelGestureCommits('blur', false)).toBe(true);
    expect(labelGestureCommits('blur', true)).toBe(false);
    const cancelled = nextLabelAction(false, true, 'escape');
    expect(cancelled.commit).toBe(false);
    expect(nextLabelAction(cancelled.closed, false, 'blur').commit).toBe(false);
    const entered = nextLabelAction(false, false, 'enter');
    expect(entered.commit).toBe(true);
    expect(nextLabelAction(entered.closed, false, 'blur').commit).toBe(false);
    const history = pushHistory(createHistory(), board);
    const undone = undoHistory(history, named);
    expect(undone?.board.edges[0]?.label).toBe(undefined);
    const redone = undone ? redoHistory(undone.history, undone.board) : null;
    expect(redone?.board.edges[0]?.label).toBe('paid');
  });

  test('copy, duplication, and zip keep relationship metadata', async () => {
    const { board, edge } = linked();
    const named = setEdgeStyle(setEdgeLabel(board, edge.id, 'met') ?? board, edge.id, 'red-string');
    if (!named) throw new Error('style');
    const copied = selectionClosure(named, ['a', 'b']);
    const decoded = copied ? decodeGraphClipboard(encodeGraphClipboard(copied)) : null;
    expect(GRAPH_CLIPBOARD_VERSION).toBe(1);
    expect(decoded?.edges[0]?.label).toBe('met');
    expect(decoded?.edges[0]?.style).toBe('red-string');
    const group = groupSelection(named, ['a', 'b']);
    if ('error' in group) throw new Error(group.error);
    const frame = group.board.nodes.find((node) => node.kind === 'group');
    const closed = frame ? selectionClosure(group.board, [frame.id]) : null;
    expect(closed?.edges[0]?.label).toBe('met');
    const duplicate = duplicateSelection(named, ['a', 'b']);
    expect(duplicate.edges.filter((entry) => entry.label === 'met' && entry.style === 'red-string')).toHaveLength(2);
    const archive = await readArchive(await buildArchive(named, [], now));
    if ('error' in archive) throw new Error(archive.error);
    expect(archive.board.edges[0]?.label).toBe('met');
    expect(archive.board.edges[0]?.style).toBe('red-string');
    const dots = parseBoard({ ...createEmptyBoard(), schemaVersion: 5, backgroundPattern: 'dots', ditherAtlas: undefined });
    if (!dots) throw new Error('dots');
    const dotsArchive = await readArchive(await buildArchive(dots, [], now));
    if ('error' in dotsArchive) throw new Error(dotsArchive.error);
    expect(dotsArchive.board.backgroundPattern).toBe('dots');
    expect(ARCHIVE_VERSION).toBe(2);
    const physics = await Bun.file(new URL('../domain/physics.ts', import.meta.url)).text();
    expect(physics.includes('label')).toBe(false);
    expect(physics.includes('red-string')).toBe(false);
    expect(physics.includes('0.045')).toBe(true);
  });
});

describe('saved views', () => {
  test('stores an ordered camera list outside graph history', () => {
    const board = createEmptyBoard(now);
    const first = addSavedView(board, '  Overview  ', { x: 10, y: -4, zoom: 0.4 });
    if (!first) throw new Error('view');
    expect(first.savedViews[0]?.name).toBe('Overview');
    expect(first.savedViews[0]?.viewport).toEqual({ x: 10, y: -4, zoom: 0.4 });
    expect(first.savedViews[0]?.id.length > 0).toBe(true);
    const second = addSavedView(first, nextViewName(first.savedViews), { x: 2, y: 3, zoom: 2 });
    if (!second) throw new Error('second');
    expect(second.savedViews.map((view) => view.name)).toEqual(['Overview', 'View 1']);
    const renamed = renameSavedView(second, second.savedViews[0]?.id ?? '', 'Overview');
    expect(renamed).toBe(second);
    const retitled = renameSavedView(second, second.savedViews[0]?.id ?? '', 'Wide');
    expect(retitled?.savedViews[0]?.name).toBe('Wide');
    expect(retitled?.savedViews[0]?.viewport).toEqual(second.savedViews[0]?.viewport);
    const moved = updateSavedView(retitled ?? second, second.savedViews[1]?.id ?? '', { x: 8, y: 9, zoom: 1 });
    expect(moved?.savedViews[1]?.viewport).toEqual({ x: 8, y: 9, zoom: 1 });
    expect(updateSavedView(moved ?? second, second.savedViews[1]?.id ?? '', { x: 8, y: 9, zoom: 1 })).toBe(moved);
    const removed = deleteSavedView(moved ?? second, second.savedViews[0]?.id ?? '');
    expect(removed?.savedViews).toHaveLength(1);
    expect(addSavedView(board, '   ', { x: 0, y: 0, zoom: 1 })).toBeNull();
    expect(addSavedView(board, 'x'.repeat(61), { x: 0, y: 0, zoom: 1 })).toBeNull();
    let full = board;
    for (let index = 0; index < 32; index += 1) {
      const next = addSavedView(full, `Place ${index}`, { x: index, y: 0, zoom: 1 });
      if (!next) throw new Error('cap');
      full = next;
    }
    expect(addSavedView(full, 'Extra', { x: 0, y: 0, zoom: 1 })).toBeNull();
    expect(editSavedView(true, board, { type: 'add', name: 'Nope', viewport: { x: 0, y: 0, zoom: 1 } })).toBeNull();
    const recalled = recallViewport(first.savedViews[0] ?? { id: 'x', name: 'Overview', viewport: { x: 10, y: -4, zoom: 0.4 } });
    expect(recalled).toEqual({ x: 10, y: -4, zoom: 0.4 });
    expect(clampCamera({ x: 1, y: 2, zoom: 9 }).zoom).toBe(6);
    const round = parseBoard(JSON.parse(JSON.stringify(second)));
    expect(round?.savedViews.map((view) => view.name)).toEqual(['Overview', 'View 1']);
    const note = text('n', 0, 0, 'Before');
    const start = addNodes(board, [note], now);
    const history = pushHistory(createHistory(), start);
    const edited = { ...start, nodes: start.nodes.map((node) => node.id === 'n' && node.kind === 'text' ? { ...node, text: 'After' } : node), revision: start.revision + 1 };
    const withView = addSavedView(edited, 'Overview', { x: 5, y: 6, zoom: 1 });
    if (!withView) throw new Error('view');
    const undone = undoHistory(history, withView);
    expect(undone?.board.savedViews[0]?.name).toBe('Overview');
    const undoneNote = undone?.board.nodes.find((node) => node.id === 'n');
    expect(undoneNote?.kind === 'text' && undoneNote.text).toBe('Before');
    const redone = undone ? redoHistory(undone.history, undone.board) : null;
    expect(redone?.board.savedViews[0]?.name).toBe('Overview');
    const patterned = setBackgroundPattern(withView, 'grid');
    expect(patterned.savedViews).toEqual(withView.savedViews);
    const renamedBoard = renameBoard(withView, 'Heist');
    expect(renamedBoard.savedViews).toEqual(withView.savedViews);
    expect(renamedBoard.ditherAtlas?.seed).toBe(seedFromProjectName('Heist'));
  });
});

describe('contextual chrome containment', () => {
  test('search and saved views scroll inside their panels and toolbar buttons use the shared reset', async () => {
    const css = await Bun.file(new URL('../styles/app.css', import.meta.url)).text();
    const palette = await Bun.file(new URL('../components/SearchPalette.tsx', import.meta.url)).text();
    expect(css.includes('.search-palette {\n  top: 72px;')).toBe(true);
    expect(css.includes('max-height: calc(100dvh - 88px);')).toBe(true);
    expect(css.includes('#search-results,\n.views-list {\n  min-height: 0;\n  overflow-y: auto;')).toBe(true);
    expect(css.includes('.edge-tools button,\n.views-panel button')).toBe(true);
    expect(css.includes('overscroll-behavior-y: contain;')).toBe(true);
    expect(palette.includes('list.scrollTop')).toBe(true);
    expect(palette.includes('onClose()')).toBe(true);
    expect(palette.includes("onJump(results[selected].id)")).toBe(true);
  });
});

describe('atlas default wiring', () => {
  test('keeps the shader lazy and the dots fallback stored as atlas', async () => {
    const view = await Bun.file(new URL('../components/BoardView.tsx', import.meta.url)).text();
    const renderer = await Bun.file(new URL('../backgrounds/atlas-renderer.ts', import.meta.url)).text();
    expect(view.includes("import('../backgrounds/DitherAtlasLayer')")).toBe(true);
    expect(view.includes('atlas-shader')).toBe(false);
    expect(view.includes('canonicalViewportUpdate(blockedRef.current, boardRef.current, viewport)')).toBe(true);
    expect(view.includes('if (blockedRef.current) return;')).toBe(true);
    expect(renderer.includes('this.raf = 0')).toBe(true);
    expect(renderer.includes('setInterval')).toBe(false);
    const empty = createEmptyBoard();
    const archive = await readArchive(await buildArchive(empty, [], now));
    if ('error' in archive) throw new Error(archive.error);
    expect(archive.board.backgroundPattern).toBe('dither-atlas');
    expect(archive.board.ditherAtlas?.rendererVersion).toBe(3);
  });
});

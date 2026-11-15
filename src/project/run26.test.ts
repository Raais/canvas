import { describe, expect, test } from 'bun:test';
import { strToU8, unzipSync, zipSync } from 'fflate';
import { buildArchive, readArchive } from '../archive/zip';
import { addDrawing, addNodes, createEmptyBoard, createTextNode, createWebsiteNode, eraseDrawings, parseBoard, placeNode, referencedAssetIds, resolveErasure } from '../domain/board';
import {
  DRAWING_THEME_COLORS,
  beginStroke,
  cancelStroke,
  countDrawings,
  drawingEditsAllowed,
  drawingFromWorld,
  drawingHits,
  eraserWorldRadius,
  extendStroke,
  finishStroke,
  pointSegmentDistance,
  segmentSegmentDistance,
  simplifyPolyline,
  worldStrokeWidth,
} from '../domain/drawing';
import { worldTopLeft } from '../domain/geometry';
import { connectNodes } from '../domain/graph';
import { GRAPH_CLIPBOARD_VERSION, decodeGraphClipboard, encodeGraphClipboard, pasteGraph, selectionClosure } from '../domain/graph-clipboard';
import { detachNodes, duplicateSelection, groupFrame, groupSelection, ungroup } from '../domain/groups';
import { createHistory, pushHistory, redoHistory, undoHistory } from '../domain/history';
import { relaxBoard } from '../domain/physics';
import { buildSearchIndex, contentSignature, searchNodes } from '../domain/search';
import { MAX_DRAWING_NODES, SCHEMA_VERSION, type DrawingNode, type Point } from '../domain/types';
import { onInkPointerDown, onInkPointerFinish, reduceInkGesture, type InkEvent, type InkGestureState } from '../editor/ink-gesture';
import { dragBodyUpdates } from '../editor/pulling';
import { createNodeProjection } from '../components/flow-projection';
import { SaveQueue } from '../persistence/save-queue';
import { decidePwaUpdate } from './pwa-update';
import { buildContentIndex, queryBoard } from '../search/query';

const now = '2026-11-15T12:00:00.000Z';
const later = '2026-11-15T13:00:00.000Z';

function must<T>(value: T | null): T {
  if (!value) throw new Error('missing drawing');
  return value;
}

function stroke(points: readonly Point[], color: DrawingNode['color'] = 'ink', width = 4, id?: string): DrawingNode {
  return must(drawingFromWorld(points, color, width, now, id));
}

type GestureStep = 'down' | 'move' | 'up' | 'lost-capture' | 'revision' | 'escape' | 'tool' | 'blur' | 'viewport' | InkEvent;

function play(steps: readonly GestureStep[]) {
  let state: InkGestureState = { open: false, pointerId: null, sessionId: 'board-a', readOnly: false };
  const effects: string[] = [];
  for (const step of steps) {
    if (step === 'move') {
      effects.push('ignore');
      continue;
    }
    const event: InkEvent = typeof step === 'string'
      ? step === 'down'
        ? { type: 'down', pointerId: 7, isPrimary: true, button: 0, readOnly: false, spaceHeld: false, sessionId: 'board-a' }
        : step === 'up' || step === 'lost-capture'
          ? { type: step, pointerId: state.pointerId ?? 7 }
          : { type: step }
      : step;
    const result = reduceInkGesture(state, event);
    state = result.state;
    effects.push(result.effect);
  }
  return { state, effects };
}

describe('drawing nodes', () => {
  test('stores schema 14 and keeps older boards', () => {
    expect(SCHEMA_VERSION).toBe(15);
    expect(GRAPH_CLIPBOARD_VERSION).toBe(1);
    expect(parseBoard({ ...createEmptyBoard(now), schemaVersion: 12 })?.schemaVersion).toBe(15);
    const site = createWebsiteNode({ center: { x: 0, y: 0 }, url: 'https://example.com/', title: 'Example', now });
    const legacy = parseBoard({ ...addNodes(createEmptyBoard(now), [site], now), schemaVersion: 13, physicsEnabled: false });
    expect(legacy?.schemaVersion).toBe(15);
    expect(legacy?.physicsEnabled).toBe(false);
    expect(legacy?.nodes.some((node) => node.kind === 'website' && node.url === 'https://example.com/')).toBe(true);
    expect(parseBoard({ ...createEmptyBoard(now), schemaVersion: 16 })).toBeNull();
  });

  test('builds dots, straight strokes, and negative coordinates', () => {
    const dot = must(finishStroke(beginStroke({ x: 10, y: 20 }, 1, 'rose', 4), now, 'dot'));
    expect(dot.points).toEqual([2, 2]);
    expect(dot.width).toBe(4);
    expect(dot.height).toBe(4);
    const flat = stroke([{ x: 10, y: 20 }, { x: 30, y: 20 }], 'blue', 4, 'flat');
    expect(flat.y).toBe(18);
    expect(flat.height).toBe(4);
    expect(flat.width).toBe(24);
    const upright = stroke([{ x: 10, y: 20 }, { x: 10, y: 50 }], 'sage', 4, 'up');
    expect(upright.width).toBe(4);
    expect(upright.height).toBe(34);
    const negative = stroke([{ x: -30, y: -10 }, { x: -10, y: -10 }], 'sand', 4, 'neg');
    expect(negative.x).toBe(-32);
    expect(negative.y).toBe(-12);
    const stored = parseBoard(addNodes(createEmptyBoard(now), [dot, flat, negative], now));
    expect(stored?.nodes.find((node) => node.id === 'neg')?.kind).toBe('drawing');
  });

  test('rejects malformed drawings and enforces the board limit', () => {
    const good = stroke([{ x: 0, y: 0 }, { x: 12, y: 0 }], 'ink', 4, 'ok');
    const board = addNodes(createEmptyBoard(now), [good], now);
    expect(parseBoard({ ...board, nodes: [{ ...good, points: [0, 1, Number.NaN] }] })).toBeNull();
    expect(parseBoard({ ...board, nodes: [{ ...good, points: [0] }] })).toBeNull();
    expect(parseBoard({ ...board, nodes: [{ ...good, points: Array.from({ length: 2050 }, () => 1) }] })).toBeNull();
    expect(parseBoard({ ...board, nodes: [{ ...good, color: 'purple' }] })).toBeNull();
    expect(parseBoard({ ...board, nodes: [{ ...good, strokeWidth: 0 }] })).toBeNull();
    expect(parseBoard({ ...board, nodes: [{ ...good, strokeWidth: 400 }] })).toBeNull();
    expect(parseBoard({ ...board, nodes: [{ ...good, points: [0, 0, 4, 80] }] })).toBeNull();
    expect(parseBoard({ ...createEmptyBoard(now), schemaVersion: 13, nodes: [good] })).toBeNull();
    const many = Array.from({ length: MAX_DRAWING_NODES }, (_, index) => stroke([{ x: index, y: 0 }], 'ink', 4, `d${index}`));
    const full = addNodes(createEmptyBoard(now), many, now);
    expect(countDrawings(full.nodes)).toBe(2000);
    const extra = stroke([{ x: 0, y: 4 }], 'ink', 4, 'extra');
    const refused = addDrawing(full, extra, later);
    expect('error' in refused ? refused.error : '').toContain('2,000');
    expect(parseBoard({ ...full, nodes: [...full.nodes, extra] })).toBeNull();
    const erased = eraseDrawings(full, ['d0'], later);
    const again = addDrawing(erased, extra, later);
    expect('error' in again).toBe(false);
  });

  test('samples, simplifies, and converts width from the starting zoom', () => {
    const draft = beginStroke({ x: 0, y: 0 }, 2, 'ink', 4);
    const same = extendStroke(draft, { x: 0, y: 0 });
    expect(same).toBe(draft);
    const moved = extendStroke(draft, { x: 3, y: 0 });
    expect(moved.points).toHaveLength(2);
    const line = Array.from({ length: 12 }, (_, index) => ({ x: index, y: 0 }));
    expect(simplifyPolyline(line, 0.2)).toEqual([{ x: 0, y: 0 }, { x: 11, y: 0 }]);
    const corner = simplifyPolyline([{ x: 0, y: 0 }, { x: 8, y: 0.1 }, { x: 8, y: 8 }], 0.4);
    expect(corner).toEqual([{ x: 0, y: 0 }, { x: 8, y: 0.1 }, { x: 8, y: 8 }]);
    const curve = Array.from({ length: 18 }, (_, index) => {
      const angle = (index / 17) * Math.PI;
      return { x: Math.cos(angle) * 40, y: Math.sin(angle) * 40 };
    });
    expect(simplifyPolyline(curve, 0.6).length).toBeGreaterThan(4);
    expect(worldStrokeWidth(4, 2)).toBe(2);
    expect(worldStrokeWidth(8, 0.1)).toBe(80);
    expect(finishStroke(cancelStroke(moved), now)).toBeNull();
    const drawn = must(finishStroke(moved, now, 'zoom'));
    expect(drawn.points.every((value) => Number.isFinite(value))).toBe(true);
  });

  test('erases whole strokes by geometry, including grouped ink', () => {
    expect(pointSegmentDistance(1, 1, 0, 0, 4, 0)).toBe(1);
    expect(segmentSegmentDistance(0, 0, 4, 0, 2, -1, 2, 3)).toBe(0);
    expect(eraserWorldRadius(1)).toBe(12);
    expect(eraserWorldRadius(2)).toBe(6);
    const line = stroke([{ x: 0, y: 0 }, { x: 80, y: 0 }], 'ink', 4, 'line');
    const dot = stroke([{ x: 0, y: 30 }], 'rose', 4, 'dot');
    const square = stroke([{ x: 0, y: 80 }, { x: 120, y: 80 }, { x: 120, y: 200 }, { x: 0, y: 200 }, { x: 0, y: 80 }], 'sage', 4, 'box');
    const note = createTextNode({ x: 300, y: 0 }, 'keep', now);
    const board = addNodes(createEmptyBoard(now), [line, dot, square, note], now);
    expect(drawingHits(board.nodes, { x: 40, y: 0 }, { x: 42, y: 0 }, 2)).toEqual(['line']);
    expect(drawingHits(board.nodes, { x: 40, y: 30 }, { x: 50, y: 30 }, 2)).toEqual([]);
    expect(drawingHits(board.nodes, { x: 0, y: 30 }, { x: 1, y: 30 }, 2)).toEqual(['dot']);
    expect(drawingHits(board.nodes, { x: 60, y: 140 }, { x: 70, y: 150 }, 3)).toEqual([]);
    const grouped = groupSelection(board, ['line']);
    if ('error' in grouped) throw new Error(grouped.error);
    const moved = placeNode(grouped.board, grouped.board.nodes.find((node) => node.kind === 'group')?.id ?? '', { x: 500, y: 80 });
    const child = moved.nodes.find((node) => node.id === 'line');
    const origin = child ? worldTopLeft(moved.nodes, child) : { x: 0, y: 0 };
    const mid = child?.kind === 'drawing'
      ? { x: origin.x + (child.points[0] ?? 0) + ((child.points[2] ?? 0) - (child.points[0] ?? 0)) / 2, y: origin.y + (child.points[1] ?? 0) }
      : { x: 0, y: 0 };
    expect(drawingHits(moved.nodes, mid, mid, 2)).toEqual(['line']);
    expect(drawingHits(moved.nodes, { x: child?.x ?? 0, y: child?.y ?? 0 }, { x: child?.x ?? 0, y: child?.y ?? 0 }, 1)).toEqual([]);
    const swept = eraseDrawings(board, ['line', 'dot', 'line', note.id], later);
    expect(swept.nodes.map((node) => node.id)).toEqual(['box', note.id]);
    expect(eraseDrawings(board, [])).toBe(board);
    expect(resolveErasure(board, ['line'], true)).toBe(board);
    const history = pushHistory(createHistory(), board);
    const undone = undoHistory(history, swept);
    expect(undone?.board.nodes.filter((node) => node.kind === 'drawing')).toHaveLength(3);
    const redone = undone ? redoHistory(undone.history, undone.board) : null;
    expect(redone?.board.nodes.filter((node) => node.kind === 'drawing').map((node) => node.id)).toEqual(['box']);
  });

  test('groups, copies, and refuses relationship endpoints', () => {
    const drawing = stroke([{ x: 20, y: 20 }, { x: 60, y: 30 }], 'sand', 4, 'ink');
    const note = { ...createTextNode({ x: 200, y: 20 }, 'Note', now), id: 'note' };
    const other = { ...createTextNode({ x: 420, y: 20 }, 'Other', now), id: 'other' };
    let board = addNodes(createEmptyBoard(now), [drawing, note, other], now);
    const framed = groupFrame(board, { x: 0, y: 0, width: 120, height: 80 });
    if ('error' in framed) throw new Error(framed.error);
    expect(framed.board.nodes.some((node) => node.kind === 'group')).toBe(true);
    const framedInk = framed.board.nodes.find((node) => node.id === 'ink');
    expect(framedInk?.kind === 'drawing' ? framedInk.parentId?.length ?? 0 : 0).toBeGreaterThan(0);
    const released = ungroup(framed.board, framed.board.nodes.filter((node) => node.kind === 'group').map((node) => node.id), later);
    const releasedInk = released.nodes.find((node) => node.id === 'ink');
    expect(releasedInk?.kind === 'drawing' ? releasedInk.parentId ?? '' : 'stuck').toBe('');
    const detached = detachNodes(framed.board, ['ink'], later);
    const detachedInk = detached.nodes.find((node) => node.id === 'ink');
    expect(detachedInk?.kind === 'drawing' ? detachedInk.parentId ?? '' : 'stuck').toBe('');
    const copied = duplicateSelection(board, ['ink'], later);
    const twin = copied.nodes.find((node) => node.kind === 'drawing' && node.id !== 'ink');
    expect(twin?.kind === 'drawing' ? twin.points : []).toEqual(drawing.points);
    expect(twin?.kind === 'drawing' ? twin.lastEditedAt : '').toBe(later);
    const grouped = groupSelection(board, ['ink', 'note']);
    if ('error' in grouped) throw new Error(grouped.error);
    const group = grouped.board.nodes.find((node) => node.kind === 'group');
    const groupCopy = group ? duplicateSelection(grouped.board, [group.id], later) : grouped.board;
    expect(groupCopy.nodes.filter((node) => node.kind === 'drawing')).toHaveLength(2);
    const payload = selectionClosure(board, ['ink']);
    const decoded = payload ? decodeGraphClipboard(encodeGraphClipboard(payload)) : null;
    const pasted = decoded ? pasteGraph(createEmptyBoard(later), decoded, { x: 10, y: 10 }, new Set(), 0, later) : null;
    const pastedNode = pasted && !('error' in pasted) ? pasted.nodes.find((node) => node.kind === 'drawing') : null;
    expect(pastedNode?.kind === 'drawing' ? pastedNode.color : '').toBe('sand');
    expect(pastedNode?.id === 'ink').toBe(false);
    expect(connectNodes(board, 'ink', 'note', 'right', 'left', now)).toBeNull();
    expect(referencedAssetIds(board).size).toBe(0);
    const linked = connectNodes(addNodes(createEmptyBoard(now), [note, other], now), 'note', 'other', 'right', 'left', now);
    const before = linked ? relaxBoard(linked, [], 8) : null;
    const withInk = before ? addNodes(before, [drawing], now) : null;
    const after = withInk ? relaxBoard(withInk, [], 8) : null;
    expect(after?.nodes.find((node) => node.id === 'note')?.x).toBe(before?.nodes.find((node) => node.id === 'note')?.x);
    expect(dragBodyUpdates([{ type: 'position', id: 'ink', dragging: true }], [{ id: 'ink', kind: 'drawing' }])).toEqual([]);
  });

  test('drawing wrappers ignore hits outside the stroke', () => {
    const drawing = stroke([{ x: 0, y: 0 }, { x: 48, y: 12 }], 'ink', 4, 'ink');
    const dot = stroke([{ x: 6, y: 6 }], 'rose', 4, 'dot');
    const grouped = { ...drawing, id: 'grouped', parentId: 'g1' };
    const note = { ...createTextNode({ x: 0, y: 80 }, 'under', now), id: 'note' };
    const projection = createNodeProjection();
    const input = { selected: new Set<string>(), editingId: null, readOnly: false, unlocked: new Map(), registry: null, library: new Map() };
    const nodes = projection.project(addNodes(createEmptyBoard(now), [drawing, dot, grouped, note], now).nodes, input);
    const wrapper = (id: string) => ({ pointerEvents: 'all', ...nodes.find((node) => node.id === id)?.style });
    expect(wrapper('ink').pointerEvents).toBe('none');
    expect(wrapper('dot').pointerEvents).toBe('none');
    expect(wrapper('grouped').pointerEvents).toBe('none');
    expect(wrapper('note').pointerEvents).toBe('all');
    const ink = nodes.find((node) => node.id === 'ink');
    const point = nodes.find((node) => node.id === 'dot');
    expect(ink?.type).toBe('drawing');
    expect(point?.type === 'drawing' ? point.data.dot : false).toBe(true);
    expect(point?.type === 'drawing' ? point.connectable : true).toBe(false);
  });

  test('projects stably and leaves drawings out of search', () => {
    const drawing = stroke([{ x: 0, y: 0 }, { x: 20, y: 8 }], 'ink', 4, 'ink');
    const note = { ...createTextNode({ x: 0, y: 80 }, 'hello canvas', now), id: 'note' };
    const board = addNodes(createEmptyBoard(now), [drawing, note], now);
    const projection = createNodeProjection();
    const input = { selected: new Set<string>(), editingId: null, readOnly: false, unlocked: new Map(), registry: null, library: new Map() };
    const first = projection.project(board.nodes, input).find((node) => node.type === 'drawing');
    const second = projection.project(board.nodes, input).find((node) => node.type === 'drawing');
    expect(second).toBe(first);
    const remaining = projection.project([note], input);
    expect(remaining.some((node) => node.id === 'ink')).toBe(false);
    expect(searchNodes(buildSearchIndex(board.nodes), 'hello')[0]?.id).toBe('note');
    expect(searchNodes(buildSearchIndex(board.nodes), 'drawing')).toHaveLength(0);
    const dated = queryBoard(board.nodes, buildContentIndex(board.nodes), '2026', new Date('2026-11-15T18:00:00.000Z'));
    expect(dated.results.some((result) => result.id === 'ink')).toBe(false);
    const moved = placeNode(board, 'ink', { x: drawing.x + 12, y: drawing.y });
    expect(contentSignature(moved.nodes)).toBe(contentSignature(board.nodes));
    expect(DRAWING_THEME_COLORS.dark.ink === DRAWING_THEME_COLORS.light.ink).toBe(false);
    expect(Object.keys(DRAWING_THEME_COLORS.dark)).toHaveLength(5);
    expect(Object.keys(DRAWING_THEME_COLORS.light)).toHaveLength(5);
  });

  test('round-trips drawings in archive version 2 and clipboard version 1', async () => {
    const drawing = stroke([{ x: 4, y: 6 }, { x: 24, y: 16 }], 'blue', 4, 'ink');
    const dot = stroke([{ x: -8, y: 3 }], 'ink', 4, 'dot');
    const board = addNodes(createEmptyBoard(now), [drawing, dot], now);
    const packed = await buildArchive(board, [], now);
    const opened = await readArchive(packed);
    if ('error' in opened) throw new Error(opened.error);
    expect(opened.assets).toHaveLength(0);
    const restored = opened.board.nodes.find((node) => node.id === 'ink');
    expect(restored?.kind === 'drawing' ? restored.points : []).toEqual(drawing.points);
    expect(restored?.kind === 'drawing' ? restored.color : '').toBe('blue');
    const files = unzipSync(packed);
    const manifest = JSON.parse(new TextDecoder().decode(files['manifest.json'] ?? new Uint8Array())) as { archiveVersion: number };
    manifest.archiveVersion = 1;
    files['manifest.json'] = strToU8(JSON.stringify(manifest));
    const legacy = await readArchive(zipSync(files));
    expect('error' in legacy ? '' : legacy.board.nodes.filter((node) => node.kind === 'drawing')).toHaveLength(2);
    expect(drawingEditsAllowed(true)).toBe(false);
    expect(drawingEditsAllowed(false)).toBe(true);
  });

  test('reports a failed save as an error and blocks updates during a stroke', async () => {
    const board = createEmptyBoard(now);
    const statuses: string[] = [];
    const database = { transaction() { throw new Error('disk full'); } };
    const queue = new SaveQueue(database as never, () => board, (status) => statuses.push(status));
    queue.adopt(board);
    queue.saveNow();
    await queue.idle();
    expect(statuses[statuses.length - 1]).toBe('error');
    expect(decidePwaUpdate({
      editingNote: false,
      editingRelationship: false,
      confirming: false,
      ingesting: false,
      adjustingRotation: false,
      drawing: true,
      focusedField: false,
      readOnly: false,
      saveStatus: 'saved',
      hasUnpersisted: false,
      hasRecovery: false,
      expectationMatches: true,
    }).action).toBe('block');
  });

  test('refuses duplicate and paste operations that would pass 2,000 drawings', () => {
    const dot = (id: string): DrawingNode => ({ id, kind: 'drawing', x: 0, y: 0, width: 4, height: 4, points: [2, 2], color: 'ink', brush: 'legacy', strokeWidth: 4, lastEditedAt: now });
    const almost = addNodes(createEmptyBoard(now), Array.from({ length: 1999 }, (_, index) => dot(`d${index}`)), now);
    const room = duplicateSelection(almost, ['d0'], later);
    expect(countDrawings(room.nodes)).toBe(2000);
    expect(parseBoard(room)?.nodes.filter((node) => node.kind === 'drawing')).toHaveLength(2000);
    const full = addNodes(createEmptyBoard(now), Array.from({ length: 2000 }, (_, index) => dot(`f${index}`)), now);
    expect(duplicateSelection(full, ['f0'], later)).toBe(full);
    expect(parseBoard(full)?.schemaVersion).toBe(15);
    const note = { ...createTextNode({ x: 40, y: 40 }, 'plain', now), id: 'note' };
    const mixed = addNodes(full, [note], now);
    const notesOnly = duplicateSelection(mixed, ['note'], later);
    expect(countDrawings(notesOnly.nodes)).toBe(2000);
    expect(notesOnly.nodes.filter((node) => node.kind === 'text')).toHaveLength(2);
    expect(parseBoard(notesOnly)?.schemaVersion).toBe(15);
    expect(duplicateSelection(mixed, ['note', 'f0'], later)).toBe(mixed);
    const pair = addNodes(createEmptyBoard(now), [dot('a'), dot('b')], now);
    const grouped = groupSelection(pair, ['a', 'b']);
    if ('error' in grouped) throw new Error(grouped.error);
    const crowded = addNodes(grouped.board, Array.from({ length: 1997 }, (_, index) => dot(`g${index}`)), now);
    expect(countDrawings(crowded.nodes)).toBe(1999);
    const group = crowded.nodes.find((node) => node.kind === 'group');
    expect(group ? duplicateSelection(crowded, [group.id], later) : crowded).toBe(crowded);
    expect(parseBoard(crowded)?.nodes.filter((node) => node.kind === 'drawing')).toHaveLength(1999);
    const freed = eraseDrawings(crowded, ['g0', 'g1'], later);
    const duplicatedGroup = group ? duplicateSelection(freed, [group.id], later) : freed;
    expect(countDrawings(duplicatedGroup.nodes)).toBe(1999);
    expect(parseBoard(duplicatedGroup)?.schemaVersion).toBe(15);
    const payload = selectionClosure(pair, ['a']);
    const decoded = payload ? decodeGraphClipboard(encodeGraphClipboard(payload)) : null;
    const blocked = decoded ? pasteGraph(full, decoded, { x: 8, y: 8 }, new Set(), 0, later) : null;
    expect(blocked && 'error' in blocked ? blocked.error : '').toContain('2,000');
    expect(parseBoard(full)?.nodes).toHaveLength(2000);
    const groupPayload = group ? selectionClosure(crowded, [group.id]) : null;
    const groupPaste = groupPayload ? pasteGraph(crowded, groupPayload, { x: 12, y: 12 }, new Set(), 0, later) : null;
    expect(groupPaste && 'error' in groupPaste ? groupPaste.error : '').toContain('2,000');
    expect(parseBoard(crowded)?.nodes.filter((node) => node.kind === 'drawing')).toHaveLength(1999);
    const textPayload = selectionClosure(mixed, ['note']);
    const textPaste = textPayload ? pasteGraph(full, textPayload, { x: 16, y: 16 }, new Set(), 0, later) : null;
    expect(textPaste && !('error' in textPaste) ? countDrawings(textPaste.nodes) : 0).toBe(2000);
    expect(textPaste && !('error' in textPaste) ? parseBoard(textPaste)?.nodes.some((node) => node.kind === 'text') : false).toBe(true);
    const openPaste = decoded ? pasteGraph(almost, decoded, { x: 4, y: 4 }, new Set(), 0, later) : null;
    expect(openPaste && !('error' in openPaste) ? countDrawings(openPaste.nodes) : 0).toBe(2000);
    expect(openPaste && !('error' in openPaste) ? parseBoard(openPaste)?.schemaVersion : 0).toBe(15);
  });

  test('cancels an open pen or eraser gesture when a second pointer arrives', () => {
    const primary = { isPrimary: true, button: 0, readOnly: false, spaceHeld: false };
    const secondFinger = { isPrimary: false, button: 0, readOnly: false, spaceHeld: false };
    const started = onInkPointerDown({ open: false }, primary);
    expect(started.effect).toBe('start');
    const cancelled = onInkPointerDown(started.state, secondFinger);
    expect(cancelled.effect).toBe('cancel');
    expect(cancelled.state.open).toBe(false);
    expect(onInkPointerFinish(cancelled.state, true, 'up').effect).toBe('ignore');
    expect(onInkPointerFinish(cancelled.state, true, 'cancel').effect).toBe('ignore');
    const ignored = onInkPointerDown({ open: false }, secondFinger);
    expect(ignored.effect).toBe('ignore');
    expect(ignored.state.open).toBe(false);
    const finished = onInkPointerFinish(started.state, true, 'up');
    expect(finished.effect).toBe('commit');
    expect(onInkPointerFinish(finished.state, true, 'up').effect).toBe('ignore');
    expect(onInkPointerDown({ open: false }, { ...primary, button: 2 }).effect).toBe('ignore');
    expect(onInkPointerDown({ open: true }, { ...primary, readOnly: true }).effect).toBe('cancel');
  });

  test('commits one stroke, one dot, and each rapid stroke once', () => {
    const stroke = play(['down', 'move', 'up']);
    expect(stroke.effects).toEqual(['start', 'ignore', 'commit']);
    expect(stroke.state.open).toBe(false);
    const dot = play(['down', 'up']);
    expect(dot.effects).toEqual(['start', 'commit']);
    const rapid = play(['down', 'up', 'down', 'up', 'down', 'move', 'up']);
    expect(rapid.effects.filter((effect) => effect === 'commit')).toHaveLength(3);
    expect(rapid.effects.filter((effect) => effect === 'start')).toHaveLength(3);
    const repeated = play(['down', 'up', 'up']);
    expect(repeated.effects.filter((effect) => effect === 'commit')).toHaveLength(1);
  });

  test('keeps a gesture through document revisions and viewport saves', () => {
    const revised = play(['down', 'revision', 'revision', 'up']);
    expect(revised.effects).toEqual(['start', 'ignore', 'ignore', 'commit']);
    expect(revised.state.open).toBe(false);
    const saved = play(['down', 'move', 'revision', 'up']);
    expect(saved.effects).toEqual(['start', 'ignore', 'ignore', 'commit']);
    expect(saved.state.pointerId).toBeNull();
  });

  test('cancels for board replacement, read-only, and escape without a later commit', () => {
    const replaced = play(['down', 'move', { type: 'replace', sessionId: 'board-b' }, 'up']);
    expect(replaced.effects).toEqual(['start', 'ignore', 'cancel', 'ignore']);
    expect(replaced.state.sessionId).toBe('board-b');
    const sameBoard = play(['down', { type: 'replace', sessionId: 'board-a' }, 'up']);
    expect(sameBoard.effects).toEqual(['start', 'ignore', 'commit']);
    const locked = play(['down', { type: 'read-only', readOnly: true }, 'up']);
    expect(locked.effects).toEqual(['start', 'cancel', 'ignore']);
    expect(locked.state.readOnly).toBe(true);
    const escaped = play(['down', 'move', 'escape', 'up']);
    expect(escaped.effects).toEqual(['start', 'ignore', 'cancel', 'ignore']);
    expect(play(['down', 'tool', 'up']).effects).toEqual(['start', 'cancel', 'ignore']);
    expect(play(['down', 'blur', 'up']).effects).toEqual(['start', 'cancel', 'ignore']);
    expect(play(['down', 'viewport', 'up']).effects).toEqual(['start', 'cancel', 'ignore']);
  });

  test('pointercancel and lost capture follow the active pointer only', () => {
    const cancelled = play(['down', 'move', { type: 'cancel', pointerId: 7 }, 'up']);
    expect(cancelled.effects).toEqual(['start', 'ignore', 'cancel', 'ignore']);
    const otherCancel = play(['down', { type: 'cancel', pointerId: 9 }, 'up']);
    expect(otherCancel.effects).toEqual(['start', 'ignore', 'commit']);
    const otherUp = play(['down', { type: 'up', pointerId: 9 }, { type: 'lost-capture', pointerId: 9 }, 'up']);
    expect(otherUp.effects).toEqual(['start', 'ignore', 'ignore', 'commit']);
    const captureThenUp = play(['down', 'move', 'lost-capture', 'up']);
    expect(captureThenUp.effects).toEqual(['start', 'ignore', 'ignore', 'commit']);
    const upThenCapture = play(['down', 'up', 'lost-capture', 'up']);
    expect(upThenCapture.effects.filter((effect) => effect === 'commit')).toHaveLength(1);
    expect(upThenCapture.effects).toEqual(['start', 'commit', 'ignore', 'ignore']);
    const fallback = play(['down', 'move', 'up', 'up']);
    expect(fallback.effects.filter((effect) => effect === 'commit')).toHaveLength(1);
  });

  test('a committed stroke survives parsing and one undo, and one eraser sweep is one undo', () => {
    const board = createEmptyBoard(now);
    const drawn = addDrawing(board, stroke([{ x: 4, y: 8 }, { x: 40, y: 18 }], 'blue', 4, 'kept'), now);
    if ('error' in drawn) throw new Error(drawn.error);
    const parsed = parseBoard(drawn);
    const kept = parsed?.nodes.find((node) => node.id === 'kept');
    expect(kept?.kind === 'drawing' ? kept.points : []).toEqual(
      drawn.nodes.find((node) => node.kind === 'drawing')?.points ?? [],
    );
    const history = pushHistory(createHistory(), board);
    const undone = undoHistory(history, drawn);
    expect(undone?.board.nodes.some((node) => node.kind === 'drawing')).toBe(false);
    const redone = undone ? redoHistory(undone.history, undone.board) : null;
    expect(redone?.board.nodes.filter((node) => node.kind === 'drawing')).toHaveLength(1);
    expect(redone?.history.past).toHaveLength(1);
    const again = redone ? undoHistory(redone.history, redone.board) : null;
    expect(again?.history.past).toHaveLength(0);
    const first = stroke([{ x: 0, y: 0 }, { x: 30, y: 0 }], 'ink', 4, 'a');
    const second = stroke([{ x: 0, y: 20 }, { x: 30, y: 20 }], 'ink', 4, 'b');
    const page = addNodes(createEmptyBoard(now), [first, second], now);
    const swept = eraseDrawings(page, ['a', 'b'], later);
    expect(swept.nodes.filter((node) => node.kind === 'drawing')).toHaveLength(0);
    const sweepHistory = pushHistory(createHistory(), page);
    const restored = undoHistory(sweepHistory, swept);
    expect(restored?.board.nodes.filter((node) => node.kind === 'drawing')).toHaveLength(2);
    expect(restored?.history.past).toHaveLength(0);
  });

  test('measures drawing history, hit testing, and projection', () => {
    const sizes = [100, 500, 1000];
    for (const size of sizes) {
      const nodes = Array.from({ length: size }, (_, index) => {
        const kind = index % 5;
        if (kind === 0) return stroke([{ x: index * 3, y: index }], 'ink', 2, `n${index}`);
        if (kind === 1) return stroke([{ x: index, y: -index }], 'blue', 4, `n${index}`);
        if (kind === 2) {
          const curve = Array.from({ length: 24 }, (_, step) => ({ x: index + Math.sin(step) * 12, y: step * 3 }));
          return stroke(curve, 'sage', 4, `n${index}`);
        }
        if (kind === 3) return stroke([{ x: 4000 + index, y: 4000 }], 'rose', 8, `n${index}`);
        return stroke([{ x: index, y: 20 }, { x: index + 30, y: 20 }, { x: index + 30, y: 50 }], 'sand', 4, `n${index}`);
      });
      const note = createTextNode({ x: 0, y: 0 }, 'mixed', now);
      const board = addNodes(createEmptyBoard(now), [...nodes, note], now);
      const started = performance.now();
      const serialized = JSON.stringify(board);
      const serializeMs = performance.now() - started;
      const cloneStarted = performance.now();
      const history = pushHistory(createHistory(), board);
      const cloneMs = performance.now() - cloneStarted;
      const hitStarted = performance.now();
      const hits = drawingHits(board.nodes, { x: 0, y: 0 }, { x: size * 3, y: 40 }, 8);
      const hitMs = performance.now() - hitStarted;
      const eraseStarted = performance.now();
      const erased = eraseDrawings(board, hits, later);
      const eraseMs = performance.now() - eraseStarted;
      const undoStarted = performance.now();
      undoHistory(history, erased);
      const undoMs = performance.now() - undoStarted;
      const projection = createNodeProjection();
      const input = { selected: new Set<string>(), editingId: null, readOnly: false, unlocked: new Map(), registry: null, library: new Map() };
      const projectStarted = performance.now();
      const projected = projection.project(board.nodes, input);
      const projectMs = performance.now() - projectStarted;
      console.info(`drawings ${size} serialize ${serializeMs.toFixed(1)}ms ${serialized.length}b clone ${cloneMs.toFixed(1)}ms hit ${hitMs.toFixed(1)}ms/${hits.length} erase ${eraseMs.toFixed(1)}ms undo ${undoMs.toFixed(1)}ms project ${projectMs.toFixed(1)}ms nodes ${projected.length}`);
      expect(projected).toHaveLength(size + 1);
      expect(history.past).toHaveLength(1);
    }
  });
});

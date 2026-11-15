import { describe, expect, test } from 'bun:test';
import { ARCHIVE_VERSION } from '../archive/format';
import { buildArchive, readArchive } from '../archive/zip';
import { addNodes, createEmptyBoard, createTextNode, eraseDrawings, parseBoard } from '../domain/board';
import { DRAWING_COLORS, drawingFromWorld, drawingHits, finishStroke, beginStroke, extendStroke, penScreenPx, worldStrokeWidth } from '../domain/drawing';
import { GRAPH_CLIPBOARD_VERSION, decodeGraphClipboard, encodeGraphClipboard, pasteGraph, selectionClosure } from '../domain/graph-clipboard';
import { duplicateSelection } from '../domain/groups';
import { createHistory, pushHistory, redoHistory, undoHistory } from '../domain/history';
import {
  DRAWING_BRUSHES,
  brushEndTaper,
  getBrushPreset,
  getOrganicOutline,
  organicBuildCount,
  organicSvgPath,
  outlineToSvgPath,
  pointInOutline,
} from '../domain/organic-ink';
import { reduceInkGesture, type InkEvent, type InkGestureState } from '../editor/ink-gesture';
import { createNodeProjection } from '../components/flow-projection';
import { MAX_DRAWING_NODES, MAX_DRAWING_POINTS, SCHEMA_VERSION, type DrawingNode, type Point } from '../domain/types';

const now = '2026-11-15T12:00:00.000Z';
const later = '2026-11-15T13:00:00.000Z';

function must<T>(value: T | null): T {
  if (!value) throw new Error('missing drawing');
  return value;
}

function line(): Point[] {
  return [
    { x: 0, y: 0 },
    { x: 4, y: 1 },
    { x: 8, y: 0 },
    { x: 18, y: 7 },
    { x: 36, y: 2 },
    { x: 40, y: 5 },
  ];
}

function radii(outline: readonly Point[], samples: readonly Point[]): number[] {
  return outline.map((point) => {
    let best = Infinity;
    for (let index = 0; index < samples.length - 1; index += 1) {
      const a = samples[index];
      const b = samples[index + 1];
      if (!a || !b) continue;
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const length = dx * dx + dy * dy;
      const t = length === 0 ? 0 : Math.max(0, Math.min(1, ((point.x - a.x) * dx + (point.y - a.y) * dy) / length));
      best = Math.min(best, Math.hypot(point.x - (a.x + t * dx), point.y - (a.y + t * dy)));
    }
    return best;
  });
}

function spread(values: readonly number[]): number {
  return Math.max(...values) - Math.min(...values);
}

function ink(points: readonly Point[], brush: DrawingNode['brush'], width = 5, id = 'ink'): DrawingNode {
  return must(drawingFromWorld(points, 'ink', width, now, id, brush));
}

describe('organic ink', () => {
  test('offers three brushes and keeps fountain as the default width', () => {
    expect(DRAWING_BRUSHES.map((entry) => entry.id)).toEqual(['fineliner', 'fountain', 'brush']);
    expect(DRAWING_BRUSHES.map((entry) => entry.label)).toEqual(['Fineliner', 'Fountain Pen', 'Brush Pen']);
    expect(DRAWING_BRUSHES.map((entry) => entry.short)).toEqual(['Fineliner', 'Fountain', 'Brush']);
    expect(getBrushPreset('fountain').simulatePressure).toBe(true);
    expect(getBrushPreset('fineliner').simulatePressure).toBe(false);
    expect(getBrushPreset('fineliner').thinning).toBe(0);
    expect(penScreenPx('fountain')).toBe(5);
    expect(DRAWING_COLORS).toHaveLength(5);
    expect(worldStrokeWidth(penScreenPx('brush'), 2)).toBe(4.5);
    expect(SCHEMA_VERSION).toBe(15);
    expect(ARCHIVE_VERSION).toBe(2);
    expect(GRAPH_CLIPBOARD_VERSION).toBe(1);
  });

  test('makes the three brushes distinct without dropping short marks', () => {
    const samples = line();
    const fine = getOrganicOutline(samples, 'fineliner', 3, true);
    const fountain = getOrganicOutline(samples, 'fountain', 5, true);
    const brush = getOrganicOutline(samples, 'brush', 9, true);
    expect(spread(radii(fountain, samples))).toBeGreaterThan(spread(radii(fine, samples)) + 0.2);
    expect(spread(radii(brush, samples))).toBeGreaterThan(spread(radii(fountain, samples)));
    const dot = getOrganicOutline([{ x: 4, y: 6 }], 'brush', 9, true);
    expect(dot.length).toBeGreaterThan(8);
    expect(outlineToSvgPath(dot).length).toBeGreaterThan(10);
    const tiny = getOrganicOutline([{ x: 0, y: 0 }, { x: 0.4, y: 0.1 }], 'brush', 9, true);
    expect(tiny.length).toBeGreaterThan(8);
    expect(outlineToSvgPath(tiny).indexOf('NaN')).toBe(-1);
    expect(outlineToSvgPath(tiny).indexOf('Infinity')).toBe(-1);
    expect(brushEndTaper([{ x: 0, y: 0 }, { x: 2, y: 0 }], 9)).toBe(0);
    expect(brushEndTaper(samples, 9)).toBeGreaterThan(0);
  });

  test('keeps corners, loops, and empty interiors out of the ink', () => {
    const corner = getOrganicOutline([{ x: 0, y: 0 }, { x: 80, y: 0 }, { x: 80, y: 80 }], 'fineliner', 3, true);
    expect(pointInOutline({ x: 40, y: 0 }, corner)).toBe(true);
    expect(pointInOutline({ x: 40, y: 24 }, corner)).toBe(false);
    const loop = Array.from({ length: 28 }, (_, index) => {
      const angle = (index / 28) * Math.PI * 2;
      return { x: Math.cos(angle) * 60, y: Math.sin(angle) * 60 };
    });
    const ring = getOrganicOutline(loop, 'fountain', 5, true);
    expect(pointInOutline({ x: 0, y: 0 }, ring)).toBe(false);
    expect(pointInOutline({ x: 60, y: 0 }, ring)).toBe(true);
    const bow = getOrganicOutline(
      [
        { x: 0, y: 0 },
        { x: 0, y: 80 },
        { x: 70, y: 80 },
        { x: 70, y: 62 },
        { x: 18, y: 62 },
        { x: 18, y: 18 },
        { x: 70, y: 18 },
        { x: 70, y: 0 },
      ],
      'brush',
      8,
      true,
    );
    expect(pointInOutline({ x: 40, y: 40 }, bow)).toBe(false);
    const far = ink([{ x: -240, y: 900 }, { x: -180, y: 940 }, { x: -120, y: 910 }], 'fountain', 5, 'far');
    expect(far.x < -240).toBe(true);
    expect(far.points.every((value) => Number.isFinite(value) && value >= -0.05)).toBe(true);
  });

  test('stores input points inside bounds that contain the outline', () => {
    const points = line();
    const node = ink(points, 'fountain', 5, 'pen');
    const outline = getOrganicOutline(
      Array.from({ length: node.points.length / 2 }, (_, index) => ({ x: node.x + (node.points[index * 2] ?? 0), y: node.y + (node.points[index * 2 + 1] ?? 0) })),
      'fountain',
      node.strokeWidth,
      true,
    );
    expect(outline.every((point) => point.x >= node.x - 0.05 && point.y >= node.y - 0.05 && point.x <= node.x + node.width + 0.05 && point.y <= node.y + node.height + 0.05)).toBe(true);
    const again = organicSvgPath(node.points, 'fountain', node.strokeWidth);
    const built = organicBuildCount();
    expect(organicSvgPath(node.points, 'fountain', node.strokeWidth)).toBe(again);
    expect(organicBuildCount()).toBe(built);
    const draft = beginStroke(points[0] ?? { x: 0, y: 0 }, 1, 'ink', 5, 'fountain');
    let moved = draft;
    for (const point of points.slice(1)) moved = extendStroke(moved, point);
    const finished = must(finishStroke(moved, now, 'done'));
    expect(organicSvgPath(finished.points, 'fountain', finished.strokeWidth)).toBe(organicSvgPath(finished.points, 'fountain', finished.strokeWidth));
    expect(finished.brush).toBe('fountain');
    expect(finished.points.length <= MAX_DRAWING_POINTS * 2).toBe(true);
  });

  test('commits fifty gestures once each and still cancels real interruptions', () => {
    let state: InkGestureState = { open: false, pointerId: null, sessionId: 'board-a', readOnly: false };
    let commits = 0;
    for (let index = 0; index < 50; index += 1) {
      for (const event of [
        { type: 'down', pointerId: 3, isPrimary: true, button: 0, readOnly: false, spaceHeld: false, sessionId: 'board-a' },
        { type: 'up', pointerId: 3 },
        { type: 'up', pointerId: 3 },
      ] as const) {
        const step = reduceInkGesture(state, event);
        state = step.state;
        if (step.effect === 'commit') commits += 1;
      }
    }
    expect(commits).toBe(50);
    const open = reduceInkGesture(state, { type: 'down', pointerId: 3, isPrimary: true, button: 0, readOnly: false, spaceHeld: false, sessionId: 'board-a' });
    expect(reduceInkGesture(open.state, { type: 'revision' }).effect).toBe('ignore');
    expect(reduceInkGesture(open.state, { type: 'replace', sessionId: 'board-b' }).effect).toBe('cancel');
    expect(reduceInkGesture(open.state, { type: 'read-only', readOnly: true }).effect).toBe('cancel');
    expect(reduceInkGesture(open.state, { type: 'escape' }).effect).toBe('cancel');
    expect(reduceInkGesture(open.state, { type: 'down', pointerId: 8, isPrimary: false, button: 0, readOnly: false, spaceHeld: false, sessionId: 'board-a' }).effect).toBe('cancel');
    expect(reduceInkGesture(open.state, { type: 'cancel', pointerId: 9 }).effect).toBe('ignore');
    expect(reduceInkGesture(open.state, { type: 'lost-capture', pointerId: 3 }).effect).toBe('ignore');
    const up = reduceInkGesture(open.state, { type: 'up', pointerId: 3 });
    expect(up.effect).toBe('commit');
    expect(reduceInkGesture(up.state, { type: 'lost-capture', pointerId: 3 } satisfies InkEvent).effect).toBe('ignore');
  });

  test('keeps stroke-only hits for organic ink and leaves other nodes alone', () => {
    const stroke = ink(line(), 'brush', 9, 'thick');
    const local = Array.from({ length: stroke.points.length / 2 }, (_, index) => ({
      x: stroke.x + (stroke.points[index * 2] ?? 0),
      y: stroke.y + (stroke.points[index * 2 + 1] ?? 0),
    }));
    const outline = getOrganicOutline(local, 'brush', stroke.strokeWidth, true);
    const edge = outline[0] ?? { x: stroke.x, y: stroke.y };
    expect(drawingHits([stroke], edge, edge, 0)).toEqual(['thick']);
    expect(drawingHits([stroke], { x: edge.x + 80, y: edge.y + 80 }, { x: edge.x + 90, y: edge.y + 90 }, 2)).toEqual([]);
    const dot = ink([{ x: 12, y: 12 }], 'fineliner', 3, 'dot');
    expect(drawingHits([dot], { x: dot.x + (dot.points[0] ?? 0), y: dot.y + (dot.points[1] ?? 0) }, { x: dot.x + (dot.points[0] ?? 0), y: dot.y + (dot.points[1] ?? 0) }, 1)).toEqual(['dot']);
    const note = { ...createTextNode({ x: 0, y: 0 }, 'keep', now), id: 'note' };
    expect(drawingHits([note, stroke], { x: note.x + 4, y: note.y + 4 }, { x: note.x + 8, y: note.y + 8 }, 4)).toEqual([]);
    const projection = createNodeProjection().project([stroke, dot], { selected: new Set(), editingId: null, readOnly: false, unlocked: new Map(), registry: null, library: new Map() });
    expect({ pointerEvents: 'all', ...projection[0]?.style }.pointerEvents).toBe('none');
    expect(projection.find((node) => node.id === 'dot')?.type === 'drawing' ? projection.find((node) => node.id === 'dot')?.data && 'dot' in (projection.find((node) => node.id === 'dot')?.data ?? {}) : false).toBe(true);
  });

  test('migrates schema 14 drawings as legacy and keeps new brushes', async () => {
    const legacy = ink([{ x: 2, y: 2 }, { x: 30, y: 8 }], 'legacy', 4, 'old');
    const board = addNodes(createEmptyBoard(now), [legacy], now);
    const raw = { ...board, schemaVersion: 14, nodes: board.nodes.map((node) => (node.kind === 'drawing' ? { ...node, brush: undefined } : node)) };
    const migrated = parseBoard(raw);
    const kept = migrated?.nodes.find((node) => node.id === 'old');
    expect(migrated?.schemaVersion).toBe(15);
    expect(kept?.kind === 'drawing' ? kept.brush : '').toBe('legacy');
    expect(kept?.kind === 'drawing' ? kept.points : []).toEqual(legacy.points);
    expect(kept?.kind === 'drawing' ? kept.strokeWidth : 0).toBe(legacy.strokeWidth);
    expect(kept?.kind === 'drawing' ? kept.x : 0).toBe(legacy.x);
    expect(parseBoard({ ...board, nodes: board.nodes.map((node) => (node.kind === 'drawing' ? { ...node, brush: 'marker' } : node)) })).toBeNull();
    expect(parseBoard({ ...createEmptyBoard(now), schemaVersion: 13 })?.schemaVersion).toBe(15);
    expect(parseBoard({ ...createEmptyBoard(now), schemaVersion: 16 })).toBeNull();
    const fresh = ink(line(), 'brush', 9, 'new');
    const live = addNodes(createEmptyBoard(now), [fresh], now);
    const payload = selectionClosure(live, ['new']);
    const decoded = payload ? decodeGraphClipboard(encodeGraphClipboard(payload)) : null;
    const pastedNode = decoded?.nodes.find((node) => node.kind === 'drawing');
    expect(pastedNode?.kind === 'drawing' ? pastedNode.brush : '').toBe('brush');
    const { brush, ...without } = fresh;
    void brush;
    const oldClipboard = decodeGraphClipboard(`canvas-graph/1\n${JSON.stringify({ format: 'canvas-graph', version: 1, nodes: [without], edges: [] })}`);
    expect(oldClipboard?.nodes[0]?.kind === 'drawing' ? oldClipboard.nodes[0].brush : '').toBe('legacy');
    const packed = await buildArchive(live, [], now);
    const opened = await readArchive(packed);
    const restored = 'error' in opened ? null : opened.board.nodes.find((node) => node.id === 'new');
    expect(restored?.kind === 'drawing' ? restored.brush : '').toBe('brush');
    const copied = duplicateSelection(live, ['new'], later);
    expect(copied.nodes.filter((node) => node.kind === 'drawing' && node.brush === 'brush')).toHaveLength(2);
    const history = pushHistory(createHistory(), live);
    const removed = eraseDrawings(live, ['new'], later);
    const undone = undoHistory(history, removed);
    const restoredInk = undone?.board.nodes.find((node) => node.id === 'new');
    expect(restoredInk?.kind === 'drawing' ? restoredInk.brush : '').toBe('brush');
    const redone = undone ? redoHistory(undone.history, undone.board) : null;
    expect(redone?.board.nodes.some((node) => node.kind === 'drawing')).toBe(false);
    const pasted = decoded ? pasteGraph(createEmptyBoard(later), decoded, { x: 12, y: 12 }, new Set(), 0, later) : null;
    expect(pasted && !('error' in pasted) ? pasted.nodes.some((node) => node.kind === 'drawing' && node.brush === 'brush') : false).toBe(true);
    expect(MAX_DRAWING_NODES).toBe(2000);
    expect(MAX_DRAWING_POINTS).toBe(1024);
  });

  test('caches unchanged outlines and builds a thousand strokes', () => {
    const node = ink(line(), 'fountain', 5, 'cached');
    const path = organicSvgPath(node.points, 'fountain', node.strokeWidth);
    const after = organicBuildCount();
    expect(organicSvgPath(node.points, 'fountain', node.strokeWidth)).toBe(path);
    expect(organicBuildCount()).toBe(after);
    const started = performance.now();
    for (let index = 0; index < 1000; index += 1) {
      const brush = index % 3 === 0 ? 'fineliner' : index % 3 === 1 ? 'fountain' : 'brush';
      getOrganicOutline(
        [
          { x: index, y: 0 },
          { x: index + 12, y: 6 },
          { x: index + 20, y: -2 },
          { x: index + 34, y: 8 },
        ],
        brush,
        penScreenPx(brush),
        true,
      );
    }
    const elapsed = performance.now() - started;
    expect(elapsed).toBeGreaterThan(0);
    expect(elapsed < 4000).toBe(true);
  });
});

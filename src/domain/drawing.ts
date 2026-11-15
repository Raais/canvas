import {
  DRAWING_STROKE_MAX,
  DRAWING_STROKE_MIN,
  ERASER_RADIUS_PX,
  MAX_DRAWING_POINTS,
  MAX_ZOOM,
  MIN_ZOOM,
  type BoardNode,
  type DrawingColor,
  type DrawingNode,
  type Point,
} from './types';

export const DRAWING_COLORS = ['ink', 'blue', 'sage', 'rose', 'sand'] as const;

export const PEN_SIZES = [
  { id: 'thin', label: 'Thin', screenPx: 2 },
  { id: 'medium', label: 'Medium', screenPx: 4 },
  { id: 'thick', label: 'Thick', screenPx: 8 },
] as const;

export type PenSizeId = (typeof PEN_SIZES)[number]['id'];

/** Theme-resolved stroke colors. `ink` flips with the board; the stored id does not. */
export const DRAWING_THEME_COLORS: Record<'dark' | 'light', Record<DrawingColor, string>> = {
  dark: { ink: '#f4efe6', blue: '#8eacc6', sage: '#8eae8a', rose: '#e2b1a0', sand: '#e0c59a' },
  light: { ink: '#241f1a', blue: '#2f5f86', sage: '#3d6b45', rose: '#9a4038', sand: '#8a6232' },
};

const SAMPLE_SCREEN_PX = 0.75;
const SIMPLIFY_SCREEN_PX = 0.6;
const RAW_POINT_CAP = 4096;

export type StrokeDraft = {
  points: Point[];
  zoom: number;
  color: DrawingColor;
  screenWidth: number;
  cancelled: boolean;
};

export function drawingEditsAllowed(readOnly: boolean): boolean {
  return !readOnly;
}

export function isDrawingColor(value: unknown): value is DrawingColor {
  return value === 'ink' || value === 'blue' || value === 'sage' || value === 'rose' || value === 'sand';
}

export function countDrawings(nodes: readonly { kind: string }[]): number {
  let count = 0;
  for (const node of nodes) if (node.kind === 'drawing') count += 1;
  return count;
}

export function penScreenPx(size: PenSizeId): number {
  return PEN_SIZES.find((entry) => entry.id === size)?.screenPx ?? 4;
}

export function worldStrokeWidth(screenPx: number, zoom: number): number {
  const safeZoom = clampZoom(zoom);
  const width = screenPx / safeZoom;
  return round2(Math.min(DRAWING_STROKE_MAX, Math.max(DRAWING_STROKE_MIN, width)));
}

export function eraserWorldRadius(zoom: number): number {
  return ERASER_RADIUS_PX / clampZoom(zoom);
}

export function sampleDistance(zoom: number): number {
  return SAMPLE_SCREEN_PX / clampZoom(zoom);
}

export function simplifyTolerance(zoom: number): number {
  return SIMPLIFY_SCREEN_PX / clampZoom(zoom);
}

export function beginStroke(point: Point, zoom: number, color: DrawingColor, screenWidth: number): StrokeDraft {
  return { points: [roundPoint(point)], zoom: clampZoom(zoom), color, screenWidth, cancelled: false };
}

export function extendStroke(draft: StrokeDraft, point: Point): StrokeDraft {
  if (draft.cancelled || draft.points.length >= RAW_POINT_CAP) return draft;
  const next = roundPoint(point);
  const last = draft.points[draft.points.length - 1];
  if (!last || !Number.isFinite(next.x) || !Number.isFinite(next.y)) return draft;
  if (Math.hypot(next.x - last.x, next.y - last.y) < sampleDistance(draft.zoom)) return draft;
  return { ...draft, points: [...draft.points, next] };
}

export function cancelStroke(draft: StrokeDraft): StrokeDraft {
  if (draft.cancelled) return draft;
  return { ...draft, cancelled: true };
}

export function finishStroke(draft: StrokeDraft, now: string, id?: string): DrawingNode | null {
  if (draft.cancelled || draft.points.length === 0) return null;
  const simplified = limitPoints(simplifyPolyline(draft.points, simplifyTolerance(draft.zoom)));
  if (simplified.length === 0 || simplified.some((point) => !Number.isFinite(point.x) || !Number.isFinite(point.y))) return null;
  return drawingFromWorld(simplified, draft.color, worldStrokeWidth(draft.screenWidth, draft.zoom), now, id ?? crypto.randomUUID());
}

export function drawingFromWorld(
  worldPoints: readonly Point[],
  color: DrawingColor,
  strokeWidth: number,
  now: string,
  id?: string,
): DrawingNode | null {
  if (!isDrawingColor(color) || worldPoints.length === 0 || worldPoints.length > MAX_DRAWING_POINTS) return null;
  if (!Number.isFinite(strokeWidth) || strokeWidth < DRAWING_STROKE_MIN || strokeWidth > DRAWING_STROKE_MAX) return null;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const point of worldPoints) {
    if (!Number.isFinite(point.x) || !Number.isFinite(point.y)) return null;
    minX = Math.min(minX, point.x);
    minY = Math.min(minY, point.y);
    maxX = Math.max(maxX, point.x);
    maxY = Math.max(maxY, point.y);
  }
  const pad = strokeWidth / 2;
  const x = round2(minX - pad);
  const y = round2(minY - pad);
  const width = Math.max(round2(strokeWidth), round2(maxX - minX + strokeWidth));
  const height = Math.max(round2(strokeWidth), round2(maxY - minY + strokeWidth));
  if (!(width > 0) || !(height > 0)) return null;
  const points: number[] = [];
  for (const point of worldPoints) {
    points.push(clamp(round2(point.x - x), 0, width), clamp(round2(point.y - y), 0, height));
  }
  return { id: id ?? crypto.randomUUID(), kind: 'drawing', x, y, width, height, points, color, strokeWidth, lastEditedAt: now };
}

export function simplifyPolyline(points: readonly Point[], tolerance: number): Point[] {
  if (points.length <= 2) return points.map((point) => ({ ...point }));
  const safe = Number.isFinite(tolerance) && tolerance > 0 ? tolerance : 0;
  return rdp(points, safe);
}

export function pathFromPairs(points: readonly number[]): string {
  if (points.length < 4) return '';
  let path = `M ${points[0]} ${points[1]}`;
  for (let index = 2; index < points.length; index += 2) path += ` L ${points[index]} ${points[index + 1]}`;
  return path;
}

export function parseDrawingNode(value: Record<string, unknown>, parentId: string | undefined): DrawingNode | null {
  if (!isDrawingColor(value.color)) return null;
  if (typeof value.strokeWidth !== 'number' || !Number.isFinite(value.strokeWidth)) return null;
  if (value.strokeWidth < DRAWING_STROKE_MIN || value.strokeWidth > DRAWING_STROKE_MAX) return null;
  if (typeof value.lastEditedAt !== 'string' || !Number.isFinite(Date.parse(value.lastEditedAt))) return null;
  if (!Array.isArray(value.points) || value.points.length < 2 || value.points.length > MAX_DRAWING_POINTS * 2 || value.points.length % 2 !== 0) return null;
  const points: number[] = [];
  for (const entry of value.points) {
    if (typeof entry !== 'number' || !Number.isFinite(entry)) return null;
    points.push(entry);
  }
  const width = value.width;
  const height = value.height;
  if (typeof width !== 'number' || typeof height !== 'number' || !(width > 0) || !(height > 0)) return null;
  for (let index = 0; index < points.length; index += 2) {
    const x = points[index] ?? Number.NaN;
    const y = points[index + 1] ?? Number.NaN;
    if (x < -0.05 || y < -0.05 || x > width + 0.05 || y > height + 0.05) return null;
  }
  return {
    id: String(value.id),
    kind: 'drawing',
    ...(parentId ? { parentId } : {}),
    x: Number(value.x),
    y: Number(value.y),
    width,
    height,
    points,
    color: value.color,
    strokeWidth: value.strokeWidth,
    lastEditedAt: value.lastEditedAt,
  };
}

export function drawingHits(
  nodes: readonly BoardNode[],
  from: Point,
  to: Point,
  radius: number,
): string[] {
  if (!Number.isFinite(radius) || radius < 0 || !Number.isFinite(from.x) || !Number.isFinite(from.y) || !Number.isFinite(to.x) || !Number.isFinite(to.y)) return [];
  const hits: string[] = [];
  const seen = new Set<string>();
  for (const node of nodes) {
    if (node.kind !== 'drawing' || seen.has(node.id)) continue;
    const origin = worldOrigin(nodes, node);
    if (!boundsNearSegment(origin.x, origin.y, node.width, node.height, from, to, radius + node.strokeWidth / 2)) continue;
    if (strokeTouches(node, origin, from, to, radius)) {
      seen.add(node.id);
      hits.push(node.id);
    }
  }
  return hits;
}

function strokeTouches(node: DrawingNode, origin: Point, from: Point, to: Point, radius: number): boolean {
  const threshold = radius + node.strokeWidth / 2;
  const pairs = node.points;
  if (pairs.length < 2) return false;
  if (pairs.length === 2) {
    return pointSegmentDistance(origin.x + (pairs[0] ?? 0), origin.y + (pairs[1] ?? 0), from.x, from.y, to.x, to.y) <= threshold;
  }
  for (let index = 0; index < pairs.length - 2; index += 2) {
    const ax = origin.x + (pairs[index] ?? 0);
    const ay = origin.y + (pairs[index + 1] ?? 0);
    const bx = origin.x + (pairs[index + 2] ?? 0);
    const by = origin.y + (pairs[index + 3] ?? 0);
    if (segmentSegmentDistance(ax, ay, bx, by, from.x, from.y, to.x, to.y) <= threshold) return true;
  }
  return false;
}

function worldOrigin(nodes: readonly BoardNode[], node: DrawingNode): Point {
  if (node.parentId) {
    const parent = nodes.find((entry) => entry.id === node.parentId && entry.kind === 'group');
    if (parent) return { x: parent.x + node.x, y: parent.y + node.y };
  }
  return { x: node.x, y: node.y };
}

function boundsNearSegment(x: number, y: number, width: number, height: number, from: Point, to: Point, pad: number): boolean {
  const minX = Math.min(from.x, to.x) - pad;
  const minY = Math.min(from.y, to.y) - pad;
  const maxX = Math.max(from.x, to.x) + pad;
  const maxY = Math.max(from.y, to.y) + pad;
  return x <= maxX && x + width >= minX && y <= maxY && y + height >= minY;
}

export function pointSegmentDistance(px: number, py: number, ax: number, ay: number, bx: number, by: number): number {
  const dx = bx - ax;
  const dy = by - ay;
  const length = dx * dx + dy * dy;
  if (length === 0) return Math.hypot(px - ax, py - ay);
  const t = clamp(((px - ax) * dx + (py - ay) * dy) / length, 0, 1);
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

export function segmentSegmentDistance(
  ax: number,
  ay: number,
  bx: number,
  by: number,
  cx: number,
  cy: number,
  dx: number,
  dy: number,
): number {
  if (segmentsIntersect(ax, ay, bx, by, cx, cy, dx, dy)) return 0;
  return Math.min(
    pointSegmentDistance(ax, ay, cx, cy, dx, dy),
    pointSegmentDistance(bx, by, cx, cy, dx, dy),
    pointSegmentDistance(cx, cy, ax, ay, bx, by),
    pointSegmentDistance(dx, dy, ax, ay, bx, by),
  );
}

function segmentsIntersect(
  ax: number,
  ay: number,
  bx: number,
  by: number,
  cx: number,
  cy: number,
  dx: number,
  dy: number,
): boolean {
  const d1 = cross(dx - cx, dy - cy, ax - cx, ay - cy);
  const d2 = cross(dx - cx, dy - cy, bx - cx, by - cy);
  const d3 = cross(bx - ax, by - ay, cx - ax, cy - ay);
  const d4 = cross(bx - ax, by - ay, dx - ax, dy - ay);
  return ((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0));
}

function cross(ax: number, ay: number, bx: number, by: number): number {
  return ax * by - ay * bx;
}

function rdp(points: readonly Point[], epsilon: number): Point[] {
  const first = points[0];
  const last = points[points.length - 1];
  if (!first || !last || points.length < 3) return points.map((point) => ({ ...point }));
  let max = 0;
  let index = 0;
  for (let cursor = 1; cursor < points.length - 1; cursor += 1) {
    const point = points[cursor];
    if (!point) continue;
    const distance = pointSegmentDistance(point.x, point.y, first.x, first.y, last.x, last.y);
    if (distance > max) {
      max = distance;
      index = cursor;
    }
  }
  if (max > epsilon && index > 0) {
    const left = rdp(points.slice(0, index + 1), epsilon);
    const right = rdp(points.slice(index), epsilon);
    return [...left.slice(0, -1), ...right];
  }
  return [{ ...first }, { ...last }];
}

function limitPoints(points: Point[]): Point[] {
  if (points.length <= MAX_DRAWING_POINTS) return points;
  const kept: Point[] = [];
  const last = points.length - 1;
  for (let index = 0; index < MAX_DRAWING_POINTS; index += 1) {
    const source = Math.round((index * last) / (MAX_DRAWING_POINTS - 1));
    const point = points[source];
    if (point) kept.push(point);
  }
  return kept;
}

function roundPoint(point: Point): Point {
  return { x: round2(point.x), y: round2(point.y) };
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function clampZoom(zoom: number): number {
  if (!Number.isFinite(zoom) || zoom <= 0) return 1;
  return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, zoom));
}

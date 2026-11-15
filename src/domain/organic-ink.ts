import { getStroke } from 'perfect-freehand';
import type { DrawingBrush, Point } from './types';

export type OrganicBrush = Exclude<DrawingBrush, 'legacy'>;

export type BrushPreset = {
  id: OrganicBrush;
  label: string;
  screenPx: number;
  thinning: number;
  smoothing: number;
  streamline: number;
  simulatePressure: boolean;
};

export const DRAWING_BRUSHES: readonly BrushPreset[] = [
  { id: 'fineliner', label: 'Fineliner', screenPx: 3, thinning: 0, smoothing: 0.5, streamline: 0.3, simulatePressure: false },
  { id: 'fountain', label: 'Fountain Pen', screenPx: 5, thinning: 0.55, smoothing: 0.65, streamline: 0.45, simulatePressure: true },
  { id: 'brush', label: 'Brush Pen', screenPx: 9, thinning: 0.8, smoothing: 0.7, streamline: 0.5, simulatePressure: true },
];

const PATH_LIMIT = 2200;
const pathCache = new Map<string, string>();
const outlineCache = new Map<string, Point[]>();
let outlineBuilds = 0;

export function isOrganicBrush(value: unknown): value is OrganicBrush {
  return value === 'fineliner' || value === 'fountain' || value === 'brush';
}

export function isDrawingBrush(value: unknown): value is DrawingBrush {
  return value === 'legacy' || isOrganicBrush(value);
}

export function getBrushPreset(brush: OrganicBrush): BrushPreset {
  return DRAWING_BRUSHES.find((entry) => entry.id === brush) ?? DRAWING_BRUSHES[1]!;
}

export function organicBuildCount(): number {
  return outlineBuilds;
}

export function getOrganicOutline(points: readonly Point[], brush: OrganicBrush, worldWidth: number, last = true): Point[] {
  if (!Number.isFinite(worldWidth) || worldWidth <= 0) return [];
  const input = points.filter((point) => Number.isFinite(point.x) && Number.isFinite(point.y));
  const first = input[0];
  if (!first) return [];
  if (input.length < 2) return circleOutline(first, worldWidth / 2);
  outlineBuilds += 1;
  const preset = getBrushPreset(brush);
  const taper = brush === 'brush' ? brushEndTaper(input, worldWidth) : 0;
  const raw = getStroke(
    input.map((point) => [point.x, point.y]),
    {
      size: worldWidth,
      thinning: preset.thinning,
      smoothing: preset.smoothing,
      streamline: preset.streamline,
      simulatePressure: preset.simulatePressure,
      start: { cap: true, taper: 0 },
      end: { cap: true, taper },
      last,
    },
  );
  const outline: Point[] = [];
  for (const vertex of raw) {
    const x = vertex[0];
    const y = vertex[1];
    if (typeof x !== 'number' || typeof y !== 'number' || !Number.isFinite(x) || !Number.isFinite(y)) continue;
    outline.push({ x, y });
  }
  return outline.length >= 3 ? outline : circleOutline(first, worldWidth / 2);
}

export function outlineToSvgPath(outline: readonly Point[]): string {
  const first = outline[0];
  if (!first || outline.length < 2) return '';
  if (!Number.isFinite(first.x) || !Number.isFinite(first.y)) return '';
  let path = `M ${trim(first.x)} ${trim(first.y)} Q`;
  for (let index = 0; index < outline.length; index += 1) {
    const current = outline[index];
    const next = outline[(index + 1) % outline.length];
    if (!current || !next) return '';
    if (!Number.isFinite(current.x) || !Number.isFinite(current.y) || !Number.isFinite(next.x) || !Number.isFinite(next.y)) return '';
    path += ` ${trim(current.x)} ${trim(current.y)} ${trim((current.x + next.x) / 2)} ${trim((current.y + next.y) / 2)}`;
  }
  return `${path} Z`;
}

export function outlineForPairs(pairs: readonly number[], brush: OrganicBrush, worldWidth: number): Point[] {
  const key = cacheKey(brush, worldWidth, pairs);
  const cached = outlineCache.get(key);
  if (cached) return cached;
  const outline = getOrganicOutline(pairsToPoints(pairs), brush, worldWidth, true);
  outlineCache.set(key, outline);
  trimCache(outlineCache);
  return outline;
}

export function organicSvgPath(pairs: readonly number[], brush: OrganicBrush, worldWidth: number): string {
  const key = cacheKey(brush, worldWidth, pairs);
  const cached = pathCache.get(key);
  if (cached !== undefined) return cached;
  const path = outlineToSvgPath(outlineForPairs(pairs, brush, worldWidth));
  pathCache.set(key, path);
  trimCache(pathCache);
  return path;
}

export function pointInOutline(point: Point, outline: readonly Point[]): boolean {
  if (outline.length < 3) return false;
  let inside = false;
  for (let index = 0, previous = outline.length - 1; index < outline.length; previous = index, index += 1) {
    const a = outline[index];
    const b = outline[previous];
    if (!a || !b) continue;
    const crosses = a.y > point.y !== b.y > point.y;
    const x = ((b.x - a.x) * (point.y - a.y)) / (b.y - a.y || Number.EPSILON) + a.x;
    if (crosses && point.x < x) inside = !inside;
  }
  return inside;
}

export function brushEndTaper(points: readonly Point[], size: number): number {
  let length = 0;
  for (let index = 1; index < points.length; index += 1) {
    const previous = points[index - 1];
    const point = points[index];
    if (!previous || !point) continue;
    length += Math.hypot(point.x - previous.x, point.y - previous.y);
  }
  if (length < size * 4) return 0;
  return trim(Math.min(size * 2.2, length * 0.16));
}

function circleOutline(center: Point, radius: number): Point[] {
  const safe = Number.isFinite(radius) && radius > 0 ? radius : 0.5;
  const steps = 20;
  const outline: Point[] = [];
  for (let index = 0; index < steps; index += 1) {
    const angle = (index / steps) * Math.PI * 2;
    outline.push({ x: center.x + Math.cos(angle) * safe, y: center.y + Math.sin(angle) * safe });
  }
  return outline;
}

function pairsToPoints(pairs: readonly number[]): Point[] {
  const points: Point[] = [];
  for (let index = 0; index < pairs.length; index += 2) points.push({ x: pairs[index] ?? 0, y: pairs[index + 1] ?? 0 });
  return points;
}

function cacheKey(brush: OrganicBrush, worldWidth: number, pairs: readonly number[]): string {
  return `${brush}|${worldWidth}|${pairs.join(',')}`;
}

function trimCache(cache: Map<string, unknown>) {
  while (cache.size > PATH_LIMIT) {
    const oldest = cache.keys().next().value;
    if (oldest === undefined) return;
    cache.delete(oldest);
  }
}

function trim(value: number): number {
  return Math.round(value * 100) / 100;
}

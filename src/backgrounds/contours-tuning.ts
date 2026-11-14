export const CONTOURS_V1_TERRAIN = {
  largeScale: 2490,
  mediumScale: 790,
  detailScale: 305,
  largeWeight: 0.76,
  mediumWeight: 0.36,
  detailWeight: 0.12,
  densityLow: -0.06,
  densityHigh: 0.41,
};

export type ContoursTuning = {
  minorInterval: number;
  majorEvery: number;
  minorWidthPx: number;
  majorWidthPx: number;
  minorOpacity: number;
  majorOpacity: number;
  coastlineOpacity: number;
  lodFadeStartPx: number;
  lodFadeEndPx: number;
};

export type ContoursPreview = 'original' | 'experimental';

export const CONTOURS_V1_DEFAULTS: ContoursTuning = {
  minorInterval: 0.075,
  majorEvery: 4,
  minorWidthPx: 0.7,
  majorWidthPx: 1.15,
  minorOpacity: 0.12,
  majorOpacity: 0.24,
  coastlineOpacity: 0.17,
  lodFadeStartPx: 2,
  lodFadeEndPx: 5,
};

const LIMITS = {
  minorInterval: [0.025, 0.2],
  majorEvery: [2, 8],
  minorWidthPx: [0.3, 2],
  majorWidthPx: [0.5, 3],
  minorOpacity: [0, 0.5],
  majorOpacity: [0, 0.7],
  coastlineOpacity: [0, 0.5],
  lodFadeStartPx: [1, 5],
  lodFadeEndPx: [2, 10],
} as const;

function clampNumber(value: number, min: number, max: number, fallback: number): number {
  if (!Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, value));
}

export function clampContoursTuning(input: Partial<ContoursTuning>, base: ContoursTuning = CONTOURS_V1_DEFAULTS): ContoursTuning {
  const next = { ...base, ...input };
  const minorInterval = clampNumber(next.minorInterval, LIMITS.minorInterval[0], LIMITS.minorInterval[1], base.minorInterval);
  const majorEvery = Math.round(clampNumber(next.majorEvery, LIMITS.majorEvery[0], LIMITS.majorEvery[1], base.majorEvery));
  const minorWidthPx = clampNumber(next.minorWidthPx, LIMITS.minorWidthPx[0], LIMITS.minorWidthPx[1], base.minorWidthPx);
  const majorWidthPx = clampNumber(next.majorWidthPx, LIMITS.majorWidthPx[0], LIMITS.majorWidthPx[1], base.majorWidthPx);
  const minorOpacity = clampNumber(next.minorOpacity, LIMITS.minorOpacity[0], LIMITS.minorOpacity[1], base.minorOpacity);
  const majorOpacity = clampNumber(next.majorOpacity, LIMITS.majorOpacity[0], LIMITS.majorOpacity[1], base.majorOpacity);
  const coastlineOpacity = clampNumber(next.coastlineOpacity, LIMITS.coastlineOpacity[0], LIMITS.coastlineOpacity[1], base.coastlineOpacity);
  let lodFadeStartPx = clampNumber(next.lodFadeStartPx, LIMITS.lodFadeStartPx[0], LIMITS.lodFadeStartPx[1], base.lodFadeStartPx);
  let lodFadeEndPx = clampNumber(next.lodFadeEndPx, LIMITS.lodFadeEndPx[0], LIMITS.lodFadeEndPx[1], base.lodFadeEndPx);
  if (lodFadeEndPx < lodFadeStartPx + 0.5) lodFadeEndPx = Math.min(LIMITS.lodFadeEndPx[1], lodFadeStartPx + 0.5);
  if (lodFadeEndPx < lodFadeStartPx + 0.5) lodFadeStartPx = lodFadeEndPx - 0.5;
  return {
    minorInterval, majorEvery, minorWidthPx, majorWidthPx, minorOpacity, majorOpacity, coastlineOpacity, lodFadeStartPx, lodFadeEndPx,
  };
}

export function contourWeights(terrain = CONTOURS_V1_TERRAIN): [number, number, number] {
  const sum = terrain.largeWeight + terrain.mediumWeight + terrain.detailWeight;
  if (!(sum > 0)) return [1 / 3, 1 / 3, 1 / 3];
  return [terrain.largeWeight / sum, terrain.mediumWeight / sum, terrain.detailWeight / sum];
}

export function effectiveContoursTuning(preview: ContoursPreview, experimental: ContoursTuning): ContoursTuning {
  return preview === 'original' ? CONTOURS_V1_DEFAULTS : clampContoursTuning(experimental);
}

export function contoursSceneKey(scene: {
  x: number; y: number; zoom: number; cssWidth: number; cssHeight: number; seed: number; appearance: string; dpr: number; tuning: ContoursTuning;
}): string {
  const tuning = clampContoursTuning(scene.tuning);
  return [
    scene.x, scene.y, scene.zoom, scene.cssWidth, scene.cssHeight, scene.seed, scene.appearance, scene.dpr,
    tuning.minorInterval, tuning.majorEvery, tuning.minorWidthPx, tuning.majorWidthPx,
    tuning.minorOpacity, tuning.majorOpacity, tuning.coastlineOpacity, tuning.lodFadeStartPx, tuning.lodFadeEndPx,
    CONTOURS_V1_TERRAIN.largeScale, CONTOURS_V1_TERRAIN.densityLow,
  ].join(':');
}

export function coastlineCoverage(terrain: number, seaLevel: number, footprint: number, halfWidthPx: number): number {
  const height = terrain - seaLevel;
  const foot = Math.max(Number.isFinite(footprint) ? footprint : 0, 0.00001);
  const pixels = Math.abs(height) / foot;
  const start = Math.max(Number.isFinite(halfWidthPx) ? halfWidthPx : 0, 0);
  const end = start + 1;
  if (pixels <= start) return 1;
  if (pixels >= end) return 0;
  const t = (pixels - start) / (end - start);
  const smooth = t * t * (3 - 2 * t);
  return 1 - smooth;
}

export function contoursLabDocument(settings: ContoursTuning, context: { seed: number; title: string; zoom: number; rendererVersion: 1 }) {
  return {
    format: 'canvas-topographic-contours-lab' as const,
    configVersion: 1 as const,
    baseRendererVersion: 1 as const,
    settings: clampContoursTuning(settings),
    context,
  };
}

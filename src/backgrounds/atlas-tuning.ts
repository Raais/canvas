export const ATLAS_LAB_ENABLED = true;

export type AtlasDitherMode = 'smooth' | 'adaptive';
export type AtlasPreview = 'original' | 'experimental';

export type AtlasTuning = {
  largeScale: number;
  mediumScale: number;
  detailScale: number;
  largeWeight: number;
  mediumWeight: number;
  detailWeight: number;
  densityLow: number;
  densityHigh: number;
  cellSize: number;
  inkStrength: number;
  ditherMode: AtlasDitherMode;
  smoothFadeStart: number;
  smoothFadeEnd: number;
  adaptiveTargetPixels: number;
  voidEnabled: boolean;
  voidCutoff: number;
  voidSoftness: number;
};

export const ATLAS_V1_DEFAULTS: AtlasTuning = {
  largeScale: 900,
  mediumScale: 340,
  detailScale: 105,
  largeWeight: 0.57,
  mediumWeight: 0.28,
  detailWeight: 0.15,
  densityLow: -0.18,
  densityHigh: 0.42,
  cellSize: 4,
  inkStrength: 0.72,
  ditherMode: 'smooth',
  smoothFadeStart: 0.8,
  smoothFadeEnd: 2.4,
  adaptiveTargetPixels: 2.5,
  voidEnabled: false,
  voidCutoff: 0.15,
  voidSoftness: 0,
};

export const ATLAS_V2_DEFAULTS: AtlasTuning = {
  largeScale: 2490,
  mediumScale: 790,
  detailScale: 305,
  largeWeight: 0.76,
  mediumWeight: 0.36,
  detailWeight: 0.12,
  densityLow: -0.06,
  densityHigh: 0.41,
  cellSize: 7,
  inkStrength: 0.07,
  ditherMode: 'adaptive',
  smoothFadeStart: 0.8,
  smoothFadeEnd: 2.4,
  adaptiveTargetPixels: 2.25,
  voidEnabled: false,
  voidCutoff: 0.15,
  voidSoftness: 0,
};

export const ATLAS_TUNING_DEFAULTS = ATLAS_V1_DEFAULTS;

export function defaultsForAtlasVersion(version: 1 | 2): AtlasTuning {
  return version === 1 ? ATLAS_V1_DEFAULTS : ATLAS_V2_DEFAULTS;
}

const LIMITS = {
  largeScale: [250, 2500],
  mediumScale: [80, 1200],
  detailScale: [20, 450],
  largeWeight: [0, 1],
  mediumWeight: [0, 1],
  detailWeight: [0, 1],
  densityLow: [-0.8, 0.3],
  densityHigh: [0, 0.9],
  cellSize: [1, 32],
  inkStrength: [0, 1],
  smoothFadeStart: [0.2, 3],
  smoothFadeEnd: [0.5, 6],
  adaptiveTargetPixels: [1, 6],
  voidCutoff: [0, 1],
  voidSoftness: [0, 0.15],
} as const;

function clampNumber(value: number, min: number, max: number, fallback: number): number {
  if (!Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, value));
}

export function clampAtlasTuning(input: Partial<AtlasTuning>, base: AtlasTuning = ATLAS_V1_DEFAULTS): AtlasTuning {
  const next = { ...base, ...input };
  const largeScale = clampNumber(next.largeScale, LIMITS.largeScale[0], LIMITS.largeScale[1], base.largeScale);
  const mediumScale = clampNumber(next.mediumScale, LIMITS.mediumScale[0], LIMITS.mediumScale[1], base.mediumScale);
  const detailScale = clampNumber(next.detailScale, LIMITS.detailScale[0], LIMITS.detailScale[1], base.detailScale);
  const largeWeight = clampNumber(next.largeWeight, 0, 1, base.largeWeight);
  const mediumWeight = clampNumber(next.mediumWeight, 0, 1, base.mediumWeight);
  const detailWeight = clampNumber(next.detailWeight, 0, 1, base.detailWeight);
  let densityLow = clampNumber(next.densityLow, LIMITS.densityLow[0], LIMITS.densityLow[1], base.densityLow);
  let densityHigh = clampNumber(next.densityHigh, LIMITS.densityHigh[0], LIMITS.densityHigh[1], base.densityHigh);
  if (densityHigh < densityLow + 0.01) densityHigh = Math.min(LIMITS.densityHigh[1], densityLow + 0.01);
  if (densityHigh < densityLow + 0.01) densityLow = densityHigh - 0.01;
  let smoothFadeStart = clampNumber(next.smoothFadeStart, LIMITS.smoothFadeStart[0], LIMITS.smoothFadeStart[1], base.smoothFadeStart);
  let smoothFadeEnd = clampNumber(next.smoothFadeEnd, LIMITS.smoothFadeEnd[0], LIMITS.smoothFadeEnd[1], base.smoothFadeEnd);
  if (smoothFadeEnd < smoothFadeStart + 0.1) smoothFadeEnd = Math.min(LIMITS.smoothFadeEnd[1], smoothFadeStart + 0.1);
  const cellSize = Math.round(clampNumber(next.cellSize, LIMITS.cellSize[0], LIMITS.cellSize[1], base.cellSize));
  const inkStrength = clampNumber(next.inkStrength, 0, 1, base.inkStrength);
  const adaptiveTargetPixels = clampNumber(next.adaptiveTargetPixels, LIMITS.adaptiveTargetPixels[0], LIMITS.adaptiveTargetPixels[1], base.adaptiveTargetPixels);
  const ditherMode: AtlasDitherMode = next.ditherMode === 'adaptive' ? 'adaptive' : 'smooth';
  const voidEnabled = next.voidEnabled === true;
  const voidCutoff = clampNumber(next.voidCutoff, LIMITS.voidCutoff[0], LIMITS.voidCutoff[1], base.voidCutoff);
  const voidSoftness = clampNumber(next.voidSoftness, LIMITS.voidSoftness[0], LIMITS.voidSoftness[1], base.voidSoftness);
  return {
    largeScale, mediumScale, detailScale, largeWeight, mediumWeight, detailWeight,
    densityLow, densityHigh, cellSize, inkStrength, ditherMode, smoothFadeStart, smoothFadeEnd, adaptiveTargetPixels,
    voidEnabled, voidCutoff, voidSoftness,
  };
}

export function landMask(density: number, cutoff: number, softness: number, enabled = true): number {
  if (!enabled) return 1;
  const safeDensity = Number.isFinite(density) ? Math.min(1, Math.max(0, density)) : 0;
  const safeCutoff = clampNumber(cutoff, 0, 1, ATLAS_V1_DEFAULTS.voidCutoff);
  const safeSoftness = clampNumber(softness, 0, 0.15, 0);
  if (!(safeSoftness > 0)) return safeDensity > safeCutoff ? 1 : 0;
  const upper = Math.min(1, safeCutoff + safeSoftness);
  if (upper <= safeCutoff) return safeDensity > safeCutoff ? 1 : 0;
  if (safeDensity <= safeCutoff) return 0;
  if (safeDensity >= upper) return 1;
  const t = (safeDensity - safeCutoff) / (upper - safeCutoff);
  return t * t * (3 - 2 * t);
}

export function normalizedWeights(tuning: AtlasTuning): [number, number, number] {
  const sum = tuning.largeWeight + tuning.mediumWeight + tuning.detailWeight;
  if (!(sum > 0)) return [1 / 3, 1 / 3, 1 / 3];
  return [tuning.largeWeight / sum, tuning.mediumWeight / sum, tuning.detailWeight / sum];
}

export function adaptiveCells(baseCell: number, zoom: number, targetPixels: number, pixelScale = 1): { fine: number; coarse: number; blend: number } {
  const scale = Math.max(pixelScale, 0.0001);
  const safeZoom = Math.max(zoom, 0.0001);
  const base = Math.max(baseCell, 1);
  let coarse = base;
  const cap = base * 256;
  while (coarse * safeZoom * scale < targetPixels && coarse * 2 <= cap) coarse *= 2;
  const fine = coarse > base ? coarse / 2 : coarse;
  if (fine === coarse) return { fine, coarse, blend: 1 };
  const projected = coarse * safeZoom * scale;
  const gap = Math.max(targetPixels * 0.4, 0.25);
  const blend = Math.min(1, Math.max(0, (projected - targetPixels) / gap + 0.5));
  return { fine, coarse, blend };
}

export function latticeIndex(world: number, cell: number): number {
  return Math.floor(world / Math.max(cell, 0.001));
}

export type ResolvedAtlas = {
  scales: [number, number, number];
  weights: [number, number, number];
  thresholds: [number, number];
  fade: [number, number];
  cells: [number, number];
  blend: number;
  mode: 0 | 1;
  inkStrength: number;
  voidEnabled: 0 | 1;
  voidCutoff: number;
  voidSoftness: number;
};

export function resolveAtlas(tuning: AtlasTuning, zoom: number, pixelScale = 1): ResolvedAtlas {
  const safe = clampAtlasTuning(tuning);
  const weights = normalizedWeights(safe);
  const adaptive = safe.ditherMode === 'adaptive' ? adaptiveCells(safe.cellSize, zoom, safe.adaptiveTargetPixels, pixelScale) : null;
  return {
    scales: [safe.largeScale, safe.mediumScale, safe.detailScale],
    weights,
    thresholds: [safe.densityLow, safe.densityHigh],
    fade: [safe.smoothFadeStart, safe.smoothFadeEnd],
    cells: adaptive ? [adaptive.fine, adaptive.coarse] : [safe.cellSize, safe.cellSize],
    blend: adaptive ? adaptive.blend : 1,
    mode: safe.ditherMode === 'adaptive' ? 1 : 0,
    inkStrength: safe.inkStrength,
    voidEnabled: safe.voidEnabled ? 1 : 0,
    voidCutoff: safe.voidCutoff,
    voidSoftness: safe.voidSoftness,
  };
}

export function effectiveAtlasTuning(preview: AtlasPreview, experimental: AtlasTuning, version: 1 | 2): AtlasTuning {
  return preview === 'original' ? defaultsForAtlasVersion(version) : experimental;
}

export function atlasSceneKey(scene: {
  x: number; y: number; zoom: number; cssWidth: number; cssHeight: number; seed: number; appearance: string; dpr: number; tuning: AtlasTuning;
}): string {
  const tuning = clampAtlasTuning(scene.tuning);
  return [
    scene.x, scene.y, scene.zoom, scene.cssWidth, scene.cssHeight, scene.seed, scene.appearance, scene.dpr,
    tuning.largeScale, tuning.mediumScale, tuning.detailScale, tuning.largeWeight, tuning.mediumWeight, tuning.detailWeight,
    tuning.densityLow, tuning.densityHigh, tuning.cellSize, tuning.inkStrength, tuning.ditherMode,
    tuning.smoothFadeStart, tuning.smoothFadeEnd, tuning.adaptiveTargetPixels,
    tuning.voidEnabled ? 1 : 0, tuning.voidCutoff, tuning.voidSoftness,
  ].join(':');
}

export function atlasLabDocument(settings: AtlasTuning, context: { seed: number; title: string; zoom: number; rendererVersion: 1 | 2 }) {
  return {
    format: 'canvas-dither-atlas-lab' as const,
    configVersion: 2 as const,
    baseRendererVersion: context.rendererVersion,
    settings: clampAtlasTuning(settings, defaultsForAtlasVersion(context.rendererVersion)),
    context,
  };
}

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
};

export const ATLAS_TUNING_DEFAULTS: AtlasTuning = {
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
};

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
} as const;

function clampNumber(value: number, min: number, max: number, fallback: number): number {
  if (!Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, value));
}

export function clampAtlasTuning(input: Partial<AtlasTuning>): AtlasTuning {
  const next = { ...ATLAS_TUNING_DEFAULTS, ...input };
  const largeScale = clampNumber(next.largeScale, LIMITS.largeScale[0], LIMITS.largeScale[1], ATLAS_TUNING_DEFAULTS.largeScale);
  const mediumScale = clampNumber(next.mediumScale, LIMITS.mediumScale[0], LIMITS.mediumScale[1], ATLAS_TUNING_DEFAULTS.mediumScale);
  const detailScale = clampNumber(next.detailScale, LIMITS.detailScale[0], LIMITS.detailScale[1], ATLAS_TUNING_DEFAULTS.detailScale);
  const largeWeight = clampNumber(next.largeWeight, 0, 1, ATLAS_TUNING_DEFAULTS.largeWeight);
  const mediumWeight = clampNumber(next.mediumWeight, 0, 1, ATLAS_TUNING_DEFAULTS.mediumWeight);
  const detailWeight = clampNumber(next.detailWeight, 0, 1, ATLAS_TUNING_DEFAULTS.detailWeight);
  let densityLow = clampNumber(next.densityLow, LIMITS.densityLow[0], LIMITS.densityLow[1], ATLAS_TUNING_DEFAULTS.densityLow);
  let densityHigh = clampNumber(next.densityHigh, LIMITS.densityHigh[0], LIMITS.densityHigh[1], ATLAS_TUNING_DEFAULTS.densityHigh);
  if (densityHigh < densityLow + 0.01) densityHigh = Math.min(LIMITS.densityHigh[1], densityLow + 0.01);
  if (densityHigh < densityLow + 0.01) densityLow = densityHigh - 0.01;
  let smoothFadeStart = clampNumber(next.smoothFadeStart, LIMITS.smoothFadeStart[0], LIMITS.smoothFadeStart[1], ATLAS_TUNING_DEFAULTS.smoothFadeStart);
  let smoothFadeEnd = clampNumber(next.smoothFadeEnd, LIMITS.smoothFadeEnd[0], LIMITS.smoothFadeEnd[1], ATLAS_TUNING_DEFAULTS.smoothFadeEnd);
  if (smoothFadeEnd < smoothFadeStart + 0.1) smoothFadeEnd = Math.min(LIMITS.smoothFadeEnd[1], smoothFadeStart + 0.1);
  const cellSize = Math.round(clampNumber(next.cellSize, LIMITS.cellSize[0], LIMITS.cellSize[1], ATLAS_TUNING_DEFAULTS.cellSize));
  const inkStrength = clampNumber(next.inkStrength, 0, 1, ATLAS_TUNING_DEFAULTS.inkStrength);
  const adaptiveTargetPixels = clampNumber(next.adaptiveTargetPixels, LIMITS.adaptiveTargetPixels[0], LIMITS.adaptiveTargetPixels[1], ATLAS_TUNING_DEFAULTS.adaptiveTargetPixels);
  const ditherMode: AtlasDitherMode = next.ditherMode === 'adaptive' ? 'adaptive' : 'smooth';
  return {
    largeScale, mediumScale, detailScale, largeWeight, mediumWeight, detailWeight,
    densityLow, densityHigh, cellSize, inkStrength, ditherMode, smoothFadeStart, smoothFadeEnd, adaptiveTargetPixels,
  };
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
  };
}

export function effectiveAtlasTuning(preview: AtlasPreview, experimental: AtlasTuning): AtlasTuning {
  return preview === 'original' ? ATLAS_TUNING_DEFAULTS : experimental;
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
  ].join(':');
}

export function atlasLabDocument(settings: AtlasTuning, context: { seed: number; title: string; zoom: number; rendererVersion: 1 }) {
  return {
    format: 'canvas-dither-atlas-lab' as const,
    configVersion: 1 as const,
    baseRendererVersion: 1 as const,
    settings: clampAtlasTuning(settings),
    context,
  };
}

import { describe, expect, test } from 'bun:test';
import { buildArchive, readArchive } from '../archive/zip';
import { DrawScheduler, frameChanged } from '../backgrounds/atlas-math';
import { seedFromProjectName } from '../backgrounds/atlas-seed';
import {
  ATLAS_LAB_ENABLED,
  ATLAS_TUNING_DEFAULTS,
  adaptiveCells,
  atlasLabDocument,
  atlasSceneKey,
  clampAtlasTuning,
  effectiveAtlasTuning,
  latticeIndex,
  normalizedWeights,
  resolveAtlas,
  type AtlasTuning,
} from '../backgrounds/atlas-tuning';
import { createEmptyBoard, parseBoard, renameBoard, setBackgroundPattern } from '../domain/board';

declare const Bun: { file(path: URL): { text(): Promise<string> } };

const scene = {
  x: 0, y: 0, zoom: 1, cssWidth: 800, cssHeight: 600, seed: 7, appearance: 'dark', dpr: 1, tuning: ATLAS_TUNING_DEFAULTS,
};

describe('atlas rename seeding', () => {
  test('renaming an atlas project changes the seed with the title', () => {
    const atlas = setBackgroundPattern(renameBoard(createEmptyBoard(), 'Research Atlas'), 'dither-atlas');
    const renamed = renameBoard(atlas, 'Ideas 2027');
    expect(renamed.title).toBe('Ideas 2027');
    expect(renamed.ditherAtlas?.seed).toBe(seedFromProjectName('Ideas 2027'));
    expect(renamed.ditherAtlas?.seed === atlas.ditherAtlas?.seed).toBe(false);
    expect(renamed.ditherAtlas?.rendererVersion).toBe(1);
  });

  test('renaming while dots is selected still updates a saved seed', () => {
    const atlas = setBackgroundPattern(renameBoard(createEmptyBoard(), 'Research Atlas'), 'dither-atlas');
    const dots = setBackgroundPattern(atlas, 'dots');
    const renamed = renameBoard(dots, 'Field Notes');
    const returned = setBackgroundPattern(renamed, 'dither-atlas');
    expect(renamed.backgroundPattern).toBe('dots');
    expect(renamed.ditherAtlas?.seed).toBe(seedFromProjectName('Field Notes'));
    expect(returned.ditherAtlas?.seed).toBe(seedFromProjectName('Field Notes'));
  });

  test('a project that never used atlas does not gain metadata', () => {
    const renamed = renameBoard(createEmptyBoard(), 'Plain');
    expect(renamed.ditherAtlas).toBe(undefined);
  });

  test('normalized titles share a seed and an exact repeat is not a mutation', () => {
    const atlas = setBackgroundPattern(renameBoard(createEmptyBoard(), 'Research Atlas'), 'dither-atlas');
    const spaced = renameBoard(atlas, '  Research Atlas');
    expect(spaced.ditherAtlas?.seed).toBe(atlas.ditherAtlas?.seed);
    expect(renameBoard(spaced, spaced.title)).toBe(spaced);
  });

  test('import keeps the stored seed until a later rename', async () => {
    const atlas = setBackgroundPattern(renameBoard(createEmptyBoard(), 'Research Atlas'), 'dither-atlas');
    const parsed = parseBoard({ ...atlas, title: 'Different title' });
    const archive = await readArchive(await buildArchive(atlas, [], '2026-11-14T00:00:00.000Z'));
    if ('error' in archive) throw new Error(archive.error);
    expect(parsed?.ditherAtlas?.seed).toBe(atlas.ditherAtlas?.seed);
    expect(archive.board.ditherAtlas?.seed).toBe(atlas.ditherAtlas?.seed);
    expect(renameBoard(archive.board, 'After import').ditherAtlas?.seed).toBe(seedFromProjectName('After import'));
  });
});

describe('atlas tuning', () => {
  test('defaults match the accepted renderer and stay finite', () => {
    expect(ATLAS_TUNING_DEFAULTS).toEqual({
      largeScale: 900, mediumScale: 340, detailScale: 105,
      largeWeight: 0.57, mediumWeight: 0.28, detailWeight: 0.15,
      densityLow: -0.18, densityHigh: 0.42, cellSize: 4, inkStrength: 0.72,
      ditherMode: 'smooth', smoothFadeStart: 0.8, smoothFadeEnd: 2.4, adaptiveTargetPixels: 2.5,
    });
    expect(Object.values(ATLAS_TUNING_DEFAULTS).every((value) => value === 'smooth' || Number.isFinite(value))).toBe(true);
  });

  test('rejects invalid scales, modes, and threshold order', () => {
    const clamped = clampAtlasTuning({
      largeScale: -20, mediumScale: Number.NaN, detailScale: Number.POSITIVE_INFINITY,
      densityLow: 0.4, densityHigh: 0.1, smoothFadeStart: 2, smoothFadeEnd: 1,
      ditherMode: 'clouds' as AtlasTuning['ditherMode'],
    });
    expect(clamped.largeScale).toBe(250);
    expect(clamped.mediumScale).toBe(ATLAS_TUNING_DEFAULTS.mediumScale);
    expect(clamped.detailScale).toBe(ATLAS_TUNING_DEFAULTS.detailScale);
    expect(clamped.densityHigh > clamped.densityLow).toBe(true);
    expect(clamped.smoothFadeEnd > clamped.smoothFadeStart).toBe(true);
    expect(clamped.ditherMode).toBe('smooth');
  });

  test('zero weights fall back without dividing by zero', () => {
    const weights = normalizedWeights({ ...ATLAS_TUNING_DEFAULTS, largeWeight: 0, mediumWeight: 0, detailWeight: 0 });
    expect(weights[0] + weights[1] + weights[2]).toBe(1);
    expect(normalizedWeights(ATLAS_TUNING_DEFAULTS)).toEqual([0.57, 0.28, 0.15]);
  });

  test('original preview and reset do not overwrite experimental values', () => {
    const experimental = clampAtlasTuning({ ...ATLAS_TUNING_DEFAULTS, largeScale: 1200, ditherMode: 'adaptive' });
    expect(effectiveAtlasTuning('original', experimental).largeScale).toBe(900);
    expect(experimental.largeScale).toBe(1200);
    expect(clampAtlasTuning({}).ditherMode).toBe('smooth');
  });

  test('adaptive cells stay on power-of-two lattices', () => {
    expect(adaptiveCells(4, 1, 2.5).coarse).toBe(4);
    expect(adaptiveCells(4, 0.1, 2.5).coarse).toBe(32);
    expect(adaptiveCells(4, 0.05, 2.5).coarse).toBe(64);
    expect(latticeIndex(-10, 4)).toBe(-3);
    expect(latticeIndex(1_000_000, 32)).toBe(Math.floor(1_000_000 / 32));
    const resolved = resolveAtlas({ ...ATLAS_TUNING_DEFAULTS, ditherMode: 'adaptive' }, 0.1, 1);
    expect(resolved.mode).toBe(1);
    expect(resolved.cells[1] % resolved.cells[0] === 0 || resolved.cells[0] === resolved.cells[1]).toBe(true);
    expect(resolveAtlas(ATLAS_TUNING_DEFAULTS, 1, 1).scales).toEqual([900, 340, 105]);
  });

  test('scene keys include tuning, seed, theme, and device pixel ratio', () => {
    const first = atlasSceneKey(scene);
    expect(atlasSceneKey(scene)).toBe(first);
    expect(atlasSceneKey({ ...scene, tuning: { ...scene.tuning, inkStrength: 0.4 } }) === first).toBe(false);
    expect(atlasSceneKey({ ...scene, seed: 8 }) === first).toBe(false);
    expect(atlasSceneKey({ ...scene, appearance: 'light' }) === first).toBe(false);
    expect(atlasSceneKey({ ...scene, dpr: 2 }) === first).toBe(false);
    expect(frameChanged(first, first)).toBe(false);
    const scheduler = new DrawScheduler();
    expect(scheduler.request()).toBe(true);
    expect(scheduler.request()).toBe(false);
  });

  test('copied configuration keeps experimental values apart from the seed', () => {
    const settings = clampAtlasTuning({ ...ATLAS_TUNING_DEFAULTS, ditherMode: 'adaptive', cellSize: 8 });
    const document = atlasLabDocument(settings, { seed: 99, title: 'Field', zoom: 0.5, rendererVersion: 1 });
    const text = JSON.stringify(document, null, 2);
    expect(document.format).toBe('canvas-dither-atlas-lab');
    expect(document.settings.cellSize).toBe(8);
    expect(document.settings.ditherMode).toBe('adaptive');
    expect(document.context.seed).toBe(99);
    expect(text.includes('"largeScale"')).toBe(true);
    expect(text.includes('"adaptiveTargetPixels"')).toBe(true);
    const board = setBackgroundPattern(createEmptyBoard(), 'dither-atlas');
    expect(JSON.stringify(board).includes('largeScale')).toBe(false);
  });
});

describe('atlas lab wiring', () => {
  test('the shader, restoration, and lab flag stay isolated', async () => {
    const shader = await Bun.file(new URL('../backgrounds/atlas-shader.ts', import.meta.url)).text();
    const renderer = await Bun.file(new URL('../backgrounds/atlas-renderer.ts', import.meta.url)).text();
    const menu = await Bun.file(new URL('../components/ProjectMenu.tsx', import.meta.url)).text();
    const board = await Bun.file(new URL('../components/BoardView.tsx', import.meta.url)).text();
    for (const name of ['uNoiseScales', 'uNoiseWeights', 'uDensityThresholds', 'uInkStrength', 'uDitherMode', 'uSmoothFade', 'uCells', 'uLodBlend']) {
      expect(shader.includes(name)).toBe(true);
    }
    const restored = renderer.slice(renderer.indexOf('onRestored'));
    expect(restored.includes('buildGpu')).toBe(true);
    expect(renderer.includes('devicePixelRatio')).toBe(true);
    expect(menu.includes('ATLAS_LAB_ENABLED')).toBe(true);
    expect(menu.includes("pattern === 'dither-atlas'")).toBe(true);
    expect(board.includes("import('../backgrounds/DitherAtlasLayer')")).toBe(true);
    expect(board.includes('atlas-shader')).toBe(false);
    expect(ATLAS_LAB_ENABLED).toBe(true);
  });
});

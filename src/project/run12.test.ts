import { describe, expect, test } from 'bun:test';
import { buildArchive, readArchive } from '../archive/zip';
import {
  ATLAS_V1_DEFAULTS,
  ATLAS_V2_DEFAULTS,
  atlasLabDocument,
  atlasSceneKey,
  clampAtlasTuning,
  defaultsForAtlasVersion,
  effectiveAtlasTuning,
  landMask,
  normalizedWeights,
  resolveAtlas,
} from '../backgrounds/atlas-tuning';
import { seedFromProjectName } from '../backgrounds/atlas-seed';
import { createEmptyBoard, createTextNode, parseBoard, renameBoard, setBackgroundPattern, upgradeAtlasRenderer } from '../domain/board';

declare const Bun: { file(path: URL): { text(): Promise<string> } };

const scene = {
  x: 0, y: 0, zoom: 1, cssWidth: 800, cssHeight: 600, seed: 7, appearance: 'dark', dpr: 1, tuning: ATLAS_V2_DEFAULTS,
};

describe('atlas renderer versions', () => {
  test('parses v1 and v2 and rejects other versions', () => {
    const empty = createEmptyBoard();
    const v1 = parseBoard({ ...empty, backgroundPattern: 'dither-atlas', ditherAtlas: { seed: 0, rendererVersion: 1 } });
    const v2 = parseBoard({ ...empty, backgroundPattern: 'dither-atlas', ditherAtlas: { seed: 4294967295, rendererVersion: 2 } });
    expect(v1?.ditherAtlas?.rendererVersion).toBe(1);
    expect(v2?.ditherAtlas?.rendererVersion).toBe(2);
    expect(v2?.ditherAtlas?.seed).toBe(4294967295);
    for (const rendererVersion of [0, 4, -1, 1.5, '2']) {
      expect(parseBoard({ ...empty, backgroundPattern: 'dither-atlas', ditherAtlas: { seed: 1, rendererVersion } })).toBeNull();
    }
  });

  test('new atlas uses v2 and an existing version survives switching, import, and rename', async () => {
    const created = setBackgroundPattern(createEmptyBoard(), 'dither-atlas');
    expect(created.ditherAtlas?.rendererVersion).toBe(3);
    const returned = setBackgroundPattern(setBackgroundPattern(created, 'dots'), 'dither-atlas');
    expect(returned.ditherAtlas?.rendererVersion).toBe(3);
    const legacy = { ...created, ditherAtlas: { seed: created.ditherAtlas?.seed ?? 0, rendererVersion: 1 as const } };
    const reopened = parseBoard(legacy);
    expect(reopened?.ditherAtlas?.rendererVersion).toBe(1);
    expect(setBackgroundPattern(setBackgroundPattern(legacy, 'dots'), 'dither-atlas').ditherAtlas?.rendererVersion).toBe(1);
    expect(renameBoard(legacy, 'Renamed').ditherAtlas).toEqual({ seed: seedFromProjectName('Renamed'), rendererVersion: 1 });
    const archive = await readArchive(await buildArchive(legacy, [], '2026-11-14T00:00:00.000Z'));
    if ('error' in archive) throw new Error(archive.error);
    expect(archive.board.ditherAtlas?.rendererVersion).toBe(1);
    expect(archive.board.ditherAtlas?.seed).toBe(legacy.ditherAtlas.seed);
  });

  test('upgrade keeps the seed and graph and changes only the renderer version', () => {
    const created = setBackgroundPattern(createEmptyBoard(), 'dither-atlas');
    const legacy = {
      ...setBackgroundPattern(created, 'dots'),
      backgroundPattern: 'dither-atlas' as const,
      nodes: [createTextNode({ x: 10, y: 20 }, 'note')],
      ditherAtlas: { seed: 42, rendererVersion: 1 as const },
    };
    const upgraded = upgradeAtlasRenderer(legacy);
    expect(upgraded.ditherAtlas).toEqual({ seed: 42, rendererVersion: 3 });
    expect(upgraded.nodes).toEqual(legacy.nodes);
    expect(upgraded.edges).toEqual(legacy.edges);
    expect(upgraded.title).toBe(legacy.title);
    expect(upgraded.viewport).toEqual(legacy.viewport);
    expect(upgraded.revision).toBe(legacy.revision + 1);
    expect(upgradeAtlasRenderer(upgraded)).toBe(upgraded);
    expect(JSON.stringify(upgraded).includes('voidEnabled')).toBe(false);
  });
});

describe('version defaults and void mask', () => {
  test('v1 and v2 defaults are exact and void stays off', () => {
    expect(defaultsForAtlasVersion(1)).toEqual(ATLAS_V1_DEFAULTS);
    expect(ATLAS_V2_DEFAULTS).toEqual({
      largeScale: 2490, mediumScale: 790, detailScale: 305,
      largeWeight: 0.76, mediumWeight: 0.36, detailWeight: 0.12,
      densityLow: -0.06, densityHigh: 0.41, cellSize: 7, inkStrength: 0.07,
      ditherMode: 'adaptive', smoothFadeStart: 0.8, smoothFadeEnd: 2.4, adaptiveTargetPixels: 2.25,
      voidEnabled: false, voidCutoff: 0.15, voidSoftness: 0,
    });
    expect(ATLAS_V1_DEFAULTS.voidEnabled).toBe(false);
    expect(ATLAS_V2_DEFAULTS.voidEnabled).toBe(false);
    const weights = normalizedWeights(ATLAS_V2_DEFAULTS);
    expect(Math.abs(weights[0] - 0.76 / 1.24) < 1e-12).toBe(true);
    expect(Math.abs(weights[0] + weights[1] + weights[2] - 1) < 1e-12).toBe(true);
  });

  test('the mask is hard at the cutoff and soft inside the transition', () => {
    expect(landMask(0, 0.15, 0, false)).toBe(1);
    expect(landMask(0.1, 0.15, 0)).toBe(0);
    expect(landMask(0.15, 0.15, 0)).toBe(0);
    expect(landMask(0.16, 0.15, 0)).toBe(1);
    expect(landMask(0.1, 0.15, 0.05)).toBe(0);
    const mid = landMask(0.175, 0.15, 0.05);
    expect(mid > 0 && mid < 1).toBe(true);
    expect(landMask(0.21, 0.15, 0.05)).toBe(1);
    expect(landMask(0, 0, 0)).toBe(0);
    expect(landMask(1, 1, 0)).toBe(0);
    expect(landMask(-1, -2, -1)).toBe(0);
    expect(landMask(2, 2, 2)).toBe(0);
    expect(landMask(Number.NaN, Number.POSITIVE_INFINITY, Number.NaN)).toBe(0);
    expect(landMask(0.2, 0.15, 0.05)).toBe(landMask(0.2, 0.15, 0.05));
  });

  test('original, reset, and comparison follow the active renderer version', () => {
    const experiment = clampAtlasTuning({ ...ATLAS_V2_DEFAULTS, voidEnabled: true, voidCutoff: 0.4, voidSoftness: 0.005 }, ATLAS_V2_DEFAULTS);
    expect(effectiveAtlasTuning('original', experiment, 1)).toEqual(ATLAS_V1_DEFAULTS);
    expect(effectiveAtlasTuning('original', experiment, 2)).toEqual(ATLAS_V2_DEFAULTS);
    expect(defaultsForAtlasVersion(1).ditherMode).toBe('smooth');
    expect(defaultsForAtlasVersion(2).inkStrength).toBe(0.07);
    expect(experiment.voidEnabled).toBe(true);
    expect(experiment.voidCutoff).toBe(0.4);
    expect(effectiveAtlasTuning('experimental', experiment, 2).voidSoftness).toBe(0.005);
    const held = clampAtlasTuning({ ...experiment, voidEnabled: false }, ATLAS_V2_DEFAULTS);
    expect(held.voidEnabled).toBe(false);
    expect(held.voidCutoff).toBe(0.4);
    expect(held.voidSoftness).toBe(0.005);
  });

  test('void uniforms follow the resolved settings and change the scene key', () => {
    const v2 = resolveAtlas(ATLAS_V2_DEFAULTS, 0.1, 1);
    const v1 = resolveAtlas(ATLAS_V1_DEFAULTS, 1, 1);
    expect(v2.scales).toEqual([2490, 790, 305]);
    expect(v2.mode).toBe(1);
    expect(v2.voidEnabled).toBe(0);
    expect(v1.mode).toBe(0);
    expect(v1.cells).toEqual([4, 4]);
    const masked = resolveAtlas({ ...ATLAS_V2_DEFAULTS, voidEnabled: true, voidCutoff: 0.33, voidSoftness: 0.005 }, 1, 1);
    expect(masked.voidEnabled).toBe(1);
    expect(masked.voidCutoff).toBe(0.33);
    expect(masked.voidSoftness).toBe(0.005);
    const key = atlasSceneKey(scene);
    expect(atlasSceneKey({ ...scene, tuning: { ...scene.tuning, voidEnabled: true } }) === key).toBe(false);
    expect(atlasSceneKey({ ...scene, tuning: { ...scene.tuning, voidCutoff: 0.2 } }) === key).toBe(false);
    expect(atlasSceneKey({ ...scene, tuning: { ...scene.tuning, voidSoftness: 0.01 } }) === key).toBe(false);
  });

  test('copied configuration is version 2 and keeps softness exact', () => {
    const settings = { ...ATLAS_V2_DEFAULTS, voidEnabled: true, voidSoftness: 0.005 };
    const document = atlasLabDocument(settings, { seed: 99, title: 'Field', zoom: 0.1, rendererVersion: 2 });
    const text = JSON.stringify(document, null, 2);
    expect(document.format).toBe('canvas-dither-atlas-lab');
    expect(document.configVersion).toBe(2);
    expect(document.baseRendererVersion).toBe(2);
    expect(document.context.rendererVersion).toBe(2);
    expect(document.settings.voidEnabled).toBe(true);
    expect(document.settings.voidSoftness).toBe(0.005);
    expect(document.settings.largeWeight).toBe(0.76);
    expect(text.includes('"voidSoftness": 0.005')).toBe(true);
    expect(text.includes('"seed": 99')).toBe(true);
    expect(JSON.stringify(document.settings).includes('"seed"')).toBe(false);
  });
});

describe('atlas v2 wiring', () => {
  test('the mask is applied after dithering and stays out of the default bundle', async () => {
    const shader = await Bun.file(new URL('../backgrounds/atlas-shader.ts', import.meta.url)).text();
    const renderer = await Bun.file(new URL('../backgrounds/atlas-renderer.ts', import.meta.url)).text();
    const board = await Bun.file(new URL('../components/BoardView.tsx', import.meta.url)).text();
    const menu = await Bun.file(new URL('../components/ProjectMenu.tsx', import.meta.url)).text();
    const tone = shader.indexOf('float tone = mix');
    const mask = shader.indexOf('uVoidEnabled == 1');
    const color = shader.indexOf('vec3 color = mix');
    expect(tone < mask && mask < color).toBe(true);
    expect(shader.includes('float landMask')).toBe(true);
    expect(shader.includes('if (softness <= 0.0)')).toBe(true);
    for (const name of ['uVoidEnabled', 'uVoidCutoff', 'uVoidSoftness']) expect(renderer.includes(name)).toBe(true);
    expect(renderer.includes('drawArrays')).toBe(true);
    expect(board.includes("import('../backgrounds/DitherAtlasLayer')")).toBe(true);
    expect(board.includes('atlas-shader')).toBe(false);
    expect(board.includes('defaultsForAtlasVersion(3)')).toBe(true);
    expect(menu.includes('Use new Atlas look')).toBe(true);
    expect(menu.includes('rendererVersion === 1 || rendererVersion === 2')).toBe(true);
  });
});

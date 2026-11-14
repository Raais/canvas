import { describe, expect, test } from 'bun:test';
import { buildArchive, readArchive } from '../archive/zip';
import { ATLAS_V1_DEFAULTS, ATLAS_V2_DEFAULTS, ATLAS_V3_DEFAULTS, atlasLabDocument, defaultsForAtlasVersion, effectiveAtlasTuning, resolveAtlas, storedAtlasVersion } from '../backgrounds/atlas-tuning';
import { seedFromProjectName } from '../backgrounds/atlas-seed';
import { createEmptyBoard, parseBoard, renameBoard, setBackgroundPattern, upgradeAtlasRenderer } from '../domain/board';

describe('atlas renderer v3', () => {
  test('uses the selected defaults and leaves v1 and v2 unchanged', () => {
    expect(ATLAS_V3_DEFAULTS).toEqual({
      largeScale: 2490, mediumScale: 790, detailScale: 305,
      largeWeight: 0.76, mediumWeight: 0.36, detailWeight: 0.12,
      densityLow: -0.06, densityHigh: 0.41, cellSize: 7, inkStrength: 0.07,
      ditherMode: 'adaptive', smoothFadeStart: 0.8, smoothFadeEnd: 2.4, adaptiveTargetPixels: 2.25,
      voidEnabled: true, voidCutoff: 0, voidSoftness: 0,
    });
    expect(ATLAS_V2_DEFAULTS.voidEnabled).toBe(false);
    expect(ATLAS_V2_DEFAULTS.voidCutoff).toBe(0.15);
    expect(defaultsForAtlasVersion(1)).toEqual(ATLAS_V1_DEFAULTS);
    expect(defaultsForAtlasVersion(2)).toEqual(ATLAS_V2_DEFAULTS);
    expect(defaultsForAtlasVersion(3)).toEqual(ATLAS_V3_DEFAULTS);
    const resolved = resolveAtlas(ATLAS_V3_DEFAULTS, 1, 1);
    expect(resolved.voidEnabled).toBe(1);
    expect(resolved.voidCutoff).toBe(0);
    expect(resolved.scales).toEqual([2490, 790, 305]);
    expect(resolved.mode).toBe(1);
  });

  test('new atlas is v3 and older versions survive parse, import, and rename', async () => {
    const empty = createEmptyBoard();
    expect(empty.backgroundPattern).toBe('dither-atlas');
    expect(empty.ditherAtlas?.rendererVersion).toBe(3);
    expect(empty.ditherAtlas?.seed).toBe(seedFromProjectName('Untitled board'));
    const created = setBackgroundPattern(empty, 'dither-atlas');
    expect(created.ditherAtlas?.rendererVersion).toBe(3);
    const v2 = { ...created, ditherAtlas: { seed: 775267960, rendererVersion: 2 as const } };
    const parsed = parseBoard(v2);
    expect(parsed?.ditherAtlas).toEqual({ seed: 775267960, rendererVersion: 2 });
    expect(setBackgroundPattern(setBackgroundPattern(v2, 'dots'), 'dither-atlas').ditherAtlas?.rendererVersion).toBe(2);
    const renamed = renameBoard(v2, 'Coast');
    expect(renamed.ditherAtlas).toEqual({ seed: seedFromProjectName('Coast'), rendererVersion: 2 });
    const archive = await readArchive(await buildArchive(v2, [], '2026-11-14T00:00:00.000Z'));
    if ('error' in archive) throw new Error(archive.error);
    expect(archive.board.ditherAtlas).toEqual(v2.ditherAtlas);
    expect(JSON.stringify(archive.board).includes('voidEnabled')).toBe(false);
  });

  test('upgrade from v1 or v2 adopts v3 and keeps the seed', () => {
    const base = setBackgroundPattern(createEmptyBoard(), 'dither-atlas');
    for (const version of [1, 2] as const) {
      const current = { ...base, ditherAtlas: { seed: 42, rendererVersion: version } };
      const upgraded = upgradeAtlasRenderer(current);
      expect(upgraded.ditherAtlas).toEqual({ seed: 42, rendererVersion: 3 });
      expect(upgraded.nodes).toEqual(current.nodes);
      expect(upgraded.revision).toBe(current.revision + 1);
    }
    const current = { ...base, ditherAtlas: { seed: 42, rendererVersion: 3 as const } };
    expect(upgradeAtlasRenderer(current)).toBe(current);
    expect(storedAtlasVersion(undefined)).toBe(3);
    expect(storedAtlasVersion(1)).toBe(1);
    expect(storedAtlasVersion(2)).toBe(2);
  });

  test('original, reset, and copy follow v1, v2, and v3', () => {
    const experiment = { ...ATLAS_V3_DEFAULTS, largeScale: 1000, voidEnabled: false };
    expect(effectiveAtlasTuning('original', experiment, 1).voidEnabled).toBe(false);
    expect(effectiveAtlasTuning('original', experiment, 2).voidCutoff).toBe(0.15);
    expect(effectiveAtlasTuning('original', experiment, 3)).toEqual(ATLAS_V3_DEFAULTS);
    expect(experiment.largeScale).toBe(1000);
    expect(effectiveAtlasTuning('experimental', experiment, 3).voidEnabled).toBe(false);
    const copied = atlasLabDocument(experiment, { seed: 7, title: 'Field', zoom: 1, rendererVersion: 3 });
    expect(copied.configVersion).toBe(2);
    expect(copied.baseRendererVersion).toBe(3);
    expect(copied.context).toEqual({ seed: 7, title: 'Field', zoom: 1, rendererVersion: 3 });
    expect(copied.settings.voidEnabled).toBe(false);
    expect(copied.settings.largeScale).toBe(1000);
    expect(JSON.stringify(copied.settings).includes('"seed"')).toBe(false);
  });
});

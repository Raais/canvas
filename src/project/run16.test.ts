import { describe, expect, test } from 'bun:test';
import { ARCHIVE_VERSION } from '../archive/format';
import { buildArchive, readArchive } from '../archive/zip';
import { seedFromProjectName } from '../backgrounds/atlas-seed';
import { ATLAS_V3_DEFAULTS, normalizedWeights } from '../backgrounds/atlas-tuning';
import { CONTOURS_V1_DEFAULTS, CONTOURS_V1_TERRAIN, clampContoursTuning, contourWeights, contoursLabDocument, effectiveContoursTuning } from '../backgrounds/contours-tuning';
import { addNodes, createEmptyBoard, parseBoard, renameBoard, setBackgroundPattern } from '../domain/board';
import { GRAPH_CLIPBOARD_VERSION } from '../domain/graph-clipboard';
import { createHistory, pushHistory, undoHistory } from '../domain/history';
import type { BoardNode } from '../domain/types';

declare const Bun: { file(path: URL): { text(): Promise<string> } };

const now = '2026-11-14T00:00:00.000Z';

function note(id: string): BoardNode {
  return { id, kind: 'text', x: 0, y: 0, width: 40, height: 40, text: id };
}

function document(schemaVersion: number, extra: Record<string, unknown> = {}) {
  return {
    schemaVersion,
    id: 'board',
    title: 'Kept',
    createdAt: now,
    updatedAt: now,
    revision: 2,
    appearance: 'light',
    backgroundPattern: 'dots',
    nodes: [note('a'), { ...note('b'), x: 80 }],
    edges: [{ id: 'e', sourceId: 'a', targetId: 'b', sourceHandle: 'right', targetHandle: 'left', restLength: 12, label: 'paid', style: 'dashed' }],
    savedViews: [{ id: 'v', name: 'Overview', viewport: { x: 1, y: 2, zoom: 1 } }],
    viewport: { x: 3, y: 4, zoom: 1.25 },
    ...extra,
  };
}

describe('schema v7', () => {
  test('new boards stay on atlas v3 until contours are chosen', () => {
    const board = createEmptyBoard(now);
    expect(board.schemaVersion).toBe(7);
    expect(board.backgroundPattern).toBe('dither-atlas');
    expect(board.ditherAtlas).toEqual({ seed: seedFromProjectName('Untitled board'), rendererVersion: 3 });
    expect(board.topographicContours).toBe(undefined);
  });

  test('parses a contours board and rejects a broken configuration', () => {
    const valid = parseBoard(document(7, {
      backgroundPattern: 'topographic-contours',
      topographicContours: { seed: 42, rendererVersion: 1 },
      ditherAtlas: { seed: 9, rendererVersion: 2 },
    }));
    expect(valid?.topographicContours).toEqual({ seed: 42, rendererVersion: 1 });
    expect(valid?.ditherAtlas).toEqual({ seed: 9, rendererVersion: 2 });
    expect(parseBoard(document(7, { backgroundPattern: 'topographic-contours' }))).toBeNull();
    expect(parseBoard(document(7, { topographicContours: { seed: -1, rendererVersion: 1 } }))).toBeNull();
    expect(parseBoard(document(7, { topographicContours: { seed: 1.5, rendererVersion: 1 } }))).toBeNull();
    expect(parseBoard(document(7, { topographicContours: { seed: 4294967296, rendererVersion: 1 } }))).toBeNull();
    expect(parseBoard(document(7, { topographicContours: { seed: 1, rendererVersion: 2 } }))).toBeNull();
    expect(parseBoard(document(7, { topographicContours: { seed: 1 } }))).toBeNull();
  });

  test('migrates schemas 1 through 6 without inventing contours or dropping v6 metadata', () => {
    for (const schemaVersion of [1, 2, 3, 4, 5, 6]) {
      const raw = schemaVersion === 1
        ? { schemaVersion, id: 'board', title: 'Kept', createdAt: now, updatedAt: now, revision: 2, viewport: { x: 3, y: 4, zoom: 1.25 }, nodes: [note('a')], edges: [] }
        : document(schemaVersion);
      const parsed = parseBoard(raw);
      expect(parsed?.schemaVersion).toBe(7);
      expect(parsed?.title).toBe('Kept');
      expect(parsed?.backgroundPattern).toBe(schemaVersion === 1 ? 'dots' : 'dots');
      expect(parsed?.topographicContours).toBe(undefined);
      expect(parsed?.viewport).toEqual({ x: 3, y: 4, zoom: 1.25 });
    }
    const legacyAtlas = parseBoard(document(5, { backgroundPattern: 'dither-atlas', ditherAtlas: { seed: 11, rendererVersion: 1 }, edges: [], savedViews: undefined }));
    expect(legacyAtlas?.ditherAtlas).toEqual({ seed: 11, rendererVersion: 1 });
    expect(legacyAtlas?.backgroundPattern).toBe('dither-atlas');
    const v6 = parseBoard(document(6, { topographicContours: { seed: 4, rendererVersion: 1 } }));
    expect(v6?.edges[0]?.label).toBe('paid');
    expect(v6?.edges[0]?.style).toBe('dashed');
    expect(v6?.savedViews[0]?.name).toBe('Overview');
    expect(v6?.topographicContours).toBe(undefined);
    expect(v6?.appearance).toBe('light');
    expect(parseBoard(document(6, { edges: [{ id: 'e', sourceId: 'a', targetId: 'b', sourceHandle: 'right', targetHandle: 'left', restLength: 12, style: 'wavy' }] }))).toBeNull();
    const { savedViews, ...missingViews } = document(6);
    void savedViews;
    expect(parseBoard(missingViews)).toBeNull();
    expect(parseBoard(document(6, { savedViews: [{ id: 'v', name: '   ', viewport: { x: 0, y: 0, zoom: 1 } }] }))).toBeNull();
    expect(parseBoard(document(8))).toBeNull();
    expect(parseBoard({ schemaVersion: 9, id: 'x', nodes: [], edges: [] })).toBeNull();
  });
});

describe('contours switching', () => {
  test('keeps both renderer families, the graph, and regenerates seeds on rename', () => {
    const seeded = addNodes(createEmptyBoard(now), [note('n')], now);
    const atlasSeed = seeded.ditherAtlas?.seed;
    const contours = setBackgroundPattern(seeded, 'topographic-contours', now);
    expect(contours.backgroundPattern).toBe('topographic-contours');
    expect(contours.topographicContours).toEqual({ seed: seedFromProjectName('Untitled board'), rendererVersion: 1 });
    expect(contours.ditherAtlas).toEqual({ seed: atlasSeed, rendererVersion: 3 });
    const dots = setBackgroundPattern(contours, 'dots', now);
    const returned = setBackgroundPattern(dots, 'topographic-contours', now);
    expect(returned.topographicContours).toEqual(contours.topographicContours);
    const atlas = setBackgroundPattern(returned, 'dither-atlas', now);
    expect(atlas.ditherAtlas?.rendererVersion).toBe(3);
    expect(atlas.topographicContours?.rendererVersion).toBe(1);
    expect(atlas.nodes).toEqual(seeded.nodes);
    expect(atlas.edges).toEqual(seeded.edges);
    expect(atlas.viewport).toEqual(seeded.viewport);
    expect(atlas.savedViews).toEqual(seeded.savedViews);
    const legacy = parseBoard(document(6, { backgroundPattern: 'dither-atlas', ditherAtlas: { seed: 9, rendererVersion: 1 } }));
    if (!legacy) throw new Error('legacy');
    const roundTrip = setBackgroundPattern(setBackgroundPattern(legacy, 'topographic-contours', now), 'dither-atlas', now);
    expect(roundTrip.ditherAtlas?.rendererVersion).toBe(1);
    expect(roundTrip.topographicContours?.rendererVersion).toBe(1);
    const renamed = renameBoard(roundTrip, 'Coast', now);
    expect(renamed.ditherAtlas).toEqual({ seed: seedFromProjectName('Coast'), rendererVersion: 1 });
    expect(renamed.topographicContours).toEqual({ seed: seedFromProjectName('Coast'), rendererVersion: 1 });
    expect(renamed.nodes).toEqual(roundTrip.nodes);
    expect(JSON.stringify(contours).includes('minorInterval')).toBe(false);
  });
});

describe('contours tuning', () => {
  test('clamps temporary settings and exports them outside the board', () => {
    expect(CONTOURS_V1_DEFAULTS.minorInterval).toBe(0.075);
    expect(CONTOURS_V1_DEFAULTS.majorEvery).toBe(4);
    const clamped = clampContoursTuning({
      minorInterval: 0,
      majorEvery: 4.6,
      minorWidthPx: Number.POSITIVE_INFINITY,
      majorOpacity: Number.NaN,
      lodFadeStartPx: 8,
      lodFadeEndPx: 1,
    });
    expect(clamped.minorInterval).toBe(0.025);
    expect(clamped.minorInterval > 0).toBe(true);
    expect(clamped.majorEvery).toBe(5);
    expect(Number.isInteger(clamped.majorEvery)).toBe(true);
    expect(clamped.minorWidthPx).toBe(0.7);
    expect(clamped.majorOpacity).toBe(CONTOURS_V1_DEFAULTS.majorOpacity);
    expect(clamped.lodFadeEndPx > clamped.lodFadeStartPx).toBe(true);
    expect(effectiveContoursTuning('original', clamped)).toEqual(CONTOURS_V1_DEFAULTS);
    expect(effectiveContoursTuning('experimental', clamped)).toEqual(clamped);
    const reset = clampContoursTuning(CONTOURS_V1_DEFAULTS);
    expect(reset).toEqual(CONTOURS_V1_DEFAULTS);
    const copied = contoursLabDocument(clamped, { seed: 5, title: 'Field', zoom: 1.5, rendererVersion: 1 });
    expect(copied.format).toBe('canvas-topographic-contours-lab');
    expect(copied.configVersion).toBe(1);
    expect(copied.baseRendererVersion).toBe(1);
    expect(copied.settings).toEqual(clamped);
    expect(copied.context).toEqual({ seed: 5, title: 'Field', zoom: 1.5, rendererVersion: 1 });
    expect(contourWeights()).toEqual(normalizedWeights(ATLAS_V3_DEFAULTS));
    expect(CONTOURS_V1_TERRAIN.largeScale).toBe(ATLAS_V3_DEFAULTS.largeScale);
    expect(CONTOURS_V1_TERRAIN.densityLow).toBe(ATLAS_V3_DEFAULTS.densityLow);
    expect(CONTOURS_V1_TERRAIN.densityHigh).toBe(ATLAS_V3_DEFAULTS.densityHigh);
  });
});

describe('contours rendering architecture', () => {
  test('keeps a separate lazy shader and leaves the atlas sources alone', async () => {
    const shader = await Bun.file(new URL('../backgrounds/contours-shader.ts', import.meta.url)).text();
    const renderer = await Bun.file(new URL('../backgrounds/contours-renderer.ts', import.meta.url)).text();
    const atlasShader = await Bun.file(new URL('../backgrounds/atlas-shader.ts', import.meta.url)).text();
    const atlasRenderer = await Bun.file(new URL('../backgrounds/atlas-renderer.ts', import.meta.url)).text();
    const view = await Bun.file(new URL('../components/BoardView.tsx', import.meta.url)).text();
    expect(shader.includes('#version 300 es')).toBe(true);
    expect(shader.includes('precision highp float')).toBe(true);
    expect(shader.includes('fwidth(minorLevel)')).toBe(true);
    expect(shader.includes('fwidth(fract')).toBe(false);
    expect(shader.includes('uTile + uLocalOrigin')).toBe(true);
    expect(shader.includes('snoise')).toBe(true);
    expect(shader.includes('float minorLevel = terrain / interval')).toBe(true);
    expect(shader.includes('float majorLevel = terrain / (interval * every)')).toBe(true);
    expect(renderer.includes('setInterval')).toBe(false);
    expect(renderer.includes('if (key === this.drawn || this.raf) return')).toBe(true);
    expect(renderer.includes('this.raf = 0')).toBe(true);
    expect(renderer.includes('deleteProgram')).toBe(true);
    expect(renderer.includes('webglcontextrestored')).toBe(true);
    expect(renderer.includes('document.hidden')).toBe(true);
    expect(view.includes("import('../backgrounds/TopographicContoursLayer')")).toBe(true);
    expect(view.includes("import('../backgrounds/DitherAtlasLayer')")).toBe(true);
    expect(view.includes('contours-shader')).toBe(false);
    expect(view.includes('atlas-shader')).toBe(false);
    expect(view.includes('Topographic Contours unavailable on this device. Showing Dots.')).toBe(true);
    expect(atlasShader.includes('uDitherMode')).toBe(true);
    expect(atlasShader.includes('uMinorInterval')).toBe(false);
    expect(atlasRenderer.includes('uVoidCutoff')).toBe(true);
    expect(atlasRenderer.includes('ContoursRenderer')).toBe(false);
    const patternAt = view.indexOf('onPattern={(pattern)');
    const pattern = view.slice(patternAt, patternAt + 360);
    expect(pattern.includes('if (blockedRef.current) return;')).toBe(true);
    expect(pattern.indexOf('if (blockedRef.current) return;') < pattern.indexOf('setBackgroundPattern')).toBe(true);
    expect(view.includes('setContoursTuning(clampContoursTuning(next))')).toBe(true);
  });
});

describe('contours persistence', () => {
  test('round-trips the selection through reload, zip, and undo without storing the lab', async () => {
    const selected = setBackgroundPattern(addNodes(createEmptyBoard(now), [note('n')], now), 'topographic-contours', now);
    expect(selected.revision).toBeGreaterThan(createEmptyBoard(now).revision);
    const reloaded = parseBoard(JSON.parse(JSON.stringify(selected)));
    expect(reloaded?.backgroundPattern).toBe('topographic-contours');
    expect(reloaded?.topographicContours).toEqual(selected.topographicContours);
    const archive = await readArchive(await buildArchive(selected, [], now));
    if ('error' in archive) throw new Error(archive.error);
    expect(ARCHIVE_VERSION).toBe(1);
    expect(GRAPH_CLIPBOARD_VERSION).toBe(1);
    expect(archive.board.backgroundPattern).toBe('topographic-contours');
    expect(archive.board.topographicContours).toEqual(selected.topographicContours);
    const before = selected;
    const edited = addNodes(selected, [note('m')], now);
    const moved = setBackgroundPattern(edited, 'dots', now);
    const undone = undoHistory(pushHistory(createHistory(), before), moved);
    expect(undone?.board.nodes.map((node) => node.id)).toEqual(['n']);
    expect(undone?.board.backgroundPattern).toBe('dots');
    expect(undone?.board.topographicContours).toEqual(selected.topographicContours);
    const legacy = parseBoard(document(4, { edges: [], savedViews: undefined, nodes: [note('a')] }));
    if (!legacy) throw new Error('legacy');
    const legacyArchive = await readArchive(await buildArchive(legacy, [], now));
    if ('error' in legacyArchive) throw new Error(legacyArchive.error);
    expect(legacyArchive.board.backgroundPattern).toBe('dots');
    expect(legacyArchive.board.topographicContours).toBe(undefined);
  });
});

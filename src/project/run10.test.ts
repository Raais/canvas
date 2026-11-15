import { describe, expect, test } from 'bun:test';
import { buildArchive, readArchive } from '../archive/zip';
import { atlasOrigin, DrawScheduler, frameChanged, screenToWorld, splitWorld, worldToScreen } from '../backgrounds/atlas-math';
import { seedFromProjectName } from '../backgrounds/atlas-seed';
import { createEmptyBoard, parseBoard, renameBoard, setBackgroundPattern, setGroupBackgroundTone } from '../domain/board';
import { duplicateSelection } from '../domain/groups';
import { createHistory, pushHistory, undoHistory } from '../domain/history';
import { decodeGraphClipboard, encodeGraphClipboard, selectionClosure } from '../domain/graph-clipboard';
import type { BoardNode } from '../domain/types';

declare const Bun: { file(path: URL): { text(): Promise<string> } };

function group(id = 'group'): BoardNode {
  return { id, kind: 'group', x: 10, y: 20, width: 300, height: 180, label: 'Cluster' };
}

describe('dither atlas seed and schema', () => {
  test('derives a stable unsigned seed and updates it when the title changes', () => {
    expect(seedFromProjectName('Research Atlas')).toBe(seedFromProjectName('  Research Atlas  '));
    expect(seedFromProjectName('')).toBe(seedFromProjectName('Untitled board'));
    expect(seedFromProjectName('e\u0301')).toBe(seedFromProjectName('é'));
    expect(seedFromProjectName('Research Atlas') === seedFromProjectName('Ideas')).toBe(false);
    const seed = seedFromProjectName('Research Atlas');
    expect(seed >= 0 && seed <= 4294967295 && Number.isInteger(seed)).toBe(true);
    const named = renameBoard(createEmptyBoard(), 'Research Atlas');
    const atlas = setBackgroundPattern(named, 'dither-atlas');
    const renamed = renameBoard(atlas, 'Ideas 2027');
    const returned = setBackgroundPattern(setBackgroundPattern(renamed, 'dots'), 'dither-atlas');
    expect(renamed.ditherAtlas?.seed).toBe(seedFromProjectName('Ideas 2027'));
    expect(returned.ditherAtlas?.seed).toBe(seedFromProjectName('Ideas 2027'));
    expect(createEmptyBoard().backgroundPattern).toBe('dither-atlas');
    expect(createEmptyBoard().ditherAtlas?.rendererVersion).toBe(3);
    expect(createEmptyBoard().ditherAtlas?.seed).toBe(seedFromProjectName('Untitled board'));
  });

  test('migrates older patterns and rejects malformed atlas metadata', () => {
    const empty = createEmptyBoard();
    const grid = parseBoard({ ...empty, schemaVersion: 4, backgroundPattern: 'grid', ditherAtlas: undefined });
    expect(grid?.schemaVersion).toBe(13);
    expect(grid?.backgroundPattern).toBe('grid');
    expect(grid?.ditherAtlas).toBe(undefined);
    expect(parseBoard({ ...empty, schemaVersion: 14 })).toBeNull();
    expect(parseBoard({ ...empty, backgroundPattern: 'dither-atlas', ditherAtlas: undefined })).toBeNull();
    expect(parseBoard({ ...empty, backgroundPattern: 'dither-atlas', ditherAtlas: { seed: 0, rendererVersion: 1 } })?.ditherAtlas?.seed).toBe(0);
    expect(parseBoard({ ...empty, backgroundPattern: 'dither-atlas', ditherAtlas: { seed: -1, rendererVersion: 1 } })).toBeNull();
    expect(parseBoard({ ...empty, backgroundPattern: 'dither-atlas', ditherAtlas: { seed: 1.5, rendererVersion: 1 } })).toBeNull();
    expect(parseBoard({ ...empty, backgroundPattern: 'dither-atlas', ditherAtlas: { seed: 1, rendererVersion: 2 } })?.ditherAtlas?.rendererVersion).toBe(2);
    expect(parseBoard({ ...empty, backgroundPattern: 'dither-atlas', ditherAtlas: { seed: 1, rendererVersion: 3 } })?.ditherAtlas?.rendererVersion).toBe(3);
    expect(parseBoard({ ...empty, backgroundPattern: 'dither-atlas', ditherAtlas: { seed: 1, rendererVersion: 4 } })).toBeNull();
    expect(parseBoard({ ...empty, backgroundPattern: 'marble' })).toBeNull();
    expect(parseBoard({ ...empty, nodes: [ { ...group(), backgroundTone: 'neon' } ] })).toBeNull();
  });
});

describe('atlas coordinates', () => {
  test('round-trips screen and world points and rebases large origins', () => {
    const viewport = { x: 40, y: -15, zoom: 2 };
    const world = screenToWorld(140, 85, viewport);
    const screen = worldToScreen(world.x, world.y, viewport);
    expect(Math.abs(screen.x - 140) < 0.000001).toBe(true);
    expect(Math.abs(screen.y - 85) < 0.000001).toBe(true);
    for (const value of [0, -10_000, 10_000, -100_000, 100_000, -1_000_000, 1_000_000]) {
      const split = splitWorld(value, -value);
      expect(Math.abs(split.tileX + split.localX - value) === 0).toBe(true);
      expect(Math.abs(split.tileY + split.localY + value) === 0).toBe(true);
      expect(Math.abs(split.localX) < 256).toBe(true);
    }
    const origin = atlasOrigin({ x: -2000, y: 500, zoom: 0.5 });
    expect(origin.tileX + origin.localX).toBe(screenToWorld(0, 0, { x: -2000, y: 500, zoom: 0.5 }).x);
    expect(frameChanged('a', 'a')).toBe(false);
    const scheduler = new DrawScheduler();
    expect(scheduler.request()).toBe(true);
    expect(scheduler.request()).toBe(false);
    scheduler.finish();
    expect(scheduler.request()).toBe(true);
  });
});

describe('group tones', () => {
  test('changes only the group tone and preserves it through undo, copy, and archive', async () => {
    const start = { ...createEmptyBoard(), nodes: [group()] };
    const toned = setGroupBackgroundTone(start, 'group', 'sage');
    expect(toned.nodes[0]?.kind === 'group' && toned.nodes[0].backgroundTone).toBe('sage');
    expect(toned.nodes[0]?.x).toBe(10);
    expect(toned.edges).toHaveLength(0);
    expect(setGroupBackgroundTone(toned, 'group', 'sage')).toBe(toned);
    const cleared = setGroupBackgroundTone(toned, 'group', 'default');
    expect(cleared.nodes[0]?.kind === 'group' && cleared.nodes[0].backgroundTone).toBe(undefined);
    const undone = undoHistory(pushHistory(createHistory(), start), toned);
    expect(undone?.board.nodes[0]?.kind === 'group' && undone.board.nodes[0].backgroundTone).toBe(undefined);
    const copy = duplicateSelection(toned, ['group']);
    expect(copy.nodes.some((node) => node.kind === 'group' && node.id !== 'group' && node.backgroundTone === 'sage')).toBe(true);
    const payload = selectionClosure(toned, ['group']);
    const decoded = payload ? decodeGraphClipboard(encodeGraphClipboard(payload)) : null;
    expect(decoded?.nodes[0]?.kind === 'group' && decoded.nodes[0].backgroundTone).toBe('sage');
    const archived = setBackgroundPattern(toned, 'dither-atlas');
    const bytes = await buildArchive(archived, [], '2026-11-14T00:00:00.000Z');
    const text = new TextDecoder().decode(bytes);
    expect(text.includes('terrain.png')).toBe(false);
    const read = await readArchive(bytes);
    if ('error' in read) throw new Error(read.error);
    expect(read.board.backgroundPattern).toBe('dither-atlas');
    expect(read.board.ditherAtlas).toEqual(archived.ditherAtlas);
    expect(read.board.nodes[0]?.kind === 'group' && read.board.nodes[0].backgroundTone).toBe('sage');
    expect(read.assets).toHaveLength(0);
  });
});

describe('default background isolation', () => {
  test('loads the procedural renderer through a dynamic import', async () => {
    const view = await Bun.file(new URL('../components/BoardView.tsx', import.meta.url)).text();
    const shader = await Bun.file(new URL('../backgrounds/atlas-shader.ts', import.meta.url)).text();
    expect(view.includes("import('../backgrounds/DitherAtlasLayer')")).toBe(true);
    expect(view.includes('atlas-shader')).toBe(false);
    expect(view.includes('webgl2')).toBe(false);
    expect(shader.includes('uZoom')).toBe(true);
    expect(shader.includes('uBackingResolution.y - gl_FragCoord.y')).toBe(true);
    expect(shader.includes('uTile + uLocalOrigin')).toBe(true);
  });
});

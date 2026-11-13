import { describe, expect, test } from 'bun:test';
import {
  addNodes,
  commitInteraction,
  createEmbeddedImageNode,
  createEmptyBoard,
  createExternalImageNode,
  createTextNode,
  deleteNodes,
  fitDisplaySize,
  noteImageIntrinsic,
  parseBoard,
  placeNode,
  referencedAssetIds,
  setImageMode,
  staggeredPositions,
} from './board';

const now = '2026-11-13T00:00:00.000Z';

describe('board model', () => {
  test('round-trips an empty board', () => {
    const board = createEmptyBoard(now);
    expect(parseBoard(board)?.id).toBe(board.id);
    expect(parseBoard({ ...board, schemaVersion: 99 })).toBeNull();
  });

  test('rejects unsafe image urls and duplicate ids', () => {
    const board = createEmptyBoard(now);
    const image = createExternalImageNode({
      center: { x: 0, y: 0 },
      url: 'https://example.com/a.png',
      intrinsicWidth: 100,
      intrinsicHeight: 50,
      sizedFromImage: true,
    });
    const stored = addNodes(board, [image], now);
    expect(parseBoard(stored)?.nodes).toHaveLength(1);
    expect(
      parseBoard({
        ...stored,
        nodes: [{ ...image, source: { type: 'external', url: 'javascript:alert(1)' } }],
      }),
    ).toBeNull();
    expect(parseBoard({ ...stored, nodes: [image, image] })).toBeNull();
    expect(parseBoard({ ...stored, nodes: [{ ...image, x: Number.NaN }] })).toBeNull();
  });

  test('rejects an edge whose endpoints are missing', () => {
    const board = parseBoard({
      ...createEmptyBoard(now),
      edges: [{ id: 'e1', sourceId: 'a', targetId: 'b', sourceHandle: 'right', targetHandle: 'left', restLength: 120 }],
    });
    expect(board).toBeNull();
  });

  test('places text on the requested point and clamps tiny notes', () => {
    const note = createTextNode({ x: 100, y: 80 });
    expect(note.x).toBe(-20);
    expect(note.y).toBe(10);
    const board = addNodes(createEmptyBoard(now), [note], now);
    const placed = placeNode(board, note.id, { width: 10, height: 10 });
    const next = placed.nodes[0];
    expect(next?.width).toBe(160);
    expect(next?.height).toBe(72);
  });

  test('fits images inside the initial cap and grows tiny ones', () => {
    expect(fitDisplaySize(4000, 2000)).toEqual({ width: 360, height: 180 });
    expect(fitDisplaySize(16, 16)).toEqual({ width: 72, height: 72 });
  });

  test('keeps extreme image ratios instead of padding both sides to the minimum', () => {
    const panorama = fitDisplaySize(8000, 40);
    const portrait = fitDisplaySize(40, 8000);
    expect(panorama.width).toBe(360);
    expect(panorama.height < 48).toBe(true);
    expect(panorama.width / panorama.height).toBeGreaterThan(40);
    expect(portrait.height).toBe(280);
    expect(portrait.width < 48).toBe(true);
    expect(portrait.height / portrait.width).toBeGreaterThan(40);
    const image = createEmbeddedImageNode({
      center: { x: 0, y: 0 },
      assetId: 'wide',
      intrinsicWidth: 8000,
      intrinsicHeight: 40,
    });
    image.width = 200;
    image.height = 200;
    const aspect = setImageMode(addNodes(createEmptyBoard(now), [{ ...image, mode: 'contain' }], now), image.id, 'aspect', now);
    expect(aspect.nodes[0]?.height).toBe(1);
  });

  test('staggers pasted items', () => {
    expect(staggeredPositions({ x: 10, y: 20 }, 4)).toEqual([
      { x: 10, y: 20 },
      { x: 46, y: 20 },
      { x: 10, y: 56 },
      { x: 46, y: 56 },
    ]);
  });

  test('switches aspect mode from the intrinsic ratio once', () => {
    const image = createEmbeddedImageNode({
      center: { x: 0, y: 0 },
      assetId: 'asset-1',
      intrinsicWidth: 400,
      intrinsicHeight: 200,
    });
    image.width = 200;
    image.height = 40;
    const board = addNodes(createEmptyBoard(now), [{ ...image, mode: 'contain' }], now);
    const aspect = setImageMode(board, image.id, 'aspect', now);
    expect(aspect.nodes[0]).toEqual({ ...image, mode: 'aspect', height: 100 });
    const probed = noteImageIntrinsic(aspect, image.id, 10, 10, now);
    expect(probed).toBe(aspect);
  });

  test('deletes an embedded asset only when nothing still references it', () => {
    const first = createEmbeddedImageNode({
      center: { x: 0, y: 0 },
      assetId: 'shared',
      intrinsicWidth: 80,
      intrinsicHeight: 80,
    });
    const second = createEmbeddedImageNode({
      center: { x: 30, y: 30 },
      assetId: 'shared',
      intrinsicWidth: 80,
      intrinsicHeight: 80,
    });
    const external = createExternalImageNode({
      center: { x: 0, y: 40 },
      url: 'https://example.com/a.png',
      intrinsicWidth: 80,
      intrinsicHeight: 80,
      sizedFromImage: true,
    });
    const board = addNodes(createEmptyBoard(now), [first, second, external], now);
    board.edges = [
      {
        id: 'edge',
        sourceId: first.id,
        targetId: external.id,
        sourceHandle: 'right',
        targetHandle: 'left',
        restLength: 10,
      },
    ];
    const one = deleteNodes(board, [first.id], now);
    expect(one.removedAssetIds).toEqual([]);
    expect(referencedAssetIds(one.board).has('shared')).toBe(true);
    const both = deleteNodes(one.board, [second.id, external.id], now);
    expect(both.removedAssetIds).toEqual(['shared']);
    expect(both.board.edges).toEqual([]);
  });

  test('commits an interaction as a new revision', () => {
    const board = createEmptyBoard(now);
    const next = commitInteraction(board, now);
    expect(next.revision).toBe(board.revision + 1);
  });
});

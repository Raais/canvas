import { describe, expect, test } from 'bun:test';
import { buildArchive, readArchive } from '../archive/zip';
import { entryProblem } from '../archive/validate';
import { addNodes, createEmptyBoard, createExternalImageNode, createTextNode } from '../domain/board';
import { connectNodes } from '../domain/graph';
import { groupSelection } from '../domain/groups';
import { gesturePhase, sameSelection } from '../editor/interaction';
import { createHistory } from '../domain/history';
import { TENSION, clampVelocity, relaxBoard } from '../domain/physics';
import { storedRevisionConflicts } from '../persistence/db';
import { formatOriginEstimate, logicalUsage } from '../project/storage';
import type { AssetRecord, BoardNode } from '../domain/types';

const now = '2026-11-14T00:00:00.000Z';

function note(id: string, x: number, y: number): BoardNode {
  return { id, kind: 'text', x, y, width: 80, height: 40, text: id };
}

describe('interaction stability', () => {
  test('treats the same selection as unchanged regardless of order', () => {
    expect(sameSelection(['a', 'b'], ['b', 'a'])).toBe(true);
    expect(sameSelection(['a'], ['a', 'b'])).toBe(false);
  });

  test('coalesces a drag into one commit and ignores a bare measurement', () => {
    expect(gesturePhase({
      sawDrag: true,
      dragFinished: false,
      resizeActive: false,
      resizeFinished: false,
      barePosition: false,
      changed: true,
      tracking: true,
    })).toBe('live');
    expect(gesturePhase({
      sawDrag: false,
      dragFinished: true,
      resizeActive: false,
      resizeFinished: false,
      barePosition: false,
      changed: false,
      tracking: true,
    })).toBe('commit');
    expect(gesturePhase({
      sawDrag: false,
      dragFinished: false,
      resizeActive: true,
      resizeFinished: false,
      barePosition: true,
      changed: true,
      tracking: true,
    })).toBe('live');
    expect(gesturePhase({
      sawDrag: false,
      dragFinished: false,
      resizeActive: false,
      resizeFinished: false,
      barePosition: false,
      changed: false,
      tracking: false,
    })).toBe('idle');
  });
});

describe('project archives', () => {
  test('round-trips board geometry, links, and shared image bytes', async () => {
    const base = addNodes(createEmptyBoard(now), [note('a', 10, 20), note('b', 80, 20)], now);
    const grouped = groupSelection(base, ['a', 'b'], now);
    if ('error' in grouped) throw new Error(grouped.error);
    const withLink = connectNodes(grouped.board, 'a', 'b', 'right', 'left', now);
    if (!withLink) throw new Error('missing link');
    const external = createExternalImageNode({
      center: { x: 0, y: 0 },
      url: 'https://example.com/a.png',
      intrinsicWidth: 40,
      intrinsicHeight: 20,
      sizedFromImage: true,
    });
    const board = addNodes(withLink, [external], now);
    const bytes = new Uint8Array([1, 2, 3, 4, 9]);
    const asset: AssetRecord = {
      id: 'shot',
      mimeType: 'image/png',
      byteSize: bytes.byteLength,
      createdAt: now,
      blob: new Blob([bytes], { type: 'image/png' }),
    };
    const image = {
      id: 'pic',
      kind: 'image' as const,
      x: 4,
      y: 6,
      width: 30,
      height: 20,
      mode: 'aspect' as const,
      intrinsicWidth: 30,
      intrinsicHeight: 20,
      sizedFromImage: true,
      source: { type: 'embedded' as const, assetId: 'shot' },
    };
    const duplicate = { ...image, id: 'pic-2', x: 40 };
    const full = addNodes(board, [image, duplicate], now);
    const archive = await buildArchive(full, [asset], now);
    const restored = await readArchive(archive);
    if ('error' in restored) throw new Error(restored.error);
    expect(restored.board.id).toBe(full.id);
    expect(restored.board.viewport).toEqual(full.viewport);
    expect(restored.board.edges).toEqual(full.edges);
    expect(restored.board.nodes.map((node) => node.id).sort()).toEqual(full.nodes.map((node) => node.id).sort());
    expect(restored.assets).toHaveLength(1);
    expect(new Uint8Array(await restored.assets[0]!.blob.arrayBuffer())).toEqual(bytes);
    expect(restored.summary.external).toBe(1);
  });

  test('rejects unsafe paths, duplicate names, and an unsupported board', () => {
    expect(entryProblem('../secret.txt', 4, new Set(), 0)).toBe('The archive contains an unexpected file.');
    expect(entryProblem('manifest.json', 4, new Set(['manifest.json']), 0)).toBe('The archive contains duplicate files.');
    expect(entryProblem('assets/ok.png', 80 * 1024 * 1024, new Set(), 0)).toBe('The archive is too large to import.');
  });
});

describe('project bookkeeping', () => {
  test('counts each embedded asset once and survives a missing quota', () => {
    const image = {
      id: 'pic',
      kind: 'image' as const,
      x: 0,
      y: 0,
      width: 10,
      height: 10,
      mode: 'contain' as const,
      intrinsicWidth: 10,
      intrinsicHeight: 10,
      sizedFromImage: true,
      source: { type: 'embedded' as const, assetId: 'shot' },
    };
    const board = addNodes(createEmptyBoard(now), [image, { ...image, id: 'pic-2' }, createTextNode({ x: 0, y: 0 })], now);
    const usage = logicalUsage(board, [{ id: 'shot', byteSize: 50 }]);
    expect(usage.embeddedAssets).toBe(1);
    expect(usage.assetBytes).toBe(50);
    expect(usage.notes).toBe(3);
    expect(formatOriginEstimate(null).usage).toBe('Unavailable');
    expect(formatOriginEstimate({}).percent).toBe('Unavailable');
  });

  test('detects a stale revision and starts a blank history', () => {
    const board = createEmptyBoard(now);
    expect(storedRevisionConflicts(board, { id: board.id, revision: board.revision })).toBe(false);
    expect(storedRevisionConflicts(board, { id: 'other', revision: board.revision })).toBe(true);
    expect(storedRevisionConflicts(undefined, { id: board.id, revision: 1 })).toBe(false);
    expect(createHistory().past).toEqual([]);
  });

  test('rejects a selection that would nest or steal a child', () => {
    const board = addNodes(createEmptyBoard(now), [note('a', 0, 0), note('b', 40, 0)], now);
    const grouped = groupSelection(board, ['a'], now);
    if ('error' in grouped) throw new Error(grouped.error);
    const nested = groupSelection(grouped.board, [grouped.board.nodes.find((node) => node.kind === 'group')?.id ?? '', 'b'], now);
    expect('error' in nested).toBe(true);
    const stolen = groupSelection(grouped.board, ['a', 'b'], now);
    expect('error' in stolen).toBe(true);
  });

  test('caps simulation speed', () => {
    const body = { id: 'a', x: 0, y: 0, vx: 1000, vy: 0, mass: 1 };
    clampVelocity(body);
    expect(Math.hypot(body.vx, body.vy) <= TENSION.maxSpeed).toBe(true);
    const parked = relaxBoard(addNodes(createEmptyBoard(now), [note('still', 3, 4)], now), [], 5);
    expect(parked.nodes[0]?.x).toBe(3);
  });
});

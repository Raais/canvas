import { describe, expect, test } from 'bun:test';
import { addNodes, createEmptyBoard, parseBoard } from './board';
import { worldTopLeft } from './geometry';
import { connectNodes, deleteEdges } from './graph';
import {
  deleteGroupContents,
  deleteSelection,
  duplicateSelection,
  expandGroup,
  groupFrame,
  groupSelection,
  ungroup,
} from './groups';
import { createHistory, pushHistory, redoHistory, retainedAssetIds, undoHistory } from './history';
import { relaxBoard, stepTension, tensionMagnitude, type TensionBody } from './physics';
import type { Board, BoardNode, ImageNode } from './types';

const now = '2026-11-14T00:00:00.000Z';

function note(id: string, x: number, y: number, width = 100, height = 40): BoardNode {
  return { id, kind: 'text', x, y, width, height, text: id };
}

function withNodes(nodes: BoardNode[], edges: Board['edges'] = []): Board {
  const board = addNodes(createEmptyBoard(now), nodes, now);
  return edges.length === 0 ? board : { ...board, edges };
}

describe('migration', () => {
  test('migrates a Run 1 board without dropping notes or the viewport', () => {
    const migrated = parseBoard({
      schemaVersion: 1,
      id: 'board-1',
      title: 'Kept',
      createdAt: now,
      updatedAt: now,
      revision: 4,
      viewport: { x: 12, y: -4, zoom: 1.5 },
      nodes: [note('n1', 10, 20)],
      edges: [{ id: 'e1', sourceId: 'missing', targetId: 'n1', restLength: 10 }],
    });
    expect(migrated?.schemaVersion).toBe(12);
    expect(migrated?.title).toBe('Kept');
    expect(migrated?.viewport).toEqual({ x: 12, y: -4, zoom: 1.5 });
    expect(migrated?.nodes).toHaveLength(1);
    expect(migrated?.edges).toEqual([]);
  });

  test('does not replace an unsupported document', () => {
    expect(parseBoard({ schemaVersion: 13, id: 'x', nodes: [], edges: [] })).toBeNull();
    expect(parseBoard({ schemaVersion: 2, id: 'x', title: 'T', createdAt: now, updatedAt: now, revision: 1, nodes: [note('a', 0, 0), { ...note('b', 1, 1), parentId: 'missing' }], edges: [], viewport: { x: 0, y: 0, zoom: 1 } })).toBeNull();
  });
});

describe('graph', () => {
  test('stores one undirected rest length and rejects duplicates and self links', () => {
    const board = withNodes([note('a', 0, 0), note('b', 200, 0)]);
    const linked = connectNodes(board, 'a', 'b', 'right', 'left', now);
    expect(linked?.edges).toHaveLength(1);
    expect(linked?.edges[0]?.restLength).toBeGreaterThan(0);
    expect(connectNodes(linked ?? board, 'b', 'a', 'left', 'right', now)).toBeNull();
    expect(connectNodes(board, 'a', 'a', 'right', 'left', now)).toBeNull();
    const removed = deleteEdges(linked ?? board, [linked?.edges[0]?.id ?? ''], now);
    expect(removed.edges).toEqual([]);
    expect(removed.nodes).toHaveLength(2);
  });

  test('keeps the original endpoints when notes are grouped', () => {
    const board = withNodes([note('a', 0, 0), note('b', 300, 0)]);
    const linked = connectNodes(board, 'a', 'b', 'right', 'left', now);
    if (!linked) throw new Error('expected a link');
    const grouped = groupSelection(linked, ['a'], now);
    if ('error' in grouped) throw new Error(grouped.error);
    expect(grouped.board.edges[0]?.sourceId).toBe('a');
    expect(grouped.board.edges[0]?.targetId).toBe('b');
  });
});

describe('groups', () => {
  test('round-trips world coordinates through group and ungroup', () => {
    const board = withNodes([note('a', 40, 50), note('b', 180, 90)]);
    const grouped = groupSelection(board, ['a', 'b'], now);
    if ('error' in grouped) throw new Error(grouped.error);
    const group = grouped.board.nodes.find((node) => node.kind === 'group');
    const child = grouped.board.nodes.find((node) => node.id === 'a');
    if (!group || !child || child.kind === 'group') throw new Error('missing group');
    expect(worldTopLeft(grouped.board.nodes, child)).toEqual({ x: 40, y: 50 });
    const flat = ungroup(grouped.board, [group.id], now);
    expect(flat.nodes.find((node) => node.id === 'a')).toEqual(note('a', 40, 50));
  });

  test('refuses nested groups and ignores partial or already grouped notes in a frame', () => {
    const board = withNodes([note('inside', 10, 10), note('partial', 90, 10), note('held', 400, 400)]);
    const nested = groupSelection(board, ['inside']);
    if ('error' in nested) throw new Error(nested.error);
    const again = groupSelection(nested.board, ['inside']);
    expect('error' in again).toBe(true);
    const framed = groupFrame(board, { x: 0, y: 0, width: 120, height: 80 }, now);
    if ('error' in framed) throw new Error(framed.error);
    const members = framed.board.nodes.filter((node) => node.kind !== 'group' && node.parentId);
    expect(members.map((node) => node.id)).toEqual(['inside']);
  });

  test('moves a group without changing child geometry and expands left without moving siblings', () => {
    const grouped = groupSelection(withNodes([note('a', 30, 30, 40, 40), note('b', 100, 30, 40, 40)]), ['a', 'b'], now);
    if ('error' in grouped) throw new Error(grouped.error);
    const group = grouped.board.nodes.find((node) => node.kind === 'group');
    if (!group) throw new Error('missing group');
    const moved = {
      ...grouped.board,
      nodes: grouped.board.nodes.map((node) => (node.id === group.id ? { ...node, x: node.x + 25, y: node.y - 10 } : node)),
    };
    const child = moved.nodes.find((node) => node.id === 'b');
    if (!child) throw new Error('missing child');
    expect(worldTopLeft(moved.nodes, child).x).toBe(125);
    const shifted = expandGroup({
      ...grouped.board,
      nodes: grouped.board.nodes.map((node) => (node.id === 'a' ? { ...node, x: node.x - 30 } : node)),
    }, group.id);
    const sibling = shifted.nodes.find((node) => node.id === 'b');
    const mover = shifted.nodes.find((node) => node.id === 'a');
    if (!sibling || !mover) throw new Error('missing nodes');
    expect(worldTopLeft(shifted.nodes, sibling)).toEqual(worldTopLeft(grouped.board.nodes, grouped.board.nodes.find((node) => node.id === 'b') ?? sibling));
    expect(mover.x).toBeGreaterThan(0);
  });

  test('deleting a group frame keeps children and deleting contents removes them', () => {
    const grouped = groupSelection(withNodes([note('a', 10, 10), note('b', 80, 10)]), ['a', 'b'], now);
    if ('error' in grouped) throw new Error(grouped.error);
    const group = grouped.board.nodes.find((node) => node.kind === 'group');
    if (!group) throw new Error('missing group');
    const removed = deleteSelection(grouped.board, [group.id, 'a'], now);
    expect(removed.board.nodes.map((node) => node.id).sort()).toEqual(['a', 'b']);
    expect(worldTopLeft(removed.board.nodes, removed.board.nodes.find((node) => node.id === 'a') ?? group)).toEqual({ x: 10, y: 10 });
    const cleared = deleteGroupContents(grouped.board, group.id, now);
    expect(cleared.nodes).toEqual([]);
  });
});

describe('physics', () => {
  test('pulls only when a tether is stretched', () => {
    expect(tensionMagnitude(100, 100)).toBe(0);
    expect(tensionMagnitude(50, 100)).toBe(0);
    expect(tensionMagnitude(0, 0)).toBe(0);
    const stretched = tensionMagnitude(200, 10);
    expect(stretched).toBeGreaterThan(0);
    expect(stretched <= 8).toBe(true);
  });

  test('leaves an isolated node still and ignores an unrelated component', () => {
    const alone = relaxBoard(withNodes([note('a', 5, 5)]), ['a'], 20);
    expect(alone.nodes[0]?.x).toBe(5);
    const board = withNodes([note('a', 0, 0), note('b', 400, 0), note('c', 20, 300)]);
    const linked = connectNodes(board, 'a', 'b', 'right', 'left', now);
    if (!linked) throw new Error('expected a link');
    const slack = { ...linked, edges: linked.edges.map((edge) => ({ ...edge, restLength: 0 })) };
    const settled = relaxBoard(slack, ['a'], 30);
    expect(settled.nodes.find((node) => node.id === 'c')?.x).toBe(20);
    expect(settled.nodes.find((node) => node.id === 'a')?.x).toBe(0);
    expect((settled.nodes.find((node) => node.id === 'b')?.x ?? 400) < 400).toBe(true);
  });

  test('translates a rigid group without changing the child offset', () => {
    const grouped = groupSelection(withNodes([note('child', 40, 40, 80, 40), note('out', 500, 40)]), ['child'], now);
    if ('error' in grouped) throw new Error(grouped.error);
    const linked = connectNodes(grouped.board, 'child', 'out', 'right', 'left', now);
    if (!linked) throw new Error('expected a link');
    const local = linked.nodes.find((node) => node.id === 'child');
    const stretched = { ...linked, edges: linked.edges.map((edge) => ({ ...edge, restLength: 0 })) };
    const settled = relaxBoard(stretched, ['out'], 25);
    const next = settled.nodes.find((node) => node.id === 'child');
    expect(next && local && next.kind !== 'group' && local.kind !== 'group' ? next.x : null).toBe(local?.kind === 'group' ? null : local?.x);
    const bodies: TensionBody[] = [
      { id: 'a', x: 0, y: 0, vx: 0, vy: 0, mass: 1, fx: 0, fy: 0 },
      { id: 'b', x: 300, y: 0, vx: 0, vy: 0, mass: 1 },
    ];
    const stepped = stepTension(bodies, [{ sourceId: 'a', targetId: 'b', restLength: 0, sourceOffset: { x: 0, y: 0 }, targetOffset: { x: 0, y: 0 } }]);
    expect(stepped[0]?.x).toBe(0);
    expect((stepped[1]?.x ?? 300) < 300).toBe(true);
    const crowded = stepTension(
      [
        { id: 'a', x: 0, y: 0, vx: 0, vy: 0, mass: 1, fx: 0, fy: 0 },
        { id: 'b', x: 100, y: 0, vx: 0, vy: 0, mass: 1 },
      ],
      Array.from({ length: 40 }, () => ({
        sourceId: 'a',
        targetId: 'b',
        restLength: 0,
        sourceOffset: { x: 0, y: 0 },
        targetOffset: { x: 0, y: 0 },
      })),
    );
    const shift = Math.abs((crowded[1]?.x ?? 100) - 100);
    expect(shift < 20).toBe(true);
  });
});

describe('undo', () => {
  test('undoes grouping and invalidates redo after a new edit', () => {
    const board = withNodes([note('a', 0, 0), note('b', 80, 0)]);
    const grouped = groupSelection(board, ['a', 'b'], now);
    if ('error' in grouped) throw new Error(grouped.error);
    const history = pushHistory(createHistory(), board);
    const undone = undoHistory(history, grouped.board);
    expect(undone?.board.nodes.some((node) => node.kind === 'group')).toBe(false);
    const redone = undone ? redoHistory(undone.history, undone.board) : null;
    expect(redone?.board.nodes.some((node) => node.kind === 'group')).toBe(true);
    const replaced = pushHistory(undone?.history ?? history, undone?.board ?? board);
    expect(redoHistory(replaced, addNodes(board, [note('c', 5, 5)], now))).toBeNull();
  });

  test('treats a move as one snapshot and restores a deleted image asset', () => {
    const board = withNodes([note('a', 0, 0)]);
    const moved = { ...board, nodes: board.nodes.map((node) => ({ ...node, x: 30 })) };
    const once = pushHistory(createHistory(), board);
    const back = undoHistory(once, moved);
    expect(back?.board.nodes[0]?.x).toBe(0);
    const image: ImageNode = {
      id: 'pic',
      kind: 'image',
      x: 0,
      y: 0,
      width: 80,
      height: 80,
      mode: 'aspect',
      intrinsicWidth: 80,
      intrinsicHeight: 80,
      sizedFromImage: true,
      source: { type: 'embedded', assetId: 'asset-1' },
    };
    const withImage = addNodes(createEmptyBoard(now), [image], now);
    const removed = deleteSelection(withImage, ['pic'], now);
    const kept = retainedAssetIds(removed.board, pushHistory(createHistory(), withImage));
    expect(kept.has('asset-1')).toBe(true);
    expect(retainedAssetIds(removed.board, createHistory()).has('asset-1')).toBe(false);
  });

  test('duplicates a group with its internal edge and fresh ids', () => {
    const grouped = groupSelection(withNodes([note('a', 0, 0), note('b', 80, 0)]), ['a', 'b'], now);
    if ('error' in grouped) throw new Error(grouped.error);
    const group = grouped.board.nodes.find((node) => node.kind === 'group');
    const childA = grouped.board.nodes.find((node) => node.id === 'a');
    const childB = grouped.board.nodes.find((node) => node.id === 'b');
    if (!group || !childA || !childB) throw new Error('missing nodes');
    const linked = connectNodes(grouped.board, 'a', 'b', 'right', 'left', now);
    if (!linked) throw new Error('expected a link');
    const copy = duplicateSelection(linked, [group.id], now);
    expect(copy.nodes).toHaveLength(6);
    expect(copy.edges).toHaveLength(2);
    expect(new Set(copy.nodes.map((node) => node.id)).size).toBe(6);
  });
});

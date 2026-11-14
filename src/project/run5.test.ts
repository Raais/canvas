import { describe, expect, test } from 'bun:test';
import { addNodes, createEmptyBoard, migrateStoredAppearance, parseBoard, setAppearance, toggleImageFlip } from '../domain/board';
import { decodeGraphClipboard, encodeGraphClipboard, pasteGraph, selectionClosure } from '../domain/graph-clipboard';
import { duplicateSelection, groupSelection } from '../domain/groups';
import { createHistory, pushHistory, undoHistory } from '../domain/history';
import { placeNode } from '../domain/board';
import { HANDLE_SIDES, handleAnchorTransform, visualHandleTransform } from '../editor/handles';
import type { BoardNode, ImageNode } from '../domain/types';
import { buildArchive, readArchive } from '../archive/zip';

const now = '2026-11-14T12:30:00.000Z';

function text(id: string, x = 0, y = 0): BoardNode {
  return { id, kind: 'text', x, y, width: 80, height: 40, text: id };
}

function image(id: string): ImageNode {
  return {
    id,
    kind: 'image',
    x: 12,
    y: 18,
    width: 120,
    height: 80,
    mode: 'stretch',
    intrinsicWidth: 240,
    intrinsicHeight: 160,
    sizedFromImage: true,
    source: { type: 'embedded', assetId: 'asset-1' },
  };
}

describe('handles and groups', () => {
  test('uses a different anchor shift for the right and bottom handles', () => {
    expect(handleAnchorTransform('top')).toBe('translate(-50%, -50%)');
    expect(handleAnchorTransform('left')).toBe('translate(-50%, -50%)');
    expect(handleAnchorTransform('right')).toBe('translate(50%, -50%)');
    expect(handleAnchorTransform('bottom')).toBe('translate(-50%, 50%)');
    for (const side of HANDLE_SIDES) expect(handleAnchorTransform(side).includes('scale(')).toBe(false);
    expect(visualHandleTransform()).toBe('translate(-50%, -50%) scale(var(--handle-scale, 1))');
  });

  test('moving a group keeps child offsets', () => {
    const grouped = groupSelection(addNodes(createEmptyBoard(now), [text('a', 10, 20), text('b', 80, 20)], now), ['a', 'b'], now);
    if ('error' in grouped) throw new Error(grouped.error);
    const group = grouped.board.nodes.find((node) => node.kind === 'group');
    const child = grouped.board.nodes.find((node) => node.id === 'a');
    if (!group || !child || child.kind === 'group') throw new Error('missing group');
    const moved = placeNode(grouped.board, group.id, { x: group.x + 40, y: group.y + 15 });
    const after = moved.nodes.find((node) => node.id === 'a');
    expect(after && after.kind !== 'group' ? after.x : null).toBe(child.x);
    expect(after && after.kind !== 'group' ? after.y : null).toBe(child.y);
    expect(moved.nodes.find((node) => node.id === group.id)?.x).toBe(group.x + 40);
  });
});

describe('project appearance', () => {
  test('defaults to dark and preserves a chosen theme', () => {
    const board = createEmptyBoard(now);
    expect(board.appearance).toBe('dark');
    const light = setAppearance(board, 'light', now);
    expect(light.appearance).toBe('light');
    expect(light.nodes).toEqual(board.nodes);
    expect(light.edges).toEqual(board.edges);
    const parsed = parseBoard(JSON.parse(JSON.stringify(light)));
    expect(parsed?.appearance).toBe('light');
    expect(parsed?.schemaVersion).toBe(7);
  });

  test('migrates an older board without letting a site preference override a saved theme', () => {
    const older = { ...createEmptyBoard(now), schemaVersion: 2 };
    const parsed = parseBoard(older);
    expect(parsed?.appearance).toBe('dark');
    const withLegacy = parsed ? migrateStoredAppearance(parsed, 2, null, 'light') : null;
    expect(withLegacy?.appearance).toBe('light');
    const saved = setAppearance(createEmptyBoard(now), 'light', now);
    expect(migrateStoredAppearance(saved, 3, 'light', 'dark').appearance).toBe('light');
    expect(parseBoard({ ...saved, appearance: 'system' })).toBeNull();
  });
});

describe('image flips', () => {
  test('toggles each axis, survives copy, and restores on undo', () => {
    const board = addNodes(createEmptyBoard(now), [image('pic')], now);
    const horizontal = toggleImageFlip(board, 'pic', 'x', now);
    const both = toggleImageFlip(horizontal, 'pic', 'y', now);
    const node = both.nodes.find((entry) => entry.id === 'pic');
    expect(node?.kind === 'image' && node.flipX).toBe(true);
    expect(node?.kind === 'image' && node.flipY).toBe(true);
    expect(node?.kind === 'image' ? node.width : 0).toBe(120);
    const cleared = toggleImageFlip(both, 'pic', 'x', now);
    const after = cleared.nodes.find((entry) => entry.id === 'pic');
    expect(after?.kind === 'image' ? after.flipX : true).toBe(undefined);
    expect(after?.kind === 'image' && after.flipY).toBe(true);
    const undone = undoHistory(pushHistory(createHistory(), board), both);
    const undoneNode = undone?.board.nodes.find((entry) => entry.id === 'pic');
    expect(undoneNode?.kind === 'image' ? undoneNode.flipX : true).toBe(undefined);
    const copied = duplicateSelection(both, ['pic'], now);
    const clone = copied.nodes.find((entry) => entry.id !== 'pic' && entry.kind === 'image');
    expect(clone?.kind === 'image' && clone.flipX && clone.flipY).toBe(true);
    const payload = selectionClosure(both, ['pic']);
    const decoded = payload ? decodeGraphClipboard(encodeGraphClipboard(payload)) : null;
    expect(decoded?.nodes[0]?.kind === 'image' && decoded.nodes[0].flipY).toBe(true);
  });
});

describe('clipboard validation', () => {
  test('rejects malformed graph payloads and still pastes a valid note', () => {
    const board = addNodes(createEmptyBoard(now), [text('a', 4, 8)], now);
    const payload = selectionClosure(board, ['a']);
    if (!payload) throw new Error('missing payload');
    const pasted = pasteGraph(board, payload, { x: 30, y: 40 }, new Set(), 0, now);
    expect('error' in pasted).toBe(false);
    const encoded = encodeGraphClipboard(payload);
    const broken = encoded.replace('"kind":"text"', '"kind":"widget"');
    expect(decodeGraphClipboard(broken)).toBeNull();
    expect(decodeGraphClipboard(encoded.replace('canvas-graph/1', 'canvas-graph/9'))).toBeNull();
    const nested = {
      ...payload,
      nodes: [
        { id: 'g', kind: 'group', x: 0, y: 0, width: 100, height: 80, label: 'G', parentId: 'a' },
        text('a'),
      ],
    };
    expect(decodeGraphClipboard(encodeGraphClipboard(nested as typeof payload))).toBeNull();
    const badUrl = {
      ...payload,
      nodes: [{ ...image('pic'), source: { type: 'external', url: 'javascript:alert(1)' } }],
    };
    expect(decodeGraphClipboard(encodeGraphClipboard(badUrl as typeof payload))).toBeNull();
    const self = {
      ...payload,
      edges: [{ id: 'e', sourceId: 'a', targetId: 'a', sourceHandle: 'right' as const, targetHandle: 'left' as const, restLength: 1 }],
    };
    expect(decodeGraphClipboard(encodeGraphClipboard(self))).toBeNull();
  });
});

describe('archive appearance', () => {
  test('round-trips a light board and an image flip', async () => {
    const light = setAppearance(addNodes(createEmptyBoard(now), [image('pic')], now), 'light', now);
    const flipped = toggleImageFlip(light, 'pic', 'y', now);
    const blob = new Blob([new Uint8Array([1, 2, 3, 4])], { type: 'image/png' });
    const bytes = await buildArchive(flipped, [{ id: 'asset-1', mimeType: 'image/png', byteSize: 4, createdAt: now, blob }], now);
    const read = await readArchive(bytes);
    if ('error' in read) throw new Error(read.error);
    expect(read.board.appearance).toBe('light');
    const node = read.board.nodes.find((entry) => entry.id === 'pic');
    expect(node?.kind === 'image' && node.flipY).toBe(true);
    expect(read.assets[0]?.blob.size).toBe(4);
  });
});

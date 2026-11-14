import { describe, expect, test } from 'bun:test';
import { ARCHIVE_LIMITS } from '../archive/format';
import { entryProblem } from '../archive/validate';
import { addNodes, createEmptyBoard, parseBoard, setImageMode, setPresentation } from '../domain/board';
import { classifyPlainText } from '../domain/code';
import { decodeGraphClipboard, encodeGraphClipboard, pasteGraph, selectionClosure } from '../domain/graph-clipboard';
import { groupSelection } from '../domain/groups';
import { createHistory, pushHistory, redoHistory, undoHistory } from '../domain/history';
import type { BoardNode, ImageNode } from '../domain/types';
import { parseAppearance } from '../persistence/db';
import { SaveQueue } from '../persistence/save-queue';
import { boardSnapshotKey } from '../project/storage';
import type { CanvasDatabase } from '../persistence/db';

const now = '2026-11-14T12:00:00.000Z';

function text(id: string, x: number, y: number): BoardNode {
  return { id, kind: 'text', x, y, width: 80, height: 40, text: id };
}

function image(id: string, assetId: string): ImageNode {
  return {
    id,
    kind: 'image',
    x: 10,
    y: 20,
    width: 100,
    height: 80,
    mode: 'stretch',
    intrinsicWidth: 200,
    intrinsicHeight: 100,
    sizedFromImage: true,
    source: { type: 'embedded', assetId },
  };
}

describe('graph clipboard', () => {
  test('copies a note, a group with its child, and only internal edges', () => {
    let board = addNodes(createEmptyBoard(now), [text('a', 0, 0), text('b', 40, 20), text('c', 400, 0)], now);
    board = {
      ...board,
      edges: [
        { id: 'in', sourceId: 'a', targetId: 'b', sourceHandle: 'right', targetHandle: 'left', restLength: 40 },
        { id: 'out', sourceId: 'a', targetId: 'c', sourceHandle: 'right', targetHandle: 'left', restLength: 400 },
      ],
    };
    const grouped = groupSelection(board, ['a', 'b'], now);
    if ('error' in grouped) throw new Error(grouped.error);
    const group = grouped.board.nodes.find((node) => node.kind === 'group');
    if (!group) throw new Error('missing group');
    const payload = selectionClosure(grouped.board, [group.id]);
    if (!payload) throw new Error('missing payload');
    expect(payload.nodes).toHaveLength(3);
    expect(payload.edges.map((edge) => edge.id)).toEqual(['in']);
    const decoded = decodeGraphClipboard(encodeGraphClipboard(payload));
    expect(decoded?.version).toBe(1);
    const pasted = pasteGraph(grouped.board, decoded!, { x: 20, y: 30 }, new Set(), 0, now);
    if ('error' in pasted) throw new Error(pasted.error);
    expect(pasted.nodes.length).toBe(grouped.board.nodes.length + 3);
    const again = pasteGraph(pasted, decoded!, { x: 20, y: 30 }, new Set(), 1, now);
    if ('error' in again) throw new Error(again.error);
    expect(again.nodes.length).toBe(pasted.nodes.length + 3);
    const undone = undoHistory(pushHistory(createHistory(), grouped.board), pasted);
    expect(undone?.board.nodes.length).toBe(grouped.board.nodes.length);
    const redone = undone ? redoHistory(undone.history, undone.board) : null;
    expect(redone?.board.nodes.length).toBe(pasted.nodes.length);
  });

  test('rejects a stale or foreign clipboard payload', () => {
    expect(decodeGraphClipboard('hello world')).toBeNull();
    expect(decodeGraphClipboard('canvas-graph/2\n{}')).toBeNull();
  });

  test('refuses a copy whose image is not on the board', () => {
    const board = addNodes(createEmptyBoard(now), [image('pic', 'asset-1')], now);
    const payload = selectionClosure(board, ['pic']);
    if (!payload) throw new Error('missing payload');
    const result = pasteGraph(board, payload, { x: 0, y: 0 }, new Set(), 0, now);
    expect('error' in result).toBe(true);
  });
});

describe('code notes and image stretch', () => {
  test('keeps prose as text and recognizes fenced code', () => {
    expect(classifyPlainText('A sentence containing const is still prose.')).toEqual({ presentation: 'text' });
    expect(classifyPlainText('https://example.com/const')).toEqual({ presentation: 'text' });
    const fenced = classifyPlainText('```ts\nexport const n = 1;\n```');
    expect(fenced.presentation).toBe('code');
    expect(fenced.language).toBe('TypeScript');
    const json = classifyPlainText('{\n  "ok": true\n}');
    expect(json).toEqual({ presentation: 'code', language: 'JSON' });
  });

  test('round-trips code presentation and stretch mode', () => {
    let board = addNodes(createEmptyBoard(now), [text('note', 0, 0), image('pic', 'asset-1')], now);
    board = setPresentation(board, 'note', 'code', now);
    board = setImageMode(board, 'pic', 'stretch', now);
    const parsed = parseBoard(JSON.parse(JSON.stringify(board)));
    const note = parsed?.nodes.find((node) => node.id === 'note');
    const pic = parsed?.nodes.find((node) => node.id === 'pic');
    expect(note?.kind === 'text' && note.presentation).toBe('code');
    expect(pic?.kind === 'image' && pic.mode).toBe('stretch');
    const legacy = parseBoard({ ...board, nodes: board.nodes.map((node) => (node.kind === 'image' ? { ...node, mode: 'contain' } : node)) });
    const migrated = legacy?.nodes.find((node) => node.id === 'pic');
    expect(migrated?.kind === 'image' && migrated.mode).toBe('stretch');
  });
});

describe('replacement and theme safety', () => {
  test('a failed replacement keeps pending asset writes', () => {
    const board = createEmptyBoard(now);
    const queue = new SaveQueue({} as CanvasDatabase, () => board, () => {});
    queue.adopt(board);
    queue.addAssets([{ id: 'a', mimeType: 'image/png', byteSize: 4, createdAt: now, blob: new Blob(['test']) }]);
    queue.markUnsaved();
    const held = queue.holdForReplacement();
    expect(held).toEqual({ dirty: true, upserts: 1, deletes: 0 });
    expect(queue.pendingSummary().suspended).toBe(true);
    queue.abortReplacement();
    expect(queue.pendingSummary()).toEqual({ suspended: false, dirty: true, upserts: 1, deletes: 0 });
    queue.discardPending();
  });

  test('theme preference is separate from the board snapshot', () => {
    expect(parseAppearance({ kind: 'preferences', appearance: 'light' })).toBe('light');
    expect(parseAppearance({ kind: 'preferences', appearance: 'system' })).toBe('dark');
    const board = createEmptyBoard(now);
    const changed = { ...board, title: 'Later' };
    expect(boardSnapshotKey(board) === boardSnapshotKey(changed)).toBe(false);
    expect(parseAppearance(board)).toBe('dark');
  });

  test('import and export share the archive size ceiling', () => {
    expect(entryProblem('assets/a.png', ARCHIVE_LIMITS.maxFileBytes + 1, new Set(), 0)).toBe('The archive is too large to import.');
    expect(entryProblem('assets/a.png', 10, new Set(), ARCHIVE_LIMITS.maxTotalBytes)).toBe('The archive is too large to import.');
  });
});

import { describe, expect, test } from 'bun:test';
import { ARCHIVE_LIMITS } from '../archive/format';
import { createEmptyBoard, createTextNode, renameBoard, updateText } from '../domain/board';
import { decodeGraphClipboard, encodeGraphClipboard, GRAPH_CLIPBOARD_LIMIT, looksLikeGraphClipboard, selectionClosure } from '../domain/graph-clipboard';
import { deleteGroupContents, groupSelection, moveTargets, renameGroup, restoreGroupLabels } from '../domain/groups';
import { createHistory, pushHistory, redoHistory, undoHistory } from '../domain/history';
import { taskMarkerOffsets, toggleTask, toggleTaskAt } from '../domain/markdown';
import { archiveFileLimitLabel, archivePressure, imageExceedsArchiveFile, partitionIncoming } from '../ingest/admission';
import { SaveQueue } from '../persistence/save-queue';
import type { AssetRecord } from '../domain/types';
import { createMockLocks, createWriteSession, WRITE_LOCK_NAME } from '../project/ownership';
import { memoryTabHub, openBoardChannel, otherTabWins } from '../project/tabs';

const tasks = [
  '- [ ] Alpha',
  '- [x] Beta',
  '* [ ] Gamma',
  '+ [X] Delta',
  '',
  '1. [ ] Ordered',
  '2. [x] Ordered complete',
  '',
  '-  [ ] Extra spacing',
  '',
  '> - [ ] Quoted task',
  '',
  '- [ ] Parent',
  '  - [x] Nested child',
  '',
  '- [ ] Investigate',
  '- [ ] Investigate',
].join('\n');

describe('writer ownership', () => {
  test('one tab owns the lock and a later tab stays read-only until the owner releases it', async () => {
    const locks = createMockLocks();
    const first = createWriteSession(locks);
    const second = createWriteSession(locks);
    expect(await first.retain()).toBe('owned');
    expect(await second.retain()).toBe('denied');
    first.release();
    await new Promise((resolve) => setTimeout(resolve, 0));
    const third = createWriteSession(locks);
    expect(await third.retain()).toBe('owned');
    expect(WRITE_LOCK_NAME).toBe('raais-canvas-active-board-v1');
  });

  test('a strict-mode release and retain keeps the same ownership', async () => {
    const session = createWriteSession(createMockLocks());
    const first = session.retain();
    session.release();
    const second = session.retain();
    expect(await first).toBe('owned');
    expect(await second).toBe('owned');
    session.release();
    await Promise.resolve();
  });

  test('channel discovery reaches the original writer and does not answer its own ack', () => {
    const hub = memoryTabHub();
    const yields: string[] = [];
    const posts: string[] = [];
    const bus = hub.connect();
    const original = bus.listen;
    bus.listen = (handler) => original((message) => {
      posts.push(`${message.type}:${message.tabId}`);
      handler(message);
    });
    const writer = { current: true };
    const open = (tabId: string, openedAt: number) => openBoardChannel(
      { tabId, openedAt },
      {
        isWriter: () => writer.current && tabId === 'a',
        locksAuthoritative: false,
        onYield: () => yields.push(tabId),
        onRemoteSave: () => {},
      },
      bus,
    );
    const a = open('a', 1);
    const b = open('b', 2);
    const c = open('c', 3);
    expect(yields.includes('b')).toBe(true);
    expect(yields.includes('c')).toBe(true);
    expect(yields.includes('a')).toBe(false);
    expect(posts.filter((entry) => entry.startsWith('hello-ack:')).length > 0).toBe(true);
    const before = posts.length;
    c.announce('board', 2);
    expect(posts.length > before).toBe(true);
    expect(posts.includes('saved:c')).toBe(true);
    expect(otherTabWins({ tabId: 'b', openedAt: 5 }, { tabId: 'a', openedAt: 5 })).toBe(true);
    a.close();
    b.close();
    c.close();
  });
});

describe('backup admission', () => {
  test('rejects an oversized image before treating it as eligible and keeps room for the manifest', () => {
    expect(imageExceedsArchiveFile(ARCHIVE_LIMITS.maxFileBytes)).toBe(false);
    expect(imageExceedsArchiveFile(ARCHIVE_LIMITS.maxFileBytes + 1)).toBe(true);
    expect(archiveFileLimitLabel()).toBe('64 MiB');
    const board = createEmptyBoard();
    const mixed = partitionIncoming({
      board,
      existingBytes: 1024,
      existingCount: 1,
      incoming: [
        { key: 'ok', name: 'small.png', bytes: 2048 },
        { key: 'huge', name: 'huge.png', bytes: ARCHIVE_LIMITS.maxFileBytes + 1 },
        { key: 'budget', name: 'budget.png', bytes: ARCHIVE_LIMITS.maxTotalBytes },
      ],
    });
    expect(mixed.accepted).toEqual(['ok']);
    expect(mixed.warnings.length).toBe(2);
    expect(archivePressure(ARCHIVE_LIMITS.maxTotalBytes + 1, 1)).toBe('over');
    expect(archivePressure(Math.floor(ARCHIVE_LIMITS.maxTotalBytes * 0.95), 1)).toBe('near');
  });
});

describe('clipboard and history repairs', () => {
  test('detaches a copied child into world coordinates and rejects an invalid graph marker', () => {
    const board = createEmptyBoard();
    const note = createTextNode({ x: 130, y: 240 }, 'Inside');
    const grouped = groupSelection({ ...board, nodes: [note] }, [note.id]);
    if ('error' in grouped) throw new Error(grouped.error);
    const child = grouped.board.nodes.find((node) => node.kind === 'text');
    const group = grouped.board.nodes.find((node) => node.kind === 'group');
    if (!child || !group || child.kind !== 'text' || group.kind !== 'group') throw new Error('missing');
    const onlyChild = selectionClosure(grouped.board, [child.id]);
    const copied = onlyChild?.nodes[0];
    expect(copied?.kind === 'text' && copied.parentId).toBe(undefined);
    expect(onlyChild?.nodes[0]?.x).toBe(group.x + child.x);
    expect(onlyChild?.nodes[0]?.y).toBe(group.y + child.y);
    expect(grouped.board.nodes.some((node) => node.id === child.id && node.kind === 'text' && node.parentId === group.id)).toBe(true);
    const whole = selectionClosure(grouped.board, [group.id]);
    expect(whole?.nodes.some((node) => node.kind === 'text' && node.parentId === group.id)).toBe(true);
    const encoded = encodeGraphClipboard(onlyChild!);
    expect(decodeGraphClipboard(encoded)?.nodes.length).toBe(1);
    expect(looksLikeGraphClipboard('canvas-graph/1\n{')).toBe(true);
    expect(decodeGraphClipboard('canvas-graph/1\n{')).toBeNull();
    expect(looksLikeGraphClipboard('hello')).toBe(false);
    expect(GRAPH_CLIPBOARD_LIMIT).toBe(1_500_000);
  });

  test('undo and redo keep the current title and atlas metadata', () => {
    const start = createTextNode({ x: 0, y: 0 }, 'Before');
    const board = { ...createEmptyBoard(), nodes: [start], title: 'Untitled' };
    const history = pushHistory(createHistory(), board);
    const edited = updateText(board, start.id, 'After');
    const renamed = renameBoard(edited, 'Heist plan');
    const undone = undoHistory(history, renamed);
    const undoneText = undone?.board.nodes.find((node) => node.kind === 'text');
    expect(undone?.board.title).toBe('Heist plan');
    expect(undoneText?.kind === 'text' && undoneText.text).toBe('Before');
    const redone = undone ? redoHistory(undone.history, undone.board) : null;
    const redoneText = redone?.board.nodes.find((node) => node.kind === 'text');
    expect(redone?.board.title).toBe('Heist plan');
    expect(redoneText?.kind === 'text' && redoneText.text).toBe('After');
  });
});

describe('markdown tasks and group actions', () => {
  test('toggles ordered, quoted, nested, and duplicate tasks without touching a fence', () => {
    const offsets = taskMarkerOffsets(tasks);
    expect(offsets.length).toBe(12);
    const ordered = tasks.indexOf('1. [ ] Ordered');
    expect(toggleTaskAt(tasks, ordered).includes('1. [x] Ordered')).toBe(true);
    const quoted = tasks.indexOf('> - [ ] Quoted');
    expect(toggleTaskAt(tasks, quoted).includes('> - [x] Quoted task')).toBe(true);
    const second = tasks.lastIndexOf('- [ ] Investigate');
    expect(toggleTaskAt(tasks, second).endsWith('- [x] Investigate')).toBe(true);
    const fenced = '```\n- [ ] This is code\n```\n- [ ] real';
    expect(toggleTask(fenced, 0)).toBe('```\n- [ ] This is code\n```\n- [x] real');
    expect(toggleTask('`[ ]` still text\n- [ ] real', 0).includes('- [x] real')).toBe(true);
  });

  test('move targets ignore a group-only selection and a cancelled rename restores the label', () => {
    const note = createTextNode({ x: 10, y: 10 }, 'Note');
    const grouped = groupSelection({ ...createEmptyBoard(), nodes: [note] }, [note.id]);
    if ('error' in grouped) throw new Error(grouped.error);
    const group = grouped.board.nodes.find((node) => node.kind === 'group');
    if (!group) throw new Error('group');
    expect(moveTargets(grouped.board, [group.id]).groups.length).toBe(0);
    const loose = createTextNode({ x: 400, y: 10 }, 'Loose');
    const withLoose = { ...grouped.board, nodes: [...grouped.board.nodes, loose] };
    expect(moveTargets(withLoose, [loose.id]).groups.map((entry) => entry.id)).toEqual([group.id]);
    const renamed = renameGroup(grouped.board, group.id, 'Temporary');
    const restored = restoreGroupLabels(renamed, grouped.board);
    expect(restored.nodes.some((node) => node.id === group.id && node.kind === 'group' && node.label === group.label)).toBe(true);
    const removed = deleteGroupContents(grouped.board, group.id);
    expect(removed.nodes.some((node) => node.id === group.id || node.id === note.id)).toBe(false);
  });
});

describe('conflict recovery', () => {
  test('pausing a dirty queue keeps the board and asset bytes recoverable', () => {
    const board = createEmptyBoard();
    const statuses: string[] = [];
    const queue = new SaveQueue({} as never, () => board, (status) => statuses.push(status));
    queue.adopt(board);
    const asset = { id: 'asset', mimeType: 'image/png', byteSize: 4, createdAt: board.createdAt, blob: new Blob(['test']) } as AssetRecord;
    queue.addAssets([asset]);
    queue.markUnsaved();
    queue.pauseForConflict();
    expect(queue.recovery()?.assets[0]?.id).toBe('asset');
    expect(queue.hasUnpersisted()).toBe(true);
    expect(statuses.includes('saved')).toBe(false);
    queue.schedule(0);
    expect(queue.pendingSummary().suspended).toBe(true);
  });
});

import { describe, expect, test } from 'bun:test';
import { ARCHIVE_VERSION } from '../archive/format';
import { buildArchive, readArchive } from '../archive/zip';
import { WEBP_OPTIMIZER_V1 } from '../ingest/image-optimizer-config';
import {
  addNodes,
  createEmptyBoard,
  createTextNode,
  parseBoard,
  protectTextNode,
  replaceProtectedPayload,
  setPresentation,
  unprotectTextNode,
  updateText,
} from '../domain/board';
import { connectNodes } from '../domain/graph';
import { decodeGraphClipboard, encodeGraphClipboard, GRAPH_CLIPBOARD_VERSION, pasteGraph, selectionClosure } from '../domain/graph-clipboard';
import { deleteGroupContents, deleteSelection, duplicateSelection, groupSelection } from '../domain/groups';
import { createHistory, pushHistory, undoHistory } from '../domain/history';
import { placeNode } from '../domain/board';
import { deriveKey, openProtected, protectPlaintext, reseal } from '../domain/text-crypto';
import { TEXT_KDF, forgetRemovedSessions, isProtectedTextNode, parseProtectedPayload, passwordIsUsable, preferProtectedBoard, randomBytes } from '../domain/text-protection';
import { SaveQueue } from '../persistence/save-queue';
import type { CanvasDatabase } from '../persistence/db';
import { buildSearchIndex, searchNodes } from '../domain/search';
import { effectivePullingForce } from '../editor/pulling';
import { buildContentIndex, queryBoard } from '../search/query';
import type { Board, TextNode } from '../domain/types';

declare const Bun: { file(path: URL): { text(): Promise<string> } };

const now = '2026-11-15T09:00:00.000Z';
const later = '2026-11-15T10:00:00.000Z';
const secret = 'violet-harbor-secret';
const password = 'correct horse';
const fast = { iterations: 1, memoryKiB: 8_192, parallelism: 1 };

function note(text = secret): TextNode {
  return {
    id: 'note',
    kind: 'text',
    x: 12,
    y: 18,
    width: 200,
    height: 120,
    text,
    presentation: 'markdown',
    backgroundTone: 'sage',
    textTone: 'warm',
    lastEditedAt: now,
  };
}

async function protectedBoard(text = secret, presentation?: TextNode['presentation']): Promise<Board> {
  const source = presentation ? { ...note(text), presentation } : note(text);
  const board = addNodes(createEmptyBoard(now), [source], now);
  const payload = await protectPlaintext(text, password, fast);
  return protectTextNode(board, 'note', payload);
}

describe('password crypto', () => {
  test('derives a key and round-trips text, markdown, code, and unicode', async () => {
    const saltA = randomBytes(16);
    const saltB = randomBytes(16);
    const left = await deriveKey(password, saltA, fast);
    const right = await deriveKey(password, saltB, fast);
    expect(left.length).toBe(32);
    expect(left.length === right.length && left.every((byte, index) => byte === right[index])).toBe(false);
    for (const text of ['', secret, 'café 🔒', '# Title\n\n- [ ] task', 'const n = 1;\n']) {
      const payload = await protectPlaintext(text, password, fast);
      const opened = await openProtected(payload, password);
      expect(opened?.text).toBe(text);
      const again = reseal(payload, opened?.key ?? left, text);
      expect(again.ciphertext === payload.ciphertext).toBe(false);
      expect(again.nonce === payload.nonce).toBe(false);
      expect((await openProtected(again, password))?.text).toBe(text);
    }
    const stored = await protectPlaintext(secret, password, fast);
    const wrong = await openProtected(stored, 'nope');
    expect(wrong).toBeNull();
    expect(stored.ciphertext).toBe(stored.ciphertext);
    const tampered = { ...stored, ciphertext: `${stored.ciphertext.slice(0, -2)}aa` };
    expect(await openProtected(tampered, password)).toBeNull();
    expect(stored.ciphertext.endsWith('aa')).toBe(false);
    expect(parseProtectedPayload({ ...stored, ciphertext: '%%%' })).toBeNull();
    expect(parseProtectedPayload({ ...stored, salt: 'aa' })).toBeNull();
    expect(parseProtectedPayload({ ...stored, nonce: 'aa' })).toBeNull();
    expect(parseProtectedPayload({ ...stored, version: 2 })).toBeNull();
    expect(parseProtectedPayload({ ...stored, memoryKiB: 1_000_000 })).toBeNull();
    expect(parseProtectedPayload({ ...stored, iterations: 99 })).toBeNull();
    expect(passwordIsUsable('  ')).toBe(false);
    expect(passwordIsUsable(password)).toBe(true);
    expect(TEXT_KDF).toEqual({ iterations: 3, memoryKiB: 32_768, parallelism: 1 });
    const production = await protectPlaintext('ok', password);
    expect((await openProtected(production, password))?.text).toBe('ok');
  });
});

describe('protected notes', () => {
  test('stores ciphertext only and keeps the note in the graph', async () => {
    const source = addNodes(createEmptyBoard(now), [note(), { id: 'other', kind: 'text', x: 400, y: 0, width: 80, height: 40, text: 'other', lastEditedAt: now }], now);
    const linked = connectNodes(source, 'note', 'other', 'right', 'left', now);
    if (!linked) throw new Error('link');
    const payload = await protectPlaintext(secret, password, fast);
    const protectedBoard = protectTextNode(linked, 'note', payload);
    const stored = protectedBoard.nodes.find((node) => node.id === 'note');
    expect(isProtectedTextNode(stored ?? note())).toBe(true);
    expect(stored?.kind === 'text' ? stored.text : 'x').toBe('');
    expect(stored?.kind === 'text' ? stored.lastEditedAt : '').toBe(now);
    expect(stored?.kind === 'text' ? stored.presentation : '').toBe('markdown');
    expect(stored?.kind === 'text' ? stored.backgroundTone : '').toBe('sage');
    expect(stored?.id).toBe('note');
    expect(stored?.x).toBe(12);
    expect(protectedBoard.edges).toHaveLength(1);
    expect(JSON.stringify(protectedBoard).includes(secret)).toBe(false);
    const session = await openProtected(payload, password);
    expect(session?.text).toBe(secret);
    expect(JSON.stringify(protectedBoard).includes(secret)).toBe(false);
    const same = replaceProtectedPayload(protectedBoard, 'note', payload, later);
    expect(same).toBe(protectedBoard);
    const edited = reseal(payload, session?.key ?? new Uint8Array(), 'next secret');
    const changed = replaceProtectedPayload(protectedBoard, 'note', edited, later);
    const changedNote = changed.nodes.find((node) => node.id === 'note');
    expect(changedNote?.kind === 'text' ? changedNote.lastEditedAt : '').toBe(later);
    expect(JSON.stringify(changed).includes('next secret')).toBe(false);
    expect((await openProtected(edited, password))?.text).toBe('next secret');
    const plain = unprotectTextNode(protectedBoard, 'note', secret, later);
    const restored = plain.nodes.find((node) => node.id === 'note');
    expect(restored?.kind === 'text' ? restored.text : '').toBe(secret);
    expect(restored?.kind === 'text' ? restored.protection : 'set').toBe(undefined);
    expect(restored?.kind === 'text' ? restored.lastEditedAt : '').toBe(now);
    expect(updateText(protectedBoard, 'note', 'visible', later)).toBe(protectedBoard);
  });

  test('keeps protection out of search, history, clipboard, and zip', async () => {
    const board = await protectedBoard();
    const index = buildSearchIndex(board.nodes);
    expect(JSON.stringify(index).includes(secret)).toBe(false);
    expect(searchNodes(index, 'violet')).toHaveLength(0);
    const unlockedIndex = buildSearchIndex(board.nodes);
    expect(JSON.stringify(unlockedIndex).includes(secret)).toBe(false);
    const ordinary = addNodes(board, [createTextNode({ x: 30, y: 30 }, 'alpha note', now)], now);
    expect(searchNodes(buildSearchIndex(ordinary.nodes), 'alpha')).toHaveLength(1);
    expect(searchNodes(buildSearchIndex(addNodes(createEmptyBoard(now), [{ id: 'g', kind: 'group', x: 0, y: 0, width: 120, height: 80, label: 'Atlas shelf' }], now).nodes), 'Atlas')).toHaveLength(1);
    const found = queryBoard(board.nodes, buildContentIndex(board.nodes), '2026', new Date('2026-11-15T12:00:00.000Z'));
    expect(found.results.some((result) => result.title === 'Password protected')).toBe(true);
    expect(JSON.stringify(found).includes(secret)).toBe(false);
    const history = createHistory();
    expect(undoHistory(history, board)).toBeNull();
    const moved = placeNode(board, 'note', { x: 40 });
    const undone = undoHistory(pushHistory(createHistory(), board), moved);
    expect(undone?.board.nodes.find((node) => node.id === 'note')?.x).toBe(12);
    expect(isProtectedTextNode(undone?.board.nodes[0] ?? note())).toBe(true);
    const removed = deleteSelection(board, ['note']);
    expect(removed.board.nodes.some((node) => node.id === 'note')).toBe(false);
    const restored = undoHistory(pushHistory(createHistory(), board), removed.board);
    const restoredNote = restored?.board.nodes.find((node) => node.id === 'note');
    expect(restoredNote?.kind === 'text' ? restoredNote.text : 'x').toBe('');
    const copy = selectionClosure(board, ['note']);
    const encoded = copy ? encodeGraphClipboard(copy) : '';
    expect(encoded.includes(secret)).toBe(false);
    const decoded = decodeGraphClipboard(encoded);
    expect(decoded?.nodes[0] && isProtectedTextNode(decoded.nodes[0])).toBe(true);
    const pasted = decoded ? pasteGraph(createEmptyBoard(now), decoded, { x: 80, y: 80 }, new Set(), 0, later) : null;
    const pastedNode = pasted && !('error' in pasted) ? pasted.nodes.find((node) => node.kind === 'text' && node.id !== 'note') : null;
    expect(pastedNode && isProtectedTextNode(pastedNode) ? (await openProtected(pastedNode.protection, password))?.text : '').toBe(secret);
    const duplicate = duplicateSelection(board, ['note'], later);
    const twin = duplicate.nodes.find((node) => node.id !== 'note' && node.kind === 'text');
    expect(twin && isProtectedTextNode(twin) ? (await openProtected(twin.protection, password))?.text : '').toBe(secret);
    const legacy = selectionClosure(addNodes(createEmptyBoard(now), [createTextNode({ x: 0, y: 0 }, 'plain', now)], now), [createTextNode({ x: 0, y: 0 }, 'plain', now).id]);
    expect(legacy).toBeNull();
    const plainBoard = addNodes(createEmptyBoard(now), [createTextNode({ x: 0, y: 0 }, 'plain', now)], now);
    const plainId = plainBoard.nodes[0]?.id ?? '';
    const legacyPayload = selectionClosure(plainBoard, [plainId]);
    expect(decodeGraphClipboard(legacyPayload ? encodeGraphClipboard(legacyPayload) : '')?.nodes[0]?.kind === 'text' ? true : false).toBe(true);
    const framed = groupSelection(board, ['note'], now);
    if ('error' in framed) throw new Error(framed.error);
    const group = framed.board.nodes.find((node) => node.kind === 'group');
    const groupCopy = group ? selectionClosure(framed.board, [group.id]) : null;
    expect(groupCopy ? encodeGraphClipboard(groupCopy).includes(secret) : true).toBe(false);
    expect(deleteGroupContents(framed.board, group?.id ?? '').nodes.some((node) => node.id === 'note')).toBe(false);
    const archive = await readArchive(await buildArchive(board, [], now));
    if ('error' in archive) throw new Error(archive.error);
    expect(JSON.stringify(archive.board).includes(secret)).toBe(false);
    const imported = archive.board.nodes.find((node) => node.id === 'note');
    expect(imported && isProtectedTextNode(imported) ? (await openProtected(imported.protection, password))?.text : '').toBe(secret);
    expect(ARCHIVE_VERSION).toBe(2);
    expect(GRAPH_CLIPBOARD_VERSION).toBe(1);
    const stale = addNodes(createEmptyBoard(now), [note()], now);
    expect(preferProtectedBoard(stale, board)).toBe(board);
    expect(JSON.stringify(preferProtectedBoard(stale, board)).includes(secret)).toBe(false);
    const migrated = parseBoard({ ...createEmptyBoard(now), schemaVersion: 10, physicsEnabled: false });
    expect(migrated?.schemaVersion).toBe(18);
    expect(migrated?.physicsEnabled).toBe(false);
    expect(migrated?.nodes.every((node) => node.kind !== 'text' || !node.protection)).toBe(true);
    const contours = parseBoard({ ...createEmptyBoard(now), schemaVersion: 7, backgroundPattern: 'topographic-contours', topographicContours: { seed: 4, rendererVersion: 1 } });
    expect(contours?.topographicContours?.rendererVersion).toBe(1);
    const coded = setPresentation(await protectedBoard('const n = 1', 'code'), 'note', 'code', later);
    expect(coded.nodes[0]?.kind === 'text' ? coded.nodes[0].presentation : '').toBe('code');
    expect(effectivePullingForce(true, true, 1)).toBe(false);
    expect(WEBP_OPTIMIZER_V1.quality).toBe(0.82);
    expect(parseBoard({ ...createEmptyBoard(now), nodes: [{ ...note(), protection: payloadFrom(board) }] })).toBeNull();
    const source = await Bun.file(new URL('../components/BoardView.tsx', import.meta.url)).text();
    expect(source.includes('requestProtect(id)')).toBe(true);
    expect(source.includes('if (blockedRef.current) return;')).toBe(true);
    expect(source.includes('forgetUnlocked()')).toBe(true);
  });
});

describe('protected session cleanup', () => {
  test('keyboard deletion clears an unlocked note and undo restores it locked', async () => {
    const board = await protectedBoard();
    const kept = createTextNode({ x: 40, y: 40 }, 'ordinary', now);
    const open = addNodes(board, [kept], now);
    const sessions = new Map<string, { text: string }>([
      ['note', { text: secret }],
      [kept.id, { text: 'ordinary' }],
    ]);
    const removed = deleteSelection(open, ['note'], later);
    const live = new Set(removed.board.nodes.map((node) => node.id));
    expect(forgetRemovedSessions(sessions, live)).toBe(true);
    expect(sessions.has('note')).toBe(false);
    expect(sessions.get(kept.id)?.text).toBe('ordinary');
    expect(JSON.stringify(removed.board).includes(secret)).toBe(false);
    const restored = undoHistory(pushHistory(createHistory(), open), removed.board);
    const noteNode = restored?.board.nodes.find((node) => node.id === 'note');
    expect(noteNode?.kind === 'text' ? noteNode.text : 'x').toBe('');
    expect(noteNode != null && isProtectedTextNode(noteNode)).toBe(true);
    expect(sessions.has('note')).toBe(false);
    const source = await Bun.file(new URL('../components/BoardView.tsx', import.meta.url)).text();
    expect(source.includes("deleteKeyCode={pdfNodeId ? null : ['Backspace', 'Delete']}")).toBe(true);
    expect(source.includes('forgetRemovedSessions(unlockedRef.current, liveIds)')).toBe(true);
  });

  test('deleting a group clears unlocked children and a locked deletion needs no session', async () => {
    const board = await protectedBoard();
    const framed = groupSelection(board, ['note'], now);
    if ('error' in framed) throw new Error(framed.error);
    const group = framed.board.nodes.find((node) => node.kind === 'group');
    const sessions = new Map<string, { text: string }>([['note', { text: secret }]]);
    const cleared = deleteGroupContents(framed.board, group?.id ?? '', later);
    expect(forgetRemovedSessions(sessions, new Set(cleared.nodes.map((node) => node.id)))).toBe(true);
    expect(sessions.has('note')).toBe(false);
    expect(cleared.nodes.some((node) => node.id === 'note')).toBe(false);
    const locked = new Map<string, { text: string }>();
    const deleted = deleteSelection(board, ['note'], later);
    expect(forgetRemovedSessions(locked, new Set(deleted.board.nodes.map((node) => node.id)))).toBe(false);
    expect(deleted.board.nodes.some((node) => node.id === 'note')).toBe(false);
  });

  test('moving a protected note keeps its unlocked session', async () => {
    const board = await protectedBoard();
    const sessions = new Map<string, { text: string }>([['note', { text: secret }]]);
    const moved = placeNode(board, 'note', { x: 80 });
    const movedNote = moved.nodes.find((node) => node.id === 'note');
    expect(movedNote?.x).toBe(80);
    expect(forgetRemovedSessions(sessions, new Set(moved.nodes.map((node) => node.id)))).toBe(false);
    expect(sessions.get('note')?.text).toBe(secret);
  });

  test('an in-flight plaintext save is followed by the protected board', async () => {
    const plain = addNodes(createEmptyBoard(now), [note()], now);
    const database = delayedDatabase(plain);
    let open = plain;
    const statuses: string[] = [];
    const queue = new SaveQueue(database.database, () => open, (status) => statuses.push(status));
    queue.adopt(plain);
    database.hold();
    queue.saveNow();
    await pause();
    const payload = await protectPlaintext(secret, password, fast);
    open = protectTextNode(open, 'note', payload);
    database.release();
    await queue.idle();
    const stored = database.stored();
    expect(stored.nodes.some((node) => isProtectedTextNode(node))).toBe(true);
    expect(JSON.stringify(stored).includes(secret)).toBe(false);
    expect(statuses[statuses.length - 1]).toBe('saved');
    expect(database.puts.length).toBe(2);
  });

  test('a failed protection save keeps the recoverable note and is not reported as saved', async () => {
    const plain = addNodes(createEmptyBoard(now), [note()], now);
    const database = delayedDatabase(plain);
    let open = plain;
    const statuses: string[] = [];
    const messages: string[] = [];
    const queue = new SaveQueue(database.database, () => open, (status, message) => {
      statuses.push(status);
      if (message) messages.push(message);
    });
    queue.adopt(plain);
    database.hold();
    queue.saveNow();
    await pause();
    const payload = await protectPlaintext(secret, password, fast);
    open = protectTextNode(open, 'note', payload);
    database.rejectFollowUp();
    database.release();
    await queue.idle();
    expect(JSON.stringify(database.stored()).includes(secret)).toBe(true);
    expect(database.stored().nodes.some((node) => isProtectedTextNode(node))).toBe(false);
    expect(statuses[statuses.length - 1]).toBe('error');
    expect(statuses.includes('saved')).toBe(false);
    expect(messages[0]).toBe('storage unavailable');
    expect(queue.hasUnpersisted()).toBe(true);
    const source = await Bun.file(new URL('../components/BoardView.tsx', import.meta.url)).text();
    expect(source.includes('Unable to remove password protection because saving failed.')).toBe(true);
    expect(source.includes('Unable to protect because saving failed.')).toBe(true);
  });
});

function pause(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

function delayedDatabase(initial: Board) {
  let stored = initial;
  const puts: Board[] = [];
  let commit: { resolve: () => void; reject: (error: Error) => void } | null = null;
  let rejectFollowUp = false;
  return {
    puts,
    stored: () => stored,
    hold() {
      commit = { resolve() {}, reject() {} };
    },
    release() {
      const pending = commit;
      commit = null;
      pending?.resolve();
    },
    rejectFollowUp() {
      rejectFollowUp = true;
    },
    database: {
      transaction() {
        const pendingCommit = commit;
        let staged: Board | null = null;
        const commitStaged = () => {
          if (!staged) return;
          stored = staged;
          puts.push(staged);
        };
        let resolveDone: () => void = () => {};
        let rejectDone: (error: Error) => void = () => {};
        const finished = new Promise<void>((resolve, reject) => {
          resolveDone = resolve;
          rejectDone = reject;
        });
        if (pendingCommit) {
          pendingCommit.resolve = () => {
            commitStaged();
            resolveDone();
          };
          pendingCommit.reject = rejectDone;
        }
        return {
          objectStore(name: string) {
            if (name === 'board') {
              return {
                get: () => Promise.resolve(stored),
                put: (value: Board) => {
                  staged = value;
                },
              };
            }
            return { put: () => undefined, delete: () => undefined };
          },
          abort() {},
          done: pendingCommit ? finished : {
            then(onFulfilled: () => void, onRejected: (error: Error) => void) {
              if (rejectFollowUp) {
                rejectFollowUp = false;
                onRejected(new Error('storage unavailable'));
                return;
              }
              commitStaged();
              onFulfilled();
            },
          },
        };
      },
    } as unknown as CanvasDatabase,
  };
}

function payloadFrom(board: Board) {
  const node = board.nodes.find((entry) => entry.id === 'note');
  return node && node.kind === 'text' ? node.protection : undefined;
}

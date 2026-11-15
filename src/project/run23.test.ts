import { describe, expect, test } from 'bun:test';
import { unzipSync, zipSync, strToU8 } from 'fflate';
import { ARCHIVE_VERSION } from '../archive/format';
import { buildArchive, readArchive } from '../archive/zip';
import { entryProblem, sha256 } from '../archive/validate';
import {
  addNodes,
  createEmptyBoard,
  createFileNode,
  createTextNode,
  parseBoard,
  referencedAssetIds,
} from '../domain/board';
import { classifyIncomingFile, decodeTextFile, TEXT_IMPORT_LIMIT } from '../domain/files';
import { connectNodes } from '../domain/graph';
import { decodeGraphClipboard, encodeGraphClipboard, pasteGraph, selectionClosure } from '../domain/graph-clipboard';
import { deleteSelection, duplicateSelection, groupSelection } from '../domain/groups';
import { createHistory, pushHistory, redoHistory, retainedAssetIds, undoHistory } from '../domain/history';
import { buildSearchIndex, searchNodes } from '../domain/search';
import { ingestFileList } from '../ingest/browser';
import { planAssetWrite } from '../persistence/db';
import { SaveQueue } from '../persistence/save-queue';
import { buildContentIndex, queryBoard } from '../search/query';
import type { AssetRecord, Board } from '../domain/types';
import { SCHEMA_VERSION } from '../domain/types';

declare const Bun: { file(path: URL): { text(): Promise<string> } };

const now = '2026-11-15T09:00:00.000Z';
const later = '2026-11-15T10:00:00.000Z';

describe('file classification', () => {
  test('routes known text, images, and everything else', async () => {
    const markdown = classifyIncomingFile({ name: 'Notes.MD', size: 4, type: '' });
    expect(markdown.kind).toBe('text');
    expect(markdown.kind === 'text' ? markdown.presentation : '').toBe('markdown');
    const prose = await ingestFileList([new File(['const stay = true;\nexport const n = 1;\n'], 'plain.TXT', { type: 'text/plain' })]);
    expect(prose.items[0]?.type === 'text' ? prose.items[0].presentation : 'code').toBe('text');
    const script = await ingestFileList([
      new File(['const n = 1;\n'], 'app.TS', { type: '' }),
      new File(['def n():\n    return 1\n'], 'app.py', { type: '' }),
      new File(['{"ok":true}\n'], 'app.json', { type: '' }),
      new File(['<p>Hi</p>\n'], 'app.html', { type: '' }),
      new File(['body { color: black; }\n'], 'app.css', { type: '' }),
      new File(['#!/bin/sh\necho hi\n'], 'app.zsh', { type: '' }),
    ]);
    const languages = script.items.map((item) => item.type === 'text' ? item.codeLanguage : '');
    expect(languages).toEqual(['typescript', 'python', 'json', 'html', 'css', 'shell']);
    for (const name of ['.env', '.env.local', 'reference.pdf', 'archive.zip', 'diagram.svg', 'data.csv', 'config.yaml', 'README.rst', 'report.docx']) {
      expect(classifyIncomingFile({ name, size: 8, type: '' }).kind).toBe('file');
    }
    expect(classifyIncomingFile({ name: 'huge.txt', size: TEXT_IMPORT_LIMIT + 1, type: 'text/plain' }).kind).toBe('file');
    expect(classifyIncomingFile({ name: 'huge.pdf', size: 64 * 1024 * 1024 + 1, type: '' }).kind).toBe('reject');
    expect(decodeTextFile(Uint8Array.from([0xef, 0xbb, 0xbf, 0x68, 0x69]))).toBe('hi');
    expect(decodeTextFile(Uint8Array.from([0xff, 0xfe]))).toBeNull();
    expect(decodeTextFile(Uint8Array.from([0x61, 0x00, 0x62]))).toBeNull();
    const broken = await ingestFileList([new File([Uint8Array.from([0xff])], 'broken.txt', { type: 'text/plain' })]);
    expect(broken.items[0]?.type).toBe('file');
    const png = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
    const image = await ingestFileList([new File([png], 'pixel.png', { type: 'image/png' })], { measure: async () => ({ width: 2, height: 2 }) });
    expect(image.items.some((item) => item.type === 'image')).toBe(true);
    const twins = await ingestFileList([
      new File(['same'], 'a.env', { type: '' }),
      new File(['same'], 'b.env', { type: '' }),
    ]);
    expect(twins.items).toHaveLength(2);
  });
});

describe('file nodes', () => {
  test('stores ciphertext-free metadata, groups, links, and a fresh duplicate time', () => {
    expect(SCHEMA_VERSION).toBe(18);
    const file = createFileNode({ center: { x: 40, y: 40 }, assetId: 'asset-1', filename: '.env', now });
    const board = addNodes(createEmptyBoard(now), [file], now);
    const parsed = parseBoard(JSON.parse(JSON.stringify(board)));
    const stored = parsed?.nodes.find((node) => node.kind === 'file');
    expect(stored?.kind === 'file' ? stored.filename : '').toBe('.env');
    expect(stored?.kind === 'file' ? stored.lastEditedAt : '').toBe(now);
    expect(referencedAssetIds(parsed ?? board).has('asset-1')).toBe(true);
    expect(parseBoard({ ...board, nodes: [{ ...file, filename: '../secret.env' }] })).toBeNull();
    const legacy = parseBoard({ ...createEmptyBoard(now), schemaVersion: 11, physicsEnabled: false });
    expect(legacy?.schemaVersion).toBe(18);
    expect(legacy?.physicsEnabled).toBe(false);
    expect(legacy?.nodes.some((node) => node.kind === 'file')).toBe(false);
    const framed = groupSelection(board, [file.id], now);
    if ('error' in framed) throw new Error(framed.error);
    const child = framed.board.nodes.find((node) => node.id === file.id);
    expect(child?.kind === 'file' && child.parentId ? child.parentId.length : 0).toBeGreaterThan(0);
    const other = createTextNode({ x: 300, y: 40 }, 'note', now);
    const linkedBoard = addNodes(board, [other], now);
    const linked = connectNodes(linkedBoard, file.id, other.id, 'right', 'left', now);
    expect(linked?.edges).toHaveLength(1);
    const copied = duplicateSelection(board, [file.id], later);
    const twin = copied.nodes.find((node) => node.id !== file.id && node.kind === 'file');
    expect(twin?.kind === 'file' ? twin.assetId : '').toBe('asset-1');
    expect(twin?.kind === 'file' ? twin.lastEditedAt : '').toBe(later);
    expect(file.lastEditedAt).toBe(now);
  });

  test('keeps shared bytes through delete and undo, and releases the last reference', () => {
    const first = createFileNode({ center: { x: 0, y: 0 }, assetId: 'shared', filename: 'a.pdf', now });
    const second = { ...createFileNode({ center: { x: 80, y: 0 }, assetId: 'shared', filename: 'b.pdf', now }), id: 'second' };
    const board = addNodes(createEmptyBoard(now), [first, second], now);
    const removed = deleteSelection(board, [first.id], later);
    expect(referencedAssetIds(removed.board).has('shared')).toBe(true);
    const history = pushHistory(createHistory(), board);
    const undone = undoHistory(history, removed.board);
    expect(undone?.board.nodes.some((node) => node.id === first.id && node.kind === 'file')).toBe(true);
    expect(retainedAssetIds(removed.board, history).has('shared')).toBe(true);
    const started = pushHistory(createHistory(), board);
    const deleted = deleteSelection(board, [first.id], later);
    const back = undoHistory(started, deleted.board);
    const forward = back ? redoHistory(back.history, back.board) : null;
    expect(forward?.board.nodes.some((node) => node.id === first.id)).toBe(false);
    expect(referencedAssetIds(forward?.board ?? board).has('shared')).toBe(true);
    const again = deleteSelection(board, [first.id, 'second'], later);
    expect(referencedAssetIds(again.board).has('shared')).toBe(false);
    const asset: AssetRecord = { id: 'shared', mimeType: 'application/pdf', byteSize: 4, createdAt: now, blob: new Blob(['pdf']) };
    const plan = planAssetWrite(board, [asset], []);
    expect(plan.upserts.map((entry) => entry.id)).toEqual(['shared']);
    const dropped = planAssetWrite(again.board, [], ['shared']);
    expect(dropped.deleteIds).toEqual(['shared']);
  });

  test('copies a file only when its asset is on the board', () => {
    const file = createFileNode({ center: { x: 10, y: 10 }, assetId: 'asset-1', filename: 'notes.pdf', now });
    const board = addNodes(createEmptyBoard(now), [file], now);
    const payload = selectionClosure(board, [file.id]);
    expect(payload ? encodeGraphClipboard(payload).includes('notes.pdf') : false).toBe(true);
    expect(payload ? encodeGraphClipboard(payload).includes('asset-1') : false).toBe(true);
    const decoded = payload ? decodeGraphClipboard(encodeGraphClipboard(payload)) : null;
    expect(decoded?.nodes[0]?.kind).toBe('file');
    const pasted = decoded ? pasteGraph(createEmptyBoard(now), decoded, { x: 20, y: 20 }, new Set(['asset-1']), 0, later) : null;
    const copy = pasted && !('error' in pasted) ? pasted.nodes.find((node) => node.kind === 'file') : null;
    expect(copy?.kind === 'file' ? copy.assetId : '').toBe('asset-1');
    expect(copy?.kind === 'file' ? copy.lastEditedAt : '').toBe(later);
    const missing = decoded ? pasteGraph(createEmptyBoard(now), decoded, { x: 0, y: 0 }, new Set(), 0, later) : null;
    expect(missing && 'error' in missing ? missing.error : '').toBe('That copy refers to a file that is not on this board.');
    const framed = groupSelection(board, [file.id], now);
    if ('error' in framed) throw new Error(framed.error);
    const group = framed.board.nodes.find((node) => node.kind === 'group');
    const groupCopy = group ? selectionClosure(framed.board, [group.id]) : null;
    expect(groupCopy?.nodes.some((node) => node.kind === 'file')).toBe(true);
  });

  test('finds a file by name and date without indexing its bytes', () => {
    const file = createFileNode({ center: { x: 0, y: 0 }, assetId: 'asset-1', filename: 'harbor.pdf', now });
    const secret = createTextNode({ x: 0, y: 0 }, '', now);
    const protectedNote = { ...secret, id: 'locked', text: '', protection: undefined };
    void protectedNote;
    const board = addNodes(createEmptyBoard(now), [file], now);
    const hits = searchNodes(buildSearchIndex(board.nodes), 'harbor');
    expect(hits[0]?.title).toBe('harbor.pdf');
    expect(hits[0]?.kind).toBe('file');
    const dated = queryBoard(board.nodes, buildContentIndex(board.nodes), '2026', new Date('2026-11-15T12:00:00.000Z'));
    expect(dated.results.some((result) => result.kind === 'file' && result.title === 'harbor.pdf')).toBe(true);
    expect(JSON.stringify(buildSearchIndex(board.nodes)).includes('pdf-bytes')).toBe(false);
  });
});

describe('file archives', () => {
  test('round-trips original bytes, including empty and binary files, and still reads version 1', async () => {
    expect(ARCHIVE_VERSION).toBe(2);
    const bytes = Uint8Array.from([0, 255, 10, 13, 0x80]);
    const empty = new Uint8Array();
    const file = fileOn(createEmptyBoard(now), 'asset-bin', 'report.pdf', now);
    const emptyNode = { ...createFileNode({ center: { x: 80, y: 0 }, assetId: 'asset-empty', filename: 'empty.bin', now }), id: 'empty' };
    const image = {
      id: 'pic',
      kind: 'image' as const,
      x: 200,
      y: 0,
      width: 20,
      height: 20,
      mode: 'aspect' as const,
      intrinsicWidth: 2,
      intrinsicHeight: 2,
      sizedFromImage: true,
      source: { type: 'embedded' as const, assetId: 'asset-png' },
      lastEditedAt: now,
    };
    const board = addNodes(file, [emptyNode, image], now);
    const assets = [
      asset('asset-bin', 'application/pdf', bytes),
      asset('asset-empty', 'application/octet-stream', empty),
      asset('asset-png', 'image/png', Uint8Array.from([137, 80, 78, 71])),
    ];
    const packed = await buildArchive(board, assets, now);
    const opened = await readArchive(packed);
    if ('error' in opened) throw new Error(opened.error);
    expect(opened.summary.files).toBe(2);
    expect(opened.summary.embedded).toBe(1);
    const restored = opened.assets.find((entry) => entry.id === 'asset-bin');
    expect(restored ? [...new Uint8Array(await restored.blob.arrayBuffer())] : []).toEqual([...bytes]);
    const restoredEmpty = opened.assets.find((entry) => entry.id === 'asset-empty');
    expect(restoredEmpty?.byteSize).toBe(0);
    const node = opened.board.nodes.find((entry) => entry.kind === 'file' && entry.assetId === 'asset-bin');
    expect(node?.kind === 'file' ? node.filename : '').toBe('report.pdf');
    const legacy = await readArchive(await versionOne(packed));
    expect('error' in legacy ? legacy.error : 'ok').toBe('ok');
    expect(entryProblem('../assets/secret.bin', 4, new Set(), 0)).toBe('The archive contains an unexpected file.');
    expect(entryProblem('assets/../secret.bin', 4, new Set(), 0)).toBe('The archive contains an unexpected file.');
    expect(entryProblem('assets/foo..bar.bin', 4, new Set(), 0)).toBe('The archive contains an unsafe path.');
    const mismatched = await readArchive(await withBadChecksum(packed));
    expect('error' in mismatched ? mismatched.error : '').toBe('An archived file does not match its checksum.');
    const stripped = await readArchive(await withoutAsset(packed, 'assets/asset-bin.bin'));
    expect('error' in stripped ? stripped.error : '').toContain('missing');
  });

  test('a failed save is not reported as saved', async () => {
    const file = fileOn(createEmptyBoard(now), 'asset-1', 'notes.pdf', now);
    const database = failingDatabase(file);
    const statuses: string[] = [];
    const queue = new SaveQueue(database, () => file, (status) => statuses.push(status));
    queue.adopt(file);
    queue.saveNow();
    await queue.idle();
    expect(statuses[statuses.length - 1]).toBe('error');
    expect(statuses.includes('saved')).toBe(false);
    expect(queue.hasUnpersisted()).toBe(true);
    const source = await Bun.file(new URL('../components/BoardView.tsx', import.meta.url)).text();
    expect(source.includes('if (blockedRef.current) return;')).toBe(true);
    expect(source.includes('downloadBlob(asset.blob, node.filename)')).toBe(true);
  });
});

function fileOn(board: Board, assetId: string, filename: string, stamp: string): Board {
  return addNodes(board, [createFileNode({ center: { x: 0, y: 0 }, assetId, filename, now: stamp })], stamp);
}

function asset(id: string, mimeType: string, bytes: Uint8Array): AssetRecord {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return { id, mimeType, byteSize: copy.byteLength, createdAt: now, blob: new Blob([copy], { type: mimeType }) };
}

async function versionOne(bytes: Uint8Array): Promise<Uint8Array> {
  const files = unzipSync(bytes);
  const manifest = JSON.parse(new TextDecoder().decode(files['manifest.json'] ?? new Uint8Array())) as { archiveVersion: number };
  manifest.archiveVersion = 1;
  files['manifest.json'] = strToU8(JSON.stringify(manifest));
  return zipSync(files);
}

async function withBadChecksum(bytes: Uint8Array): Promise<Uint8Array> {
  const files = unzipSync(bytes);
  const manifest = JSON.parse(new TextDecoder().decode(files['manifest.json'] ?? new Uint8Array())) as { assets: Array<{ path: string; sha256: string }> };
  const target = manifest.assets.find((entry) => entry.path.endsWith('.bin'));
  if (!target) throw new Error('missing bin');
  target.sha256 = await sha256(Uint8Array.from([1]));
  files['manifest.json'] = strToU8(JSON.stringify(manifest));
  return zipSync(files);
}

async function withoutAsset(bytes: Uint8Array, path: string): Promise<Uint8Array> {
  const files = unzipSync(bytes);
  delete files[path];
  return zipSync(files);
}

function failingDatabase(board: Board) {
  return {
    transaction() {
      return {
        objectStore() {
          return { get: () => Promise.resolve(board), put: () => undefined, delete: () => undefined };
        },
        abort() {},
        done: Promise.reject(new Error('storage unavailable')),
      };
    },
  } as unknown as ConstructorParameters<typeof SaveQueue>[0];
}

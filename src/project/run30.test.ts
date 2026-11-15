import { describe, expect, test } from 'bun:test';
import { deflateSync, strToU8, zipSync } from 'fflate';
import { ARCHIVE_VERSION } from '../archive/format';
import { buildArchive, readArchive } from '../archive/zip';
import { crc32 } from '../archive/zip-crc';
import { extractZip } from '../archive/zip-extract';
import { inspectZip } from '../archive/zip-directory';
import {
  addNodes,
  createEmptyBoard,
  createSuitcaseNode,
  createTextNode,
  parseBoard,
  referencedAssetIds,
} from '../domain/board';
import { connectNodes } from '../domain/graph';
import { GRAPH_CLIPBOARD_VERSION, encodeGraphClipboard, pasteGraph, selectionClosure } from '../domain/graph-clipboard';
import { deleteSelection, duplicateSelection, groupSelection } from '../domain/groups';
import { createHistory, pushHistory, redoHistory, retainedAssetIds, undoHistory } from '../domain/history';
import { buildSearchIndex, searchNodes } from '../domain/search';
import { CANVAS_BACKUP_MESSAGE, planUnpack, SUITCASE_FILE_LIMIT } from '../domain/suitcase';
import { classifyXray } from '../domain/xray';
import { ingestFileList } from '../ingest/browser';
import { commitUnpacked, materializeUnpacked } from '../ingest/unpack-board';
import { createAssetRecord } from '../persistence/db';
import { buildContentIndex, queryBoard } from '../search/query';
import { SYNTHETIC_PNG } from './synthetic-png';
import type { AssetRecord, Board } from '../domain/types';
import { SCHEMA_VERSION } from '../domain/types';

declare const Bun: { file(path: URL): { text(): Promise<string> } };

const now = '2026-11-15T09:00:00.000Z';

describe('ZIP suitcase', () => {
  test('stores an ordinary ZIP without unpacking and migrates schema 16', async () => {
    expect(SCHEMA_VERSION).toBe(18);
    expect(ARCHIVE_VERSION).toBe(2);
    expect(GRAPH_CLIPBOARD_VERSION).toBe(1);
    const packed = zipSync({
      'docs/hello.txt': strToU8('hello'),
      'docs/notes.md': strToU8('# Notes'),
      'src/app.ts': strToU8('export const n = 1;\n'),
      'designs/logo.png': SYNTHETIC_PNG,
      'archive/logo.png': SYNTHETIC_PNG,
      'reference.pdf': Uint8Array.from([0x25, 0x50, 0x44, 0x46]),
      'briefing.webm': Uint8Array.from([1, 2, 3, 4]),
      'nested.zip': zipSync({ 'inner.txt': strToU8('inside') }),
    });
    const inspected = inspectZip(packed);
    if ('error' in inspected) throw new Error(inspected.error);
    expect(inspected.listing.fileCount).toBe(8);
    expect(inspected.listing.identity).toBe('ordinary');
    expect(inspected.listing.entries.some((entry) => entry.path === 'docs/hello.txt')).toBe(true);
    const file = new File([packed], 'project-assets.zip', { type: 'application/zip' });
    const bundle = await ingestFileList([file]);
    expect(bundle.items).toHaveLength(1);
    expect(bundle.items[0]?.type).toBe('suitcase');
    expect(bundle.warnings).toHaveLength(0);
    const suitcaseItem = bundle.items[0];
    expect(suitcaseItem?.type === 'suitcase' ? suitcaseItem.fileCount : 0).toBe(8);
    expect(suitcaseItem?.type === 'suitcase' ? await suitcaseItem.blob.arrayBuffer() : null).toEqual(packed.buffer);
    const board = addNodes(createEmptyBoard(now), [createSuitcaseNode({ center: { x: 0, y: 0 }, assetId: 'zip-1', filename: 'project-assets.zip', fileCount: 8, now })], now);
    const parsed = parseBoard(JSON.parse(JSON.stringify(board)));
    expect(parsed?.schemaVersion).toBe(18);
    expect(parsed?.nodes[0]?.kind).toBe('suitcase');
    expect(JSON.stringify(parsed).includes('hello')).toBe(false);
    expect(parseBoard({ ...createEmptyBoard(now), schemaVersion: 16 })?.schemaVersion).toBe(18);
    expect(parseBoard({ ...createEmptyBoard(now), schemaVersion: 2 })?.schemaVersion).toBe(18);
    expect(parseBoard({ ...createEmptyBoard(now), schemaVersion: 19 })).toBeNull();
    expect(parseBoard({ ...board, schemaVersion: 16 })).toBeNull();
    expect(parseBoard(badSuitcase(board, { filename: '../secret.zip' }))).toBeNull();
    expect(parseBoard(badSuitcase(board, { fileCount: -1 }))).toBeNull();
    expect(parseBoard(badSuitcase(board, { fileCount: SUITCASE_FILE_LIMIT + 1 }))).toBeNull();
    expect(parseBoard(badSuitcase(board, { width: 10 }))).toBeNull();
    const emptyZip = inspectZip(zipSync({}));
    expect('listing' in emptyZip ? emptyZip.listing.fileCount : -1).toBe(0);
  });

  test('keeps Canvas backups out of the suitcase path', async () => {
    const backup = zipSync({ 'manifest.json': strToU8(JSON.stringify({ format: 'canvas-board', archiveVersion: 2 })) });
    const renamed = new File([backup], 'backup.zip', { type: 'application/zip' });
    const renamedBundle = await ingestFileList([renamed]);
    expect(renamedBundle.items).toHaveLength(0);
    expect(renamedBundle.warnings[0]).toBe(CANVAS_BACKUP_MESSAGE);
    const named = new File([zipSync({ 'docs/a.txt': strToU8('a') })], 'board.canvas.zip', { type: 'application/zip' });
    const namedBundle = await ingestFileList([named]);
    expect(namedBundle.items).toHaveLength(0);
    expect(namedBundle.warnings[0]).toBe(CANVAS_BACKUP_MESSAGE);
    const unrelated = zipSync({ 'manifest.json': strToU8(JSON.stringify({ format: 'notes', title: 'unrelated' })), 'docs/a.txt': strToU8('a') });
    const ordinary = await ingestFileList([new File([unrelated], 'research.zip', { type: 'application/zip' })]);
    expect(ordinary.items[0]?.type).toBe('suitcase');
    const unrelatedListing = inspectZip(unrelated);
    expect('listing' in unrelatedListing ? unrelatedListing.listing.identity : '').toBe('ordinary');
    const source = await Bun.file(new URL('../components/BoardView.tsx', import.meta.url)).text();
    expect(source.includes('readArchive(')).toBe(true);
  });

  test('lists folders without decompressing and rejects unsafe archives', () => {
    const hello = strToU8('hello');
    const packed = zipSync({ 'docs/hello.txt': hello, 'docs/': new Uint8Array(), 'archive/logo.png': SYNTHETIC_PNG });
    const listed = inspectZip(packed);
    if ('error' in listed) throw new Error(listed.error);
    expect(listed.listing.entries.some((entry) => entry.path === 'docs/hello.txt' && entry.uncompressedSize === 5)).toBe(true);
    expect(listed.listing.entries.filter((entry) => entry.path.endsWith('logo.png'))).toHaveLength(1);
    const corrupt = buildZip([{ name: 'docs/hello.txt', method: 8, compressed: Uint8Array.from([1, 2, 3, 4, 5, 6, 7]), uncompressedSize: 5, crc: crc32(hello) }]);
    expect('listing' in inspectZip(corrupt)).toBe(true);
    expect('error' in extractZip(corrupt, ['docs/hello.txt'])).toBe(true);
    expect(zipError(inspectZip(buildZip([{ name: '../secret.txt', data: hello }])))).toBe('This ZIP path is unsafe.');
    expect(zipError(inspectZip(buildZip([{ name: '/etc/passwd', data: hello }])))).toBe('This ZIP path is unsafe.');
    expect(zipError(inspectZip(buildZip([{ name: 'C:/secret.txt', data: hello }])))).toBe('This ZIP path is unsafe.');
    expect(zipError(inspectZip(buildZip([{ name: '\\\\server\\share.txt', data: hello }])))).toBe('This ZIP path is unsafe.');
    expect(zipError(inspectZip(buildZip([{ name: 'notes\\secret.txt', data: hello }])))).toBe('This ZIP path is unsafe.');
    expect(zipError(inspectZip(buildZip([{ name: 'bad\u0000name.txt', data: hello }])))).toBe('This ZIP path is unsafe.');
    expect(zipError(inspectZip(buildZip([{ name: `${'a/'.repeat(20)}file.txt`, data: hello }])))).toBe('This ZIP path is unsafe.');
    expect(zipError(inspectZip(buildZip([{ name: `${'a'.repeat(513)}.txt`, data: hello }])))).toBe('This ZIP path is unsafe.');
    const link = inspectZip(buildZip([{ name: 'link.txt', data: strToU8('target'), madeBy: 0x0314, external: 0o120000 << 16 }]));
    expect('listing' in link ? link.listing.entries[0]?.reason : '').toBe('link');
    expect('listing' in link ? link.listing.entries[0]?.extractable : true).toBe(false);
    expect(zipError(inspectZip(buildZip([{ name: 'secret.txt', data: hello, flags: 1 }])))).toContain('encrypted');
    const method = inspectZip(buildZip([{ name: 'odd.bin', data: hello, method: 12 }]));
    expect('listing' in method ? method.listing.entries[0]?.reason : '').toBe('method');
    expect(zipError(inspectZip(Uint8Array.from([1, 2, 3, 4])))).toBe('This ZIP is not valid.');
    expect(zipError(inspectZip(buildZip([{ name: 'a.txt', data: hello, method: 8, localMethod: 0 }])))).toBe('This ZIP is not valid.');
    const tampered = buildZip([{ name: 'a.txt', data: hello, crc: 1 }]);
    expect(zipError(extractZip(tampered, ['a.txt']))).toBe('This ZIP entry failed its integrity check.');
    const bomb = deflateSync(new Uint8Array(50_000));
    const lied = buildZip([{ name: 'bomb.bin', method: 8, compressed: bomb, uncompressedSize: 32, crc: 0 }]);
    expect(zipError(extractZip(lied, ['bomb.bin']))).toBe('This ZIP entry is larger than its declared size.');
    expect(zipError(inspectZip(buildZip([{ name: 'big.bin', data: hello, uncompressedSize: 1024 * 1024, compressedSize: 1 }])))).toContain('expands too much');
    const spanned = buildZip([{ name: 'a.txt', data: hello }]);
    spanned[spanned.length - 18] = 1;
    expect(zipError(inspectZip(spanned))).toContain('volumes');
    const zip64 = buildZip([{ name: 'a.txt', data: hello }]);
    zip64[zip64.length - 6] = 0xff;
    zip64[zip64.length - 5] = 0xff;
    zip64[zip64.length - 4] = 0xff;
    zip64[zip64.length - 3] = 0xff;
    expect(zipError(inspectZip(zip64))).toContain('ZIP64');
  });

  test('unpacks supported files atomically and keeps the original archive', () => {
    const entries = [
      { path: 'docs/hello.txt', bytes: strToU8('hello') },
      { path: 'docs/notes.md', bytes: strToU8('# Notes') },
      { path: 'src/app.ts', bytes: strToU8('export const n = 1;\n') },
      { path: 'designs/logo.png', bytes: SYNTHETIC_PNG },
      { path: 'archive/logo.png', bytes: SYNTHETIC_PNG },
      { path: 'reference.pdf', bytes: Uint8Array.from([0x25, 0x50, 0x44, 0x46]) },
      { path: 'briefing.webm', bytes: Uint8Array.from([1, 2, 3, 4]) },
      { path: 'nested.zip', bytes: zipSync({ 'inner.txt': strToU8('inside') }) },
    ];
    const materialized = materializeUnpacked(entries);
    if ('error' in materialized) throw new Error(materialized.error);
    const text = materialized.pieces.find((piece) => piece.path === 'docs/hello.txt');
    const markdown = materialized.pieces.find((piece) => piece.path === 'docs/notes.md');
    const code = materialized.pieces.find((piece) => piece.path === 'src/app.ts');
    const image = materialized.pieces.find((piece) => piece.path === 'designs/logo.png');
    const pdf = materialized.pieces.find((piece) => piece.path === 'reference.pdf');
    const audio = materialized.pieces.find((piece) => piece.path === 'briefing.webm');
    const nested = materialized.pieces.find((piece) => piece.path === 'nested.zip');
    expect(text?.kind).toBe('text');
    expect(markdown?.kind === 'text' ? markdown.presentation : '').toBe('markdown');
    expect(code?.kind === 'text' ? code.presentation : '').toBe('code');
    expect(image?.kind).toBe('image');
    expect(pdf?.kind).toBe('file');
    expect(audio?.kind).toBe('file');
    expect(nested?.kind).toBe('file');
    const base = suitcaseBoard();
    const grouped = commitUnpacked({ board: base.board, suitcaseId: base.id, pieces: materialized.pieces, group: true, now, assets: [base.asset] });
    if ('error' in grouped) throw new Error(grouped.error);
    expect(grouped.board.nodes.some((node) => node.kind === 'group' && node.label === 'From project-assets.zip')).toBe(true);
    expect(grouped.board.nodes.filter((node) => (node.kind === 'file' || node.kind === 'image') && 'sourcePath' in node && node.sourcePath?.endsWith('logo.png'))).toHaveLength(2);
    expect(grouped.board.nodes.some((node) => node.kind === 'voice')).toBe(false);
    expect(grouped.board.nodes.some((node) => node.kind === 'suitcase')).toBe(true);
    const history = pushHistory(createHistory(), base.board);
    const undone = undoHistory(history, grouped.board);
    expect(undone?.board.nodes.filter((node) => node.kind !== 'suitcase')).toHaveLength(0);
    const redone = undone ? redoHistory(undone.history, undone.board) : null;
    expect(redone?.board.nodes.some((node) => node.kind === 'image')).toBe(true);
    expect(retainedAssetIds(grouped.board, history).has(base.asset.id)).toBe(true);
    const loose = commitUnpacked({ board: base.board, suitcaseId: base.id, pieces: materialized.pieces.slice(0, 1), group: false, now, assets: [base.asset] });
    expect('error' in loose ? '' : loose.board.nodes.filter((node) => node.kind === 'group')).toHaveLength(0);
    const removedZip = deleteSelection(grouped.board, [base.id], now);
    expect(removedZip.board.nodes.some((node) => node.kind === 'text')).toBe(true);
    expect(removedZip.board.nodes.some((node) => node.kind === 'suitcase')).toBe(false);
    const removedText = deleteSelection(grouped.board, grouped.board.nodes.filter((node) => node.kind === 'text').map((node) => node.id), now);
    expect(removedText.board.nodes.some((node) => node.kind === 'suitcase')).toBe(true);
    expect(zipError(planUnpack([{ path: 'a.txt', uncompressedSize: 1, extractable: false }], 'all'))).toContain('Unpack all');
    expect(zipError(planUnpack(Array.from({ length: 101 }, (_, index) => ({ path: `f${index}.txt`, uncompressedSize: 1, extractable: true })), 'selected'))).toContain('100');
  });

  test('round-trips the suitcase through history, clipboard, search, and ZIP v2', async () => {
    const packed = zipSync({ 'docs/hello.txt': strToU8('hello') });
    const asset = createAssetRecord(new Blob([packed], { type: 'application/zip' }), 'application/zip', now);
    const board = addNodes(createEmptyBoard(now), [createSuitcaseNode({ center: { x: 10, y: 10 }, assetId: asset.id, filename: 'project-assets.zip', fileCount: 1, now })], now);
    const suitcase = board.nodes.find((node) => node.kind === 'suitcase');
    if (!suitcase || suitcase.kind !== 'suitcase') throw new Error('missing suitcase');
    const copied = duplicateSelection(board, [suitcase.id], now);
    const twins = copied.nodes.filter((node) => node.kind === 'suitcase');
    expect(twins).toHaveLength(2);
    expect(twins.every((node) => node.kind === 'suitcase' && node.assetId === asset.id)).toBe(true);
    const one = deleteSelection(copied, [twins[0]!.id], now);
    expect(one.removedAssetIds).toHaveLength(0);
    expect(referencedAssetIds(one.board).has(asset.id)).toBe(true);
    const history = pushHistory(createHistory(), board);
    const removed = deleteSelection(board, [suitcase.id], now);
    expect(retainedAssetIds(removed.board, history).has(asset.id)).toBe(true);
    const restored = undoHistory(history, removed.board);
    expect(restored?.board.nodes.some((node) => node.kind === 'suitcase' && node.assetId === asset.id)).toBe(true);
    const grouped = groupSelection(board, [suitcase.id], now);
    expect('error' in grouped ? grouped.error : grouped.board.nodes.find((node) => node.kind === 'suitcase')?.assetId).toBe(asset.id);
    const text = createTextNode({ x: 400, y: 20 }, 'Pier', now);
    const linked = connectNodes(addNodes(board, [text], now), suitcase.id, text.id, 'right', 'left', now);
    expect(linked?.edges).toHaveLength(1);
    const closure = selectionClosure(board, [suitcase.id]);
    const encoded = closure ? encodeGraphClipboard(closure) : '';
    expect(encoded.includes('hello')).toBe(false);
    const pasted = closure ? pasteGraph(board, closure, { x: 30, y: 30 }, new Set([asset.id]), 0, now) : null;
    const pastedNodes = pasted && !('error' in pasted) ? pasted.nodes.filter((node) => node.kind === 'suitcase') : [];
    expect(pastedNodes).toHaveLength(2);
    const rejected = closure ? pasteGraph(createEmptyBoard(now), closure, { x: 0, y: 0 }, new Set(), 0, now) : null;
    expect(rejected && 'error' in rejected ? rejected.error : '').toBe('That copy refers to a ZIP that is not on this board.');
    expect(searchNodes(buildSearchIndex(board.nodes), 'project-assets').map((hit) => hit.kind)).toEqual(['suitcase']);
    const dated = queryBoard(board.nodes, buildContentIndex(board.nodes), 'Nov 15, 2026', new Date('2026-11-15T12:00:00.000Z'));
    expect(dated.matchIds).toContain(suitcase.id);
    const scene = classifyXray({
      nodes: linked?.nodes.map((node) => ({ id: node.id, parentId: 'parentId' in node ? node.parentId : undefined })) ?? [],
      edges: linked?.edges.map((edge) => ({ id: edge.id, sourceId: edge.sourceId, targetId: edge.targetId })) ?? [],
      matchIds: [suitcase.id],
      enabled: true,
      showConnections: true,
      active: true,
    });
    expect(scene.nodes.get(suitcase.id)).toBe('match');
    expect(scene.nodes.get(text.id)).toBe('context');
    const opened = await readArchive(await buildArchive(board, [asset], now));
    if ('error' in opened) throw new Error(opened.error);
    expect(opened.summary.suitcases).toBe(1);
    const restoredZip = opened.assets.find((entry) => entry.id === asset.id);
    expect(restoredZip ? [...new Uint8Array(await restoredZip.blob.arrayBuffer())] : []).toEqual([...packed]);
    const tampered = await readArchive(await withBadChecksum(await buildArchive(board, [asset], now)));
    expect('error' in tampered ? tampered.error : '').toBe('An archived file does not match its checksum.');
    const view = await Bun.file(new URL('../components/SuitcaseExplorer.tsx', import.meta.url)).text();
    expect(view.includes('This tab can browse and download the ZIP. Unpacking is off.')).toBe(true);
    expect(view.includes('disabled={readOnly || busy}')).toBe(true);
  });
});

function zipError(result: object): string {
  return 'error' in result && typeof result.error === 'string' ? result.error : '';
}

function suitcaseBoard(): { board: Board; id: string; asset: AssetRecord } {
  const asset = createAssetRecord(new Blob(['zip']), 'application/zip', now);
  const node = createSuitcaseNode({ center: { x: 0, y: 0 }, assetId: asset.id, filename: 'project-assets.zip', fileCount: 1, now });
  return { board: addNodes(createEmptyBoard(now), [node], now), id: node.id, asset };
}

function badSuitcase(board: Board, patch: Record<string, unknown>): Board {
  return { ...board, nodes: board.nodes.map((node) => node.kind === 'suitcase' ? { ...node, ...patch } : node) };
}

type BuiltEntry = {
  name: string;
  data?: Uint8Array;
  compressed?: Uint8Array;
  method?: number;
  flags?: number;
  crc?: number;
  uncompressedSize?: number;
  compressedSize?: number;
  madeBy?: number;
  external?: number;
  localMethod?: number;
};

function buildZip(entries: BuiltEntry[]): Uint8Array {
  const locals: Uint8Array[] = [];
  const centrals: Uint8Array[] = [];
  let offset = 0;
  for (const entry of entries) {
    const name = new TextEncoder().encode(entry.name);
    const compressed = entry.compressed ?? entry.data ?? new Uint8Array();
    const method = entry.method ?? 0;
    const crc = entry.crc ?? crc32(entry.data ?? compressed);
    const uncompressedSize = entry.uncompressedSize ?? (entry.data ?? compressed).byteLength;
    const local = header(0x04034b50, entry.flags ?? 0, entry.localMethod ?? method, crc, compressed.byteLength, uncompressedSize, name, entry.madeBy ?? 20, 0);
    locals.push(local, compressed);
    centrals.push(header(0x02014b50, entry.flags ?? 0, method, crc, entry.compressedSize ?? compressed.byteLength, uncompressedSize, name, entry.madeBy ?? 20, entry.external ?? 0, offset));
    offset += local.byteLength + compressed.byteLength;
  }
  const central = concat(centrals);
  const eocd = new Uint8Array(22);
  const view = new DataView(eocd.buffer);
  view.setUint32(0, 0x06054b50, true);
  view.setUint16(8, entries.length, true);
  view.setUint16(10, entries.length, true);
  view.setUint32(12, central.byteLength, true);
  view.setUint32(16, offset, true);
  return concat([...locals, central, eocd]);
}

function header(signature: number, flags: number, method: number, crc: number, compressedSize: number, uncompressedSize: number, name: Uint8Array, madeBy: number, external: number, localOffset = 0): Uint8Array {
  const bytes = new Uint8Array(signature === 0x02014b50 ? 46 + name.byteLength : 30 + name.byteLength);
  const view = new DataView(bytes.buffer);
  view.setUint32(0, signature, true);
  if (signature === 0x02014b50) {
    view.setUint16(4, madeBy, true);
    view.setUint16(6, 20, true);
    view.setUint16(8, flags, true);
    view.setUint16(10, method, true);
    view.setUint32(16, crc, true);
    view.setUint32(20, compressedSize, true);
    view.setUint32(24, uncompressedSize, true);
    view.setUint16(28, name.byteLength, true);
    view.setUint32(38, external, true);
    view.setUint32(42, localOffset, true);
    bytes.set(name, 46);
  } else {
    view.setUint16(4, 20, true);
    view.setUint16(6, flags, true);
    view.setUint16(8, method, true);
    view.setUint32(14, crc, true);
    view.setUint32(18, compressedSize, true);
    view.setUint32(22, uncompressedSize, true);
    view.setUint16(26, name.byteLength, true);
    bytes.set(name, 30);
  }
  return bytes;
}

function concat(parts: Uint8Array[]): Uint8Array {
  const size = parts.reduce((sum, part) => sum + part.byteLength, 0);
  const out = new Uint8Array(size);
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.byteLength;
  }
  return out;
}

async function withBadChecksum(bytes: Uint8Array): Promise<Uint8Array> {
  const { unzipSync, zipSync: pack, strToU8: text } = await import('fflate');
  const { sha256 } = await import('../archive/validate');
  const files = unzipSync(bytes);
  const manifest = JSON.parse(new TextDecoder().decode(files['manifest.json'] ?? new Uint8Array())) as { assets: Array<{ path: string; sha256: string }> };
  const target = manifest.assets.find((entry) => entry.path.endsWith('.bin'));
  if (!target) throw new Error('missing suitcase');
  target.sha256 = await sha256(Uint8Array.from([1]));
  files['manifest.json'] = text(JSON.stringify(manifest));
  return pack(files);
}

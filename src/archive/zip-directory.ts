import { ARCHIVE_FORMAT } from './format';
import { crc32 } from './zip-crc';
import { inflateBounded } from './zip-inflate';
import { canonicalZipPath, zipPathProblem } from '../domain/zip-paths';
import {
  SUITCASE_ARCHIVE_BYTES,
  SUITCASE_DECLARED_BYTES,
  SUITCASE_ENTRY_BYTES,
  SUITCASE_FILE_LIMIT,
  SUITCASE_RATIO,
  SUITCASE_RATIO_FLOOR,
} from '../domain/suitcase';

const CP437 = '\u00c7\u00fc\u00e9\u00e2\u00e4\u00e0\u00e5\u00e7\u00ea\u00eb\u00e8\u00ef\u00ee\u00ec\u00c4\u00c5\u00c9\u00e6\u00c6\u00f4\u00f6\u00f2\u00fb\u00f9\u00ff\u00d6\u00dc\u00a2\u00a3\u00a5\u20a7\u0192\u00e1\u00ed\u00f3\u00fa\u00f1\u00d1\u00aa\u00ba\u00bf\u2310\u00ac\u00bd\u00bc\u00a1\u00ab\u00bb\u2591\u2592\u2593\u2502\u2524\u2561\u2562\u2556\u2555\u2563\u2551\u2557\u255d\u255c\u255b\u2510\u2514\u2534\u252c\u251c\u2500\u253c\u255e\u255f\u255a\u2554\u2569\u2566\u2560\u2550\u256c\u2567\u2568\u2564\u2565\u2559\u2558\u2552\u2553\u256b\u256a\u2518\u250c\u2588\u2584\u258c\u2590\u2580\u03b1\u00df\u0393\u03c0\u03a3\u03c3\u00b5\u03c4\u03a6\u0398\u03a9\u03b4\u221e\u03c6\u03b5\u2229\u2261\u00b1\u2265\u2264\u2320\u2321\u00f7\u2248\u00b0\u2219\u00b7\u221a\u207f\u00b2\u25a0\u00a0';

export type ZipListingEntry = {
  path: string;
  directory: boolean;
  method: number;
  compressedSize: number;
  uncompressedSize: number;
  crc32: number;
  localOffset: number;
  extractable: boolean;
  reason: string | null;
};

export type ZipListing = {
  entries: ZipListingEntry[];
  fileCount: number;
  declaredBytes: number;
  identity: 'ordinary' | 'canvas-board';
};

export function inspectZip(bytes: Uint8Array): { listing: ZipListing } | { error: string } {
  if (bytes.byteLength > SUITCASE_ARCHIVE_BYTES) return { error: 'This ZIP is too large to open.' };
  const eocd = findEocd(bytes);
  if ('error' in eocd) return eocd;
  const parsed = readCentralDirectory(bytes, eocd);
  if ('error' in parsed) return parsed;
  const identity = classifyIdentity(bytes, parsed);
  if ('error' in identity) return identity;
  const fileCount = parsed.filter((entry) => !entry.directory).length;
  const declaredBytes = parsed.reduce((sum, entry) => sum + entry.uncompressedSize, 0);
  return { listing: { entries: parsed, fileCount, declaredBytes, identity: identity.identity } };
}

export function readLocalPayload(bytes: Uint8Array, entry: ZipListingEntry): { data: Uint8Array } | { error: string } {
  if (entry.localOffset < 0 || entry.localOffset + 30 > bytes.byteLength) return { error: 'This ZIP is not valid.' };
  if (readU32(bytes, entry.localOffset) !== 0x04034b50) return { error: 'This ZIP is not valid.' };
  const flags = readU16(bytes, entry.localOffset + 6);
  const method = readU16(bytes, entry.localOffset + 8);
  const compressedSize = readU32(bytes, entry.localOffset + 18);
  const uncompressedSize = readU32(bytes, entry.localOffset + 22);
  const nameLength = readU16(bytes, entry.localOffset + 26);
  const extraLength = readU16(bytes, entry.localOffset + 28);
  const nameStart = entry.localOffset + 30;
  const dataStart = nameStart + nameLength + extraLength;
  if (nameLength > ZIP_NAME_BYTES || dataStart > bytes.byteLength) return { error: 'This ZIP is not valid.' };
  const name = decodeName(bytes.subarray(nameStart, nameStart + nameLength), (flags & 0x800) !== 0);
  if (!name || canonicalZipPath(name) !== entry.path) return { error: 'This ZIP is not valid.' };
  if (method !== entry.method) return { error: 'This ZIP is not valid.' };
  const described = (flags & 0x8) === 0;
  if (described && (compressedSize !== entry.compressedSize || uncompressedSize !== entry.uncompressedSize)) {
    return { error: 'This ZIP is not valid.' };
  }
  if (dataStart + entry.compressedSize > bytes.byteLength) return { error: 'This ZIP is not valid.' };
  return { data: bytes.subarray(dataStart, dataStart + entry.compressedSize) };
}

type Eocd = { entries: number; size: number; offset: number };

const ZIP_NAME_BYTES = 1024;

function findEocd(bytes: Uint8Array): Eocd | { error: string } {
  if (bytes.byteLength < 22) return { error: 'This ZIP is not valid.' };
  const start = Math.max(0, bytes.byteLength - 65535 - 22);
  for (let offset = bytes.byteLength - 22; offset >= start; offset -= 1) {
    if (readU32(bytes, offset) !== 0x06054b50) continue;
    const comment = readU16(bytes, offset + 20);
    if (offset + 22 + comment !== bytes.byteLength) continue;
    const disk = readU16(bytes, offset + 4);
    const cdDisk = readU16(bytes, offset + 6);
    const onDisk = readU16(bytes, offset + 8);
    const entries = readU16(bytes, offset + 10);
    const size = readU32(bytes, offset + 12);
    const cdOffset = readU32(bytes, offset + 16);
    if (disk !== 0 || cdDisk !== 0) return { error: 'This ZIP spans multiple volumes, which is not supported.' };
    if (onDisk === 0xffff || entries === 0xffff || size === 0xffffffff || cdOffset === 0xffffffff) {
      return { error: 'This ZIP uses ZIP64, which is not supported.' };
    }
    if (onDisk !== entries) return { error: 'This ZIP is not valid.' };
    if (entries > SUITCASE_FILE_LIMIT) return { error: 'This ZIP has too many files.' };
    if (cdOffset > bytes.byteLength || size > bytes.byteLength - cdOffset || cdOffset + size > offset) {
      return { error: 'This ZIP is not valid.' };
    }
    return { entries, size, offset: cdOffset };
  }
  return { error: 'This ZIP is not valid.' };
}

function readCentralDirectory(bytes: Uint8Array, eocd: Eocd): ZipListingEntry[] | { error: string } {
  const entries: ZipListingEntry[] = [];
  const seen = new Set<string>();
  let cursor = eocd.offset;
  const end = eocd.offset + eocd.size;
  let declared = 0;
  for (let index = 0; index < eocd.entries; index += 1) {
    if (cursor + 46 > end) return { error: 'This ZIP is not valid.' };
    if (readU32(bytes, cursor) !== 0x02014b50) return { error: 'This ZIP is not valid.' };
    const madeBy = readU16(bytes, cursor + 4);
    const flags = readU16(bytes, cursor + 8);
    const method = readU16(bytes, cursor + 10);
    const crc = readU32(bytes, cursor + 16);
    const compressedSize = readU32(bytes, cursor + 20);
    const uncompressedSize = readU32(bytes, cursor + 24);
    const nameLength = readU16(bytes, cursor + 28);
    const extraLength = readU16(bytes, cursor + 30);
    const commentLength = readU16(bytes, cursor + 32);
    const localOffset = readU32(bytes, cursor + 42);
    const external = readU32(bytes, cursor + 38);
    const nameStart = cursor + 46;
    const next = nameStart + nameLength + extraLength + commentLength;
    if (nameLength > ZIP_NAME_BYTES || next > end) return { error: 'This ZIP is not valid.' };
    if ((flags & 0x1) !== 0) return { error: 'This ZIP is encrypted and cannot be opened.' };
    if ((flags & 0x40) !== 0) return { error: 'This ZIP uses strong encryption, which is not supported.' };
    const decoded = decodeName(bytes.subarray(nameStart, nameStart + nameLength), (flags & 0x800) !== 0);
    if (!decoded) return { error: 'This ZIP path is unsafe.' };
    const path = canonicalZipPath(decoded);
    if (zipPathProblem(path)) return { error: 'This ZIP path is unsafe.' };
    if (seen.has(path)) return { error: 'This ZIP path is unsafe.' };
    seen.add(path);
    const special = specialKind(madeBy, external, path);
    const directory = special === 'directory' || path.endsWith('/');
    if (directory && (uncompressedSize !== 0 || compressedSize > 64)) return { error: 'This ZIP is not valid.' };
    if (!directory && uncompressedSize > SUITCASE_ENTRY_BYTES) return { error: 'A ZIP entry is too large to unpack.' };
    if (compressedSize > bytes.byteLength) return { error: 'This ZIP is not valid.' };
    if (uncompressedSize > SUITCASE_RATIO_FLOOR && uncompressedSize / Math.max(compressedSize, 1) > SUITCASE_RATIO) {
      return { error: 'This ZIP expands too much to open.' };
    }
    declared += uncompressedSize;
    if (declared > SUITCASE_DECLARED_BYTES) return { error: 'This ZIP expands too much to open.' };
    const supported = method === 0 || method === 8;
    const extractable = !directory && special === 'file' && supported;
    const reason = directory ? null : special === 'link' ? 'link' : special === 'special' ? 'special' : supported ? null : 'method';
    const listed: ZipListingEntry = {
      path,
      directory,
      method,
      compressedSize,
      uncompressedSize,
      crc32: crc,
      localOffset,
      extractable,
      reason,
    };
    const local = readLocalPayload(bytes, listed);
    if ('error' in local) return local;
    entries.push(listed);
    cursor = next;
  }
  if (cursor !== end) return { error: 'This ZIP is not valid.' };
  return entries;
}

function classifyIdentity(bytes: Uint8Array, entries: readonly ZipListingEntry[]): { identity: 'ordinary' | 'canvas-board' } | { error: string } {
  const manifest = entries.find((entry) => entry.path === 'manifest.json' && !entry.directory);
  if (!manifest) return { identity: 'ordinary' };
  if (!manifest.extractable || manifest.uncompressedSize > 1024 * 1024) return { error: 'This ZIP could not be identified.' };
  const payload = readLocalPayload(bytes, manifest);
  if ('error' in payload) return payload;
  const inflated = expand(payload.data, manifest);
  if ('error' in inflated) return { error: 'This ZIP could not be identified.' };
  try {
    const parsed = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(inflated.data)) as { format?: unknown };
    return { identity: parsed.format === ARCHIVE_FORMAT ? 'canvas-board' : 'ordinary' };
  } catch {
    return { identity: 'ordinary' };
  }
}

function expand(data: Uint8Array, entry: ZipListingEntry): { data: Uint8Array } | { error: string } {
  if (entry.method === 0) {
    if (data.byteLength !== entry.uncompressedSize) return { error: 'This ZIP is not valid.' };
    return { data };
  }
  const inflated = inflateBounded(data, entry.uncompressedSize);
  if (inflated === 'overflow' || inflated === 'corrupt') return { error: 'This ZIP is not valid.' };
  if (inflated.byteLength !== entry.uncompressedSize || crc32(inflated) !== entry.crc32) return { error: 'This ZIP is not valid.' };
  return { data: inflated };
}

function specialKind(madeBy: number, external: number, path: string): 'file' | 'directory' | 'link' | 'special' {
  if ((madeBy >>> 8) === 3) {
    const mode = (external >>> 16) & 0o170000;
    if (mode === 0o120000) return 'link';
    if (mode === 0o040000) return 'directory';
    if (mode === 0o100000 || mode === 0) return path.endsWith('/') ? 'directory' : 'file';
    if (mode === 0o010000 || mode === 0o020000 || mode === 0o060000 || mode === 0o140000) return 'special';
  }
  if ((external & 0x10) !== 0 || path.endsWith('/')) return 'directory';
  return 'file';
}

function decodeName(bytes: Uint8Array, utf8: boolean): string | null {
  if (utf8) {
    try {
      return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    } catch {
      return null;
    }
  }
  let text = '';
  for (const byte of bytes) {
    if (byte < 128) text += String.fromCharCode(byte);
    else {
      const mapped = CP437[byte - 128];
      if (!mapped) return null;
      text += mapped;
    }
  }
  return text;
}

function readU16(bytes: Uint8Array, offset: number): number {
  return bytes[offset]! | (bytes[offset + 1]! << 8);
}

function readU32(bytes: Uint8Array, offset: number): number {
  return (bytes[offset]! | (bytes[offset + 1]! << 8) | (bytes[offset + 2]! << 16) | (bytes[offset + 3]! << 24)) >>> 0;
}

import { crc32 } from './zip-crc';
import { inflateBounded } from './zip-inflate';
import { inspectZip, readLocalPayload, type ZipListingEntry } from './zip-directory';
import { SUITCASE_ENTRY_BYTES, SUITCASE_UNPACK_BYTES, SUITCASE_UNPACK_FILES } from '../domain/suitcase';

export type ExtractedZipEntry = {
  path: string;
  bytes: Uint8Array;
};

export function extractZip(archive: Uint8Array, paths: readonly string[]): { entries: ExtractedZipEntry[] } | { error: string } {
  if (paths.length === 0) return { error: 'Select a file to unpack.' };
  if (paths.length > SUITCASE_UNPACK_FILES) return { error: 'Select 100 or fewer files.' };
  const inspected = inspectZip(archive);
  if ('error' in inspected) return inspected;
  if (inspected.listing.identity === 'canvas-board') return { error: 'This is a Canvas board backup. Use Project → Import to open it.' };
  const wanted = new Set(paths);
  if (wanted.size !== paths.length) return { error: 'That selection lists the same file twice.' };
  const byPath = new Map(inspected.listing.entries.map((entry) => [entry.path, entry]));
  let budget = 0;
  const chosen: ZipListingEntry[] = [];
  for (const path of paths) {
    const entry = byPath.get(path);
    if (!entry || entry.directory) return { error: 'That file is not in this ZIP.' };
    if (!entry.extractable) return { error: entry.reason === 'method' ? 'That file uses an unsupported compression method.' : 'That file cannot be unpacked.' };
    budget += entry.uncompressedSize;
    if (entry.uncompressedSize > SUITCASE_ENTRY_BYTES || budget > SUITCASE_UNPACK_BYTES) return { error: 'Select fewer files. That unpack is too large.' };
    chosen.push(entry);
  }
  const entries: ExtractedZipEntry[] = [];
  for (const entry of chosen) {
    const payload = readLocalPayload(archive, entry);
    if ('error' in payload) return payload;
    const expanded = expandEntry(payload.data, entry);
    if ('error' in expanded) return expanded;
    entries.push({ path: entry.path, bytes: expanded.data });
  }
  return { entries };
}

function expandEntry(data: Uint8Array, entry: ZipListingEntry): { data: Uint8Array } | { error: string } {
  const limit = Math.min(entry.uncompressedSize, SUITCASE_ENTRY_BYTES);
  if (entry.method === 0) {
    if (data.byteLength !== entry.uncompressedSize) return { error: 'This ZIP entry is larger than its declared size.' };
    if (crc32(data) !== entry.crc32) return { error: 'This ZIP entry failed its integrity check.' };
    return { data: copyBytes(data) };
  }
  const inflated = inflateBounded(data, limit);
  if (inflated === 'overflow') return { error: 'This ZIP entry is larger than its declared size.' };
  if (inflated === 'corrupt') return { error: 'This ZIP entry failed its integrity check.' };
  if (inflated.byteLength !== entry.uncompressedSize) return { error: 'This ZIP entry is larger than its declared size.' };
  if (crc32(inflated) !== entry.crc32) return { error: 'This ZIP entry failed its integrity check.' };
  return { data: inflated };
}

function copyBytes(bytes: Uint8Array): Uint8Array {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return copy;
}

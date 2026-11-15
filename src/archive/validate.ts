import { parseBoard, referencedAssetIds } from '../domain/board';
import type { AssetRecord, Board } from '../domain/types';
import { canonicalRasterMime } from '../ingest/clipboard';
import {
  ARCHIVE_FORMAT,
  ARCHIVE_LIMITS,
  ARCHIVE_VERSION,
  assetExtension,
  type ArchiveManifest,
  type ArchiveSummary,
} from './format';

export type ArchivePayload = {
  board: Board;
  assets: AssetRecord[];
  summary: ArchiveSummary;
};

export function summarizeArchive(board: Board, assetBytes: number): ArchiveSummary {
  let embedded = 0;
  let files = 0;
  let external = 0;
  for (const node of board.nodes) {
    if (node.kind === 'file') files += 1;
    if (node.kind === 'image' && node.source.type === 'embedded') embedded += 1;
    if (node.kind === 'image' && node.source.type === 'external') external += 1;
  }
  return { embedded, files, external, payloadBytes: assetBytes };
}

export function validateArchiveEntries(
  entries: readonly { name: string; bytes: Uint8Array }[],
): { error: string } | { manifest: ArchiveManifest; files: Map<string, Uint8Array> } {
  if (entries.length === 0 || entries.length > ARCHIVE_LIMITS.maxEntries) {
    return { error: 'This archive has an unexpected number of files.' };
  }
  const names = new Set<string>();
  let total = 0;
  const files = new Map<string, Uint8Array>();
  for (const entry of entries) {
    const problem = entryProblem(entry.name, entry.bytes.byteLength, names, total);
    if (problem) return { error: problem };
    names.add(entry.name);
    total += entry.bytes.byteLength;
    files.set(entry.name, entry.bytes);
  }
  const manifestBytes = files.get('manifest.json');
  if (!manifestBytes) return { error: 'The archive is missing manifest.json.' };
  let parsed: unknown;
  try {
    parsed = JSON.parse(new TextDecoder().decode(manifestBytes));
  } catch {
    return { error: 'The archive manifest is not valid JSON.' };
  }
  if (!isRecord(parsed)) return { error: 'The archive manifest is missing.' };
  if (parsed.format !== ARCHIVE_FORMAT) return { error: 'This file is not a canvas board archive.' };
  if (parsed.archiveVersion !== 1 && parsed.archiveVersion !== ARCHIVE_VERSION) return { error: 'This archive version is not supported.' };
  if (!Array.isArray(parsed.assets) || !Array.isArray(parsed.externalImages)) {
    return { error: 'The archive manifest is incomplete.' };
  }
  const board = parseBoard(parsed.board);
  if (!board) return { error: 'The archived board is invalid and was not imported.' };
  const assets: ArchiveManifest['assets'] = [];
  const seenAssets = new Set<string>();
  for (const asset of parsed.assets) {
    if (!isRecord(asset) || typeof asset.id !== 'string' || typeof asset.path !== 'string') {
      return { error: 'The archive lists an invalid file.' };
    }
    if (seenAssets.has(asset.id)) return { error: 'The archive lists the same file twice.' };
    seenAssets.add(asset.id);
    const binary = asset.path.endsWith('.bin');
    const mimeType = binary ? attachmentMimeType(asset.mimeType) : typeof asset.mimeType === 'string' ? canonicalRasterMime(asset.mimeType) : null;
    if (!mimeType || (!binary && assetExtension(mimeType) === null)) return { error: binary ? 'The archive contains an invalid attachment.' : 'The archive contains an unsupported image type.' };
    if (!assetPathAllowed(asset.path, binary)) return { error: 'The archive contains an unexpected file.' };
    if (typeof asset.sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(asset.sha256)) {
      return { error: binary ? 'An archived file is missing its checksum.' : 'An archived image is missing its checksum.' };
    }
    if (asset.byteSize !== undefined && (typeof asset.byteSize !== 'number' || asset.byteSize < 0)) {
      return { error: binary ? 'An archived file has an invalid size.' : 'An archived image has an invalid size.' };
    }
    const bytes = files.get(asset.path);
    if (!bytes) return { error: binary ? 'The archive is missing an attached file.' : 'The archive is missing an embedded image.' };
    if (typeof asset.byteSize === 'number' && bytes.byteLength !== asset.byteSize) {
      return { error: binary ? 'An archived file does not match its recorded size.' : 'An archived image does not match its recorded size.' };
    }
    assets.push({
      id: asset.id,
      mimeType,
      byteSize: bytes.byteLength,
      sha256: asset.sha256,
      path: asset.path,
    });
  }
  const required = referencedAssetIds(board);
  for (const id of required) {
    if (!seenAssets.has(id)) return { error: 'The archive is missing an embedded file.' };
  }
  for (const id of seenAssets) {
    if (!required.has(id)) return { error: 'The archive contains a file the board does not use.' };
  }
  for (const node of board.nodes) {
    if (node.kind === 'file') {
      const asset = assets.find((entry) => entry.id === node.assetId);
      if (!asset || !asset.path.endsWith('.bin')) return { error: 'An attached file does not match its archive entry.' };
    }
    if (node.kind === 'image' && node.source.type === 'embedded') {
      const assetId = node.source.assetId;
      const asset = assets.find((entry) => entry.id === assetId);
      if (!asset || asset.path.endsWith('.bin')) return { error: 'An embedded image does not match its archive entry.' };
    }
  }
  return {
    manifest: {
      format: ARCHIVE_FORMAT,
      archiveVersion: ARCHIVE_VERSION,
      exportedAt: typeof parsed.exportedAt === 'string' ? parsed.exportedAt : '',
      application: 'canvas',
      board,
      assets,
      externalImages: [],
    },
    files,
  };
}

export async function hashesMatch(assets: ArchiveManifest['assets'], files: Map<string, Uint8Array>): Promise<string | null> {
  for (const asset of assets) {
    const bytes = files.get(asset.path);
    if (!bytes) return asset.path.endsWith('.bin') ? 'The archive is missing an attached file.' : 'The archive is missing an embedded image.';
    const hash = await sha256(bytes);
    if (hash !== asset.sha256) return asset.path.endsWith('.bin') ? 'An archived file does not match its checksum.' : 'An archived image does not match its checksum.';
  }
  return null;
}

export function entryProblem(name: string, size: number, seen: ReadonlySet<string>, total: number): string | null {
  if (seen.has(name)) return 'The archive contains duplicate files.';
  if (name !== 'manifest.json' && !/^assets\/[A-Za-z0-9._-]+\.(png|jpg|webp|gif|avif|bin)$/.test(name)) {
    return 'The archive contains an unexpected file.';
  }
  if (name.includes('..') || name.startsWith('/') || name.includes('\\')) return 'The archive contains an unsafe path.';
  if (size > ARCHIVE_LIMITS.maxFileBytes || total + size > ARCHIVE_LIMITS.maxTotalBytes) {
    return 'The archive is too large to import.';
  }
  return null;
}

export async function sha256(bytes: Uint8Array): Promise<string> {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  const digest = await crypto.subtle.digest('SHA-256', copy.buffer);
  return [...new Uint8Array(digest)].map((value) => value.toString(16).padStart(2, '0')).join('');
}

function assetPathAllowed(path: string, binary: boolean): boolean {
  return binary ? /^assets\/[A-Za-z0-9._-]+\.bin$/.test(path) : /^assets\/[A-Za-z0-9._-]+\.(png|jpg|webp|gif|avif)$/.test(path);
}

function attachmentMimeType(value: unknown): string | null {
  if (typeof value !== 'string' || value.length === 0 || value.length > 127) return null;
  if (!/^[A-Za-z0-9][A-Za-z0-9!#$&^_.+-]*\/[A-Za-z0-9][A-Za-z0-9!#$&^_.+-]*$/.test(value)) return null;
  return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

import type { Board } from '../domain/types';

export const ARCHIVE_FORMAT = 'canvas-board';
export const ARCHIVE_VERSION = 1;

/** Limits for a single-board browser archive. Images stay compressed; these caps stop accidental or hostile expansion. */
export const ARCHIVE_LIMITS = {
  maxEntries: 4000,
  maxFileBytes: 64 * 1024 * 1024,
  maxTotalBytes: 256 * 1024 * 1024,
};

export type ArchiveAsset = {
  id: string;
  mimeType: string;
  byteSize: number;
  sha256: string;
  path: string;
};

export type ExternalImageRef = {
  nodeId: string;
  url: string;
};

export type ArchiveManifest = {
  format: typeof ARCHIVE_FORMAT;
  archiveVersion: typeof ARCHIVE_VERSION;
  exportedAt: string;
  application: 'canvas';
  board: Board;
  assets: ArchiveAsset[];
  externalImages: ExternalImageRef[];
};

export type ArchiveSummary = {
  embedded: number;
  external: number;
  payloadBytes: number;
};

export function archiveFilename(title: string): string {
  const cleaned = title
    .normalize('NFKD')
    .replace(/[^a-zA-Z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
  return `${cleaned || 'canvas-board'}.canvas.zip`;
}

export function assetExtension(mimeType: string): string | null {
  if (mimeType === 'image/png') return 'png';
  if (mimeType === 'image/jpeg') return 'jpg';
  if (mimeType === 'image/webp') return 'webp';
  if (mimeType === 'image/gif') return 'gif';
  if (mimeType === 'image/avif') return 'avif';
  return null;
}

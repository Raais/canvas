import { ARCHIVE_LIMITS } from '../archive/format';
import { sanitizeFilename } from './files';

export const SUITCASE_NOTE_WIDTH = 268;
export const SUITCASE_NOTE_HEIGHT = 132;
export const SUITCASE_MIN_WIDTH = 220;
export const SUITCASE_MIN_HEIGHT = 108;
export const SUITCASE_FILE_LIMIT = 1000;
export const SUITCASE_UNPACK_FILES = 100;
export const SUITCASE_UNPACK_BYTES = 128 * 1024 * 1024;
export const SUITCASE_DECLARED_BYTES = ARCHIVE_LIMITS.maxTotalBytes;
export const SUITCASE_ENTRY_BYTES = ARCHIVE_LIMITS.maxFileBytes;
export const SUITCASE_ARCHIVE_BYTES = ARCHIVE_LIMITS.maxFileBytes;
export const SUITCASE_RATIO = 200;
export const SUITCASE_RATIO_FLOOR = 1024;
export const SUITCASE_MIME = 'application/zip';

export const CANVAS_BACKUP_MESSAGE = 'This is a Canvas board backup. Use Project → Import to open it.';

export function looksLikeZipName(name: string): boolean {
  return name.toLowerCase().endsWith('.zip');
}

export function isCanvasBackupName(name: string): boolean {
  return name.toLowerCase().endsWith('.canvas.zip');
}

export function suitcaseFilename(name: string): string | null {
  if (isCanvasBackupName(name)) return null;
  return sanitizeFilename(name);
}

export function suitcaseCountProblem(count: number): string | null {
  if (!Number.isInteger(count) || count < 0 || count > SUITCASE_FILE_LIMIT) return 'That suitcase has an invalid file count.';
  return null;
}

export function extractionGroupLabel(filename: string): string {
  const label = `From ${filename}`;
  return label.length > 80 ? `${label.slice(0, 79)}…` : label;
}

export type UnpackChoice = {
  path: string;
  uncompressedSize: number;
  extractable: boolean;
};

export function planUnpack(entries: readonly UnpackChoice[], mode: 'selected' | 'all'): { paths: string[]; bytes: number } | { error: string } {
  const chosen = mode === 'all' ? entries : entries;
  if (mode === 'all' && entries.some((entry) => !entry.extractable)) {
    return { error: 'Unpack all cannot skip unsupported files. Choose the files that can be unpacked.' };
  }
  if (chosen.length === 0) return { error: 'Select a file to unpack.' };
  if (chosen.some((entry) => !entry.extractable)) return { error: 'That selection includes a file that cannot be unpacked.' };
  if (chosen.length > SUITCASE_UNPACK_FILES) return { error: 'Select 100 or fewer files.' };
  const bytes = chosen.reduce((sum, entry) => sum + entry.uncompressedSize, 0);
  if (bytes > SUITCASE_UNPACK_BYTES) return { error: 'Select fewer files. That unpack is too large.' };
  const paths = chosen.map((entry) => entry.path);
  if (new Set(paths).size !== paths.length) return { error: 'That selection lists the same file twice.' };
  return { paths, bytes };
}

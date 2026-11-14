import { ARCHIVE_LIMITS } from '../archive/format';
import type { Board } from '../domain/types';

/** Reserve for the ZIP manifest and board JSON growth. The final check still uses the real archive cap. */
export const ARCHIVE_MANIFEST_RESERVE = 16 * 1024 * 1024;
export const EMBEDDED_ASSET_BUDGET = ARCHIVE_LIMITS.maxTotalBytes - ARCHIVE_MANIFEST_RESERVE;

const ENTRY_OVERHEAD = 512;

export function imageExceedsArchiveFile(bytes: number): boolean {
  return bytes > ARCHIVE_LIMITS.maxFileBytes;
}

export function archiveFileLimitLabel(): string {
  return `${ARCHIVE_LIMITS.maxFileBytes / (1024 * 1024)} MiB`;
}

export function partitionIncoming(input: {
  board: Board;
  existingBytes: number;
  existingCount: number;
  incoming: readonly { key: string; name: string; bytes: number }[];
}): { accepted: string[]; warnings: string[] } {
  const accepted: string[] = [];
  const warnings: string[] = [];
  const documentBytes = new TextEncoder().encode(JSON.stringify(input.board)).length;
  let bytes = input.existingBytes;
  let count = input.existingCount;
  for (const file of input.incoming) {
    const name = file.name || 'image';
    if (imageExceedsArchiveFile(file.bytes)) {
      warnings.push(`Skipped ${name}: images larger than ${archiveFileLimitLabel()} cannot be included in canvas backups.`);
      continue;
    }
    const nextCount = count + 1;
    const nextBytes = bytes + file.bytes;
    const projected = documentBytes + nextBytes + (nextCount + 1) * ENTRY_OVERHEAD;
    if (nextCount + 1 > ARCHIVE_LIMITS.maxEntries) {
      warnings.push(`Skipped ${name}: the board already has too many files for a canvas backup.`);
      continue;
    }
    if (nextBytes > EMBEDDED_ASSET_BUDGET || projected > ARCHIVE_LIMITS.maxTotalBytes) {
      warnings.push(`Skipped ${name}: adding it would make the board too large to export.`);
      continue;
    }
    accepted.push(file.key);
    bytes = nextBytes;
    count = nextCount;
  }
  return { accepted, warnings };
}

export function archivePressure(totalBytes: number, embeddedAssets: number): 'ok' | 'near' | 'over' {
  const entries = embeddedAssets + 1;
  if (totalBytes > ARCHIVE_LIMITS.maxTotalBytes || entries > ARCHIVE_LIMITS.maxEntries) return 'over';
  if (totalBytes > Math.min(EMBEDDED_ASSET_BUDGET, ARCHIVE_LIMITS.maxTotalBytes * 0.9)) return 'near';
  return 'ok';
}

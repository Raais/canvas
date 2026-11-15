import { referencedAssetIds } from '../domain/board';
import type { AssetRecord, Board } from '../domain/types';
import { SUITCASE_MIME } from '../domain/suitcase';
import { canonicalAudioMime } from '../domain/voice';
import {
  ARCHIVE_FORMAT,
  ARCHIVE_LIMITS,
  ARCHIVE_VERSION,
  assetExtension,
  type ArchiveManifest,
} from './format';
import { hashesMatch, sha256, summarizeArchive, validateArchiveEntries, type ArchivePayload } from './validate';

export type ZipBytes = Uint8Array;

export async function buildArchive(board: Board, assets: readonly AssetRecord[], exportedAt: string): Promise<ZipBytes> {
  const { strToU8, zipSync } = await import('fflate');
  const referenced = referencedAssetIds(board);
  const files: Record<string, Uint8Array> = {};
  const listed: ArchiveManifest['assets'] = [];
  const external = board.nodes.flatMap((node) =>
    node.kind === 'image' && node.source.type === 'external' ? [{ nodeId: node.id, url: node.source.url }] : [],
  );
  let payload = 0;
  for (const id of referenced) {
    const asset = assets.find((entry) => entry.id === id);
    if (!asset) throw new Error('An embedded file is missing, so the archive was not created.');
    const usedByFile = board.nodes.some((node) => node.kind === 'file' && node.assetId === id);
    const usedByVoice = board.nodes.some((node) => node.kind === 'voice' && node.assetId === id);
    const usedBySuitcase = board.nodes.some((node) => node.kind === 'suitcase' && node.assetId === id);
    const usedByImage = board.nodes.some((node) => node.kind === 'image' && node.source.type === 'embedded' && node.source.assetId === id);
    const roles = Number(usedByFile) + Number(usedByVoice) + Number(usedBySuitcase) + Number(usedByImage);
    if (roles > 1) throw new Error('An attachment is stored in an inconsistent way.');
    if (usedByVoice && !canonicalAudioMime(asset.mimeType)) throw new Error('A voice note uses an unsupported audio type.');
    if (usedBySuitcase && asset.mimeType !== SUITCASE_MIME) throw new Error('A ZIP suitcase uses an unsupported type.');
    const extension = usedByFile || usedByVoice || usedBySuitcase ? 'bin' : assetExtension(asset.mimeType);
    if (!extension) throw new Error('An embedded image uses an unsupported type.');
    const bytes = new Uint8Array(await asset.blob.arrayBuffer());
    if (bytes.byteLength > ARCHIVE_LIMITS.maxFileBytes) {
      throw new Error(usedBySuitcase ? 'A ZIP suitcase is too large to export.' : usedByVoice ? 'A recording is too large to export.' : usedByFile ? 'A file is too large to export.' : 'An image is too large to export.');
    }
    payload += bytes.byteLength;
    const path = `assets/${id}.${extension}`;
    files[path] = bytes;
    listed.push({ id, mimeType: asset.mimeType, byteSize: bytes.byteLength, sha256: await sha256(bytes), path });
  }
  const manifest: ArchiveManifest = {
    format: ARCHIVE_FORMAT,
    archiveVersion: ARCHIVE_VERSION,
    exportedAt,
    application: 'canvas',
    board,
    assets: listed,
    externalImages: external,
  };
  const manifestBytes = strToU8(JSON.stringify(manifest));
  if (listed.length + 1 > ARCHIVE_LIMITS.maxEntries) throw new Error('This board has too many files to export.');
  if (payload + manifestBytes.byteLength > ARCHIVE_LIMITS.maxTotalBytes) throw new Error('This board is too large to export.');
  const packed: Record<string, [Uint8Array, { level: 0 | 6 }]> = {
    'manifest.json': [manifestBytes, { level: 6 }],
  };
  for (const [path, bytes] of Object.entries(files)) packed[path] = [bytes, { level: 0 }];
  return zipSync(packed);
}

export async function readArchive(bytes: ZipBytes): Promise<{ error: string } | ArchivePayload> {
  let inflated: Record<string, Uint8Array>;
  try {
    const { unzipSync } = await import('fflate');
    const seen = new Set<string>();
    let total = 0;
    inflated = unzipSync(bytes, {
      filter(file) {
        if (file.compression !== 0 && file.compression !== 8) {
          throw new Error('The archive uses an unsupported compression method.');
        }
        if (seen.has(file.name)) throw new Error('The archive contains duplicate files.');
        if (file.name !== 'manifest.json' && !/^assets\/[A-Za-z0-9._-]+\.(png|jpg|webp|gif|avif|bin)$/.test(file.name)) {
          throw new Error('The archive contains an unexpected file.');
        }
        if (file.originalSize > ARCHIVE_LIMITS.maxFileBytes || total + file.originalSize > ARCHIVE_LIMITS.maxTotalBytes) {
          throw new Error('The archive is too large to import.');
        }
        if (seen.size + 1 > ARCHIVE_LIMITS.maxEntries) throw new Error('This archive has an unexpected number of files.');
        seen.add(file.name);
        total += file.originalSize;
        return true;
      },
    });
  } catch (error) {
    return { error: error instanceof Error && error.message ? error.message : 'The archive could not be read.' };
  }
  const entries = Object.entries(inflated).map(([name, value]) => ({ name, bytes: value }));
  const validated = validateArchiveEntries(entries);
  if ('error' in validated) return validated;
  const mismatch = await hashesMatch(validated.manifest.assets, validated.files);
  if (mismatch) return { error: mismatch };
  const assets: AssetRecord[] = validated.manifest.assets.map((asset) => {
    const bytes = validated.files.get(asset.path);
    if (!bytes) throw new Error('The archive is missing an embedded file.');
    const copy = new Uint8Array(bytes.byteLength);
    copy.set(bytes);
    return {
      id: asset.id,
      mimeType: asset.mimeType,
      byteSize: copy.byteLength,
      createdAt: validated.manifest.exportedAt || new Date().toISOString(),
      blob: new Blob([copy], { type: asset.mimeType }),
    };
  });
  return {
    board: validated.manifest.board,
    assets,
    summary: summarizeArchive(validated.manifest.board, assets.reduce((sum, asset) => sum + asset.byteSize, 0)),
  };
}

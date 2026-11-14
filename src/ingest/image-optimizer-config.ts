import { imageExceedsArchiveFile, archiveFileLimitLabel } from './admission';

export const WEBP_OPTIMIZER_V1 = {
  mimeType: 'image/webp',
  quality: 0.82,
  maxDimension: 2560,
  minimumSavingsRatio: 0.15,
} as const;

export const OPTIMIZE_IMAGES_KEY = 'raais-canvas-optimize-images-v1';
export const RAW_SOURCE_BYTES = 128 * 1024 * 1024;
export const MAX_DECODED_PIXELS = 50_000_000;
export const WEBP_OPTIMIZER_LABEL = `WebP · Quality ${Math.round(WEBP_OPTIMIZER_V1.quality * 100)}% · Max ${WEBP_OPTIMIZER_V1.maxDimension} px`;

export type PreferenceStorage = {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
};

export function readOptimizeImages(storage: PreferenceStorage | null): boolean {
  try {
    return storage?.getItem(OPTIMIZE_IMAGES_KEY) === 'on';
  } catch {
    return false;
  }
}

export function writeOptimizeImages(storage: PreferenceStorage | null, enabled: boolean): void {
  try {
    storage?.setItem(OPTIMIZE_IMAGES_KEY, enabled ? 'on' : 'off');
  } catch {
    // The in-session toggle still applies when the browser refuses storage.
  }
}

export function isOptimizableMime(mimeType: string): boolean {
  return mimeType === 'image/png' || mimeType === 'image/jpeg';
}

export type PngAnimation = 'still' | 'animated' | 'ambiguous';

const PNG_SIGNATURE = [137, 80, 78, 71, 13, 10, 26, 10];

/** acTL before the first IDAT means the PNG is animated. A broken length is ambiguous, not a still. */
export function classifyPngAnimation(bytes: Uint8Array): PngAnimation {
  const read = (offset: number, length: number): Uint8Array | null => {
    if (length < 0 || offset < 0 || offset > bytes.length || length > bytes.length - offset) return null;
    return bytes.subarray(offset, offset + length);
  };
  return walkPngChunksSync(bytes.length, read(0, 8), read);
}

export async function classifyPngBlob(blob: Blob): Promise<PngAnimation> {
  const read = async (offset: number, length: number): Promise<Uint8Array | null> => {
    if (length < 0 || offset < 0 || offset > blob.size || length > blob.size - offset) return null;
    return new Uint8Array(await blob.slice(offset, offset + length).arrayBuffer());
  };
  return walkPngChunksAsync(blob.size, read);
}

function walkPngChunksSync(
  size: number,
  signature: Uint8Array | null,
  read: (offset: number, length: number) => Uint8Array | null,
): PngAnimation {
  if (!isPngSignature(signature)) return 'ambiguous';
  let offset = 8;
  while (offset + 8 <= size) {
    const header = read(offset, 8);
    if (!header || header.length < 8) return 'ambiguous';
    const length = pngChunkLength(header);
    if (length === null || length > size - offset - 12) return 'ambiguous';
    if (isChunk(header, 'acTL')) return 'animated';
    if (isChunk(header, 'IDAT')) return 'still';
    offset += 12 + length;
  }
  return 'ambiguous';
}

async function walkPngChunksAsync(
  size: number,
  read: (offset: number, length: number) => Promise<Uint8Array | null>,
): Promise<PngAnimation> {
  if (!isPngSignature(await read(0, 8))) return 'ambiguous';
  let offset = 8;
  while (offset + 8 <= size) {
    const header = await read(offset, 8);
    if (!header || header.length < 8) return 'ambiguous';
    const length = pngChunkLength(header);
    if (length === null || length > size - offset - 12) return 'ambiguous';
    if (isChunk(header, 'acTL')) return 'animated';
    if (isChunk(header, 'IDAT')) return 'still';
    offset += 12 + length;
  }
  return 'ambiguous';
}

function isPngSignature(bytes: Uint8Array | null): boolean {
  if (!bytes || bytes.length < 8) return false;
  return PNG_SIGNATURE.every((value, index) => bytes[index] === value);
}

function pngChunkLength(header: Uint8Array): number | null {
  const view = new DataView(header.buffer, header.byteOffset, header.byteLength);
  const length = view.getUint32(0);
  if (!Number.isFinite(length)) return null;
  return length;
}

function isChunk(header: Uint8Array, type: string): boolean {
  return header[4] === type.charCodeAt(0)
    && header[5] === type.charCodeAt(1)
    && header[6] === type.charCodeAt(2)
    && header[7] === type.charCodeAt(3);
}

export function keepsOriginalMime(mimeType: string): boolean {
  return mimeType === 'image/gif' || mimeType === 'image/webp' || mimeType === 'image/avif';
}

export function classifyDimensions(width: number, height: number): 'ok' | 'invalid' | 'too-many-pixels' {
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) return 'invalid';
  if (width * height > MAX_DECODED_PIXELS) return 'too-many-pixels';
  return 'ok';
}

export function scaledDimensions(width: number, height: number): { width: number; height: number } | null {
  if (classifyDimensions(width, height) !== 'ok') return null;
  const scale = Math.min(1, WEBP_OPTIMIZER_V1.maxDimension / Math.max(width, height));
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  };
}

export function savesEnough(optimizedBytes: number, originalBytes: number): boolean {
  return optimizedBytes > 0 && optimizedBytes * 20 <= originalBytes * 17;
}

export type SourceGate =
  | { action: 'optimize' }
  | { action: 'store-original' }
  | { action: 'reject'; warning: string };

export function gateIncomingImage(input: {
  optimize: boolean;
  mimeType: string;
  bytes: number;
  name: string;
  width?: number;
  height?: number;
  png?: PngAnimation;
}): SourceGate {
  const name = input.name || 'image';
  const pngCanOptimize = input.mimeType !== 'image/png' || input.png === 'still';
  const eligible = input.optimize && isOptimizableMime(input.mimeType) && pngCanOptimize;
  if (!eligible) {
    if (imageExceedsArchiveFile(input.bytes)) {
      return { action: 'reject', warning: `Skipped ${name}: images larger than ${archiveFileLimitLabel()} cannot be included in canvas backups.` };
    }
    return { action: 'store-original' };
  }
  if (input.bytes > RAW_SOURCE_BYTES) {
    return { action: 'reject', warning: `Skipped ${name}: the image is too large to optimize.` };
  }
  if (input.width !== undefined && input.height !== undefined) {
    const dimensions = classifyDimensions(input.width, input.height);
    if (dimensions === 'invalid') return { action: 'reject', warning: name === 'image' ? 'Could not read an image.' : `Could not read "${name}".` };
    if (dimensions === 'too-many-pixels') {
      if (!imageExceedsArchiveFile(input.bytes)) return { action: 'store-original' };
      return { action: 'reject', warning: `Skipped ${name}: the image has too many pixels to optimize.` };
    }
  }
  return { action: 'optimize' };
}

export type EncodedProbe = {
  bytes: number;
  mimeType: string;
  width: number;
  height: number;
};

export function settleOptimization(input: {
  originalBytes: number;
  encoded: EncodedProbe | null;
}): 'accept' | 'preserve' | 'reject' {
  const originalFits = !imageExceedsArchiveFile(input.originalBytes);
  const encoded = input.encoded;
  const acceptable = Boolean(
    encoded
    && encoded.mimeType === WEBP_OPTIMIZER_V1.mimeType
    && savesEnough(encoded.bytes, input.originalBytes)
    && !imageExceedsArchiveFile(encoded.bytes)
    && classifyDimensions(encoded.width, encoded.height) === 'ok',
  );
  if (acceptable) return 'accept';
  return originalFits ? 'preserve' : 'reject';
}

export function describeOptimization(input: {
  optimized: number;
  unchanged: number;
  failedKept: number;
  savedBytes: number;
}): string | null {
  const considered = input.optimized + input.unchanged + input.failedKept;
  const parts: string[] = [];
  if (input.optimized > 0 && input.unchanged === 0 && input.failedKept === 0) {
    parts.push(`Optimized ${input.optimized} ${input.optimized === 1 ? 'image' : 'images'} · saved ${formatSaved(input.savedBytes)}`);
  } else if (input.optimized > 0) {
    parts.push(`Optimized ${input.optimized} of ${considered} images · saved ${formatSaved(input.savedBytes)}`);
  }
  if (input.failedKept === 1) parts.push('One image could not be optimized and was kept unchanged.');
  else if (input.failedKept > 1) parts.push(`${input.failedKept} images could not be optimized and were kept unchanged.`);
  return parts.length > 0 ? parts.join(' ') : null;
}

function formatSaved(bytes: number): string {
  if (bytes < 1024) return `${Math.round(bytes)} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function readRasterDimensions(bytes: Uint8Array, mimeType: string): { width: number; height: number } | null {
  if (mimeType === 'image/png') return readPngDimensions(bytes);
  if (mimeType === 'image/jpeg') return readJpegDimensions(bytes);
  return null;
}

function readPngDimensions(bytes: Uint8Array): { width: number; height: number } | null {
  if (bytes.length < 24) return null;
  const signature = [137, 80, 78, 71, 13, 10, 26, 10];
  for (let index = 0; index < signature.length; index += 1) {
    if (bytes[index] !== signature[index]) return null;
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (view.getUint32(12) !== 0x49484452) return null;
  const width = view.getUint32(16);
  const height = view.getUint32(20);
  if (width <= 0 || height <= 0) return null;
  return { width, height };
}

function readJpegDimensions(bytes: Uint8Array): { width: number; height: number } | null {
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let offset = 2;
  while (offset + 3 < bytes.length) {
    if (bytes[offset] !== 0xff) return null;
    while (offset < bytes.length && bytes[offset] === 0xff) offset += 1;
    const marker = bytes[offset];
    if (marker === undefined) return null;
    offset += 1;
    if (marker === 0xd8) continue;
    if (marker === 0xd9 || marker === 0xda) return null;
    if (offset + 1 >= bytes.length) return null;
    const length = view.getUint16(offset);
    if (length < 2 || offset + length > bytes.length) return null;
    const sof = marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;
    if (sof) {
      if (length < 7) return null;
      const height = view.getUint16(offset + 3);
      const width = view.getUint16(offset + 5);
      if (width <= 0 || height <= 0) return null;
      return { width, height };
    }
    offset += length;
  }
  return null;
}

export function mayPlaceImages(readOnly: boolean): boolean {
  return !readOnly;
}

export function mayReplaceBoard(ingesting: boolean): boolean {
  return !ingesting;
}

export function createBatchGuard() {
  let generation = 0;
  return {
    capture: () => generation,
    invalidate: () => {
      generation += 1;
    },
    current: (token: number) => token === generation,
  };
}

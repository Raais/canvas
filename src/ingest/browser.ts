import {
  FALLBACK_IMAGE_HEIGHT,
  FALLBACK_IMAGE_WIDTH,
  type Point,
} from '../domain/types';
import {
  canonicalRasterMime,
  captureClipboardData,
  contentSignature,
  interpretClipboard,
  mimeFromFileName,
  type ClipboardImageRef,
  type ClipboardSnapshot,
  type IngestAction,
} from './clipboard';
import { imageExceedsArchiveFile } from './admission';
import {
  classifyPngAnimation,
  classifyPngBlob,
  describeOptimization,
  gateIncomingImage,
  isOptimizableMime,
  RAW_SOURCE_BYTES,
  readRasterDimensions,
  settleOptimization,
  type PngAnimation,
} from './image-optimizer-config';
import type { ImageOptimizer } from './image-optimizer';
import { attachmentMime, classifyIncomingFile, decodeTextFile, rejectedFileMessage } from '../domain/files';
import type { CodeLanguage, NotePresentation } from '../domain/types';

export type PreparedItem =
  | { type: 'text'; text: string; presentation?: NotePresentation; codeLanguage?: CodeLanguage; language?: string; sourceFilename?: string }
  | { type: 'file'; blob: Blob; mimeType: string; filename: string }
  | {
      type: 'image';
      blob: Blob;
      mimeType: string;
      intrinsicWidth: number;
      intrinsicHeight: number;
    }
  | {
      type: 'external-image';
      url: string;
      intrinsicWidth: number;
      intrinsicHeight: number;
      sizedFromImage: boolean;
    };

export type IngestBundle = {
  items: PreparedItem[];
  warnings: string[];
  summary: string | null;
};

export type IngestOptions = {
  optimize?: boolean;
  optimizer?: Pick<ImageOptimizer, 'optimize'>;
  measure?: (blob: Blob, mimeType: string) => Promise<{ width: number; height: number } | null>;
  onOptimizing?: () => void;
};

const IDLE_OPTIONS: IngestOptions = {};

export async function ingestDataTransfer(data: DataTransfer, kind: 'clipboard' | 'files'): Promise<IngestBundle> {
  return ingestClipboard(captureClipboardData(data), kind);
}

export async function ingestClipboard(snapshot: ClipboardSnapshot, kind: 'clipboard' | 'files', options: IngestOptions = IDLE_OPTIONS): Promise<IngestBundle> {
  const collected = await collectFiles(snapshot.files.map((entry) => entry.file), options);
  if (kind === 'files') {
    const actions: IngestAction[] = collected.refs.map((image) => ({ type: 'file-image', fileKey: image.key }));
    const prepared = await prepareActions(actions, collected.files, options);
    return { items: prepared.items, warnings: [...collected.warnings, ...prepared.warnings], summary: prepared.summary };
  }
  const interpreted = interpretClipboard({
    imageKeys: collected.refs,
    html: snapshot.html,
    plainText: snapshot.plainText,
  });
  const prepared = await prepareActions(interpreted.actions, collected.files, options);
  return {
    items: prepared.items,
    warnings: [...collected.warnings, ...interpreted.warnings, ...prepared.warnings],
    summary: prepared.summary,
  };
}

export async function ingestFileList(list: FileList | readonly File[], options: IngestOptions = IDLE_OPTIONS): Promise<IngestBundle> {
  const items: PreparedItem[] = [];
  const warnings: string[] = [];
  let summary: string | null = null;
  for (const file of Array.from(list)) {
    const decision = classifyIncomingFile(file);
    if (decision.kind === 'reject') {
      warnings.push(rejectedFileMessage(decision.filename, decision.reason));
      continue;
    }
    if (decision.kind === 'image') {
      const collected = await collectFiles([file], options);
      const actions: IngestAction[] = collected.refs.map((image) => ({ type: 'file-image', fileKey: image.key }));
      const prepared = await prepareActions(actions, collected.files, options);
      items.push(...prepared.items);
      warnings.push(...collected.warnings, ...prepared.warnings);
      summary = prepared.summary ?? summary;
      continue;
    }
    if (decision.kind === 'text') {
      const decoded = decodeTextFile(new Uint8Array(await file.arrayBuffer()));
      if (decoded === null) {
        items.push({ type: 'file', blob: file, mimeType: attachmentMime(''), filename: decision.filename });
        continue;
      }
      items.push({
        type: 'text',
        text: decoded,
        presentation: decision.presentation,
        ...(decision.codeLanguage ? { codeLanguage: decision.codeLanguage } : {}),
        ...(decision.language ? { language: decision.language } : {}),
        sourceFilename: decision.filename,
      });
      continue;
    }
    items.push({ type: 'file', blob: file, mimeType: decision.mimeType, filename: decision.filename });
  }
  return { items, warnings, summary };
}

export function placementOrigin(pointer: Point | null, fallback: Point): Point {
  return pointer ?? fallback;
}

type HeldFile = {
  file: File;
  mimeType: string;
  width: number | null;
  height: number | null;
  png?: PngAnimation;
};

async function collectFiles(list: FileList | readonly File[], options: IngestOptions): Promise<{
  refs: ClipboardImageRef[];
  files: Map<string, HeldFile>;
  warnings: string[];
}> {
  const refs: ClipboardImageRef[] = [];
  const files = new Map<string, HeldFile>();
  const warnings: string[] = [];
  for (const file of Array.from(list)) {
    const mimeType = canonicalRasterMime(file.type) ?? mimeFromFileName(file.name);
    if (!mimeType) {
      warnings.push(file.name ? `Skipped unsupported file "${file.name}".` : 'Skipped an unsupported file.');
      continue;
    }
    const name = file.name || 'image';
    if (mimeType === 'image/png' && options.optimize === true && file.size > RAW_SOURCE_BYTES) {
      const kind = await classifyPngBlob(file);
      const oversized = gateIncomingImage({ optimize: true, mimeType, bytes: file.size, name, png: kind });
      if (oversized.action === 'reject') warnings.push(oversized.warning);
      continue;
    }
    const early = gateIncomingImage({
      optimize: options.optimize === true && mimeType !== 'image/png',
      mimeType,
      bytes: file.size,
      name,
    });
    if (early.action === 'reject') {
      warnings.push(early.warning);
      continue;
    }
    const bytes = new Uint8Array(await file.arrayBuffer());
    const png = mimeType === 'image/png' ? classifyPngAnimation(bytes) : undefined;
    const measured = isOptimizableMime(mimeType) && png !== 'animated' && png !== 'ambiguous' ? readRasterDimensions(bytes, mimeType) : null;
    const sized = gateIncomingImage({
      optimize: options.optimize === true,
      mimeType,
      bytes: file.size,
      name,
      ...(png ? { png } : {}),
      ...(measured ? { width: measured.width, height: measured.height } : {}),
    });
    if (sized.action === 'reject') {
      warnings.push(sized.warning);
      continue;
    }
    const key = contentSignature(mimeType, bytes);
    if (files.has(key)) continue;
    const blob = file.type === mimeType ? file : new File([copyBuffer(bytes)], file.name, { type: mimeType });
    files.set(key, { file: blob, mimeType, width: measured?.width ?? null, height: measured?.height ?? null, ...(png ? { png } : {}) });
    refs.push({ key, mimeType });
  }
  return { refs, files, warnings };
}

async function prepareActions(actions: readonly IngestAction[], files: Map<string, HeldFile>, options: IngestOptions): Promise<IngestBundle> {
  const items: PreparedItem[] = [];
  const warnings: string[] = [];
  const stats = { optimized: 0, unchanged: 0, failedKept: 0, savedBytes: 0 };
  let announced = false;
  for (const action of actions) {
    if (action.type === 'text') {
      items.push(action);
      continue;
    }
    if (action.type === 'external-image') {
      const probed = await probeExternalImage(action.url);
      items.push({
        type: 'external-image',
        url: action.url,
        intrinsicWidth: probed?.width ?? FALLBACK_IMAGE_WIDTH,
        intrinsicHeight: probed?.height ?? FALLBACK_IMAGE_HEIGHT,
        sizedFromImage: probed !== null,
      });
      continue;
    }
    const embedded = action.type === 'file-image'
      ? filePayload(files.get(action.fileKey))
      : bytePayload(action.bytes, action.mimeType);
    if (!embedded) {
      warnings.push(action.type === 'file-image' ? 'Could not read a pasted image.' : 'Could not read an embedded image.');
      continue;
    }
    const prepared = await prepareEmbedded(embedded, options, stats, () => {
      if (announced) return;
      announced = true;
      options.onOptimizing?.();
    });
    if (prepared.kind === 'cancel') return { items: [], warnings: [], summary: null };
    if (prepared.kind === 'warning') {
      warnings.push(prepared.warning);
      continue;
    }
    items.push(prepared.item);
  }
  return { items, warnings, summary: describeOptimization(stats) };
}

function filePayload(held: HeldFile | undefined): EmbeddedPayload | null {
  if (!held) return null;
  return {
    blob: held.file,
    mimeType: held.mimeType,
    name: held.file.name || 'image',
    width: held.width,
    height: held.height,
    ...(held.png ? { png: held.png } : {}),
  };
}

function bytePayload(bytes: Uint8Array, mimeType: string): EmbeddedPayload {
  const png = mimeType === 'image/png' ? classifyPngAnimation(bytes) : undefined;
  const measured = isOptimizableMime(mimeType) && png !== 'animated' && png !== 'ambiguous' ? readRasterDimensions(bytes, mimeType) : null;
  return {
    blob: new Blob([copyBuffer(bytes)], { type: mimeType }),
    mimeType,
    name: 'image',
    width: measured?.width ?? null,
    height: measured?.height ?? null,
    ...(png ? { png } : {}),
  };
}

type EmbeddedPayload = {
  blob: Blob;
  mimeType: string;
  name: string;
  width: number | null;
  height: number | null;
  png?: PngAnimation;
};

async function prepareEmbedded(
  payload: EmbeddedPayload,
  options: IngestOptions,
  stats: { optimized: number; unchanged: number; failedKept: number; savedBytes: number },
  onOptimizing: () => void,
): Promise<{ kind: 'item'; item: PreparedItem } | { kind: 'warning'; warning: string } | { kind: 'cancel' }> {
  const known = payload.width !== null && payload.height !== null ? { width: payload.width, height: payload.height } : null;
  const gate = gateIncomingImage({
    optimize: options.optimize === true,
    mimeType: payload.mimeType,
    bytes: payload.blob.size,
    name: payload.name,
    ...(payload.png ? { png: payload.png } : {}),
    ...(known ?? {}),
  });
  if (gate.action === 'reject') return { kind: 'warning', warning: gate.warning };
  if (gate.action === 'optimize' && !options.optimizer && imageExceedsArchiveFile(payload.blob.size)) {
    return { kind: 'warning', warning: `Skipped ${payload.name}: it could not be optimized and is too large to store.` };
  }
  if (gate.action === 'store-original' || !options.optimizer) {
    const decoded = known ?? await measureBlob(payload.blob, payload.mimeType, options);
    if (!decoded) return { kind: 'warning', warning: payload.name === 'image' ? 'Could not read an image.' : `Could not read "${payload.name}".` };
    return { kind: 'item', item: imageItem(payload.blob, payload.mimeType, decoded.width, decoded.height) };
  }
  onOptimizing();
  let encoded: Awaited<ReturnType<ImageOptimizer['optimize']>>;
  try {
    encoded = await options.optimizer.optimize({ blob: payload.blob, width: known?.width ?? 0, height: known?.height ?? 0 });
  } catch {
    encoded = { ok: false, reason: 'failed' };
  }
  if (!encoded.ok && encoded.reason === 'cancelled') return { kind: 'cancel' };
  const sourceWidth = encoded.ok ? encoded.sourceWidth : encoded.sourceWidth ?? known?.width;
  const sourceHeight = encoded.ok ? encoded.sourceHeight : encoded.sourceHeight ?? known?.height;
  const decision = settleOptimization({
    originalBytes: payload.blob.size,
    encoded: encoded.ok ? { bytes: encoded.blob.size, mimeType: encoded.blob.type, width: encoded.width, height: encoded.height } : null,
  });
  if (decision === 'accept' && encoded.ok) {
    stats.optimized += 1;
    stats.savedBytes += Math.max(0, payload.blob.size - encoded.blob.size);
    return { kind: 'item', item: imageItem(encoded.blob, 'image/webp', encoded.width, encoded.height) };
  }
  if (decision === 'preserve') {
    let width = sourceWidth;
    let height = sourceHeight;
    if (!(width && height)) {
      const measured = await measureBlob(payload.blob, payload.mimeType, options);
      width = measured?.width;
      height = measured?.height;
    }
    if (!(width && height)) return { kind: 'warning', warning: payload.name === 'image' ? 'Could not read an image.' : `Could not read "${payload.name}".` };
    if (!encoded.ok && encoded.reason !== 'pixels') stats.failedKept += 1;
    else stats.unchanged += 1;
    return { kind: 'item', item: imageItem(payload.blob, payload.mimeType, width, height) };
  }
  const warning = !encoded.ok && encoded.reason === 'pixels'
    ? `Skipped ${payload.name}: the image has too many pixels to optimize.`
    : `Skipped ${payload.name}: it could not be optimized and is too large to store.`;
  return { kind: 'warning', warning };
}

function imageItem(blob: Blob, mimeType: string, width: number, height: number): PreparedItem {
  return { type: 'image', blob, mimeType, intrinsicWidth: width, intrinsicHeight: height };
}

async function measureBlob(blob: Blob, mimeType: string, options: IngestOptions): Promise<{ width: number; height: number } | null> {
  if (options.measure) return options.measure(blob, mimeType);
  const bytes = new Uint8Array(await blob.arrayBuffer());
  return readRasterDimensions(bytes, mimeType) ?? decodeBlob(blob);
}

function copyBuffer(bytes: Uint8Array): ArrayBuffer {
  const copy = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(copy).set(bytes);
  return copy;
}

function decodeBlob(blob: Blob): Promise<{ width: number; height: number } | null> {
  const url = URL.createObjectURL(blob);
  return new Promise((resolve) => {
    const image = new Image();
    image.onload = () => {
      URL.revokeObjectURL(url);
      if (image.naturalWidth > 0 && image.naturalHeight > 0) {
        resolve({ width: image.naturalWidth, height: image.naturalHeight });
      } else {
        resolve(null);
      }
    };
    image.onerror = () => {
      URL.revokeObjectURL(url);
      resolve(null);
    };
    image.src = url;
  });
}

function probeExternalImage(url: string): Promise<{ width: number; height: number } | null> {
  return new Promise((resolve) => {
    const image = new Image();
    const timer = window.setTimeout(() => {
      image.onload = null;
      image.onerror = null;
      resolve(null);
    }, 8000);
    image.onload = () => {
      window.clearTimeout(timer);
      if (image.naturalWidth > 0 && image.naturalHeight > 0) {
        resolve({ width: image.naturalWidth, height: image.naturalHeight });
      } else {
        resolve(null);
      }
    };
    image.onerror = () => {
      window.clearTimeout(timer);
      resolve(null);
    };
    image.src = url;
  });
}

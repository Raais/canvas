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

export type PreparedItem =
  | { type: 'text'; text: string }
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
};

export async function ingestDataTransfer(data: DataTransfer, kind: 'clipboard' | 'files'): Promise<IngestBundle> {
  return ingestClipboard(captureClipboardData(data), kind);
}

export async function ingestClipboard(snapshot: ClipboardSnapshot, kind: 'clipboard' | 'files'): Promise<IngestBundle> {
  const collected = await collectFiles(snapshot.files.map((entry) => entry.file));
  if (kind === 'files') {
    const actions: IngestAction[] = collected.refs.map((image) => ({ type: 'file-image', fileKey: image.key }));
    const prepared = await prepareActions(actions, collected.files);
    return { items: prepared.items, warnings: [...collected.warnings, ...prepared.warnings] };
  }
  const interpreted = interpretClipboard({
    imageKeys: collected.refs,
    html: snapshot.html,
    plainText: snapshot.plainText,
  });
  const prepared = await prepareActions(interpreted.actions, collected.files);
  return {
    items: prepared.items,
    warnings: [...collected.warnings, ...interpreted.warnings, ...prepared.warnings],
  };
}

export async function ingestFileList(list: FileList | readonly File[]): Promise<IngestBundle> {
  const collected = await collectFiles(list);
  const actions: IngestAction[] = collected.refs.map((image) => ({ type: 'file-image', fileKey: image.key }));
  const prepared = await prepareActions(actions, collected.files);
  return { items: prepared.items, warnings: [...collected.warnings, ...prepared.warnings] };
}

export function placementOrigin(pointer: Point | null, fallback: Point): Point {
  return pointer ?? fallback;
}

async function collectFiles(list: FileList | readonly File[]): Promise<{
  refs: ClipboardImageRef[];
  files: Map<string, File>;
  warnings: string[];
}> {
  const refs: ClipboardImageRef[] = [];
  const files = new Map<string, File>();
  const warnings: string[] = [];
  for (const file of Array.from(list)) {
    const mimeType = canonicalRasterMime(file.type) ?? mimeFromFileName(file.name);
    if (!mimeType) {
      warnings.push(file.name ? `Skipped unsupported file "${file.name}".` : 'Skipped an unsupported file.');
      continue;
    }
    const bytes = new Uint8Array(await file.arrayBuffer());
    const key = contentSignature(mimeType, bytes);
    if (files.has(key)) continue;
    const blob = file.type === mimeType ? file : new File([copyBuffer(bytes)], file.name, { type: mimeType });
    files.set(key, blob);
    refs.push({ key, mimeType });
  }
  return { refs, files, warnings };
}

async function prepareActions(actions: readonly IngestAction[], files: Map<string, File>): Promise<IngestBundle> {
  const items: PreparedItem[] = [];
  const warnings: string[] = [];
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
    if (action.type === 'file-image') {
      const file = files.get(action.fileKey);
      if (!file) {
        warnings.push('Could not read a pasted image.');
        continue;
      }
      const decoded = await decodeBlob(file);
      if (!decoded) {
        warnings.push(file.name ? `Could not read "${file.name}".` : 'Could not read an image.');
        continue;
      }
      items.push({
        type: 'image',
        blob: file,
        mimeType: canonicalRasterMime(file.type) ?? 'application/octet-stream',
        intrinsicWidth: decoded.width,
        intrinsicHeight: decoded.height,
      });
      continue;
    }
    const blob = new Blob([copyBuffer(action.bytes)], { type: action.mimeType });
    const decoded = await decodeBlob(blob);
    if (!decoded) {
      warnings.push('Could not read an embedded image.');
      continue;
    }
    items.push({
      type: 'image',
      blob,
      mimeType: action.mimeType,
      intrinsicWidth: decoded.width,
      intrinsicHeight: decoded.height,
    });
  }
  return { items, warnings };
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

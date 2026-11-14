import { classifyDimensions, scaledDimensions, WEBP_OPTIMIZER_V1 } from './image-optimizer-config';

type WorkerRequest = {
  id: number;
  blob: Blob;
  width: number;
  height: number;
};

type WorkerResponse = {
  id: number;
  ok: boolean;
  reason?: string;
  blob?: Blob;
  width?: number;
  height?: number;
  sourceWidth?: number;
  sourceHeight?: number;
};

const scope = self as unknown as {
  onmessage: ((event: MessageEvent<WorkerRequest>) => void) | null;
  postMessage(message: WorkerResponse): void;
};

scope.onmessage = (event) => {
  void encode(event.data).then((response) => {
    scope.postMessage(response);
  });
};

async function encode(request: WorkerRequest): Promise<WorkerResponse> {
  let bitmap: ImageBitmap | null = null;
  try {
    const known = request.width > 0 && request.height > 0 ? { width: request.width, height: request.height } : null;
    const source = known ?? await measure(request.blob);
    if (!source) return { id: request.id, ok: false, reason: 'failed' };
    const dimensions = classifyDimensions(source.width, source.height);
    if (dimensions === 'invalid') return { id: request.id, ok: false, reason: 'failed', sourceWidth: source.width, sourceHeight: source.height };
    if (dimensions === 'too-many-pixels') {
      return { id: request.id, ok: false, reason: 'pixels', sourceWidth: source.width, sourceHeight: source.height };
    }
    const target = scaledDimensions(source.width, source.height);
    if (!target) return { id: request.id, ok: false, reason: 'failed', sourceWidth: source.width, sourceHeight: source.height };
    bitmap = await decode(request.blob, target);
    const canvas = new OffscreenCanvas(target.width, target.height);
    const context = canvas.getContext('2d');
    if (!context) return { id: request.id, ok: false, reason: 'failed', sourceWidth: source.width, sourceHeight: source.height };
    context.drawImage(bitmap, 0, 0, target.width, target.height);
    const blob = await canvas.convertToBlob({ type: WEBP_OPTIMIZER_V1.mimeType, quality: WEBP_OPTIMIZER_V1.quality });
    if (!blob || blob.type !== WEBP_OPTIMIZER_V1.mimeType || blob.size <= 0) {
      return { id: request.id, ok: false, reason: 'failed', sourceWidth: source.width, sourceHeight: source.height };
    }
    return {
      id: request.id,
      ok: true,
      blob,
      width: target.width,
      height: target.height,
      sourceWidth: source.width,
      sourceHeight: source.height,
    };
  } catch {
    return { id: request.id, ok: false, reason: 'failed' };
  } finally {
    bitmap?.close();
  }
}

async function measure(blob: Blob): Promise<{ width: number; height: number } | null> {
  const bitmap = await createImageBitmap(blob);
  try {
    if (bitmap.width <= 0 || bitmap.height <= 0) return null;
    return { width: bitmap.width, height: bitmap.height };
  } finally {
    bitmap.close();
  }
}

async function decode(blob: Blob, target: { width: number; height: number }): Promise<ImageBitmap> {
  try {
    return await createImageBitmap(blob, {
      resizeWidth: target.width,
      resizeHeight: target.height,
      resizeQuality: 'high',
    });
  } catch {
    return createImageBitmap(blob);
  }
}

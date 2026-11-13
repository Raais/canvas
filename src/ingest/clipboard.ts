const MAX_DATA_URL_BYTES = 25 * 1024 * 1024;

const RASTER_MIME = new Map<string, string>([
  ['image/png', 'image/png'],
  ['image/jpeg', 'image/jpeg'],
  ['image/jpg', 'image/jpeg'],
  ['image/pjpeg', 'image/jpeg'],
  ['image/webp', 'image/webp'],
  ['image/gif', 'image/gif'],
  ['image/avif', 'image/avif'],
]);

const IMAGE_EXTENSION = /\.(png|jpe?g|webp|gif|avif)$/i;
const IMG_TAG = /<img\b[^>]*>/gi;
const SRC_ATTR = /\bsrc\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+))/i;

export type IngestAction =
  | { type: 'text'; text: string }
  | { type: 'file-image'; fileKey: string }
  | { type: 'bytes-image'; mimeType: string; bytes: Uint8Array }
  | { type: 'external-image'; url: string };

export type ClipboardImageRef = {
  key: string;
  mimeType: string;
};

export type InterpretResult = {
  actions: IngestAction[];
  warnings: string[];
};

export function canonicalRasterMime(mimeType: string): string | null {
  return RASTER_MIME.get(mimeType.trim().toLowerCase()) ?? null;
}

export function mimeFromFileName(name: string): string | null {
  const match = /\.([a-z0-9]+)$/i.exec(name.trim());
  if (!match?.[1]) return null;
  const extension = match[1].toLowerCase();
  if (extension === 'jpg' || extension === 'jpeg') return 'image/jpeg';
  if (extension === 'png') return 'image/png';
  if (extension === 'webp') return 'image/webp';
  if (extension === 'gif') return 'image/gif';
  if (extension === 'avif') return 'image/avif';
  return null;
}

export function contentSignature(mimeType: string, bytes: Uint8Array): string {
  let hash = 2166136261;
  const step = Math.max(1, Math.floor(bytes.length / 4096));
  for (let index = 0; index < bytes.length; index += step) {
    hash ^= bytes[index] ?? 0;
    hash = Math.imul(hash, 16777619);
  }
  return `${mimeType}:${bytes.length}:${hash >>> 0}`;
}

export function isDirectImageUrl(value: string): boolean {
  if (!isHttpUrl(value)) return false;
  try {
    return IMAGE_EXTENSION.test(new URL(value).pathname);
  } catch {
    return false;
  }
}

/**
 * Clipboard precedence: image bytes win, a standalone HTML image becomes an
 * external or embedded image, and mixed HTML falls back to plain text.
 * One copied picture must not become several notes because the clipboard
 * offered the same pixels in more than one representation.
 */
export function interpretClipboard(input: {
  imageKeys: readonly ClipboardImageRef[];
  html: string | null;
  plainText: string | null;
}): InterpretResult {
  if (input.imageKeys.length > 0) {
    const seen = new Set<string>();
    const actions: IngestAction[] = [];
    for (const image of input.imageKeys) {
      if (seen.has(image.key)) continue;
      seen.add(image.key);
      actions.push({ type: 'file-image', fileKey: image.key });
    }
    return { actions, warnings: [] };
  }

  const html = input.html?.trim() ? input.html : null;
  if (html) {
    const images = extractImageSources(html);
    const visible = visibleText(html);
    if (images.length > 0 && visible.length === 0) {
      return interpretStandaloneImages(images);
    }
    if (images.length > 0 && visible.length > 0) {
      const text = preferredText(input.plainText, visible);
      return text ? { actions: [{ type: 'text', text }], warnings: [] } : { actions: [], warnings: [] };
    }
  }

  const plain = input.plainText ?? '';
  const trimmed = plain.trim();
  if (!trimmed) return { actions: [], warnings: [] };
  if (isDirectImageUrl(trimmed)) return { actions: [{ type: 'external-image', url: trimmed }], warnings: [] };
  return { actions: [{ type: 'text', text: plain }], warnings: [] };
}

function interpretStandaloneImages(sources: readonly string[]): InterpretResult {
  const actions: IngestAction[] = [];
  const warnings: string[] = [];
  for (const source of sources) {
    const decoded = decodeImageSource(source);
    if (decoded.kind === 'bytes') {
      actions.push({ type: 'bytes-image', mimeType: decoded.mimeType, bytes: decoded.bytes });
    } else if (decoded.kind === 'url') {
      actions.push({ type: 'external-image', url: decoded.url });
    } else if (decoded.kind === 'warning') {
      warnings.push(decoded.message);
    }
  }
  if (actions.length === 0 && warnings.length === 0) {
    warnings.push('Could not use the pasted image.');
  }
  return { actions, warnings };
}

function decodeImageSource(
  source: string,
):
  | { kind: 'bytes'; mimeType: string; bytes: Uint8Array }
  | { kind: 'url'; url: string }
  | { kind: 'warning'; message: string }
  | { kind: 'skip' } {
  const decodedUrl = decodeHtmlEntities(source.trim());
  if (decodedUrl.toLowerCase().startsWith('data:')) {
    const data = decodeDataImage(decodedUrl);
    if ('error' in data) return { kind: 'warning', message: data.error };
    return { kind: 'bytes', mimeType: data.mimeType, bytes: data.bytes };
  }
  if (isHttpUrl(decodedUrl)) return { kind: 'url', url: decodedUrl };
  if (/^(javascript|file|blob):/i.test(decodedUrl)) {
    return { kind: 'warning', message: 'Skipped an image link that cannot be stored.' };
  }
  return { kind: 'skip' };
}

export function decodeDataImage(source: string): { mimeType: string; bytes: Uint8Array } | { error: string } {
  const match = /^data:([^;,]+)?((?:;[^,]*)*),([\s\S]*)$/i.exec(source.trim());
  if (!match) return { error: 'Could not decode an embedded image.' };
  const mimeType = canonicalRasterMime(match[1] ?? '');
  if (!mimeType) {
    if ((match[1] ?? '').toLowerCase().includes('svg')) {
      return { error: 'SVG images are not supported.' };
    }
    return { error: 'Could not decode an embedded image.' };
  }
  if (!/;base64/i.test(match[2] ?? '')) return { error: 'Could not decode an embedded image.' };
  const payload = (match[3] ?? '').replace(/\s+/g, '');
  try {
    const binary = atob(payload);
    if (binary.length > MAX_DATA_URL_BYTES) return { error: 'That embedded image is too large to store.' };
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
    return { mimeType, bytes };
  } catch {
    return { error: 'Could not decode an embedded image.' };
  }
}

function extractImageSources(html: string): string[] {
  const sources: string[] = [];
  for (const tag of html.match(IMG_TAG) ?? []) {
    const match = SRC_ATTR.exec(tag);
    const source = match?.[1] ?? match?.[2] ?? match?.[3];
    if (source) sources.push(source);
  }
  return sources;
}

function visibleText(html: string): string {
  return decodeHtmlEntities(
    html
      .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, ' ')
      .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, ' ')
      .replace(/<[^>]+>/g, ' '),
  )
    .replace(/\s+/g, ' ')
    .trim();
}

function preferredText(plainText: string | null, visible: string): string | null {
  if (plainText && plainText.trim()) return plainText;
  return visible || null;
}

function decodeHtmlEntities(value: string): string {
  return value
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>');
}

function isHttpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}

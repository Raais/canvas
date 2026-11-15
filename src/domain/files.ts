import { ARCHIVE_LIMITS } from '../archive/format';
import type { CodeLanguage } from './types';

export const TEXT_IMPORT_LIMIT = 1_048_576;

const IMAGE_EXTENSIONS = new Set(['png', 'jpg', 'jpeg', 'webp', 'gif', 'avif']);

const TEXT_EXTENSIONS: Record<string, { presentation: 'text' | 'markdown' | 'code'; codeLanguage?: CodeLanguage; language?: string }> = {
  md: { presentation: 'markdown' },
  markdown: { presentation: 'markdown' },
  txt: { presentation: 'text' },
  js: { presentation: 'code', codeLanguage: 'javascript', language: 'JavaScript' },
  mjs: { presentation: 'code', codeLanguage: 'javascript', language: 'JavaScript' },
  cjs: { presentation: 'code', codeLanguage: 'javascript', language: 'JavaScript' },
  jsx: { presentation: 'code', codeLanguage: 'javascript', language: 'JavaScript' },
  ts: { presentation: 'code', codeLanguage: 'typescript', language: 'TypeScript' },
  tsx: { presentation: 'code', codeLanguage: 'typescript', language: 'TypeScript' },
  py: { presentation: 'code', codeLanguage: 'python', language: 'Python' },
  json: { presentation: 'code', codeLanguage: 'json', language: 'JSON' },
  html: { presentation: 'code', codeLanguage: 'html', language: 'HTML' },
  htm: { presentation: 'code', codeLanguage: 'html', language: 'HTML' },
  css: { presentation: 'code', codeLanguage: 'css', language: 'CSS' },
  sh: { presentation: 'code', codeLanguage: 'shell', language: 'Shell' },
  bash: { presentation: 'code', codeLanguage: 'shell', language: 'Shell' },
  zsh: { presentation: 'code', codeLanguage: 'shell', language: 'Shell' },
};

export type IncomingClass =
  | { kind: 'text'; filename: string; presentation: 'text' | 'markdown' | 'code'; codeLanguage?: CodeLanguage; language?: string }
  | { kind: 'image'; filename: string }
  | { kind: 'file'; filename: string; mimeType: string }
  | { kind: 'reject'; filename: string; reason: 'oversize' | 'name' };

export function sanitizeFilename(value: string): string | null {
  const leaf = value.replace(/\\/g, '/').split('/').pop() ?? '';
  let cleaned = '';
  for (const char of leaf) {
    const code = char.charCodeAt(0);
    if (code < 32 || code === 127) continue;
    cleaned += char;
  }
  cleaned = cleaned.trim();
  if (!cleaned || cleaned === '.' || cleaned === '..') return null;
  return cleaned.length > 255 ? cleaned.slice(0, 255) : cleaned;
}

export function attachmentMime(type: string): string {
  if (type.length > 0 && type.length <= 127 && /^[A-Za-z0-9][A-Za-z0-9!#$&^_.+-]*\/[A-Za-z0-9][A-Za-z0-9!#$&^_.+-]*$/.test(type)) return type;
  return 'application/octet-stream';
}

export function fileExtension(filename: string): string {
  const dot = filename.lastIndexOf('.');
  if (dot <= 0) return '';
  return filename.slice(dot + 1).toLowerCase();
}

export function fileKindLabel(filename: string): string {
  const extension = fileExtension(filename);
  return extension ? extension.toUpperCase() : 'File';
}

export function classifyIncomingFile(file: { name: string; size: number; type: string }): IncomingClass {
  const filename = sanitizeFilename(file.name || 'file');
  if (!filename) return { kind: 'reject', filename: file.name || 'file', reason: 'name' };
  if (file.size > ARCHIVE_LIMITS.maxFileBytes) return { kind: 'reject', filename, reason: 'oversize' };
  const extension = fileExtension(filename);
  const text = TEXT_EXTENSIONS[extension];
  if (text) {
    if (file.size > TEXT_IMPORT_LIMIT) return { kind: 'file', filename, mimeType: attachmentMime(file.type) };
    return { kind: 'text', filename, presentation: text.presentation, ...(text.codeLanguage ? { codeLanguage: text.codeLanguage } : {}), ...(text.language ? { language: text.language } : {}) };
  }
  if (IMAGE_EXTENSIONS.has(extension) || (!extension && isRasterMime(file.type))) return { kind: 'image', filename };
  return { kind: 'file', filename, mimeType: attachmentMime(file.type) };
}

export function decodeTextFile(bytes: Uint8Array): string | null {
  if (bytes.includes(0)) return null;
  let start = 0;
  if (bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) start = 3;
  let text: string;
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(bytes.subarray(start));
  } catch {
    return null;
  }
  for (const char of text) {
    const code = char.charCodeAt(0);
    if (code === 9 || code === 10 || code === 13) continue;
    if (code < 32) return null;
  }
  return text;
}

export function rejectedFileMessage(filename: string, reason: 'oversize' | 'name'): string {
  if (reason === 'name') return `Skipped ${filename}: the file name cannot be used.`;
  return `Skipped ${filename}: files larger than ${ARCHIVE_LIMITS.maxFileBytes / (1024 * 1024)} MiB cannot be added.`;
}

function isRasterMime(type: string): boolean {
  return type === 'image/png' || type === 'image/jpeg' || type === 'image/webp' || type === 'image/gif' || type === 'image/avif';
}

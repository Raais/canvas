export const ZIP_PATH_LIMIT = 512;
export const ZIP_PATH_DEPTH = 16;

/** Component-aware ZIP path check. `draft..txt` is a file name. `../draft.txt` is not. */
export function zipPathProblem(value: string): string | null {
  if (!value || value.length > ZIP_PATH_LIMIT) return 'This ZIP path is unsafe.';
  if (value.includes('\\') || value.includes('\u0000')) return 'This ZIP path is unsafe.';
  for (const char of value) {
    const code = char.charCodeAt(0);
    if (code < 32 || code === 127) return 'This ZIP path is unsafe.';
  }
  const directory = value.endsWith('/');
  const body = directory ? value.slice(0, -1) : value;
  if (!body || body.startsWith('/') || body.includes('//')) return 'This ZIP path is unsafe.';
  const parts = body.split('/');
  if (parts.length > ZIP_PATH_DEPTH) return 'This ZIP path is unsafe.';
  for (const part of parts) {
    if (!part || part === '.' || part === '..') return 'This ZIP path is unsafe.';
    if (/^[A-Za-z]:/.test(part)) return 'This ZIP path is unsafe.';
  }
  return null;
}

export function canonicalZipPath(value: string): string {
  const directory = value.endsWith('/');
  const normalized = value.normalize('NFC');
  return directory && !normalized.endsWith('/') ? `${normalized}/` : normalized;
}

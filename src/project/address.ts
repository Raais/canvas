export function canonicalCanvasAddress(pathname: string, search = '', hash = ''): string | null {
  if (pathname !== '/canvas/') return null;
  return `/canvas${search}${hash}`;
}

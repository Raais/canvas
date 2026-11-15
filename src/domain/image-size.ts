export function formatStoredMegabytes(bytes: number | null | undefined): string | null {
  if (typeof bytes !== 'number' || !Number.isFinite(bytes) || bytes < 0) return null;
  const megabytes = bytes / 1_000_000;
  if (bytes > 0 && megabytes < 0.1) return '<0.1MB';
  return `${megabytes.toFixed(1)}MB`;
}

export function lookupEmbeddedByteSize(
  source: { type: string; assetId?: string },
  library: ReadonlyMap<string, { byteSize: number }>,
): number | undefined {
  if (source.type !== 'embedded' || typeof source.assetId !== 'string') return undefined;
  const size = library.get(source.assetId)?.byteSize;
  if (formatStoredMegabytes(size) === null) return undefined;
  return size;
}

export function nodeDateLabelText(dateLabel: string, byteSize: number | undefined): string {
  const size = formatStoredMegabytes(byteSize);
  return size ? `${size} | ${dateLabel}` : dateLabel;
}

export function nodeDateTitle(dateTitle: string, byteSize: number | undefined): string {
  if (byteSize === undefined || formatStoredMegabytes(byteSize) === null) return dateTitle;
  return `${dateTitle} · ${byteSize} bytes`;
}

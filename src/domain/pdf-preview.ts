import { fileExtension } from './files';

/** Manual zoom stops. Fit modes may use a smaller scale so a large page still fits. */
export const PDF_ZOOM_STEPS = [0.5, 0.75, 1, 1.25, 1.5, 2, 2.5, 3] as const;
export const PDF_MIN_ZOOM = PDF_ZOOM_STEPS[0];
export const PDF_MAX_ZOOM = PDF_ZOOM_STEPS[PDF_ZOOM_STEPS.length - 1];
/** Bitmap budget for one rendered page. Layout size and this cap are separate. */
export const PDF_MAX_PIXELS = 12_000_000;
export const PDF_MAX_CANVAS_EDGE = 4096;
export const PDF_SEARCH_PAGE_LIMIT = 400;
export const PDF_PASSWORD_MESSAGE = 'This PDF is password protected and cannot be previewed here.';
export const PDF_EMPTY_MESSAGE = 'This PDF is empty.';
export const PDF_INVALID_MESSAGE = 'This file is not a readable PDF.';
export const PDF_MISSING_MESSAGE = 'This PDF is missing from this browser.';

export const PDF_VIEWER_GUARDS = {
  renderAnnotationLayer: false,
  renderForms: false,
  enableScripting: false,
  isEvalSupported: false,
} as const;

const PDF_MARKER = [0x25, 0x50, 0x44, 0x46, 0x2d];

export function isPdfAttachment(filename: string, mimeType = ''): boolean {
  if (fileExtension(filename) === 'pdf') return true;
  return mimeType.trim().toLowerCase() === 'application/pdf';
}

export function pdfHeaderStatus(bytes: Uint8Array): 'empty' | 'invalid' | 'ok' {
  if (bytes.byteLength === 0) return 'empty';
  const window = Math.min(bytes.byteLength, 1024);
  for (let start = 0; start <= window - PDF_MARKER.length; start += 1) {
    let found = true;
    for (let index = 0; index < PDF_MARKER.length; index += 1) {
      if (bytes[start + index] !== PDF_MARKER[index]) {
        found = false;
        break;
      }
    }
    if (found) return 'ok';
  }
  return 'invalid';
}

export async function inspectPdfBlob(blob: Blob): Promise<'empty' | 'invalid' | 'ok'> {
  if (blob.size === 0) return 'empty';
  const head = new Uint8Array(await blob.slice(0, 1024).arrayBuffer());
  return pdfHeaderStatus(head);
}

export function pdfFailureMessage(error: unknown): string {
  const name = error && typeof error === 'object' && 'name' in error ? String(error.name) : '';
  const message = error instanceof Error ? error.message : '';
  if (name === 'PasswordException' || name === 'PasswordRequiredException' || /password/i.test(message)) return PDF_PASSWORD_MESSAGE;
  if (name === 'InvalidPDFException' || /invalid pdf/i.test(message)) return PDF_INVALID_MESSAGE;
  return 'This PDF could not be previewed.';
}

export function clampPage(page: number, count: number): number | null {
  if (!Number.isInteger(page) || count < 1 || page < 1 || page > count) return null;
  return page;
}

export function parsePageInput(value: string, count: number): number | null {
  const trimmed = value.trim();
  if (!/^\d+$/.test(trimmed)) return null;
  return clampPage(Number(trimmed), count);
}

export function settlePageRequest(requests: readonly number[], count: number): number {
  let page = 1;
  for (const request of requests) {
    const next = clampPage(request, count);
    if (next !== null) page = next;
  }
  return page;
}

export function stepZoom(current: number, direction: 1 | -1): number {
  if (direction > 0) {
    const higher = PDF_ZOOM_STEPS.find((step) => step > current + 0.001);
    return higher ?? PDF_MAX_ZOOM;
  }
  const lower = [...PDF_ZOOM_STEPS].reverse().find((step) => step < current - 0.001);
  return lower ?? PDF_MIN_ZOOM;
}

export function clampFitScale(scale: number): number {
  if (!Number.isFinite(scale) || scale <= 0) return 1;
  return Math.min(PDF_MAX_ZOOM, Math.max(0.05, scale));
}

export function fitScale(
  pageWidth: number,
  pageHeight: number,
  boxWidth: number,
  boxHeight: number,
  mode: 'width' | 'page',
): number {
  if (pageWidth <= 0 || pageHeight <= 0 || boxWidth <= 0 || boxHeight <= 0) return 1;
  const widthScale = boxWidth / pageWidth;
  if (mode === 'width') return clampFitScale(widthScale);
  return clampFitScale(Math.min(widthScale, boxHeight / pageHeight));
}

/** Device pixel ratio for one page, capped so the bitmap stays within the pixel budget. */
export function renderPixelRatio(cssWidth: number, cssHeight: number, deviceRatio: number): number {
  const wanted = Math.min(Math.max(Number.isFinite(deviceRatio) ? deviceRatio : 1, 1), 3);
  const width = Math.max(cssWidth, 1);
  const height = Math.max(cssHeight, 1);
  const byArea = Math.sqrt(PDF_MAX_PIXELS / (width * height));
  const byEdge = Math.min(PDF_MAX_CANVAS_EDGE / width, PDF_MAX_CANVAS_EDGE / height);
  return Math.max(0.25, Math.min(wanted, byArea, byEdge));
}

export function pdfDocumentOptions(baseUrl: string) {
  const root = `${baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`}pdfjs/`;
  return {
    isEvalSupported: PDF_VIEWER_GUARDS.isEvalSupported,
    enableScripting: PDF_VIEWER_GUARDS.enableScripting,
    enableXfa: false,
    cMapUrl: `${root}cmaps/`,
    cMapPacked: true,
    standardFontDataUrl: `${root}standard_fonts/`,
    wasmUrl: `${root}wasm/`,
    maxImageSize: PDF_MAX_PIXELS,
    disableAutoFetch: true,
    disableStream: true,
    useSystemFonts: true,
  };
}

export function escapePdfText(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

export function renderHighlightedText(text: string, query: string): string {
  const needle = query.trim();
  if (!needle) return escapePdfText(text);
  const lower = text.toLowerCase();
  const target = needle.toLowerCase();
  let cursor = 0;
  let html = '';
  while (cursor < text.length) {
    const at = lower.indexOf(target, cursor);
    if (at < 0) {
      html += escapePdfText(text.slice(cursor));
      break;
    }
    html += escapePdfText(text.slice(cursor, at));
    html += `<mark class="pdf-hit">${escapePdfText(text.slice(at, at + target.length))}</mark>`;
    cursor = at + target.length;
  }
  return html;
}

export type PdfMatch = { page: number; index: number };

export function findInPageText(page: number, text: string, query: string): PdfMatch[] {
  const needle = query.trim().toLowerCase();
  if (!needle || page < 1) return [];
  const haystack = text.toLowerCase();
  const matches: PdfMatch[] = [];
  let from = 0;
  while (from <= haystack.length) {
    const at = haystack.indexOf(needle, from);
    if (at < 0) break;
    matches.push({ page, index: at });
    from = at + needle.length;
  }
  return matches;
}

export type PdfSearchResult = {
  matches: PdfMatch[];
  extractable: boolean;
  complete: boolean;
  cancelled: boolean;
  searchedPages: number;
  pageCount: number;
};

export async function collectPdfMatches(
  pageCount: number,
  query: string,
  readPage: (page: number) => Promise<string>,
  signal: AbortSignal,
  onProgress?: (done: number, total: number) => void,
): Promise<PdfSearchResult> {
  const limit = Math.min(Math.max(pageCount, 0), PDF_SEARCH_PAGE_LIMIT);
  const matches: PdfMatch[] = [];
  let extractable = false;
  for (let page = 1; page <= limit; page += 1) {
    if (signal.aborted) {
      return { matches, extractable, complete: false, cancelled: true, searchedPages: page - 1, pageCount };
    }
    const text = await readPage(page);
    if (text.trim().length > 0) extractable = true;
    matches.push(...findInPageText(page, text, query));
    if (page % 8 === 0) {
      onProgress?.(page, limit);
      await new Promise((resolve) => setTimeout(resolve, 0));
      if (signal.aborted) {
        return { matches, extractable, complete: false, cancelled: true, searchedPages: page, pageCount };
      }
    }
  }
  return {
    matches,
    extractable,
    complete: pageCount <= PDF_SEARCH_PAGE_LIMIT,
    cancelled: false,
    searchedPages: limit,
    pageCount,
  };
}

export function acceptSearchResult(startedQuery: string, currentQuery: string): boolean {
  return startedQuery === currentQuery;
}

export function createPdfObjectUrl(blob: Blob): { url: string; release: () => void } {
  const url = URL.createObjectURL(blob);
  let released = false;
  return {
    url,
    release() {
      if (released) return;
      released = true;
      URL.revokeObjectURL(url);
    },
  };
}

export type PdfReadingMode = 'scroll' | 'paged';
export type PdfZoomMode = 'fit-width' | 'fit-page' | 'manual';
export type PdfPageSize = { width: number; height: number };
export type PdfScrollIntent = 'user' | 'program';

export const PDF_DEFAULT_READING_MODE: PdfReadingMode = 'scroll';
export const PDF_PAGE_GAP = 16;
export const PDF_SCROLL_OVERSCAN = 2;
export const PDF_MAX_MOUNTED_PAGES = 8;
export const PDF_FALLBACK_PAGE: PdfPageSize = { width: 612, height: 792 };

export type PdfLayout = {
  tops: number[];
  heights: number[];
  widths: number[];
  total: number;
};

export function initialReadingMode(): PdfReadingMode {
  return PDF_DEFAULT_READING_MODE;
}

export function reopenViewer(memory: { page?: number; readingMode?: PdfReadingMode }): { page: number; readingMode: PdfReadingMode } {
  const page = memory.page && memory.page >= 1 ? Math.floor(memory.page) : 1;
  return { page, readingMode: 'scroll' };
}

export function estimateNatural(fallback: PdfPageSize = PDF_FALLBACK_PAGE): PdfPageSize {
  return fallback;
}

export function pageDisplaySize(
  natural: PdfPageSize,
  zoomMode: PdfZoomMode,
  manual: number,
  box: PdfPageSize,
): PdfPageSize {
  const scale = zoomMode === 'manual'
    ? manual
    : fitScale(natural.width, natural.height, box.width, box.height, zoomMode === 'fit-page' ? 'page' : 'width');
  return { width: natural.width * scale, height: natural.height * scale };
}

export function layoutPdfPages(
  count: number,
  sizes: ReadonlyMap<number, PdfPageSize>,
  display: (natural: PdfPageSize) => PdfPageSize,
  gap = PDF_PAGE_GAP,
): PdfLayout {
  const estimate = estimateNatural();
  const tops: number[] = [];
  const heights: number[] = [];
  const widths: number[] = [];
  let cursor = 0;
  for (let page = 1; page <= count; page += 1) {
    const shown = display(sizes.get(page) ?? estimate);
    tops.push(cursor);
    widths.push(shown.width);
    heights.push(shown.height);
    cursor += shown.height;
    if (page < count) cursor += gap;
  }
  return { tops, heights, widths, total: cursor };
}

export function activeScrollPage(scrollTop: number, viewportHeight: number, layout: PdfLayout): number {
  const count = layout.tops.length;
  if (count === 0) return 1;
  const viewTop = Math.max(0, scrollTop);
  const viewBottom = viewTop + Math.max(viewportHeight, 1);
  const center = viewTop + Math.max(viewportHeight, 1) / 2;
  let best = 1;
  let bestOverlap = -1;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (let index = 0; index < count; index += 1) {
    const top = layout.tops[index] ?? 0;
    const bottom = top + (layout.heights[index] ?? 0);
    const overlap = Math.max(0, Math.min(bottom, viewBottom) - Math.max(top, viewTop));
    const distance = Math.abs((top + bottom) / 2 - center);
    if (overlap > bestOverlap + 0.5 || (Math.abs(overlap - bestOverlap) <= 0.5 && distance < bestDistance)) {
      best = index + 1;
      bestOverlap = overlap;
      bestDistance = distance;
    }
  }
  if (bestOverlap <= 0) {
    for (let index = 0; index < count; index += 1) {
      const bottom = (layout.tops[index] ?? 0) + (layout.heights[index] ?? 0);
      if (bottom > viewTop) return index + 1;
    }
    return count;
  }
  return best;
}

export function pageFromUserScroll(
  scrollTop: number,
  viewportHeight: number,
  layout: PdfLayout,
  intent: PdfScrollIntent,
): number | null {
  if (intent === 'program') return null;
  return activeScrollPage(scrollTop, viewportHeight, layout);
}

export function mountedPdfPages(
  scrollTop: number,
  viewportHeight: number,
  layout: PdfLayout,
  overscan = PDF_SCROLL_OVERSCAN,
  maxMounted = PDF_MAX_MOUNTED_PAGES,
  pinnedPage: number | null = null,
): number[] {
  const count = layout.tops.length;
  if (count === 0) return [];
  const viewBottom = scrollTop + Math.max(viewportHeight, 1);
  let first = count;
  for (let index = 0; index < count; index += 1) {
    const top = layout.tops[index] ?? 0;
    const bottom = top + (layout.heights[index] ?? 0);
    if (bottom > scrollTop && top < viewBottom) {
      first = index + 1;
      break;
    }
  }
  if (first > count) first = count;
  let last = first;
  for (let page = first; page <= count; page += 1) {
    const top = layout.tops[page - 1] ?? 0;
    if (top >= viewBottom) break;
    last = page;
  }
  first = Math.max(1, first - overscan);
  last = Math.min(count, last + overscan);
  const pages: number[] = [];
  for (let page = first; page <= last; page += 1) pages.push(page);
  if (pinnedPage && pinnedPage >= 1 && pinnedPage <= count && !pages.includes(pinnedPage)) pages.push(pinnedPage);
  if (pages.length <= maxMounted) return pages;
  const focus = pinnedPage ?? activeScrollPage(scrollTop, viewportHeight, layout);
  return pages.sort((left, right) => Math.abs(left - focus) - Math.abs(right - focus) || left - right).slice(0, maxMounted).sort((left, right) => left - right);
}

export function pageScrollTop(page: number, layout: PdfLayout): number {
  return layout.tops[page - 1] ?? 0;
}

export function scrollAnchor(scrollTop: number, layout: PdfLayout): { page: number; ratio: number } {
  const page = activeScrollPage(scrollTop, 1, layout);
  const top = layout.tops[page - 1] ?? 0;
  const height = layout.heights[page - 1] || 1;
  const ratio = Math.min(1, Math.max(0, (scrollTop - top) / height));
  return { page, ratio };
}

export function scrollTopForAnchor(anchor: { page: number; ratio: number }, layout: PdfLayout): number {
  const top = layout.tops[anchor.page - 1] ?? 0;
  const height = layout.heights[anchor.page - 1] ?? 0;
  return top + anchor.ratio * height;
}

/** Preserve the visible document location after page geometry changes. */
export function measurementScrollTop(scrollTop: number, before: PdfLayout, after: PdfLayout): number {
  if (before.tops.length === 0 || after.tops.length === 0) return Math.max(0, scrollTop);
  const index = Math.min(activeScrollPage(scrollTop, 1, before) - 1, after.tops.length - 1);
  const beforeTop = before.tops[index] ?? 0;
  const beforeHeight = before.heights[index] || 1;
  const afterTop = after.tops[index] ?? 0;
  const afterHeight = after.heights[index] ?? beforeHeight;
  const aboveDelta = afterTop - beforeTop;
  if (Math.abs(afterHeight - beforeHeight) <= 0.5) return Math.max(0, scrollTop + aboveDelta);
  const ratio = Math.min(1, Math.max(0, (scrollTop - beforeTop) / beforeHeight));
  return Math.max(0, afterTop + ratio * afterHeight);
}

export function consumeScrollJump(page: number | null, userMoved: boolean): number | null {
  if (userMoved) return null;
  return page;
}

export function compensateScroll(
  scrollTop: number,
  previousHeight: number,
  nextHeight: number,
  previousTop: number,
): number {
  const previousBottom = previousTop + previousHeight;
  if (previousBottom <= scrollTop + 0.5) return scrollTop + (nextHeight - previousHeight);
  return scrollTop;
}

export function searchStatusLabel(result: PdfSearchResult, query: string): string {
  if (!query.trim()) return '';
  if (result.cancelled) return '';
  if (!result.extractable) return 'This PDF has no extractable text.';
  const count = result.matches.length === 1 ? '1 match' : `${result.matches.length} matches`;
  if (!result.complete) return `Searched the first ${result.searchedPages} of ${result.pageCount} pages. ${count}.`;
  if (result.matches.length === 0) return 'No matches.';
  return count;
}

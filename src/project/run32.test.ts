import { describe, expect, test } from 'bun:test';

declare const Bun: {
  file(path: string): { json(): Promise<unknown> };
};
import { ARCHIVE_VERSION } from '../archive/format';
import { buildArchive, readArchive } from '../archive/zip';
import { addNodes, createEmptyBoard, createFileNode } from '../domain/board';
import { duplicateSelection } from '../domain/groups';
import { GRAPH_CLIPBOARD_VERSION, encodeGraphClipboard, selectionClosure } from '../domain/graph-clipboard';
import {
  PDF_MAX_CANVAS_EDGE,
  PDF_MAX_PIXELS,
  PDF_PASSWORD_MESSAGE,
  PDF_SEARCH_PAGE_LIMIT,
  PDF_VIEWER_GUARDS,
  acceptSearchResult,
  clampPage,
  collectPdfMatches,
  createPdfObjectUrl,
  findInPageText,
  fitScale,
  inspectPdfBlob,
  isPdfAttachment,
  parsePageInput,
  pdfDocumentOptions,
  pdfFailureMessage,
  pdfHeaderStatus,
  renderHighlightedText,
  renderPixelRatio,
  searchStatusLabel,
  settlePageRequest,
  stepZoom,
} from '../domain/pdf-preview';
import { buildSearchIndex, searchNodes } from '../domain/search';
import { DATABASE_VERSION } from '../persistence/db';
import { decidePwaUpdate } from './pwa-update';
import { SCHEMA_VERSION, type AssetRecord } from '../domain/types';

const now = '2026-11-16T04:00:00.000Z';
const later = '2026-11-16T05:00:00.000Z';

describe('pdf preview', () => {
  test('recognizes pdf attachments and rejects other files', () => {
    expect(SCHEMA_VERSION).toBe(18);
    expect(ARCHIVE_VERSION).toBe(2);
    expect(GRAPH_CLIPBOARD_VERSION).toBe(1);
    expect(DATABASE_VERSION).toBe(1);
    expect(isPdfAttachment('research-paper.pdf')).toBe(true);
    expect(isPdfAttachment('research-paper.PDF')).toBe(true);
    expect(isPdfAttachment('notes.bin', 'application/pdf')).toBe(true);
    expect(isPdfAttachment('folder/paper.pdf', 'application/octet-stream')).toBe(true);
    expect(isPdfAttachment('notes.txt', 'text/plain')).toBe(false);
    expect(isPdfAttachment('photos.zip', 'application/zip')).toBe(false);
    expect(pdfHeaderStatus(new Uint8Array())).toBe('empty');
    expect(pdfHeaderStatus(new TextEncoder().encode('not a pdf'))).toBe('invalid');
    expect(pdfHeaderStatus(new TextEncoder().encode('%PDF-1.7'))).toBe('ok');
    expect(PDF_VIEWER_GUARDS.enableScripting).toBe(false);
    expect(PDF_VIEWER_GUARDS.isEvalSupported).toBe(false);
    expect(PDF_VIEWER_GUARDS.renderAnnotationLayer).toBe(false);
    expect(PDF_VIEWER_GUARDS.renderForms).toBe(false);
    const options = pdfDocumentOptions('/canvas/');
    expect(options.enableScripting).toBe(false);
    expect(options.isEvalSupported).toBe(false);
    expect(options.cMapUrl).toBe('/canvas/pdfjs/cmaps/');
    expect(options.wasmUrl).toBe('/canvas/pdfjs/wasm/');
    expect(options.cMapUrl.includes('cdn')).toBe(false);
  });

  test('keeps page, zoom, and search bounds local to the document', async () => {
    expect(parsePageInput('12', 48)).toBe(12);
    expect(parsePageInput('0', 48)).toBeNull();
    expect(parsePageInput('49', 48)).toBeNull();
    expect(parsePageInput('1.5', 48)).toBeNull();
    expect(parsePageInput('nope', 48)).toBeNull();
    expect(clampPage(1, 1)).toBe(1);
    expect(settlePageRequest([1, 20, 3, 100, 5], 120)).toBe(5);
    expect(stepZoom(1, 1)).toBe(1.25);
    expect(stepZoom(1, -1)).toBe(0.75);
    expect(stepZoom(3, 1)).toBe(3);
    expect(stepZoom(0.5, -1)).toBe(0.5);
    expect(fitScale(800, 400, 400, 400, 'page')).toBe(0.5);
    expect(fitScale(200, 400, 400, 200, 'width')).toBe(2);
    const ratio = renderPixelRatio(8000, 8000, 3);
    expect(ratio * 8000 <= PDF_MAX_CANVAS_EDGE && ratio * ratio * 8000 * 8000 <= PDF_MAX_PIXELS).toBe(true);
    const hits = findInPageText(2, 'Hello Canvas', 'canvas');
    expect(hits).toEqual([{ page: 2, index: 6 }]);
    expect(findInPageText(1, 'Hello', 'missing')).toEqual([]);
    const marked = renderHighlightedText('<script>alert(1)</script>', '<script>');
    expect(marked.includes('<script')).toBe(false);
    expect(marked.includes('&lt;script&gt;')).toBe(true);
    expect(renderHighlightedText('safe', '<img src=x onerror=alert(1)>').includes('<img')).toBe(false);
    const imageOnly = await collectPdfMatches(2, 'word', async () => '', new AbortController().signal);
    expect(imageOnly.extractable).toBe(false);
    expect(searchStatusLabel(imageOnly, 'word')).toBe('This PDF has no extractable text.');
    const found = await collectPdfMatches(2, 'Alpha', async (page) => (page === 2 ? 'Alpha note' : 'other'), new AbortController().signal);
    expect(found.matches).toEqual([{ page: 2, index: 0 }]);
    expect(found.complete).toBe(true);
    expect(searchStatusLabel({ ...found, matches: [] }, 'Alpha')).toBe('No matches.');
    const stopped = new AbortController();
    stopped.abort();
    const cancelled = await collectPdfMatches(4, 'Alpha', async () => 'Alpha', stopped.signal);
    expect(cancelled.cancelled).toBe(true);
    expect(cancelled.complete).toBe(false);
    expect(acceptSearchResult('Alpha', 'Beta')).toBe(false);
    let reads = 0;
    const limited = await collectPdfMatches(PDF_SEARCH_PAGE_LIMIT + 1, 'a', async () => {
      reads += 1;
      return 'a';
    }, new AbortController().signal);
    expect(reads).toBe(PDF_SEARCH_PAGE_LIMIT);
    expect(limited.complete).toBe(false);
    expect(searchStatusLabel(limited, 'a').includes('first 400')).toBe(true);
    expect(pdfFailureMessage(Object.assign(new Error('locked'), { name: 'PasswordException' }))).toBe(PDF_PASSWORD_MESSAGE);
    const empty = await inspectPdfBlob(new Blob([]));
    expect(empty).toBe('empty');
    const bad = await inspectPdfBlob(new Blob([new TextEncoder().encode('hello.pdf')]));
    expect(bad).toBe('invalid');
    const bytes = new TextEncoder().encode('%PDF-1.7\nSECRET-PDF-TEXT');
    const good = await inspectPdfBlob(new Blob([bytes]));
    expect(good).toBe('ok');
    expect(new TextEncoder().encode(await new Blob([bytes]).text()).join(',')).toBe(bytes.join(','));
  });

  test('preview does not copy the pdf into the board, search, clipboard, or a new archive format', async () => {
    const bytes = new TextEncoder().encode('%PDF-1.7\nSECRET-PDF-TEXT');
    const file = createFileNode({ center: { x: 100, y: 80 }, assetId: 'pdf-1', filename: 'paper.pdf', now });
    const board = addNodes(createEmptyBoard(now), [file], now);
    expect(board.revision).toBe(addNodes(createEmptyBoard(now), [file], now).revision);
    expect(board.schemaVersion).toBe(18);
    const index = buildSearchIndex(board.nodes);
    expect(searchNodes(index, 'SECRET-PDF-TEXT')).toEqual([]);
    expect(index.find((entry) => entry.id === file.id)?.body).toBe('');
    const copied = duplicateSelection(board, [file.id], later);
    const files = copied.nodes.filter((node) => node.kind === 'file');
    expect(files).toHaveLength(2);
    expect(files[0]?.kind === 'file' && files[1]?.kind === 'file' ? files[0].assetId : '').toBe('pdf-1');
    expect(files[1]?.kind === 'file' ? files[1].assetId : '').toBe('pdf-1');
    const clip = selectionClosure(board, [file.id]);
    expect(clip ? encodeGraphClipboard(clip).includes('SECRET-PDF-TEXT') : true).toBe(false);
    const asset: AssetRecord = {
      id: 'pdf-1',
      mimeType: 'application/pdf',
      byteSize: bytes.byteLength,
      createdAt: now,
      blob: new Blob([bytes], { type: 'application/pdf' }),
    };
    const opened = await readArchive(await buildArchive(board, [asset], now));
    if ('error' in opened) throw new Error(opened.error);
    const restored = new Uint8Array(await opened.assets[0]!.blob.arrayBuffer());
    expect(restored.join(',')).toBe(bytes.join(','));
    expect(decidePwaUpdate({
      editingNote: false,
      editingRelationship: false,
      confirming: false,
      ingesting: false,
      adjustingRotation: false,
      pdfViewing: true,
      focusedField: false,
      readOnly: false,
      saveStatus: 'saved',
      hasUnpersisted: false,
      hasRecovery: false,
      expectationMatches: true,
    }).action).toBe('block');
    const handle = createPdfObjectUrl(asset.blob);
    expect(handle.url.startsWith('blob:')).toBe(true);
    handle.release();
    handle.release();
    const pdfjs = await Bun.file('node_modules/pdfjs-dist/package.json').json() as { version: string };
    const reactPdf = await Bun.file('node_modules/react-pdf/package.json').json() as { version: string; dependencies: { 'pdfjs-dist': string } };
    expect(reactPdf.version).toBe('11.1.0');
    expect(pdfjs.version).toBe('6.5.438');
    expect(reactPdf.dependencies['pdfjs-dist']).toBe('6.5.438');
    expect(atLeast(pdfjs.version, '6.2.108')).toBe(true);
  });
});

function atLeast(version: string, floor: string): boolean {
  const left = version.split('.').map(Number);
  const right = floor.split('.').map(Number);
  for (let index = 0; index < 3; index += 1) {
    const current = left[index] ?? 0;
    const required = right[index] ?? 0;
    if (current > required) return true;
    if (current < required) return false;
  }
  return true;
}

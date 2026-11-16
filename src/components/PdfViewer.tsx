import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Document, Page, pdfjs } from 'react-pdf';
import 'react-pdf/dist/Page/TextLayer.css';
import {
  PDF_MAX_MOUNTED_PAGES,
  PDF_MISSING_MESSAGE,
  PDF_PASSWORD_MESSAGE,
  PDF_SCROLL_OVERSCAN,
  PDF_VIEWER_GUARDS,
  acceptSearchResult,
  activeScrollPage,
  collectPdfMatches,
  compensateScroll,
  createPdfObjectUrl,
  initialReadingMode,
  inspectPdfBlob,
  layoutPdfPages,
  mountedPdfPages,
  pageDisplaySize,
  pageFromUserScroll,
  pageScrollTop,
  parsePageInput,
  pdfDocumentOptions,
  pdfFailureMessage,
  renderHighlightedText,
  renderPixelRatio,
  scrollAnchor,
  scrollTopForAnchor,
  searchStatusLabel,
  stepZoom,
  type PdfLayout,
  type PdfPageSize,
  type PdfReadingMode,
  type PdfScrollIntent,
  type PdfSearchResult,
  type PdfZoomMode,
} from '../domain/pdf-preview';

pdfjs.GlobalWorkerOptions.workerSrc = new URL('pdfjs-dist/build/pdf.worker.min.mjs', import.meta.url).toString();

const sessionPages = new Map<string, number>();

type PdfProxy = {
  numPages: number;
  getPage: (page: number) => Promise<{
    getViewport: (options: { scale: number }) => { width: number; height: number };
    getTextContent: () => Promise<{ items: Array<{ str?: string }> }>;
  }>;
};

function selectedPdfPage(stage: HTMLElement | null): number | null {
  if (!stage || typeof document === 'undefined') return null;
  const selection = document.getSelection();
  if (!selection || selection.isCollapsed || !selection.anchorNode || !stage.contains(selection.anchorNode)) return null;
  const element = selection.anchorNode instanceof Element ? selection.anchorNode : selection.anchorNode.parentElement;
  const sheet = element?.closest('[data-pdf-page]');
  const page = Number(sheet?.getAttribute('data-pdf-page'));
  return Number.isInteger(page) && page > 0 ? page : null;
}

export function PdfViewer({
  memoryKey,
  filename,
  blob,
  onClose,
  onDownload,
}: {
  memoryKey: string;
  filename: string;
  blob: Blob | null;
  onClose: () => void;
  onDownload: () => void;
}) {
  const options = useMemo(() => pdfDocumentOptions(import.meta.env.BASE_URL), []);
  const dialogRef = useRef<HTMLDivElement>(null);
  const findRef = useRef<HTMLInputElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const pdfRef = useRef<PdfProxy | null>(null);
  const searchRef = useRef<AbortController | null>(null);
  const sizesRef = useRef(new Map<number, PdfPageSize>());
  const layoutRef = useRef<PdfLayout>({ tops: [], heights: [], widths: [], total: 0 });
  const pageRef = useRef(sessionPages.get(memoryKey) ?? 1);
  const pageCountRef = useRef(0);
  const readingRef = useRef<PdfReadingMode>(initialReadingMode());
  const intentRef = useRef<PdfScrollIntent>('user');
  const anchorRef = useRef<{ page: number; ratio: number } | null>(null);
  const pendingJump = useRef<number | null>(null);
  const programTimer = useRef(0);
  const displayRef = useRef<(natural: PdfPageSize) => PdfPageSize>((natural) => natural);
  const [url, setUrl] = useState<string | null>(null);
  const [header, setHeader] = useState<'checking' | 'ok' | 'bad'>(blob ? 'checking' : 'bad');
  const [failure, setFailure] = useState<string | null>(blob ? null : PDF_MISSING_MESSAGE);
  const [pageCount, setPageCount] = useState(0);
  const [page, setPage] = useState(() => sessionPages.get(memoryKey) ?? 1);
  const [pageDraft, setPageDraft] = useState(String(sessionPages.get(memoryKey) ?? 1));
  const [readingMode, setReadingMode] = useState<PdfReadingMode>(initialReadingMode);
  const [zoomMode, setZoomMode] = useState<PdfZoomMode>('fit-width');
  const [manual, setManual] = useState(1);
  const [sizes, setSizes] = useState(sizesRef.current);
  const [box, setBox] = useState({ width: 0, height: 0 });
  const [scrollTop, setScrollTop] = useState(0);
  const [query, setQuery] = useState('');
  const [searching, setSearching] = useState(false);
  const [progress, setProgress] = useState('');
  const [result, setResult] = useState<PdfSearchResult | null>(null);
  const [cursor, setCursor] = useState(0);
  const [findOpen, setFindOpen] = useState(false);
  pageRef.current = page;
  pageCountRef.current = pageCount;
  readingRef.current = readingMode;

  const display = useCallback((natural: PdfPageSize) => pageDisplaySize(natural, zoomMode, manual, box), [zoomMode, manual, box]);
  displayRef.current = display;
  const layout = useMemo(() => layoutPdfPages(pageCount, sizes, display), [pageCount, sizes, display]);
  layoutRef.current = layout;
  const activeNatural = sizes.get(page) ?? sizes.values().next().value ?? { width: 612, height: 792 };
  const activeDisplay = pageDisplaySize(activeNatural, zoomMode, manual, box);
  const scale = activeNatural.width > 0 ? activeDisplay.width / activeNatural.width : 1;
  const percent = `${Math.round(scale * 100)}%`;
  const highlight = useCallback((item: { str: string }) => renderHighlightedText(item.str, query), [query]);
  const mounted = readingMode === 'scroll'
    ? mountedPdfPages(scrollTop, box.height, layout, PDF_SCROLL_OVERSCAN, PDF_MAX_MOUNTED_PAGES, selectedPdfPage(stageRef.current))
    : [];

  const remember = useCallback((pageNumber: number, width: number, height: number) => {
    if (!(width > 0) || !(height > 0)) return;
    const current = sizesRef.current.get(pageNumber);
    if (current && Math.abs(current.width - width) < 0.5 && Math.abs(current.height - height) < 0.5) return;
    const before = layoutRef.current;
    const next = new Map(sizesRef.current);
    next.set(pageNumber, { width, height });
    sizesRef.current = next;
    const stage = stageRef.current;
    if (readingRef.current === 'scroll' && stage && before.heights.length >= pageNumber) {
      const nextLayout = layoutPdfPages(pageCountRef.current, next, displayRef.current);
      stage.scrollTop = compensateScroll(
        stage.scrollTop,
        before.heights[pageNumber - 1] ?? 0,
        nextLayout.heights[pageNumber - 1] ?? 0,
        before.tops[pageNumber - 1] ?? 0,
      );
    }
    setSizes(next);
  }, []);

  const beginProgrammatic = useCallback(() => {
    intentRef.current = 'program';
    window.clearTimeout(programTimer.current);
    programTimer.current = window.setTimeout(() => {
      intentRef.current = 'user';
      const stage = stageRef.current;
      if (!stage || readingRef.current !== 'scroll') return;
      const next = pageFromUserScroll(stage.scrollTop, stage.clientHeight, layoutRef.current, 'user');
      if (!next || next === pageRef.current) return;
      pageRef.current = next;
      setPage(next);
      setPageDraft(String(next));
    }, 450);
  }, []);

  const showPage = useCallback((next: number) => {
    const count = pageCountRef.current;
    const pageNumber = count > 0 ? Math.min(count, Math.max(1, next)) : Math.max(1, next);
    pageRef.current = pageNumber;
    setPage(pageNumber);
    setPageDraft(String(pageNumber));
    if (readingRef.current !== 'scroll') return;
    const top = layoutRef.current.tops[pageNumber - 1];
    const stage = stageRef.current;
    if (!stage || top === undefined) {
      pendingJump.current = pageNumber;
      return;
    }
    beginProgrammatic();
    const distance = Math.abs(pageNumber - activeScrollPage(stage.scrollTop, stage.clientHeight, layoutRef.current));
    stage.scrollTo({ top, behavior: distance > 2 ? 'auto' : 'smooth' });
  }, [beginProgrammatic]);
  const showPageRef = useRef(showPage);
  showPageRef.current = showPage;

  useEffect(() => {
    if (!blob) return;
    let live = true;
    const handle = createPdfObjectUrl(blob);
    setUrl(handle.url);
    setReadingMode(initialReadingMode());
    sizesRef.current = new Map();
    setSizes(sizesRef.current);
    void inspectPdfBlob(blob).then((status) => {
      if (!live) return;
      if (status === 'empty') {
        setHeader('bad');
        setFailure('This PDF is empty.');
        return;
      }
      if (status === 'invalid') {
        setHeader('bad');
        setFailure('This file is not a readable PDF.');
        return;
      }
      setHeader('ok');
    });
    return () => {
      live = false;
      handle.release();
      setUrl(null);
    };
  }, [blob]);

  useEffect(() => {
    const stage = stageRef.current;
    if (!stage) return;
    const measure = () => {
      const styles = getComputedStyle(stage);
      const padX = Number.parseFloat(styles.paddingLeft) + Number.parseFloat(styles.paddingRight);
      const padY = Number.parseFloat(styles.paddingTop) + Number.parseFloat(styles.paddingBottom);
      if (readingRef.current === 'scroll' && layoutRef.current.total > 0) {
        anchorRef.current = scrollAnchor(stage.scrollTop, layoutRef.current);
      }
      setBox({
        width: Math.max(0, stage.clientWidth - padX),
        height: Math.max(0, stage.clientHeight - padY),
      });
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(stage);
    return () => observer.disconnect();
  }, [failure]);

  useEffect(() => {
    const proxy = pdfRef.current;
    if (!proxy || pageCount < 1) return;
    let cancelled = false;
    const targets = [page, page + 1].filter((target) => target >= 1 && target <= pageCount && !sizesRef.current.has(target));
    for (const target of targets) {
      void proxy.getPage(target).then((pdfPage) => {
        if (cancelled) return;
        const view = pdfPage.getViewport({ scale: 1 });
        remember(target, view.width, view.height);
      }).catch(() => undefined);
    }
    return () => {
      cancelled = true;
    };
  }, [page, pageCount, remember]);

  useEffect(() => {
    sessionPages.set(memoryKey, page);
  }, [memoryKey, page]);

  useEffect(() => () => {
    searchRef.current?.abort();
    window.clearTimeout(programTimer.current);
  }, []);

  useLayoutEffect(() => {
    if (readingMode !== 'paged') return;
    const stage = stageRef.current;
    if (stage) stage.scrollTop = 0;
  }, [readingMode]);

  useLayoutEffect(() => {
    const stage = stageRef.current;
    if (!stage || readingMode !== 'scroll') return;
    const anchor = anchorRef.current;
    if (anchor) {
      beginProgrammatic();
      stage.scrollTop = scrollTopForAnchor(anchor, layout);
      anchorRef.current = null;
      setScrollTop(stage.scrollTop);
      return;
    }
    const jump = pendingJump.current;
    if (!jump) return;
    const top = layout.tops[jump - 1];
    if (top === undefined) return;
    beginProgrammatic();
    stage.scrollTop = top;
    pendingJump.current = null;
    setScrollTop(stage.scrollTop);
  }, [beginProgrammatic, layout, readingMode]);

  const close = useCallback(() => {
    searchRef.current?.abort();
    window.clearTimeout(programTimer.current);
    sessionPages.set(memoryKey, pageRef.current);
    onClose();
  }, [memoryKey, onClose]);

  useEffect(() => {
    dialogRef.current?.focus();
  }, []);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target;
      const field = target instanceof HTMLElement && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable);
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'f' && !event.altKey) {
        event.preventDefault();
        event.stopPropagation();
        setFindOpen(true);
        requestAnimationFrame(() => findRef.current?.focus());
        return;
      }
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        if (findOpen) {
          setFindOpen(false);
          return;
        }
        close();
        return;
      }
      if (field || event.metaKey || event.ctrlKey || event.altKey) return;
      if (event.key === 'ArrowLeft') {
        event.preventDefault();
        event.stopPropagation();
        showPageRef.current(pageRef.current - 1);
      } else if (event.key === 'ArrowRight' && pageCountRef.current > 0) {
        event.preventDefault();
        event.stopPropagation();
        showPageRef.current(pageRef.current + 1);
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [close, findOpen]);

  const commitPage = useCallback(() => {
    const parsed = parsePageInput(pageDraft, pageCount);
    if (parsed === null) {
      setPageDraft(String(pageRef.current));
      return;
    }
    showPage(parsed);
  }, [pageCount, pageDraft, showPage]);

  const runSearch = useCallback(async (nextQuery: string) => {
    const proxy = pdfRef.current;
    const trimmed = nextQuery.trim();
    searchRef.current?.abort();
    if (!proxy || !trimmed) {
      setResult(null);
      setSearching(false);
      setProgress('');
      return;
    }
    const controller = new AbortController();
    searchRef.current = controller;
    setSearching(true);
    setProgress('Searching…');
    const outcome = await collectPdfMatches(proxy.numPages, trimmed, async (pageNumber) => {
      const pdfPage = await proxy.getPage(pageNumber);
      const content = await pdfPage.getTextContent();
      return content.items.map((item) => item.str ?? '').join('');
    }, controller.signal, (done, total) => setProgress(`Searching page ${done} of ${total}…`));
    if (searchRef.current !== controller || !acceptSearchResult(trimmed, nextQuery.trim()) || outcome.cancelled) return;
    setSearching(false);
    setProgress('');
    setResult(outcome);
    setCursor(0);
    const first = outcome.matches[0];
    if (first) showPage(first.page);
  }, [showPage]);

  function captureZoomAnchor() {
    const stage = stageRef.current;
    if (readingRef.current !== 'scroll' || !stage || layoutRef.current.total <= 0) return;
    anchorRef.current = scrollAnchor(stage.scrollTop, layoutRef.current);
  }

  function chooseReading(next: PdfReadingMode) {
    if (next === readingMode) return;
    if (next === 'scroll') pendingJump.current = pageRef.current;
    setReadingMode(next);
  }

  function gotoMatch(nextCursor: number) {
    if (!result || result.matches.length === 0) return;
    const index = (nextCursor + result.matches.length) % result.matches.length;
    const match = result.matches[index];
    if (!match) return;
    setCursor(index);
    showPage(match.page);
  }

  function onStageScroll() {
    const stage = stageRef.current;
    if (!stage || readingRef.current !== 'scroll') return;
    setScrollTop(stage.scrollTop);
    if (intentRef.current === 'program') {
      const target = pageScrollTop(pageRef.current, layoutRef.current);
      if (Math.abs(stage.scrollTop - target) < 8) {
        intentRef.current = 'user';
        window.clearTimeout(programTimer.current);
      }
      return;
    }
    const next = pageFromUserScroll(stage.scrollTop, stage.clientHeight, layoutRef.current, 'user');
    if (next && next !== pageRef.current) {
      pageRef.current = next;
      setPage(next);
      setPageDraft(String(next));
    }
  }

  const pagedWidth = activeDisplay.width;
  const pagedRatio = pagedWidth > 0 ? renderPixelRatio(pagedWidth, activeDisplay.height, window.devicePixelRatio || 1) : 1;

  return (
    <div className="pdf-layer" onPointerDown={(event) => event.stopPropagation()} onWheel={(event) => event.stopPropagation()}>
      <div
        ref={dialogRef}
        className="pdf-viewer nowheel nopan"
        role="dialog"
        aria-modal="true"
        aria-label={filename}
        tabIndex={-1}
      >
        <header className="pdf-head">
          <h2 title={filename}>{filename}</h2>
          <div className="pdf-head-actions">
            <button type="button" onClick={onDownload}>Download</button>
            <button type="button" onClick={close}>Close</button>
          </div>
        </header>
        {failure ? (
          <div className="pdf-status">
            <p>{failure}</p>
          </div>
        ) : (
          <>
            <div className="pdf-toolbar">
              <div className="pdf-mode" role="group" aria-label="Reading mode">
                <button type="button" aria-pressed={readingMode === 'scroll'} onClick={() => chooseReading('scroll')}>Scroll</button>
                <button type="button" aria-pressed={readingMode === 'paged'} onClick={() => chooseReading('paged')}>Pages</button>
              </div>
              <button type="button" aria-label="Previous page" disabled={page <= 1} onClick={() => showPage(page - 1)}>Previous</button>
              <label className="pdf-page-field">
                <span className="sr-only">Page number</span>
                <input
                  aria-label="Page number"
                  inputMode="numeric"
                  value={pageDraft}
                  onChange={(event) => setPageDraft(event.target.value)}
                  onBlur={commitPage}
                  onKeyDown={(event) => {
                    if (event.key !== 'Enter') return;
                    event.preventDefault();
                    commitPage();
                  }}
                />
                <span>/ {pageCount || '…'}</span>
              </label>
              <button type="button" aria-label="Next page" disabled={pageCount === 0 || page >= pageCount} onClick={() => showPage(page + 1)}>Next</button>
              <button type="button" aria-label="Zoom out" onClick={() => { captureZoomAnchor(); setZoomMode('manual'); setManual((current) => stepZoom(zoomMode === 'manual' ? current : scale, -1)); }}>−</button>
              <span className="pdf-zoom" aria-live="polite">{percent}</span>
              <button type="button" aria-label="Zoom in" onClick={() => { captureZoomAnchor(); setZoomMode('manual'); setManual((current) => stepZoom(zoomMode === 'manual' ? current : scale, 1)); }}>+</button>
              <button type="button" aria-pressed={zoomMode === 'manual' && Math.abs(manual - 1) < 0.001} onClick={() => { captureZoomAnchor(); setZoomMode('manual'); setManual(1); }}>100%</button>
              <button type="button" aria-pressed={zoomMode === 'fit-width'} onClick={() => { captureZoomAnchor(); setZoomMode('fit-width'); }}>Fit width</button>
              <button type="button" aria-pressed={zoomMode === 'fit-page'} onClick={() => { captureZoomAnchor(); setZoomMode('fit-page'); }}>Fit page</button>
              <button type="button" aria-pressed={findOpen} onClick={() => { setFindOpen(true); requestAnimationFrame(() => findRef.current?.focus()); }}>Find</button>
            </div>
            {findOpen ? (
              <form
                className="pdf-find"
                onSubmit={(event) => {
                  event.preventDefault();
                  void runSearch(query);
                }}
              >
                <input
                  ref={findRef}
                  aria-label="Find in PDF"
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                />
                <button type="submit">Find</button>
                <button type="button" aria-label="Previous match" disabled={!result || result.matches.length === 0} onClick={() => gotoMatch(cursor - 1)}>Previous</button>
                <button type="button" aria-label="Next match" disabled={!result || result.matches.length === 0} onClick={() => gotoMatch(cursor + 1)}>Next</button>
                <button type="button" onClick={() => { setQuery(''); setResult(null); setProgress(''); }}>Clear</button>
                <p>{searching ? progress : result ? searchStatusLabel(result, query) : ''}</p>
              </form>
            ) : null}
            <div className="pdf-stage" ref={stageRef} onScroll={onStageScroll}>
              {url && header === 'ok' ? (
                <Document
                  file={url}
                  options={options}
                  renderMode="canvas"
                  externalLinkTarget="_blank"
                  loading={<p className="pdf-note">Reading PDF…</p>}
                  onPassword={(callback) => {
                    setFailure(PDF_PASSWORD_MESSAGE);
                    (callback as (password: string | Error | null) => void)(new Error(PDF_PASSWORD_MESSAGE));
                  }}
                  onLoadSuccess={(loaded) => {
                    const proxy = loaded as unknown as PdfProxy;
                    pdfRef.current = proxy;
                    const count = proxy.numPages;
                    setPageCount(count);
                    setPage((current) => {
                      const next = current >= 1 && current <= count ? current : 1;
                      pageRef.current = next;
                      setPageDraft(String(next));
                      if (next > 1) pendingJump.current = next;
                      return next;
                    });
                  }}
                  onLoadError={(error) => setFailure(pdfFailureMessage(error))}
                >
                  {readingMode === 'paged' && pageCount > 0 && pagedWidth > 1 ? (
                    <Page
                      pageNumber={page}
                      width={pagedWidth}
                      devicePixelRatio={pagedRatio}
                      renderTextLayer
                      renderAnnotationLayer={PDF_VIEWER_GUARDS.renderAnnotationLayer}
                      renderForms={PDF_VIEWER_GUARDS.renderForms}
                      customTextRenderer={highlight}
                      onLoadSuccess={(loaded) => remember(page, loaded.originalWidth, loaded.originalHeight)}
                      loading={<p className="pdf-note">Rendering page…</p>}
                    />
                  ) : null}
                  {readingMode === 'scroll' && pageCount > 0 ? (
                    <div className="pdf-scroll" style={{ height: layout.total }}>
                      {mounted.map((pageNumber) => {
                        const width = layout.widths[pageNumber - 1] ?? 0;
                        const height = layout.heights[pageNumber - 1] ?? 0;
                        const top = layout.tops[pageNumber - 1] ?? 0;
                        const ratio = width > 1 ? renderPixelRatio(width, height, window.devicePixelRatio || 1) : 1;
                        return (
                          <div key={pageNumber} className="pdf-sheet" data-pdf-page={pageNumber} style={{ top, height }}>
                            {width > 1 ? (
                              <Page
                                pageNumber={pageNumber}
                                width={width}
                                devicePixelRatio={ratio}
                                renderTextLayer
                                renderAnnotationLayer={PDF_VIEWER_GUARDS.renderAnnotationLayer}
                                renderForms={PDF_VIEWER_GUARDS.renderForms}
                                customTextRenderer={highlight}
                                onLoadSuccess={(loaded) => remember(pageNumber, loaded.originalWidth, loaded.originalHeight)}
                                loading={<p className="pdf-note">Rendering page…</p>}
                              />
                            ) : null}
                          </div>
                        );
                      })}
                    </div>
                  ) : null}
                  {pageCount === 0 ? <p className="pdf-note">Preparing page…</p> : null}
                </Document>
              ) : <p className="pdf-note">Reading PDF…</p>}
            </div>
            <footer className="pdf-foot">Page {pageCount ? page : '…'} of {pageCount || '…'} · {readingMode === 'scroll' ? 'Scroll' : 'Pages'}</footer>
          </>
        )}
      </div>
    </div>
  );
}

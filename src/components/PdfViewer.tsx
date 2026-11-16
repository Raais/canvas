import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Document, Page, pdfjs } from 'react-pdf';
import 'react-pdf/dist/Page/TextLayer.css';
import {
  PDF_MISSING_MESSAGE,
  PDF_PASSWORD_MESSAGE,
  PDF_VIEWER_GUARDS,
  acceptSearchResult,
  collectPdfMatches,
  createPdfObjectUrl,
  fitScale,
  inspectPdfBlob,
  parsePageInput,
  pdfDocumentOptions,
  pdfFailureMessage,
  renderHighlightedText,
  renderPixelRatio,
  searchStatusLabel,
  stepZoom,
  type PdfSearchResult,
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
  const [url, setUrl] = useState<string | null>(null);
  const [header, setHeader] = useState<'checking' | 'ok' | 'bad'>(blob ? 'checking' : 'bad');
  const [failure, setFailure] = useState<string | null>(blob ? null : PDF_MISSING_MESSAGE);
  const [pageCount, setPageCount] = useState(0);
  const [page, setPage] = useState(() => sessionPages.get(memoryKey) ?? 1);
  const [pageDraft, setPageDraft] = useState(String(sessionPages.get(memoryKey) ?? 1));
  const [mode, setMode] = useState<'fit-width' | 'fit-page' | 'manual'>('fit-width');
  const [manual, setManual] = useState(1);
  const [natural, setNatural] = useState<{ page: number; width: number; height: number } | null>(null);
  const [box, setBox] = useState({ width: 0, height: 0 });
  const [query, setQuery] = useState('');
  const [searching, setSearching] = useState(false);
  const [progress, setProgress] = useState('');
  const [result, setResult] = useState<PdfSearchResult | null>(null);
  const [cursor, setCursor] = useState(0);
  const [findOpen, setFindOpen] = useState(false);

  useEffect(() => {
    if (!blob) return;
    let live = true;
    const handle = createPdfObjectUrl(blob);
    setUrl(handle.url);
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
    if (!proxy || page < 1) return;
    let cancelled = false;
    const requested = page;
    void proxy.getPage(requested).then((pdfPage) => {
      if (cancelled) return;
      const view = pdfPage.getViewport({ scale: 1 });
      setNatural({ page: requested, width: view.width, height: view.height });
    }).catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [page, pageCount]);

  useEffect(() => {
    sessionPages.set(memoryKey, page);
  }, [memoryKey, page]);

  useEffect(() => () => {
    searchRef.current?.abort();
  }, []);

  const close = useCallback(() => {
    searchRef.current?.abort();
    sessionPages.set(memoryKey, page);
    onClose();
  }, [memoryKey, onClose, page]);

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
        setPage((current) => {
          const next = Math.max(1, current - 1);
          setPageDraft(String(next));
          return next;
        });
      } else if (event.key === 'ArrowRight' && pageCount > 0) {
        event.preventDefault();
        event.stopPropagation();
        setPage((current) => {
          const next = Math.min(pageCount, current + 1);
          setPageDraft(String(next));
          return next;
        });
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [close, findOpen, pageCount]);

  const showPage = useCallback((next: number) => {
    setPage(next);
    setPageDraft(String(next));
  }, []);

  const commitPage = useCallback(() => {
    const parsed = parsePageInput(pageDraft, pageCount);
    if (parsed === null) {
      setPageDraft(String(page));
      return;
    }
    showPage(parsed);
  }, [page, pageCount, pageDraft, showPage]);

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
    if (searchRef.current !== controller || !acceptSearchResult(trimmed, nextQuery.trim())) return;
    setSearching(false);
    setProgress('');
    if (outcome.cancelled) return;
    setResult(outcome);
    setCursor(0);
    const first = outcome.matches[0];
    if (first) showPage(first.page);
  }, [showPage]);

  const scale = natural && natural.page === page
    ? (mode === 'manual' ? manual : fitScale(natural.width, natural.height, box.width, box.height, mode === 'fit-page' ? 'page' : 'width'))
    : manual;
  const cssWidth = natural && natural.page === page ? natural.width * scale : 0;
  const cssHeight = natural && natural.page === page ? natural.height * scale : 0;
  const ratio = cssWidth > 0 ? renderPixelRatio(cssWidth, cssHeight, window.devicePixelRatio || 1) : 1;
  const percent = `${Math.round(scale * 100)}%`;
  const highlight = useCallback((item: { str: string }) => renderHighlightedText(item.str, query), [query]);

  function gotoMatch(nextCursor: number) {
    if (!result || result.matches.length === 0) return;
    const index = (nextCursor + result.matches.length) % result.matches.length;
    const match = result.matches[index];
    if (!match) return;
    setCursor(index);
    showPage(match.page);
  }

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
              <button type="button" aria-label="Zoom out" onClick={() => { setMode('manual'); setManual((current) => stepZoom(mode === 'manual' ? current : scale, -1)); }}>−</button>
              <span className="pdf-zoom" aria-live="polite">{percent}</span>
              <button type="button" aria-label="Zoom in" onClick={() => { setMode('manual'); setManual((current) => stepZoom(mode === 'manual' ? current : scale, 1)); }}>+</button>
              <button type="button" aria-pressed={mode === 'manual' && Math.abs(manual - 1) < 0.001} onClick={() => { setMode('manual'); setManual(1); }}>100%</button>
              <button type="button" aria-pressed={mode === 'fit-width'} onClick={() => setMode('fit-width')}>Fit width</button>
              <button type="button" aria-pressed={mode === 'fit-page'} onClick={() => setMode('fit-page')}>Fit page</button>
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
            <div className="pdf-stage" ref={stageRef}>
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
                      setPageDraft(String(next));
                      return next;
                    });
                  }}
                  onLoadError={(error) => setFailure(pdfFailureMessage(error))}
                >
                  {pageCount > 0 && cssWidth > 0 ? (
                    <Page
                      pageNumber={page}
                      width={cssWidth}
                      devicePixelRatio={ratio}
                      renderTextLayer
                      renderAnnotationLayer={PDF_VIEWER_GUARDS.renderAnnotationLayer}
                      renderForms={PDF_VIEWER_GUARDS.renderForms}
                      customTextRenderer={highlight}
                      loading={<p className="pdf-note">Rendering page…</p>}
                    />
                  ) : <p className="pdf-note">Preparing page…</p>}
                </Document>
              ) : <p className="pdf-note">Reading PDF…</p>}
            </div>
            <footer className="pdf-foot">Page {pageCount ? page : '…'} of {pageCount || '…'} · {failure ? 'Unavailable' : 'Ready'}</footer>
          </>
        )}
      </div>
    </div>
  );
}

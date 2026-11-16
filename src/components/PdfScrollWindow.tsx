import {
  PDF_MAX_MOUNTED_PAGES,
  PDF_SCROLL_OVERSCAN,
  layoutPdfPages,
  mountedPdfPages,
  type PdfPageSize,
} from '../domain/pdf-preview';

export function PdfScrollWindow({
  count,
  scrollTop,
  viewportHeight,
  pageWidth,
  pageHeight,
  pinnedPage = null,
}: {
  count: number;
  scrollTop: number;
  viewportHeight: number;
  pageWidth: number;
  pageHeight: number;
  pinnedPage?: number | null;
}) {
  const sizes = new Map<number, PdfPageSize>();
  const layout = layoutPdfPages(count, sizes, () => ({ width: pageWidth, height: pageHeight }));
  const mounted = mountedPdfPages(scrollTop, viewportHeight, layout, PDF_SCROLL_OVERSCAN, PDF_MAX_MOUNTED_PAGES, pinnedPage);
  return (
    <div data-pdf-total={layout.total}>
      {mounted.map((page) => <div key={page} data-pdf-page={page} />)}
    </div>
  );
}

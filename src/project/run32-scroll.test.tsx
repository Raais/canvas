import './happy-dom-setup';
import { act, createRef, forwardRef, useImperativeHandle, useMemo, useRef, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { describe, expect, test } from 'bun:test';
import { usePdfReadingScroll } from '../components/pdf-reading-scroll';
import {
  PDF_MAX_MOUNTED_PAGES,
  activeScrollPage,
  layoutPdfPages,
  mountedPdfPages,
  pageDisplaySize,
  pageScrollTop,
  type PdfLayout,
  type PdfPageSize,
  type PdfReadingMode,
} from '../domain/pdf-preview';

const box = { width: 900, height: 640 };

type ProbeApi = {
  jump: (page: number) => void;
  cancel: () => void;
  element: () => HTMLDivElement | null;
  layout: () => PdfLayout;
};

const Probe = forwardRef<ProbeApi, { count: number; sizes: Map<number, PdfPageSize>; mode: PdfReadingMode }>(
  function Probe({ count, sizes, mode }, ref) {
    const stageRef = useRef<HTMLDivElement>(null);
    const [scrollTop, setScrollTop] = useState(0);
    const layout = useMemo(
      () => layoutPdfPages(count, sizes, (natural) => pageDisplaySize(natural, 'fit-width', 1, box)),
      [count, sizes],
    );
    const reading = usePdfReadingScroll(stageRef, layout, mode, setScrollTop);
    const mounted = mode === 'scroll' ? mountedPdfPages(scrollTop, box.height, layout) : [];
    useImperativeHandle(ref, () => ({
      jump: reading.requestJump,
      cancel: reading.cancelJump,
      element: () => stageRef.current,
      layout: () => layout,
    }), [layout, reading.cancelJump, reading.requestJump]);
    return (
      <div
        ref={stageRef}
        className="pdf-stage"
        onWheel={() => reading.cancelJump()}
        onScroll={(event) => setScrollTop(event.currentTarget.scrollTop)}
        style={{ height: `${box.height}px`, overflow: 'auto', overflowAnchor: 'none' }}
      >
        <div className="pdf-scroll" style={{ height: layout.total, position: 'relative', overflowAnchor: 'none' }}>
          {mounted.map((page) => (
            <div key={page} data-pdf-page={page} style={{ position: 'absolute', top: layout.tops[page - 1], height: layout.heights[page - 1] }} />
          ))}
        </div>
      </div>
    );
  },
);

function trackScroll(stage: HTMLDivElement) {
  let top = 0;
  Object.defineProperty(stage, 'scrollTop', {
    configurable: true,
    get: () => top,
    set: (value: number) => {
      top = Number(value);
      stage.dispatchEvent(new Event('scroll'));
    },
  });
  Object.defineProperty(stage, 'clientHeight', { configurable: true, get: () => box.height });
}

describe('pdf scroll position', () => {
  test('scrolling and late page sizes do not return to the first page', async () => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const root: Root = createRoot(host);
    const api = createRef<ProbeApi>();
    await act(async () => {
      root.render(<Probe ref={api} count={30} sizes={new Map()} mode="scroll" />);
    });
    const stage = api.current?.element();
    if (!stage || !api.current) throw new Error('missing scroll stage');
    trackScroll(stage);
    const start = pageScrollTop(10, api.current.layout()) + 24;
    await act(async () => {
      stage.scrollTop = start;
    });
    expect(activeScrollPage(stage.scrollTop, 1, api.current.layout())).toBe(10);
    expect(host.querySelectorAll('[data-pdf-page]').length <= PDF_MAX_MOUNTED_PAGES).toBe(true);
    expect(host.querySelector('[data-pdf-page="1"]')).toBeNull();
    expect(host.querySelector('[data-pdf-page="10"]') !== null).toBe(true);

    const sizes = new Map<number, PdfPageSize>([
      [10, { width: 2000, height: 400 }],
      [2, { width: 500, height: 1800 }],
      [24, { width: 2000, height: 400 }],
    ]);
    await act(async () => {
      root.render(<Probe ref={api} count={30} sizes={sizes} mode="scroll" />);
    });
    expect(activeScrollPage(stage.scrollTop, 1, api.current.layout())).toBe(10);
    expect(stage.scrollTop > start).toBe(true);
    expect(host.querySelectorAll('[data-pdf-page]').length <= PDF_MAX_MOUNTED_PAGES).toBe(true);
    expect(host.querySelector('[data-pdf-page="1"]')).toBeNull();

    await act(async () => {
      api.current?.jump(20);
    });
    expect(activeScrollPage(stage.scrollTop, 1, api.current.layout())).toBe(20);
    const atTwenty = stage.scrollTop;
    await act(async () => {
      root.render(<Probe ref={api} count={30} sizes={new Map(sizes).set(28, { width: 700, height: 900 })} mode="scroll" />);
    });
    expect(stage.scrollTop).toBe(atTwenty);
    expect(activeScrollPage(stage.scrollTop, 1, api.current.layout())).toBe(20);

    await act(async () => {
      root.render(<Probe ref={api} count={30} sizes={sizes} mode="paged" />);
    });
    api.current.jump(4);
    stage.dispatchEvent(new WheelEvent('wheel', { bubbles: true, cancelable: true }));
    api.current.cancel();
    await act(async () => {
      root.render(<Probe ref={api} count={30} sizes={sizes} mode="scroll" />);
    });
    expect(activeScrollPage(stage.scrollTop, 1, api.current.layout())).toBe(20);

    root.unmount();
    host.remove();
  });
});

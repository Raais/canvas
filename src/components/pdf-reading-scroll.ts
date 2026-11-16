import { useLayoutEffect, useRef, type RefObject } from 'react';
import {
  activeScrollPage,
  consumeScrollJump,
  measurementScrollTop,
  type PdfLayout,
  type PdfReadingMode,
} from '../domain/pdf-preview';

export function usePdfReadingScroll(
  stageRef: RefObject<HTMLDivElement | null>,
  layout: PdfLayout,
  readingMode: PdfReadingMode,
  onScrollTop: (top: number) => void,
  readScrollTop?: () => number | null,
) {
  const previous = useRef<PdfLayout | null>(null);
  const jumpRef = useRef<number | null>(null);
  const layoutRef = useRef(layout);
  const readingRef = useRef(readingMode);
  layoutRef.current = layout;
  readingRef.current = readingMode;

  useLayoutEffect(() => {
    const stage = stageRef.current;
    const before = previous.current;
    if (!stage || readingMode !== 'scroll') {
      previous.current = layout;
      return;
    }
    const jump = jumpRef.current;
    if (jump !== null) {
      const top = layout.tops[jump - 1];
      if (top === undefined) return;
      jumpRef.current = null;
      previous.current = layout;
      stage.scrollTop = top;
      onScrollTop(stage.scrollTop);
      return;
    }
    previous.current = layout;
    if (!before || before.tops.length === 0 || before === layout) return;
    const sampled = readScrollTop?.();
    const next = measurementScrollTop(sampled ?? stage.scrollTop, before, layout);
    if (Math.abs(stage.scrollTop - next) <= 0.5) return;
    stage.scrollTop = next;
    onScrollTop(stage.scrollTop);
  }, [layout, onScrollTop, readScrollTop, readingMode, stageRef]);

  return {
    requestJump(page: number) {
      const stage = stageRef.current;
      const current = layoutRef.current;
      const top = current.tops[page - 1];
      if (!stage || top === undefined || readingRef.current !== 'scroll') {
        jumpRef.current = page;
        return;
      }
      jumpRef.current = null;
      const distance = Math.abs(page - activeScrollPage(stage.scrollTop, stage.clientHeight || 1, current));
      if (typeof stage.scrollTo === 'function') stage.scrollTo({ top, behavior: distance > 2 ? 'auto' : 'smooth' });
      else stage.scrollTop = top;
    },
    cancelJump() {
      jumpRef.current = consumeScrollJump(jumpRef.current, true);
    },
  };
}

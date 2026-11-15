import { useEffect, useRef } from 'react';
import { beginStroke, cancelStroke, DRAWING_THEME_COLORS, drawingHits, eraserWorldRadius, extendStroke, finishStroke, pathFromPairs, type StrokeDraft } from '../domain/drawing';
import { onInkPointerDown, onInkPointerFinish } from '../editor/ink-gesture';
import { MAX_ZOOM, MIN_ZOOM, type BoardNode, type DrawingColor, type DrawingNode, type Point, type Viewport } from '../domain/types';

type DrawingOverlayProps = {
  mode: 'pen' | 'eraser';
  color: DrawingColor;
  screenWidth: number;
  appearance: 'dark' | 'light';
  generation: number;
  readOnly: boolean;
  getViewport: () => Viewport;
  screenToFlow: (point: Point) => Point;
  setViewport: (viewport: Viewport) => void;
  nodes: () => readonly BoardNode[];
  onActive: (active: boolean) => void;
  onCommit: (node: DrawingNode) => void;
  onErase: (ids: readonly string[]) => void;
};

export function DrawingOverlay(props: DrawingOverlayProps) {
  const propsRef = useRef(props);
  propsRef.current = props;
  const rootRef = useRef<HTMLDivElement>(null);
  const pathRef = useRef<SVGPathElement>(null);
  const dotRef = useRef<SVGCircleElement>(null);
  const cursorRef = useRef<HTMLDivElement>(null);
  const draftRef = useRef<StrokeDraft | null>(null);
  const eraserRef = useRef<Set<string>>(new Set());
  const pointerRef = useRef<number | null>(null);
  const viewportRef = useRef<Viewport | null>(null);
  const closedRef = useRef(true);
  const spaceRef = useRef(false);
  const tokenRef = useRef(0);

  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    const onWheel = (event: WheelEvent) => {
      if (!closedRef.current) {
        event.preventDefault();
        return;
      }
      event.preventDefault();
      const bounds = root.getBoundingClientRect();
      const sx = event.clientX - bounds.left;
      const sy = event.clientY - bounds.top;
      const viewport = propsRef.current.getViewport();
      const worldX = (sx - viewport.x) / viewport.zoom;
      const worldY = (sy - viewport.y) / viewport.zoom;
      const zoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, viewport.zoom * Math.exp(-event.deltaY * 0.0015)));
      propsRef.current.setViewport({ x: sx - worldX * zoom, y: sy - worldY * zoom, zoom });
    };
    root.addEventListener('wheel', onWheel, { passive: false });
    return () => root.removeEventListener('wheel', onWheel);
  }, []);

  useEffect(() => {
    abandon();
  }, [props.generation, props.mode, props.readOnly]);

  useEffect(() => {
    const stop = () => {
      if (document.hidden) abandon();
    };
    document.addEventListener('visibilitychange', stop);
    window.addEventListener('blur', abandon);
    return () => {
      document.removeEventListener('visibilitychange', stop);
      window.removeEventListener('blur', abandon);
      abandon();
    };
  }, []);

  useEffect(() => {
    const down = (event: KeyboardEvent) => {
      if (event.code !== 'Space' || event.repeat) return;
      const target = event.target;
      if (target instanceof HTMLElement && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)) return;
      spaceRef.current = true;
      if (rootRef.current) rootRef.current.style.pointerEvents = 'none';
      abandon();
    };
    const up = (event: KeyboardEvent) => {
      if (event.code !== 'Space') return;
      spaceRef.current = false;
      if (rootRef.current) rootRef.current.style.pointerEvents = 'auto';
    };
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    return () => {
      window.removeEventListener('keydown', down);
      window.removeEventListener('keyup', up);
    };
  }, []);

  function paint() {
    const draft = draftRef.current;
    const viewport = viewportRef.current;
    const path = pathRef.current;
    const dot = dotRef.current;
    if (!draft || !viewport || !path || !dot) return;
    const point = draft.points[0];
    if (draft.points.length < 2 || !point) {
      path.setAttribute('d', '');
      if (!point) {
        dot.setAttribute('r', '0');
        return;
      }
      dot.setAttribute('cx', String(point.x * viewport.zoom + viewport.x));
      dot.setAttribute('cy', String(point.y * viewport.zoom + viewport.y));
      dot.setAttribute('r', String(Math.max(propsRef.current.screenWidth / 2, 1)));
      return;
    }
    dot.setAttribute('r', '0');
    const local = draft.points.flatMap((entry) => [entry.x * viewport.zoom + viewport.x, entry.y * viewport.zoom + viewport.y]);
    path.setAttribute('d', pathFromPairs(local));
  }

  function clearMarks() {
    pathRef.current?.setAttribute('d', '');
    dotRef.current?.setAttribute('r', '0');
    for (const id of eraserRef.current) {
      document.querySelector(`.react-flow__node[data-id="${CSS.escape(id)}"]`)?.classList.remove('drawing-pending-erase');
    }
  }

  function abandon() {
    if (closedRef.current && pointerRef.current === null) return;
    closedRef.current = true;
    pointerRef.current = null;
    if (draftRef.current) draftRef.current = cancelStroke(draftRef.current);
    clearMarks();
    eraserRef.current = new Set();
    draftRef.current = null;
    viewportRef.current = null;
    propsRef.current.onActive(false);
  }

  function finish(commit: boolean) {
    if (closedRef.current) return;
    const token = tokenRef.current;
    closedRef.current = true;
    const draft = draftRef.current;
    const erased = [...eraserRef.current];
    pointerRef.current = null;
    draftRef.current = null;
    viewportRef.current = null;
    clearMarks();
    eraserRef.current = new Set();
    propsRef.current.onActive(false);
    if (!commit || token !== propsRef.current.generation || propsRef.current.readOnly) return;
    if (propsRef.current.mode === 'eraser') {
      propsRef.current.onErase(erased);
      return;
    }
    if (!draft) return;
    const node = finishStroke(draft, new Date().toISOString());
    if (node) propsRef.current.onCommit(node);
  }

  const { mode, color, screenWidth, appearance } = props;
  return (
    <div
      ref={rootRef}
      className={mode === 'eraser' ? 'ink-overlay is-eraser' : 'ink-overlay'}
      onPointerDown={(event) => {
        const decision = onInkPointerDown(
          { open: pointerRef.current !== null },
          { isPrimary: event.isPrimary, button: event.button, readOnly: props.readOnly, spaceHeld: spaceRef.current },
        );
        if (decision.effect === 'cancel') {
          finish(false);
          return;
        }
        if (decision.effect === 'ignore') return;
        const viewport = props.getViewport();
        viewportRef.current = { ...viewport };
        tokenRef.current = props.generation;
        closedRef.current = false;
        pointerRef.current = event.pointerId;
        props.onActive(true);
        event.currentTarget.setPointerCapture(event.pointerId);
        const point = props.screenToFlow({ x: event.clientX, y: event.clientY });
        draftRef.current = beginStroke(point, viewport.zoom, color, screenWidth);
        if (mode === 'pen') paint();
        else {
          for (const id of drawingHits(props.nodes(), point, point, eraserWorldRadius(viewport.zoom))) {
            eraserRef.current.add(id);
            document.querySelector(`.react-flow__node[data-id="${CSS.escape(id)}"]`)?.classList.add('drawing-pending-erase');
          }
        }
      }}
      onPointerMove={(event) => {
        if (cursorRef.current) {
          const bounds = event.currentTarget.getBoundingClientRect();
          cursorRef.current.style.transform = `translate(${event.clientX - bounds.left}px, ${event.clientY - bounds.top}px)`;
        }
        if (pointerRef.current !== event.pointerId || closedRef.current) return;
        const viewport = props.getViewport();
        const start = viewportRef.current;
        if (start && (start.x !== viewport.x || start.y !== viewport.y || start.zoom !== viewport.zoom)) {
          finish(false);
          return;
        }
        const point = props.screenToFlow({ x: event.clientX, y: event.clientY });
        const draft = draftRef.current;
        if (!draft) return;
        const previous = draft.points[draft.points.length - 1] ?? point;
        draftRef.current = extendStroke(draft, point);
        if (mode === 'pen') {
          paint();
          return;
        }
        for (const id of drawingHits(props.nodes(), previous, point, eraserWorldRadius(viewport.zoom))) {
          if (eraserRef.current.has(id)) continue;
          eraserRef.current.add(id);
          document.querySelector(`.react-flow__node[data-id="${CSS.escape(id)}"]`)?.classList.add('drawing-pending-erase');
        }
      }}
      onPointerUp={(event) => {
        const decision = onInkPointerFinish({ open: pointerRef.current === event.pointerId && !closedRef.current }, true, 'up');
        if (decision.effect === 'commit') finish(true);
      }}
      onPointerCancel={() => {
        const decision = onInkPointerFinish({ open: pointerRef.current !== null && !closedRef.current }, true, 'cancel');
        if (decision.effect === 'cancel') finish(false);
      }}
      onLostPointerCapture={() => {
        const decision = onInkPointerFinish({ open: pointerRef.current !== null && !closedRef.current }, true, 'cancel');
        if (decision.effect === 'cancel') finish(false);
      }}
      onContextMenu={(event) => event.preventDefault()}
    >
      <svg className="ink-preview" aria-hidden="true">
        <path ref={pathRef} fill="none" stroke={DRAWING_THEME_COLORS[appearance][color]} strokeWidth={screenWidth} strokeLinecap="round" strokeLinejoin="round" />
        <circle ref={dotRef} r="0" fill={DRAWING_THEME_COLORS[appearance][color]} />
      </svg>
      {mode === 'eraser' ? <div ref={cursorRef} className="eraser-cursor" /> : null}
    </div>
  );
}

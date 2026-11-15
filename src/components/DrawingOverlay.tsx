import { useEffect, useRef } from 'react';
import { beginStroke, cancelStroke, DRAWING_THEME_COLORS, drawingFromWorld, drawingHits, eraserWorldRadius, extendStroke, finishStroke, pathFromPairs, settledPoints, worldStrokeWidth, type StrokeDraft } from '../domain/drawing';
import { isOrganicBrush, outlineForPairs, outlineToSvgPath } from '../domain/organic-ink';
import { reduceInkGesture, type InkEvent, type InkGestureState } from '../editor/ink-gesture';
import { MAX_ZOOM, MIN_ZOOM, type BoardNode, type DrawingColor, type DrawingNode, type Point, type Viewport } from '../domain/types';
import type { OrganicBrush } from '../domain/organic-ink';

type DrawingOverlayProps = {
  mode: 'pen' | 'eraser';
  color: DrawingColor;
  brush: OrganicBrush;
  screenWidth: number;
  appearance: 'dark' | 'light';
  sessionId: string;
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
  const sessionRef = useRef(props.sessionId);
  const gestureRef = useRef<InkGestureState>({ open: false, pointerId: null, sessionId: props.sessionId, readOnly: props.readOnly });
  const onUpRef = useRef<(pointerId: number) => void>(() => {});
  const onCancelRef = useRef<(pointerId: number) => void>(() => {});

  function apply(event: InkEvent) {
    const result = reduceInkGesture(gestureRef.current, event);
    gestureRef.current = result.state;
    return result.effect;
  }

  function paint() {
    const draft = draftRef.current;
    const viewport = viewportRef.current;
    const path = pathRef.current;
    const dot = dotRef.current;
    if (!draft || !viewport || !path || !dot) return;
    const color = DRAWING_THEME_COLORS[propsRef.current.appearance][draft.color];
    const node = drawingFromWorld(settledPoints(draft), draft.color, worldStrokeWidth(draft.screenWidth, draft.zoom), '1970-01-01T00:00:00.000Z', 'preview', draft.brush);
    if (!node) return;
    if (node.points.length <= 2 || !isOrganicBrush(node.brush)) {
      const point = node.points.length <= 2 ? { x: node.x + (node.points[0] ?? 0), y: node.y + (node.points[1] ?? 0) } : null;
      path.setAttribute('d', point ? '' : screenPath(draft, viewport));
      path.setAttribute('fill', 'none');
      path.setAttribute('stroke', color);
      if (!point) {
        dot.setAttribute('r', '0');
        return;
      }
      dot.setAttribute('cx', String(point.x * viewport.zoom + viewport.x));
      dot.setAttribute('cy', String(point.y * viewport.zoom + viewport.y));
      dot.setAttribute('r', String(Math.max((node.strokeWidth * viewport.zoom) / 2, 1)));
      dot.setAttribute('fill', color);
      return;
    }
    dot.setAttribute('r', '0');
    const outline = outlineForPairs(node.points, node.brush, node.strokeWidth).map((point) => ({
      x: (node.x + point.x) * viewport.zoom + viewport.x,
      y: (node.y + point.y) * viewport.zoom + viewport.y,
    }));
    path.setAttribute('d', outlineToSvgPath(outline));
    path.setAttribute('fill', color);
    path.setAttribute('stroke', 'none');
  }

  function screenPath(draft: StrokeDraft, viewport: Viewport): string {
    const local = draft.points.flatMap((entry) => [entry.x * viewport.zoom + viewport.x, entry.y * viewport.zoom + viewport.y]);
    return pathFromPairs(local);
  }

  function clearMarks() {
    pathRef.current?.setAttribute('d', '');
    dotRef.current?.setAttribute('r', '0');
    for (const id of eraserRef.current) {
      document.querySelector(`.react-flow__node[data-id="${CSS.escape(id)}"]`)?.classList.remove('drawing-pending-erase');
    }
  }

  function abandon() {
    gestureRef.current = { ...gestureRef.current, open: false, pointerId: null };
    if (closedRef.current && pointerRef.current === null && draftRef.current === null) return;
    closedRef.current = true;
    pointerRef.current = null;
    if (draftRef.current) draftRef.current = cancelStroke(draftRef.current);
    clearMarks();
    eraserRef.current = new Set();
    draftRef.current = null;
    viewportRef.current = null;
    propsRef.current.onActive(false);
  }

  function commitDraft() {
    if (closedRef.current) return;
    const draft = draftRef.current;
    const erased = [...eraserRef.current];
    const mode = propsRef.current.mode;
    closedRef.current = true;
    pointerRef.current = null;
    draftRef.current = null;
    viewportRef.current = null;
    clearMarks();
    eraserRef.current = new Set();
    propsRef.current.onActive(false);
    if (propsRef.current.readOnly || propsRef.current.sessionId !== sessionRef.current) return;
    if (mode === 'eraser') {
      propsRef.current.onErase(erased);
      return;
    }
    if (!draft || draft.cancelled) return;
    const node = finishStroke(draft, new Date().toISOString());
    if (!node) throw new Error('Pen stroke could not be committed.');
    propsRef.current.onCommit(node);
  }

  function onUp(pointerId: number) {
    const effect = apply({ type: 'up', pointerId });
    if (effect === 'commit') commitDraft();
  }

  function onCancel(pointerId: number) {
    const effect = apply({ type: 'cancel', pointerId });
    if (effect === 'cancel') abandon();
  }

  onUpRef.current = onUp;
  onCancelRef.current = onCancel;

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
    const effect = apply({ type: 'replace', sessionId: props.sessionId });
    if (effect === 'cancel') abandon();
  }, [props.sessionId]);

  useEffect(() => {
    const effect = apply({ type: 'read-only', readOnly: props.readOnly });
    if (effect === 'cancel') abandon();
  }, [props.readOnly]);

  useEffect(() => {
    const effect = apply({ type: 'tool' });
    if (effect === 'cancel') abandon();
  }, [props.mode]);

  useEffect(() => {
    const stop = () => {
      if (!document.hidden) return;
      if (apply({ type: 'blur' }) === 'cancel') abandon();
    };
    const blur = () => {
      if (apply({ type: 'blur' }) === 'cancel') abandon();
    };
    document.addEventListener('visibilitychange', stop);
    window.addEventListener('blur', blur);
    return () => {
      document.removeEventListener('visibilitychange', stop);
      window.removeEventListener('blur', blur);
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
      if (apply({ type: 'blur' }) === 'cancel') abandon();
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

  useEffect(() => {
    const up = (event: PointerEvent) => onUpRef.current(event.pointerId);
    const cancel = (event: PointerEvent) => onCancelRef.current(event.pointerId);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', cancel);
    return () => {
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', cancel);
    };
  }, []);

  const { mode, color, screenWidth, appearance } = props;
  return (
    <div
      ref={rootRef}
      className={mode === 'eraser' ? 'ink-overlay is-eraser' : 'ink-overlay'}
      onPointerDown={(event) => {
        const effect = apply({
          type: 'down',
          pointerId: event.pointerId,
          isPrimary: event.isPrimary,
          button: event.button,
          readOnly: props.readOnly,
          spaceHeld: spaceRef.current,
          sessionId: props.sessionId,
        });
        if (effect === 'cancel') {
          abandon();
          return;
        }
        if (effect === 'ignore') return;
        const viewport = props.getViewport();
        viewportRef.current = { ...viewport };
        sessionRef.current = props.sessionId;
        closedRef.current = false;
        pointerRef.current = event.pointerId;
        props.onActive(true);
        event.currentTarget.setPointerCapture(event.pointerId);
        const point = props.screenToFlow({ x: event.clientX, y: event.clientY });
        draftRef.current = beginStroke(point, viewport.zoom, color, screenWidth, props.brush);
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
          if (apply({ type: 'viewport' }) === 'cancel') abandon();
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
      onPointerUp={(event) => onUp(event.pointerId)}
      onPointerCancel={(event) => onCancel(event.pointerId)}
      onLostPointerCapture={(event) => {
        apply({ type: 'lost-capture', pointerId: event.pointerId });
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

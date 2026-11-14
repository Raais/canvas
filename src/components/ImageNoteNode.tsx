import { NodeResizer, NodeToolbar, Position, useInternalNode, useViewport, type Node, type NodeProps } from '@xyflow/react';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { FlipHorizontal, FlipVertical, RotateCw } from 'lucide-react';
import {
  cancelRotationDrag,
  finishRotationDrag,
  imageContentTransform,
  moveRotationDrag,
  normalizeRotation,
  nudgeRotation,
  startRotationDrag,
  type RotationDrag,
} from '../domain/image-rotation';
import type { ImageDisplayMode } from '../domain/types';
import { useBoardActions } from './board-context';
import { PortHandles } from './PortHandles';
import { placeRotationPanel } from './rotation-placement';

export type ImageNodeData = {
  mode: ImageDisplayMode;
  src: string | null;
  externalUrl: string | null;
  flipX: boolean;
  flipY: boolean;
  cornerStyle: 'rounded' | 'square';
  rotation: number;
};

export type ImageFlowNode = Node<ImageNodeData, 'image'>;

export function ImageNoteNode({ id, data, selected, width, height }: NodeProps<ImageFlowNode>) {
  const actions = useBoardActions();
  const [failed, setFailed] = useState(false);
  const [open, setOpen] = useState(false);
  const [drag, setDrag] = useState<RotationDrag | null>(null);
  const dragRef = useRef<RotationDrag | null>(null);
  const toolsRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  dragRef.current = drag;

  useLayoutEffect(() => {
    const panel = panelRef.current;
    if (!open || !panel) return;
    if (!panel.matches(':popover-open')) panel.showPopover();
    let frame = 0;
    let last = '';
    const place = () => {
      const anchor = toolsRef.current?.getBoundingClientRect();
      const width = panel.offsetWidth;
      const height = panel.scrollHeight;
      if (anchor && width > 0 && height > 0) {
        const key = `${anchor.top}|${anchor.left}|${anchor.bottom}|${anchor.right}|${width}|${height}|${window.innerWidth}|${window.innerHeight}`;
        if (key !== last) {
          last = key;
          const next = placeRotationPanel(
            anchor,
            { width, height },
            { width: window.innerWidth, height: window.innerHeight },
          );
          panel.style.top = `${next.top}px`;
          panel.style.left = `${next.left}px`;
          panel.style.maxHeight = `${next.maxHeight}px`;
        }
      }
      frame = requestAnimationFrame(place);
    };
    place();
    return () => {
      cancelAnimationFrame(frame);
      if (panel.isConnected && panel.matches(':popover-open')) panel.hidePopover();
    };
  }, [open]);

  useEffect(() => {
    setFailed(false);
  }, [data.src]);

  useEffect(() => {
    return () => {
      const current = dragRef.current;
      if (!current?.active) return;
      const finished = finishRotationDrag(current);
      dragRef.current = null;
      actions.setRotationAdjusting(false);
      if (finished.commit) actions.setRotation(id, finished.angle);
    };
  }, [actions, id]);

  useEffect(() => {
    if (selected) return;
    const current = dragRef.current;
    if (!current?.active) return;
    const finished = finishRotationDrag(current);
    dragRef.current = null;
    setDrag(null);
    actions.setRotationAdjusting(false);
    if (finished.commit) actions.setRotation(id, finished.angle);
    setOpen(false);
  }, [selected, actions, id]);

  useEffect(() => {
    if (!drag?.active) return;
    const end = () => {
      const current = dragRef.current;
      if (!current?.active) return;
      const finished = finishRotationDrag(current);
      dragRef.current = null;
      setDrag(null);
      actions.setRotationAdjusting(false);
      if (finished.commit) actions.setRotation(id, finished.angle);
    };
    window.addEventListener('pointerup', end);
    window.addEventListener('pointercancel', end);
    return () => {
      window.removeEventListener('pointerup', end);
      window.removeEventListener('pointercancel', end);
    };
  }, [drag?.active, actions, id]);

  const className = [
    'image-note',
    data.mode === 'stretch' ? 'is-stretch' : 'is-aspect',
    data.cornerStyle === 'square' ? 'is-square' : '',
    selected ? 'is-selected' : '',
  ]
    .filter(Boolean)
    .join(' ');

  const internal = useInternalNode(id);
  const viewport = useViewport();
  const screenTop = (internal?.internals.positionAbsolute.y ?? 0) * viewport.zoom + viewport.y;
  const toolbarPosition = screenTop < 56 ? Position.Bottom : Position.Top;
  const showImage = Boolean(data.src) && !failed;
  const angle = drag?.active ? drag.preview : data.rotation;
  const frameWidth = width && width > 0 ? width : 1;
  const frameHeight = height && height > 0 ? height : 1;

  function commitAngle(next: number) {
    const normalized = normalizeRotation(next);
    dragRef.current = null;
    setDrag(null);
    actions.setRotationAdjusting(false);
    if (normalized === null) return;
    actions.setRotation(id, normalized);
  }

  function cancelAngle() {
    const current = dragRef.current;
    if (current?.active) {
      const restored = cancelRotationDrag(current);
      dragRef.current = null;
      setDrag(startRotationDrag(restored));
      setDrag(null);
    }
    actions.setRotationAdjusting(false);
  }

  return (
    <div className={className}>
      <NodeResizer
        isVisible={selected}
        minWidth={data.mode === 'aspect' ? 1 : 48}
        minHeight={data.mode === 'aspect' ? 1 : 48}
        keepAspectRatio={data.mode === 'aspect'}
        color="#7aa2c4"
        lineStyle={{ borderColor: '#7aa2c4' }}
      />
      <PortHandles />
      {selected ? (
        <NodeToolbar className="nodrag nopan nowheel" position={toolbarPosition} offset={10}>
        <div ref={toolsRef} className="image-tools" onPointerDown={(event) => event.stopPropagation()}>
          <button type="button" aria-pressed={data.mode === 'aspect'} onClick={() => actions.setMode(id, 'aspect')}>
            Lock ratio
          </button>
          <button type="button" aria-pressed={data.mode === 'stretch'} onClick={() => actions.setMode(id, 'stretch')}>
            Stretch
          </button>
          <button
            type="button"
            className="icon-button"
            aria-label="Flip horizontally"
            title="Flip horizontally"
            aria-pressed={Boolean(data.flipX)}
            onClick={() => actions.toggleFlip(id, 'x')}
          >
            <FlipHorizontal size={15} strokeWidth={1.75} />
          </button>
          <button
            type="button"
            className="icon-button"
            aria-label="Flip vertically"
            title="Flip vertically"
            aria-pressed={Boolean(data.flipY)}
            onClick={() => actions.toggleFlip(id, 'y')}
          >
            <FlipVertical size={15} strokeWidth={1.75} />
          </button>
          <button
            type="button"
            className="icon-button"
            aria-label="Rotate image"
            title="Rotate"
            aria-expanded={open}
            onClick={() => {
              if (open) {
                const current = dragRef.current;
                if (current?.active) {
                  const finished = finishRotationDrag(current);
                  dragRef.current = null;
                  setDrag(null);
                  actions.setRotationAdjusting(false);
                  if (finished.commit) actions.setRotation(id, finished.angle);
                }
                setOpen(false);
                return;
              }
              setOpen(true);
            }}
          >
            <RotateCw size={15} strokeWidth={1.75} />
          </button>
          <button
            type="button"
            aria-label={data.cornerStyle === 'square' ? 'Use rounded corners' : 'Use square corners'}
            onClick={() => actions.setCornerStyle(id, data.cornerStyle === 'square' ? 'rounded' : 'square')}
          >
            {data.cornerStyle === 'square' ? 'Rounded' : 'Square'}
          </button>
          {open ? (
            <div
              ref={panelRef}
              popover="manual"
              className="rotation-panel nodrag nopan nowheel"
              role="dialog"
              aria-label="Rotate image"
              onPointerDown={(event) => event.stopPropagation()}
              onWheel={(event) => event.stopPropagation()}
              onKeyDown={(event) => {
                event.stopPropagation();
                if (event.key !== 'Escape') return;
                event.preventDefault();
                cancelAngle();
                setOpen(false);
              }}
            >
              <p>Rotation: {angle}°</p>
              <input
                className="rotation-slider"
                type="range"
                min={-180}
                max={180}
                step={1}
                value={angle}
                aria-label="Rotation"
                aria-valuemin={-180}
                aria-valuemax={180}
                aria-valuenow={angle}
                aria-valuetext={`${angle} degrees`}
                onPointerDown={() => {
                  const next = startRotationDrag(data.rotation);
                  dragRef.current = next;
                  setDrag(next);
                  actions.setRotationAdjusting(true);
                }}
                onInput={(event) => {
                  const current = dragRef.current ?? startRotationDrag(data.rotation);
                  const next = moveRotationDrag({ ...current, active: true }, Number(event.currentTarget.value));
                  dragRef.current = next;
                  setDrag(next);
                  actions.setRotationAdjusting(true);
                }}
                onBlur={() => {
                  const current = dragRef.current;
                  if (!current?.active) return;
                  const finished = finishRotationDrag(current);
                  dragRef.current = null;
                  setDrag(null);
                  actions.setRotationAdjusting(false);
                  if (finished.commit) actions.setRotation(id, finished.angle);
                }}
                onKeyUp={() => {
                  const current = dragRef.current;
                  if (!current?.active) return;
                  const finished = finishRotationDrag(current);
                  dragRef.current = { origin: finished.angle, preview: finished.angle, active: false };
                  setDrag(null);
                  actions.setRotationAdjusting(false);
                  if (finished.commit) actions.setRotation(id, finished.angle);
                }}
              />
              <div className="rotation-actions">
                <button type="button" onClick={() => commitAngle(nudgeRotation(angle, -15))}>−15°</button>
                <button type="button" onClick={() => commitAngle(nudgeRotation(angle, 15))}>+15°</button>
                <button type="button" onClick={() => commitAngle(0)}>Reset</button>
              </div>
            </div>
          ) : null}
        </div>
        </NodeToolbar>
      ) : null}
      {showImage ? (
        <div className="image-clip">
          <img
            src={data.src ?? undefined}
            alt={data.externalUrl ? 'External image' : 'Embedded image'}
            draggable={false}
            decoding="async"
            className={angle === 0 ? undefined : 'is-rotated'}
            style={{
              transform: imageContentTransform({
                width: frameWidth,
                height: frameHeight,
                degrees: angle,
                flipX: data.flipX,
                flipY: data.flipY,
              }),
              transformOrigin: 'center center',
            }}
            onLoad={(event) => {
              actions.noteIntrinsicSize(id, event.currentTarget.naturalWidth, event.currentTarget.naturalHeight);
            }}
            onError={() => setFailed(true)}
          />
        </div>
      ) : (
        <div className="image-missing">
          <span>{data.src ? 'Image unavailable' : 'Stored image is missing'}</span>
          {data.externalUrl ? (
            <span className="image-url" title={data.externalUrl}>
              {data.externalUrl}
            </span>
          ) : null}
        </div>
      )}
      {data.externalUrl ? <span className="image-flag">External</span> : null}
    </div>
  );
}

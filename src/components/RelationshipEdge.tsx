import { BaseEdge, EdgeLabelRenderer, EdgeToolbar, getBezierPath, useStore, type EdgeProps } from '@xyflow/react';
import { Trash2, Type } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { finalizeCulledEdgeLabel, isFinalUnmount } from '../editor/cull-edit';
import { nextLabelAction } from '../domain/relationships';
import type { EdgeStyle } from '../domain/types';
import { useBoardActions } from './board-context';

type RelationshipData = {
  label?: string;
  style?: EdgeStyle;
  solo?: boolean;
};

const STYLES: { id: EdgeStyle; label: string }[] = [
  { id: 'solid', label: 'Solid' },
  { id: 'dashed', label: 'Dashed' },
  { id: 'red-string', label: 'Red String' },
];

export function RelationshipEdge({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  selected,
  data: rawData,
  interactionWidth,
}: EdgeProps) {
  const data = rawData as RelationshipData | undefined;
  const actions = useBoardActions();
  const zoom = useStore((state) => state.transform[2]);
  const [path, labelX, labelY] = getBezierPath({ sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition });
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(data?.label ?? '');
  const cancelRef = useRef(false);
  const closedRef = useRef(false);
  const draftRef = useRef(draft);
  const generation = useRef(0);
  const actionsRef = useRef(actions);
  draftRef.current = draft;
  actionsRef.current = actions;
  const style = data?.style === 'dashed' || data?.style === 'red-string' ? data.style : 'solid';
  const showTools = Boolean(selected && data?.solo);

  function beginEdit() {
    cancelRef.current = false;
    closedRef.current = false;
    draftRef.current = data?.label ?? '';
    setDraft(draftRef.current);
    setEditing(true);
    actions.setEdgeEditor(true);
  }

  function finish(gesture: 'enter' | 'blur' | 'escape') {
    if (closedRef.current) return;
    const action = nextLabelAction(false, cancelRef.current, gesture);
    closedRef.current = action.closed;
    setEditing(false);
    actions.setEdgeEditor(false);
    if (action.commit) actions.commitEdgeLabel(id, draftRef.current);
  }

  useEffect(() => {
    if (!editing) return;
    const mountedGeneration = ++generation.current;
    return () => {
      const snapshot = {
        id,
        draft: draftRef.current,
        closed: closedRef.current,
        cancelled: cancelRef.current,
      };
      queueMicrotask(() => {
        const action = finalizeCulledEdgeLabel({
          finalUnmount: isFinalUnmount(mountedGeneration, generation.current),
          closed: snapshot.closed,
          cancelled: snapshot.cancelled,
        });
        if (action === 'ignore') return;
        closedRef.current = true;
        actionsRef.current.setEdgeEditor(false);
        if (action === 'commit') actionsRef.current.commitEdgeLabel(snapshot.id, snapshot.draft);
      });
    };
  }, [editing, id]);

  return (
    <>
      <BaseEdge id={id} path={path} interactionWidth={interactionWidth ?? 18} />
      {data?.label ? (
        <EdgeLabelRenderer>
          <div
            className="edge-label"
            style={{ transform: `translate(${labelX}px, ${labelY - 16}px) scale(${1 / zoom}) translate(-50%, -50%)` }}
          >
            {data.label}
          </div>
        </EdgeLabelRenderer>
      ) : null}
      <EdgeToolbar className="nodrag nopan edge-tools" edgeId={id} x={labelX} y={labelY + 8} alignY="top" isVisible={showTools}>
        {editing ? (
          <input
            className="edge-label-input"
            aria-label="Relationship label"
            value={draft}
            maxLength={80}
            autoFocus
            onChange={(event) => {
              draftRef.current = event.target.value.replace(/[\u0000-\u001F\u007F]/g, '');
              setDraft(draftRef.current);
            }}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault();
                event.stopPropagation();
                finish('enter');
              } else if (event.key === 'Escape') {
                event.preventDefault();
                event.stopPropagation();
                cancelRef.current = true;
                setDraft(data?.label ?? '');
                finish('escape');
              }
            }}
            onBlur={() => finish('blur')}
          />
        ) : (
          <button type="button" className="icon-button" aria-label="Edit label" title="Edit label" onClick={beginEdit}>
            <Type size={15} strokeWidth={1.75} />
          </button>
        )}
        <div className="edge-styles" role="group" aria-label="Relationship style">
          {STYLES.map((entry) => (
            <button
              key={entry.id}
              type="button"
              className="style-sample"
              aria-label={entry.label}
              title={entry.label}
              aria-pressed={style === entry.id}
              onClick={() => actions.setRelationshipStyle(id, entry.id)}
            >
              <svg viewBox="0 0 28 8" aria-hidden="true">
                <line x1="2" y1="4" x2="26" y2="4" className={`sample-${entry.id}`} />
              </svg>
            </button>
          ))}
        </div>
        <button type="button" className="icon-button" aria-label="Delete relationship" title="Delete relationship" onClick={() => actions.deleteRelationship(id)}>
          <Trash2 size={15} strokeWidth={1.75} />
        </button>
      </EdgeToolbar>
    </>
  );
}

export const edgeTypes = { relationship: RelationshipEdge };

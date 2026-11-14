import { NodeResizer, type Node, type NodeProps } from '@xyflow/react';
import { Palette } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import type { BackgroundTone } from '../domain/types';
import { useBoardActions } from './board-context';
import { PortHandles } from './PortHandles';

const GROUP_TONES: Array<BackgroundTone | 'default'> = ['default', 'slate', 'sage', 'sand', 'rose'];

export type GroupNodeData = {
  label: string;
  minWidth: number;
  minHeight: number;
  backgroundTone?: BackgroundTone;
};

export type GroupFlowNode = Node<GroupNodeData, 'group'>;

export function GroupNode({ id, data, selected }: NodeProps<GroupFlowNode>) {
  const actions = useBoardActions();
  const [editing, setEditing] = useState(false);
  const [tonesOpen, setTonesOpen] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!editing) return;
    inputRef.current?.focus();
    inputRef.current?.select();
  }, [editing]);

  return (
    <div className={`group-node${data.backgroundTone ? ` group-bg-${data.backgroundTone}` : ''}${selected ? ' is-selected' : ''}`}>
      <NodeResizer
        isVisible={selected}
        minWidth={data.minWidth}
        minHeight={data.minHeight}
        color="#7aa2c4"
        lineStyle={{ borderColor: '#7aa2c4' }}
      />
      <PortHandles />
      <div className="group-header">
        {editing ? (
          <input
            ref={inputRef}
            className="nodrag nopan nowheel"
            aria-label="Group name"
            value={data.label}
            onChange={(event) => actions.renameGroup(id, event.target.value)}
            onBlur={() => {
              setEditing(false);
              actions.endRename();
            }}
            onKeyDown={(event) => {
              if (event.key !== 'Escape' && event.key !== 'Enter') return;
              event.preventDefault();
              event.stopPropagation();
              setEditing(false);
              actions.endRename();
            }}
          />
        ) : (
          <button type="button" className="group-label" onDoubleClick={() => setEditing(true)}>
            {data.label || 'Group'}
          </button>
        )}
        {selected ? (
          <span className="group-actions nodrag nopan nowheel">
            <button type="button" onClick={() => actions.createNoteIn(id)}>
              Note inside
            </button>
            <button type="button" onClick={() => actions.deleteContents(id)}>
              Delete contents
            </button>
            <button type="button" className="icon-button" aria-label="Group background" title="Group background" aria-pressed={tonesOpen} onClick={() => setTonesOpen((open) => !open)}>
              <Palette size={15} strokeWidth={1.75} />
            </button>
            {tonesOpen ? (
              <span className="group-tone-menu" role="menu" aria-label="Group background" onKeyDown={(event) => {
                if (event.key !== 'Escape') return;
                event.stopPropagation();
                setTonesOpen(false);
              }}>
                {GROUP_TONES.map((tone) => (
                  <button
                    key={tone}
                    type="button"
                    role="menuitemradio"
                    aria-checked={(data.backgroundTone ?? 'default') === tone}
                    aria-label={tone}
                    title={tone}
                    onClick={() => {
                      actions.setGroupTone(id, tone);
                      setTonesOpen(false);
                    }}
                  >
                    <span className={`swatch tone-${tone}`} />
                  </button>
                ))}
              </span>
            ) : null}
          </span>
        ) : null}
      </div>
    </div>
  );
}

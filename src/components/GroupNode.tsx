import { NodeResizer, type Node, type NodeProps } from '@xyflow/react';
import { useEffect, useRef, useState } from 'react';
import { useBoardActions } from './board-context';
import { PortHandles } from './PortHandles';

export type GroupNodeData = {
  label: string;
  minWidth: number;
  minHeight: number;
};

export type GroupFlowNode = Node<GroupNodeData, 'group'>;

export function GroupNode({ id, data, selected }: NodeProps<GroupFlowNode>) {
  const actions = useBoardActions();
  const [editing, setEditing] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!editing) return;
    inputRef.current?.focus();
    inputRef.current?.select();
  }, [editing]);

  return (
    <div className={selected ? 'group-node is-selected' : 'group-node'}>
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
          </span>
        ) : null}
      </div>
    </div>
  );
}

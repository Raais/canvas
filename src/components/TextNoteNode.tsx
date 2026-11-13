import { NodeResizer, type Node, type NodeProps } from '@xyflow/react';
import { useEffect, useRef } from 'react';
import { useBoardActions } from './board-context';
import { PortHandles } from './PortHandles';

export type TextNodeData = {
  text: string;
  editing: boolean;
};

export type TextFlowNode = Node<TextNodeData, 'text'>;

export function TextNoteNode({ id, data, selected }: NodeProps<TextFlowNode>) {
  const actions = useBoardActions();
  const editorRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (!data.editing) return;
    const editor = editorRef.current;
    if (!editor) return;
    editor.focus();
    const end = editor.value.length;
    editor.setSelectionRange(end, end);
  }, [data.editing]);

  const className = data.editing ? 'text-note is-editing' : selected ? 'text-note is-selected' : 'text-note';

  return (
    <div
      className={className}
      onDoubleClick={(event) => {
        event.stopPropagation();
        actions.beginEditing(id);
      }}
    >
      <NodeResizer
        isVisible={selected && !data.editing}
        minWidth={160}
        minHeight={72}
        color="#7aa2c4"
        lineStyle={{ borderColor: '#7aa2c4' }}
      />
      <PortHandles />
      {data.editing ? (
        <textarea
          ref={editorRef}
          className="nodrag nopan nowheel"
          aria-label="Note text"
          value={data.text}
          onChange={(event) => actions.updateText(id, event.target.value)}
          onBlur={() => actions.endEditing()}
          onKeyDown={(event) => {
            if (event.key !== 'Escape') return;
            event.preventDefault();
            event.stopPropagation();
            actions.endEditing();
          }}
        />
      ) : (
        <div className="text-body">
          {data.text ? data.text : <span className="text-placeholder">Empty note</span>}
        </div>
      )}
    </div>
  );
}

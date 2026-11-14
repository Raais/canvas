import { NodeResizer, type Node, type NodeProps } from '@xyflow/react';
import { useEffect, useRef } from 'react';
import { useBoardActions } from './board-context';
import { PortHandles } from './PortHandles';

export type TextNodeData = {
  text: string;
  editing: boolean;
  presentation: 'text' | 'code';
  language?: string;
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

  const className = [
    'text-note',
    data.presentation === 'code' ? 'is-code' : '',
    data.editing ? 'is-editing' : '',
    selected ? 'is-selected' : '',
  ].filter(Boolean).join(' ');

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
      {selected && !data.editing ? (
        <div className="image-tools nodrag nopan nowheel" onPointerDown={(event) => event.stopPropagation()}>
          <button type="button" aria-pressed={data.presentation !== 'code'} onClick={() => actions.setPresentation(id, 'text')}>
            Text
          </button>
          <button type="button" aria-pressed={data.presentation === 'code'} onClick={() => actions.setPresentation(id, 'code')}>
            Code
          </button>
        </div>
      ) : null}
      {data.presentation === 'code' && !data.editing ? <span className="code-mark">{data.language ?? 'Code'}</span> : null}
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

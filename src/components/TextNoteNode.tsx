import { memo, useEffect, useRef, useState, type ChangeEvent, type PointerEvent } from 'react';
import { Handle, NodeResizer, Position, type Node, type NodeProps } from '@xyflow/react';
import { Code2, Palette, Type } from 'lucide-react';
import { useBoardActions } from './board-context';
import { HANDLE_SIDES, visualHandleTransform } from '../editor/handles';
import { highlightCode, resolveHighlightLanguage } from '../domain/highlight';
import { toggleHighlight } from '../domain/markdown';
import { MarkdownView } from './MarkdownView';
import type { BackgroundTone, CodeLanguage, TextTone } from '../domain/types';

export type TextNodeData = {
  text: string;
  editing: boolean;
  presentation: 'text' | 'markdown' | 'code';
  language?: string;
  codeLanguage?: CodeLanguage;
  backgroundTone?: BackgroundTone;
  textTone?: TextTone;
};

const BACKGROUNDS: Array<BackgroundTone | 'default'> = ['default', 'slate', 'sage', 'sand', 'rose'];
const TEXTS: Array<TextTone | 'default'> = ['default', 'muted', 'blue', 'sage', 'warm'];
const LANGUAGES: Array<CodeLanguage | 'auto'> = ['auto', 'javascript', 'typescript', 'python', 'json', 'html', 'css', 'shell', 'plain'];

function CodeView({ text, language, codeLanguage }: Pick<TextNodeData, 'text' | 'language' | 'codeLanguage'>) {
  const tokens = highlightCode(text, resolveHighlightLanguage(codeLanguage, language));
  return (
    <pre className="code-body">
      <code>
        {tokens.map((token, index) => (
          token.className
            ? <span key={index} className={`hl-${token.className}`}>{token.value}</span>
            : <span key={index}>{token.value}</span>
        ))}
      </code>
    </pre>
  );
}

function TextNoteNodeComponent({ id, data, selected }: NodeProps<Node<TextNodeData, 'text'>>) {
  const actions = useBoardActions();
  const editorRef = useRef<HTMLTextAreaElement>(null);
  const [menu, setMenu] = useState<'background' | 'text' | null>(null);

  useEffect(() => {
    if (!data.editing) return;
    const editor = editorRef.current;
    if (!editor) return;
    editor.focus();
    const end = editor.value.length;
    editor.setSelectionRange(end, end);
  }, [data.editing]);

  const tone = `note-bg-${data.backgroundTone ?? 'default'} note-ink-${data.textTone ?? 'default'}`;

  function highlight(event: PointerEvent) {
    event.preventDefault();
    event.stopPropagation();
    const editor = editorRef.current;
    if (!editor) return;
    const next = toggleHighlight(data.text, editor.selectionStart, editor.selectionEnd);
    if (!next) return;
    actions.updateText(id, next.text);
    requestAnimationFrame(() => editor.setSelectionRange(next.start, next.end));
  }

  return (
    <article className={`text-note ${tone}${selected ? ' is-selected' : ''}`} onDoubleClick={() => actions.beginEditing(id)}>
      <NodeResizer isVisible={selected} minWidth={160} minHeight={96} />
      {HANDLE_SIDES.map((side) => (
        <Handle key={side} id={side} type="source" position={side as Position} className="port nodrag nopan">
          <span className="port-dot" style={{ transform: visualHandleTransform() }} />
        </Handle>
      ))}
      {selected && !data.editing ? (
        <div className="note-tools nodrag nopan" onPointerDown={(event) => event.stopPropagation()}>
          {(['text', 'markdown', 'code'] as const).map((mode) => (
            <button key={mode} type="button" aria-pressed={data.presentation === mode} onClick={() => actions.setPresentation(id, mode)}>
              {mode === 'text' ? 'Text' : mode === 'markdown' ? 'Markdown' : 'Code'}
            </button>
          ))}
          <button type="button" aria-label="Background tone" onClick={() => setMenu(menu === 'background' ? null : 'background')}><Palette size={14} /></button>
          <button type="button" aria-label="Text tone" onClick={() => setMenu(menu === 'text' ? null : 'text')}><Type size={14} /></button>
          {data.presentation === 'code' ? (
            <label className="language-choice">
              <Code2 size={14} />
              <select value={data.codeLanguage ?? 'auto'} onChange={(event: ChangeEvent<HTMLSelectElement>) => actions.setCodeLanguage(id, event.target.value as CodeLanguage | 'auto')}>
                {LANGUAGES.map((language) => <option key={language} value={language}>{language}</option>)}
              </select>
            </label>
          ) : null}
          {menu ? (
            <div className="tone-menu" role="menu">
              {(menu === 'background' ? BACKGROUNDS : TEXTS).map((toneName) => (
                <button key={toneName} type="button" onClick={() => { actions.setNoteTone(id, menu, toneName); setMenu(null); }}>
                  <span className={`swatch note-bg-${menu === 'background' ? toneName : 'default'} note-ink-${menu === 'text' ? toneName : 'default'}`} />
                  {toneName}
                </button>
              ))}
            </div>
          ) : null}
        </div>
      ) : null}
      {data.editing ? (
        <>
          {data.presentation === 'markdown' ? (
            <button type="button" className="highlight-action nodrag nopan" onPointerDown={highlight}>Highlight</button>
          ) : null}
          <textarea
            ref={editorRef}
            className="text-editor nodrag nopan"
            value={data.text}
            aria-label="Note text"
            onChange={(event) => actions.updateText(id, event.target.value)}
            onBlur={() => actions.endEditing()}
            onPointerDown={(event) => event.stopPropagation()}
          />
        </>
      ) : data.presentation === 'markdown' ? (
        <MarkdownView text={data.text} onToggle={(index) => actions.toggleTask(id, index)} />
      ) : data.presentation === 'code' ? (
        <>
          <span className="code-label">{data.codeLanguage ?? data.language ?? 'Code'}</span>
          <CodeView text={data.text} language={data.language} codeLanguage={data.codeLanguage} />
        </>
      ) : (
        <p className="text-body">{data.text || 'Empty note'}</p>
      )}
    </article>
  );
}

export type TextFlowNode = Node<TextNodeData, 'text'>;

export const TextNoteNode = memo(TextNoteNodeComponent);

import { memo, useEffect, useRef, useState, type ChangeEvent, type PointerEvent, type RefObject } from 'react';
import { Handle, NodeResizer, NodeToolbar, Position, useInternalNode, useViewport, type Node, type NodeProps } from '@xyflow/react';
import { Code2, FileText, Highlighter, Link2, ListTodo, Lock, LockOpen, Palette, SquareStack, Type, Unlink } from 'lucide-react';
import { useBoardActions } from './board-context';
import { HANDLE_SIDES, visualHandleTransform } from '../editor/handles';
import { isFinalUnmount } from '../editor/cull-edit';
import { highlightCode, resolveHighlightLanguage } from '../domain/highlight';
import { toggleHighlight } from '../domain/markdown';
import { MarkdownView } from './MarkdownView';
import { NodeDateLabel } from './NodeDateLabel';
import { TEXT_MIN_WIDTH, TEXT_RESIZE_MIN_HEIGHT, type BackgroundTone, type CodeLanguage, type TextTone } from '../domain/types';

export type TextNodeData = {
  text: string;
  editing: boolean;
  presentation: 'text' | 'markdown' | 'code';
  language?: string;
  codeLanguage?: CodeLanguage;
  backgroundTone?: BackgroundTone;
  textTone?: TextTone;
  lastEditedAt?: string;
  protected: boolean;
  unlocked: boolean;
  readOnly: boolean;
  sourceFilename?: string;
  mirror?: boolean;
  mirrorCount?: number;
  sourceMissing?: boolean;
};

const BACKGROUNDS: Array<BackgroundTone | 'default'> = ['default', 'slate', 'sage', 'sand', 'rose'];
const TEXTS: Array<TextTone | 'default'> = ['default', 'muted', 'blue', 'sage', 'warm'];
const LANGUAGES: Array<CodeLanguage | 'auto'> = ['auto', 'javascript', 'typescript', 'python', 'json', 'html', 'css', 'shell', 'plain'];
const LANGUAGE_LABEL: Record<CodeLanguage | 'auto', string> = {
  auto: 'Auto',
  javascript: 'JS',
  typescript: 'TS',
  python: 'PY',
  json: 'JSON',
  html: 'HTML',
  css: 'CSS',
  shell: 'SH',
  plain: 'Text',
};

function CodeView({ text, language, codeLanguage }: Pick<TextNodeData, 'text' | 'language' | 'codeLanguage'>) {
  const tokens = highlightCode(text, resolveHighlightLanguage(codeLanguage, language));
  const label = codeLanguage ? LANGUAGE_LABEL[codeLanguage] : language ?? 'Code';
  return (
    <div className="code-view">
      <pre className="code-body">
        <code>
          {tokens.map((token, index) => (
            token.className
              ? <span key={index} className={`hl-${token.className}`}>{token.value}</span>
              : <span key={index}>{token.value}</span>
          ))}
        </code>
      </pre>
      <span className="code-label">{label}</span>
    </div>
  );
}

function NoteChrome({
  id,
  data,
  editorRef,
}: {
  id: string;
  data: TextNodeData;
  editorRef: RefObject<HTMLTextAreaElement | null>;
}) {
  const actions = useBoardActions();
  const [menu, setMenu] = useState<'background' | 'text' | null>(null);
  const internal = useInternalNode(id);
  const viewport = useViewport();
  const screenTop = (internal?.internals.positionAbsolute.y ?? 0) * viewport.zoom + viewport.y;
  const position = screenTop < 56 ? Position.Bottom : Position.Top;
  const editingMarkdown = data.editing && data.presentation === 'markdown';

  function holdSelection(event: PointerEvent) {
    const target = event.target;
    if (target instanceof HTMLSelectElement) return;
    event.preventDefault();
    event.stopPropagation();
  }

  function highlight(event: PointerEvent) {
    holdSelection(event);
    const editor = editorRef.current;
    if (!editor) return;
    const next = toggleHighlight(data.text, editor.selectionStart, editor.selectionEnd);
    if (!next) return;
    actions.updateText(id, next.text);
    requestAnimationFrame(() => editor.setSelectionRange(next.start, next.end));
  }

  return (
      <NodeToolbar
        position={position}
        offset={10}
        isVisible={data.editing && !editingMarkdown ? false : undefined}
        className={`note-toolbar nodrag nopan nowheel${position === Position.Bottom ? ' is-below' : ''}`}
      >
        <div className="note-toolbar-row" onPointerDown={holdSelection}>
          {editingMarkdown ? (
            <button type="button" className="icon-button" aria-label="Highlight selected text" title="Highlight selected text" onPointerDown={highlight}>
              <Highlighter size={16} strokeWidth={1.75} />
            </button>
          ) : (
            <>
              <button type="button" className="icon-button" aria-label="Text mode" title="Text" aria-pressed={data.presentation === 'text'} onClick={() => actions.setPresentation(id, 'text')}>
                <FileText size={16} strokeWidth={1.75} />
              </button>
              <button type="button" className="icon-button" aria-label="Markdown mode" title="Markdown" aria-pressed={data.presentation === 'markdown'} onClick={() => actions.setPresentation(id, 'markdown')}>
                <ListTodo size={16} strokeWidth={1.75} />
              </button>
              <button type="button" className="icon-button" aria-label="Code mode" title="Code" aria-pressed={data.presentation === 'code'} onClick={() => actions.setPresentation(id, 'code')}>
                <Code2 size={16} strokeWidth={1.75} />
              </button>
              <button type="button" className="icon-button" aria-label="Background tone" title="Background tone" aria-pressed={menu === 'background'} onClick={() => setMenu(menu === 'background' ? null : 'background')}>
                <Palette size={16} strokeWidth={1.75} />
              </button>
              <button type="button" className="icon-button" aria-label="Text tone" title="Text tone" aria-pressed={menu === 'text'} onClick={() => setMenu(menu === 'text' ? null : 'text')}>
                <Type size={16} strokeWidth={1.75} />
              </button>
              {!data.protected && !data.mirror ? (
                <button type="button" className="icon-button" aria-label="Password protect" title="Password protect" disabled={data.readOnly} onClick={() => actions.requestProtect(id)}>
                  <Lock size={16} strokeWidth={1.75} />
                </button>
              ) : null}
              {!data.protected ? (
                <button type="button" className="icon-button" aria-label={data.mirror ? 'Create another mirror' : 'Create mirror'} title={data.mirror ? 'Create another mirror' : 'Create mirror'} disabled={data.readOnly || data.sourceMissing} onClick={() => actions.createMirror(id)}>
                  <SquareStack size={16} strokeWidth={1.75} />
                </button>
              ) : null}
              {data.mirror ? (
                <button type="button" className="icon-button" aria-label="Jump to original" title="Jump to original" onClick={() => actions.jumpToSource(id)}>
                  <Link2 size={16} strokeWidth={1.75} />
                </button>
              ) : null}
              {data.mirror ? (
                <button type="button" className="icon-button" aria-label="Detach mirror" title="Detach mirror" disabled={data.readOnly || data.sourceMissing} onClick={() => actions.detachMirror(id)}>
                  <Unlink size={16} strokeWidth={1.75} />
                </button>
              ) : null}
              {data.protected && !data.unlocked ? (
                <button type="button" className="icon-button" aria-label="Unlock" title="Unlock" onClick={() => actions.requestUnlock(id)}>
                  <LockOpen size={16} strokeWidth={1.75} />
                </button>
              ) : null}
              {data.protected && data.unlocked ? (
                <>
                  <button type="button" className="icon-button" aria-label="Lock" title="Lock" onClick={() => actions.lockNote(id)}>
                    <Lock size={16} strokeWidth={1.75} />
                  </button>
                  <button type="button" className="icon-button" aria-label="Remove password protection" title="Remove password protection" disabled={data.readOnly} onClick={() => actions.removeProtection(id)}>
                    <LockOpen size={16} strokeWidth={1.75} />
                  </button>
                </>
              ) : null}
              {data.presentation === 'code' ? (
                <select
                  className="language-choice"
                  aria-label="Code language"
                  value={data.codeLanguage ?? 'auto'}
                  onChange={(event: ChangeEvent<HTMLSelectElement>) => actions.setCodeLanguage(id, event.target.value as CodeLanguage | 'auto')}
                >
                  {LANGUAGES.map((language) => <option key={language} value={language}>{LANGUAGE_LABEL[language]}</option>)}
                </select>
              ) : null}
            </>
          )}
        </div>
        {menu && !data.editing ? (
          <div className={`tone-menu${menu === 'text' ? ' text-tone-menu' : ''}`} role="menu" aria-label={menu === 'background' ? 'Background tone' : 'Text tone'}>
            {(menu === 'background' ? BACKGROUNDS : TEXTS).map((toneName) => {
              const active = menu === 'background'
                ? (data.backgroundTone ?? 'default') === toneName
                : (data.textTone ?? 'default') === toneName;
              return (
                <button key={toneName} type="button" role="menuitemradio" aria-checked={active} aria-label={toneName} title={toneName} onClick={() => { actions.setNoteTone(id, menu, toneName); setMenu(null); }}>
                  <span className={`swatch note-bg-${menu === 'background' ? toneName : 'default'} note-ink-${menu === 'text' ? toneName : 'default'}`} />
                </button>
              );
            })}
          </div>
        ) : null}
      </NodeToolbar>
  );
}

function TextNoteNodeComponent({ id, data, selected }: NodeProps<Node<TextNodeData, 'text'>>) {
  const actions = useBoardActions();
  const actionsRef = useRef(actions);
  const generation = useRef(0);
  const ownedToken = useRef<number | null>(null);
  actionsRef.current = actions;
  if (data.editing) {
    const token = actions.editingToken(id);
    if (token !== null) ownedToken.current = token;
  }
  const editorRef = useRef<HTMLTextAreaElement>(null);
  const tone = `note-bg-${data.backgroundTone ?? 'default'} note-ink-${data.textTone ?? 'default'}`;
  const showChrome = selected || (data.editing && data.presentation === 'markdown');

  useEffect(() => {
    if (!data.editing) return;
    const editor = editorRef.current;
    if (!editor) return;
    editor.focus();
    const end = editor.value.length;
    editor.setSelectionRange(end, end);
  }, [data.editing]);

  useEffect(() => {
    if (!data.editing) return;
    const mountedGeneration = ++generation.current;
    return () => {
      const token = ownedToken.current;
      queueMicrotask(() => {
        if (!isFinalUnmount(mountedGeneration, generation.current) || token === null) return;
        actionsRef.current.endEditing(token);
      });
    };
  }, [data.editing, id]);

  return (
    <article className={`text-note ${tone}${selected ? ' is-selected' : ''}${data.mirror ? ' is-mirror' : ''}${selected || data.editing ? ' nowheel' : ''}`} onDoubleClick={() => actions.beginEditing(id)}>
      <NodeResizer isVisible={selected} minWidth={TEXT_MIN_WIDTH} minHeight={TEXT_RESIZE_MIN_HEIGHT} />
      {showChrome ? <NoteChrome id={id} data={data} editorRef={editorRef} /> : null}
      {HANDLE_SIDES.map((side) => (
        <Handle key={side} id={side} type="source" position={side as Position} className="port nodrag nopan">
          <span className="port-dot" style={{ transform: visualHandleTransform() }} />
        </Handle>
      ))}
      <div className="text-note-content">
        {data.sourceFilename && !data.editing ? <p className="source-filename" title={data.sourceFilename}>{data.sourceFilename}</p> : null}
        {data.sourceMissing ? <p className="source-filename">Source unavailable</p> : null}
        {data.mirror && !data.editing ? <p className="mirror-mark" title="Live mirror of this note">Mirror</p> : null}
        {!data.mirror && data.mirrorCount ? <p className="mirror-mark" title="This note has live mirrors">{data.mirrorCount} {data.mirrorCount === 1 ? 'mirror' : 'mirrors'}</p> : null}
        {data.protected && !data.unlocked ? (
          <div className="protected-placeholder">
            <Lock size={16} strokeWidth={1.75} />
            <span>Password protected</span>
          </div>
        ) : data.editing ? (
          <textarea
            ref={editorRef}
            className="text-editor nodrag nopan"
            value={data.text}
            aria-label="Note text"
            onChange={(event) => actions.updateText(id, event.target.value)}
            onBlur={() => {
              const token = ownedToken.current;
              if (token === null) return;
              actions.endEditing(token);
            }}
            onKeyDown={(event) => {
              const finish = event.key === 'Escape' || (event.key === 'Enter' && (event.metaKey || event.ctrlKey));
              if (!finish) return;
              event.preventDefault();
              event.stopPropagation();
              event.currentTarget.blur();
            }}
            onPointerDown={(event) => event.stopPropagation()}
          />
        ) : data.presentation === 'markdown' ? (
          <MarkdownView text={data.text} onToggle={(offset) => actions.toggleTask(id, offset)} />
        ) : data.presentation === 'code' ? (
          <CodeView text={data.text} language={data.language} codeLanguage={data.codeLanguage} />
        ) : (
          <p className="text-body">{data.text || 'Empty note'}</p>
        )}
      </div>
      <NodeDateLabel iso={data.lastEditedAt} />
    </article>
  );
}

export type TextFlowNode = Node<TextNodeData, 'text'>;

export const TextNoteNode = memo(TextNoteNodeComponent);

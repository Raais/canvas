import { describe, expect, test } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';
import { createEmptyBoard, createTextNode, updateText } from '../domain/board';
import { createHistory, pushHistory, redoHistory, undoHistory } from '../domain/history';
import { toggleHighlight, toggleTask, toggleTaskAt } from '../domain/markdown';
import { MarkdownView } from '../components/MarkdownView';

declare const Bun: { file(path: URL): { text(): Promise<string> } };

function inputs(html: string): string[] {
  return html.match(/<input\b[^>]*>/g) ?? [];
}

describe('rendered markdown tasks', () => {
  test('renders checked and unchecked GFM checkboxes', () => {
    const html = renderToStaticMarkup(
      <MarkdownView text={'- [ ] Buy groceries\n- [x] Fix the bug\n- [X] Review'} onToggle={() => undefined} />,
    );
    const boxes = inputs(html);
    expect(boxes).toHaveLength(3);
    expect(boxes.filter((box) => box.includes('checked')).length).toBe(2);
    expect(boxes.some((box) => !box.includes('checked'))).toBe(true);
    expect(html.includes('<script')).toBe(false);
  });

  test('maps duplicate labels to different source offsets and ignores fences and invalid markers', () => {
    const source = '- [ ] Same label\n- [ ] Same label\n```\n- [ ] Same label\n```\n- [] not a task\n[ ] loose';
    const html = renderToStaticMarkup(<MarkdownView text={source} onToggle={() => undefined} />);
    const boxes = inputs(html);
    expect(boxes).toHaveLength(2);
    const first = boxes[0]?.match(/data-task="(\d+)"/)?.[1];
    const second = boxes[1]?.match(/data-task="(\d+)"/)?.[1];
    expect(first === second).toBe(false);
    expect(toggleTaskAt(source, Number(second))).toBe('- [ ] Same label\n- [x] Same label\n```\n- [ ] Same label\n```\n- [] not a task\n[ ] loose');
    expect(toggleTask(source, 0).startsWith('- [x] Same label\n- [ ] Same label')).toBe(true);
  });

  test('keeps CRLF and makes one checkbox undoable', () => {
    const note = createTextNode({ x: 0, y: 0 }, '- [ ] one\r\n- [ ] two');
    const start = { ...createEmptyBoard(), nodes: [note] };
    const toggled = updateText(start, note.id, toggleTaskAt(note.text, note.text.indexOf('- [ ] two')));
    const undone = undoHistory(pushHistory(createHistory(), start), toggled);
    expect(toggled.nodes[0]?.kind === 'text' && toggled.nodes[0].text.includes('\r\n- [x] two')).toBe(true);
    expect(undone?.board.nodes[0]?.kind === 'text' && undone.board.nodes[0].text).toBe(note.text);
    const redone = undone ? redoHistory(undone.history, undone.board) : null;
    expect(redone?.board.nodes[0]?.kind === 'text' && redone.board.nodes[0].text.includes('[x]')).toBe(true);
  });

  test('highlight still wraps only the selected range', () => {
    expect(toggleHighlight('keep this phrase', 5, 9)?.text).toBe('keep ==this== phrase');
  });
});

describe('contextual presentation source', () => {
  test('places note controls in a NodeToolbar and squares the image frame', async () => {
    const note = await Bun.file(new URL('../components/TextNoteNode.tsx', import.meta.url)).text();
    const image = await Bun.file(new URL('../components/ImageNoteNode.tsx', import.meta.url)).text();
    const menu = await Bun.file(new URL('../components/ProjectMenu.tsx', import.meta.url)).text();
    const css = await Bun.file(new URL('../styles/app.css', import.meta.url)).text();
    expect(note.includes('<NodeToolbar')).toBe(true);
    expect(note.includes('position={position}')).toBe(true);
    expect(note.includes('offset={10}')).toBe(true);
    expect(note.includes('aria-label="Text mode"')).toBe(true);
    expect(note.includes('aria-label="Markdown mode"')).toBe(true);
    expect(note.includes('aria-label="Code mode"')).toBe(true);
    expect(note.includes('aria-label="Highlight selected text"')).toBe(true);
    expect(note.includes('setNoteTone')).toBe(true);
    expect(note.includes('className="code-label"')).toBe(true);
    expect(image.includes("is-square")).toBe(true);
    expect(menu.includes('Canvas background')).toBe(true);
    expect(menu.includes('Project actions')).toBe(true);
    expect(menu.includes('onPattern(choice)')).toBe(true);
    expect(menu.includes('onExport')).toBe(true);
    expect(css.includes('.note-toolbar button')).toBe(true);
    expect(css.includes('.tone-menu button')).toBe(true);
    expect(css.includes('.image-note.is-square')).toBe(true);
    expect(css.includes('.image-note.is-square.is-selected { border-radius: 0; }')).toBe(true);
    expect(css.includes('.code-label')).toBe(true);
    expect(css.includes('bottom: 8px')).toBe(true);
    expect(css.includes('.pattern-section')).toBe(true);
  });
});

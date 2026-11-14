import { describe, expect, test } from 'bun:test';
import { createEmptyBoard } from '../domain/board';
import { facingHandles } from '../domain/geometry';
import { connectNodes } from '../domain/graph';
import { createHistory, pushHistory, redoHistory, undoHistory } from '../domain/history';
import { canEditSelection, canLinkSelection, plainShortcutBlocked, type ShortcutGuard } from '../editor/shortcuts';
import type { BoardNode } from '../domain/types';

declare const Bun: { file(path: URL): { text(): Promise<string> } };

function note(id: string, x: number, y: number, parentId?: string): BoardNode {
  return { id, kind: 'text', x, y, width: 40, height: 40, text: id, ...(parentId ? { parentId } : {}) };
}

function guard(patch: Partial<ShortcutGuard>): ShortcutGuard {
  return {
    defaultPrevented: false,
    composing: false,
    repeat: false,
    meta: false,
    ctrl: false,
    alt: false,
    shift: false,
    tag: null,
    editable: false,
    inOverlay: false,
    editing: false,
    blocked: false,
    ...patch,
  };
}

describe('text note handles and swatches', () => {
  test('clips note content without clipping the outer handles', async () => {
    const noteSource = await Bun.file(new URL('../components/TextNoteNode.tsx', import.meta.url)).text();
    const css = await Bun.file(new URL('../styles/app.css', import.meta.url)).text();
    const contentAt = noteSource.indexOf('className="text-note-content"');
    expect(contentAt).toBeGreaterThan(noteSource.indexOf('<NodeResizer'));
    expect(contentAt).toBeGreaterThan(noteSource.indexOf('<Handle'));
    expect(noteSource.indexOf('<textarea', contentAt)).toBeGreaterThan(contentAt);
    expect(noteSource.indexOf('<MarkdownView', contentAt)).toBeGreaterThan(contentAt);
    expect(noteSource.indexOf('<CodeView', contentAt)).toBeGreaterThan(contentAt);
    expect(noteSource.indexOf('className="text-body"', contentAt)).toBeGreaterThan(contentAt);
    const frame = css.slice(css.indexOf('.text-note {'), css.indexOf('.text-note-content'));
    const content = css.slice(css.indexOf('.text-note-content {'), css.indexOf('.text-note-content {') + 160);
    expect(frame.includes('overflow: visible')).toBe(true);
    expect(frame.includes('overflow: hidden')).toBe(false);
    expect(content.includes('overflow: hidden')).toBe(true);
    expect(css.includes('.text-tone-menu .swatch { background-color: currentColor; }')).toBe(true);
    expect(css.includes('.note-ink-default { color: var(--text); }')).toBe(true);
    expect(css.includes('.note-bg-slate')).toBe(true);
  });
});

describe('distraction-free chrome', () => {
  test('is temporary interface state and leaves node tools mounted', async () => {
    const view = await Bun.file(new URL('../components/BoardView.tsx', import.meta.url)).text();
    const board = await Bun.file(new URL('../domain/board.ts', import.meta.url)).text();
    expect(view.includes('useState(false)')).toBe(true);
    expect(view.includes('Hide interface')).toBe(true);
    expect(view.includes('Show interface')).toBe(true);
    expect(view.includes('className="focus-toggle"')).toBe(true);
    expect(view.includes('chromeHidden ? null : (')).toBe(true);
    expect(board.includes('chromeHidden')).toBe(false);
    expect(view.includes('<NodeToolbar')).toBe(false);
  });
});

describe('link and edit shortcuts', () => {
  test('chooses facing handles, including grouped children and a coincident fallback', () => {
    const nodes = [
      note('a', 0, 0),
      note('b', 200, 10),
      note('c', 10, 180),
      note('d', 80, 0),
      { id: 'group', kind: 'group' as const, x: 100, y: 100, width: 300, height: 200, label: 'Group' },
      note('child', 10, 20, 'group'),
      note('outside', 0, 200),
    ];
    expect(facingHandles(nodes, 'a', 'b')).toEqual({ source: 'right', target: 'left' });
    expect(facingHandles(nodes, 'b', 'a')).toEqual({ source: 'left', target: 'right' });
    expect(facingHandles(nodes, 'a', 'c')).toEqual({ source: 'bottom', target: 'top' });
    expect(facingHandles(nodes, 'c', 'a')).toEqual({ source: 'top', target: 'bottom' });
    expect(facingHandles(nodes, 'a', 'd')?.source).toBe('right');
    expect(facingHandles(nodes, 'a', 'a')).toBeNull();
    expect(facingHandles(nodes, 'child', 'outside')).toEqual({ source: 'left', target: 'right' });
    expect(facingHandles([note('same', 0, 0), note('twin', 0, 0)], 'same', 'twin')).toEqual({ source: 'right', target: 'left' });
  });

  test('creates one undoable link and rejects a duplicate', () => {
    const start = { ...createEmptyBoard(), nodes: [note('a', 0, 0), note('b', 240, 0)] };
    const handles = facingHandles(start.nodes, 'a', 'b');
    const linked = handles ? connectNodes(start, 'a', 'b', handles.source, handles.target) : null;
    expect(linked?.edges).toHaveLength(1);
    expect(canLinkSelection(2, false)).toBe(true);
    expect(canLinkSelection(2, true)).toBe(false);
    expect(canLinkSelection(1, false)).toBe(false);
    expect(canLinkSelection(3, false)).toBe(false);
    expect(handles ? connectNodes(linked ?? start, 'a', 'b', handles.source, handles.target) : null).toBeNull();
    const undone = linked ? undoHistory(pushHistory(createHistory(), start), linked) : null;
    expect(undone?.board.edges).toHaveLength(0);
    const redone = undone ? redoHistory(undone.history, undone.board) : null;
    expect(redone?.board.edges).toHaveLength(1);
  });

  test('guards plain shortcuts and only edits one text note', () => {
    expect(plainShortcutBlocked(guard({}))).toBe(false);
    expect(plainShortcutBlocked(guard({ tag: 'TEXTAREA' }))).toBe(true);
    expect(plainShortcutBlocked(guard({ tag: 'SELECT' }))).toBe(true);
    expect(plainShortcutBlocked(guard({ tag: 'BUTTON' }))).toBe(true);
    expect(plainShortcutBlocked(guard({ shift: true }))).toBe(true);
    expect(plainShortcutBlocked(guard({ editing: true }))).toBe(true);
    expect(plainShortcutBlocked(guard({ blocked: true }))).toBe(true);
    expect(plainShortcutBlocked(guard({ inOverlay: true }))).toBe(true);
    expect(plainShortcutBlocked(guard({ repeat: true }))).toBe(true);
    expect(plainShortcutBlocked(guard({ composing: true }))).toBe(true);
    expect(canEditSelection(1, 'text')).toBe(true);
    expect(canEditSelection(1, 'image')).toBe(false);
    expect(canEditSelection(1, 'group')).toBe(false);
    expect(canEditSelection(0, 'text')).toBe(false);
    expect(canEditSelection(2, 'text')).toBe(false);
  });
});

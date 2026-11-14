import { describe, expect, test } from 'bun:test';
import { classifyPlainText } from '../domain/code';
import { createEmptyBoard, createTextNode, parseBoard, setBackgroundPattern, setCornerStyle, updateText } from '../domain/board';
import { createHistory, pushHistory, undoHistory } from '../domain/history';
import { highlightCode } from '../domain/highlight';
import { safeHref, toggleHighlight, toggleTask } from '../domain/markdown';

describe('markdown notes', () => {
  test('recognizes task lists without converting prose or fenced code', () => {
    expect(classifyPlainText('- [ ] one\n- [x] two').presentation).toBe('markdown');
    expect(classifyPlainText('remember [ ] later').presentation).toBe('text');
    expect(classifyPlainText('```js\n- [ ] hidden\n```').presentation).toBe('code');
  });

  test('toggles the matching task and preserves the rest of the line', () => {
    const source = '- [ ] same\r\n- [ ] same\r\n```\r\n- [ ] hidden\r\n```\r\n- [x] last';
    expect(toggleTask(source, 1)).toBe('- [ ] same\r\n- [x] same\r\n```\r\n- [ ] hidden\r\n```\r\n- [x] last');
    expect(toggleTask('`[ ]` still text\n- [ ] real', 0)).toBe('`[ ]` still text\n- [x] real');
  });

  test('wraps and unwraps a highlight selection', () => {
    expect(toggleHighlight('hello', 0, 5)?.text).toBe('==hello==');
    expect(toggleHighlight('==hello==', 2, 7)?.text).toBe('hello');
    expect(toggleHighlight('hello', 1, 1)).toBeNull();
    expect(safeHref('javascript:alert(1)')).toBe(false);
    expect(safeHref('https://example.com')).toBe(true);
  });

  test('highlights code as tokens rather than executable html', () => {
    const tokens = highlightCode('const name = "<script>";', 'js');
    expect(tokens.some((token) => token.className === 'keyword')).toBe(true);
    expect(tokens.some((token) => token.value.includes('<script>'))).toBe(true);
  });
});

describe('presentation metadata', () => {
  test('defaults older boards and rejects unknown tones', () => {
    const empty = createEmptyBoard();
    expect(empty.backgroundPattern).toBe('dots');
    const legacy = parseBoard({ ...empty, schemaVersion: 3, backgroundPattern: undefined });
    expect(legacy?.backgroundPattern).toBe('dots');
    const invalid = parseBoard({
      ...empty,
      nodes: [{
        id: 'note',
        kind: 'text',
        x: 0,
        y: 0,
        width: 200,
        height: 120,
        text: 'a',
        backgroundTone: 'neon',
      }],
    });
    expect(invalid).toBeNull();
  });

  test('keeps the canvas pattern when an unrelated edit is undone', () => {
    const note = createTextNode({ x: 0, y: 0 }, 'before');
    const start = { ...createEmptyBoard(), nodes: [note] };
    const edited = updateText(start, note.id, 'after');
    const patterned = setBackgroundPattern(edited, 'blank');
    const restored = undoHistory(pushHistory(createHistory(), start), patterned);
    expect(restored?.board.backgroundPattern).toBe('blank');
    expect(restored?.board.nodes[0]?.kind === 'text' && restored.board.nodes[0].text).toBe('before');
  });

  test('stores square corners only when requested', () => {
    const board = createEmptyBoard();
    const image = {
      ...board,
      nodes: [{
        id: 'image',
        kind: 'image' as const,
        x: 0,
        y: 0,
        width: 100,
        height: 80,
        mode: 'aspect' as const,
        intrinsicWidth: 100,
        intrinsicHeight: 80,
        sizedFromImage: true,
        source: { type: 'external' as const, url: 'https://example.com/a.png' },
      }],
    };
    const parsed = parseBoard(image);
    expect(parsed?.nodes[0]?.kind).toBe('image');
    const square = parsed ? setCornerStyle(parsed, 'image', 'square') : null;
    expect(square?.nodes[0]?.kind === 'image' && square.nodes[0].cornerStyle).toBe('square');
  });
});

import { visit } from 'unist-util-visit';
import type { ListItem, Root } from 'mdast';

const TASK = /^(\s*[-*+] )\[([ xX])\]/;

type HastNode = {
  type: string;
  tagName?: string;
  properties?: Record<string, unknown>;
  children?: HastNode[];
};

export function remarkTaskIndex() {
  return (tree: Root) => {
    visit(tree, 'listItem', (node: ListItem) => {
      if (typeof node.checked !== 'boolean') return;
      const offset = node.position?.start.offset;
      if (offset == null) return;
      const data = node.data ?? {};
      node.data = {
        ...data,
        hProperties: { ...(data.hProperties as Record<string, unknown> | undefined), dataTask: String(offset) },
      };
    });
  };
}

export function rehypeTaskInputs() {
  return (tree: HastNode) => {
    visit(tree, 'element', (node: HastNode) => {
      if (node.tagName !== 'li' || node.properties?.dataTask == null) return;
      const input = node.children?.find((child) => child.tagName === 'input' && child.properties?.type === 'checkbox');
      if (!input?.properties) return;
      input.properties.dataTask = node.properties.dataTask;
      delete input.properties.disabled;
    });
  };
}

export function toggleTaskAt(source: string, offset: number): string {
  const lineStart = source.lastIndexOf('\n', Math.max(0, offset - 1)) + 1;
  const lineEnd = source.indexOf('\n', offset);
  const end = lineEnd === -1 ? source.length : lineEnd;
  const match = TASK.exec(source.slice(lineStart, end));
  if (!match) return source;
  const markAt = lineStart + match.index + match[1].length + 1;
  const mark = source[markAt] === ' ' ? 'x' : ' ';
  return source.slice(0, markAt) + mark + source.slice(markAt + 1);
}

export function toggleTask(source: string, taskIndex: number): string {
  const newline = source.includes('\r\n') ? '\r\n' : '\n';
  const lines = source.split(/\r?\n/);
  let fence = false;
  let seen = 0;
  const next = lines.map((line) => {
    if (line.trim().startsWith('```')) {
      fence = !fence;
      return line;
    }
    if (fence) return line;
    if (line.includes('`') && !TASK.test(line)) return line;
    const match = TASK.exec(line);
    if (!match) return line;
    if (seen++ !== taskIndex) return line;
    const mark = match[2] === ' ' ? 'x' : ' ';
    return `${match[1]}[${mark}]${line.slice(match[0].length)}`;
  });
  return next.join(newline);
}

export function toggleHighlight(source: string, start: number, end: number): { text: string; start: number; end: number } | null {
  if (start === end) return null;
  const from = Math.min(start, end);
  const to = Math.max(start, end);
  const selected = source.slice(from, to);
  const before = source.slice(Math.max(0, from - 2), from);
  const after = source.slice(to, to + 2);
  if (before === '==' && after === '==') {
    return { text: source.slice(0, from - 2) + selected + source.slice(to + 2), start: from - 2, end: to - 2 };
  }
  if (selected.startsWith('==') && selected.endsWith('==') && selected.length >= 4) {
    const inner = selected.slice(2, -2);
    return { text: source.slice(0, from) + inner + source.slice(to), start: from, end: from + inner.length };
  }
  const wrapped = `==${selected}==`;
  return { text: source.slice(0, from) + wrapped + source.slice(to), start: from, end: from + wrapped.length };
}

export function safeHref(value: string | undefined): boolean {
  if (!value) return false;
  try {
    const url = new URL(value, 'https://canvas.local');
    return url.protocol === 'http:' || url.protocol === 'https:' || url.protocol === 'mailto:';
  } catch {
    return false;
  }
}

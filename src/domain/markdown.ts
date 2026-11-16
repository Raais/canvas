import { fromMarkdown } from 'mdast-util-from-markdown';
import { gfmFromMarkdown } from 'mdast-util-gfm';
import { gfm } from 'micromark-extension-gfm';
import { visit } from 'unist-util-visit';
import type { ListItem, Root } from 'mdast';

type HastNode = {
  type: string;
  tagName?: string;
  properties?: Record<string, unknown>;
  children?: HastNode[];
};

export function taskMarkerOffsets(source: string): number[] {
  const tree = fromMarkdown(source, { extensions: [gfm()], mdastExtensions: [gfmFromMarkdown()] });
  const offsets: number[] = [];
  visit(tree, 'listItem', (node: ListItem) => {
    const offset = markerInItem(source, node);
    if (offset != null) offsets.push(offset);
  });
  return offsets;
}

function markerInItem(source: string, node: ListItem): number | null {
  if (typeof node.checked !== 'boolean') return null;
  const start = node.position?.start.offset;
  if (start == null) return null;
  const lineEnd = source.indexOf('\n', start);
  const slice = source.slice(start, lineEnd === -1 ? source.length : lineEnd);
  const match = /\[([ xX])\]/.exec(slice);
  if (!match) return null;
  return start + match.index + 1;
}

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
  const direct = source[offset];
  if (source[offset - 1] === '[' && source[offset + 1] === ']' && (direct === ' ' || direct === 'x' || direct === 'X')) {
    const mark = direct === ' ' ? 'x' : ' ';
    return source.slice(0, offset) + mark + source.slice(offset + 1);
  }
  const lineStart = source.lastIndexOf('\n', Math.max(0, offset - 1)) + 1;
  const lineEnd = source.indexOf('\n', offset);
  const end = lineEnd === -1 ? source.length : lineEnd;
  const parsed = taskMarkerOffsets(source).find((marker) => marker >= lineStart && marker < end);
  if (parsed == null) return source;
  return toggleTaskAt(source, parsed);
}

export function toggleTask(source: string, taskIndex: number): string {
  const marker = taskMarkerOffsets(source)[taskIndex];
  if (marker == null) return source;
  return toggleTaskAt(source, marker);
}

export function toggleHighlight(source: string, start: number, end: number): { text: string; start: number; end: number } | null {
  return toggleInline(source, start, end, '==');
}

export function toggleBold(source: string, start: number, end: number): { text: string; start: number; end: number } | null {
  return toggleInline(source, start, end, '**');
}

export function toggleItalic(source: string, start: number, end: number): { text: string; start: number; end: number } | null {
  return toggleInline(source, start, end, '*');
}

export function toggleStrike(source: string, start: number, end: number): { text: string; start: number; end: number } | null {
  return toggleInline(source, start, end, '~~');
}

export function toggleInline(source: string, start: number, end: number, marker: string): { text: string; start: number; end: number } | null {
  if (start === end || marker.length === 0) return null;
  const from = Math.min(start, end);
  const to = Math.max(start, end);
  const selected = source.slice(from, to);
  const width = marker.length;
  const before = source.slice(Math.max(0, from - width), from);
  const after = source.slice(to, to + width);
  if (before === marker && after === marker && !longerMarkerAround(source, from, to, marker)) {
    return { text: source.slice(0, from - width) + selected + source.slice(to + width), start: from - width, end: to - width };
  }
  if (ownsMarker(selected, marker)) {
    const inner = selected.slice(width, -width);
    return { text: source.slice(0, from) + inner + source.slice(to), start: from, end: from + inner.length };
  }
  const wrapped = `${marker}${selected}${marker}`;
  return { text: source.slice(0, from) + wrapped + source.slice(to), start: from, end: from + wrapped.length };
}

function longerMarkerAround(source: string, from: number, to: number, marker: string): boolean {
  if (marker.length !== 1) return false;
  return source[from - 2] === marker || source[to + 1] === marker;
}

function ownsMarker(selected: string, marker: string): boolean {
  if (!selected.startsWith(marker) || !selected.endsWith(marker) || selected.length < marker.length * 2) return false;
  if (marker.length !== 1) return true;
  const inner = selected.slice(1, -1);
  return !(inner.startsWith(marker) && inner.endsWith(marker));
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

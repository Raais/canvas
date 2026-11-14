import { memo, type PointerEvent } from 'react';
import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { visit } from 'unist-util-visit';
import type { Root, Text } from 'mdast';
import { rehypeTaskInputs, remarkTaskIndex, safeHref } from '../domain/markdown';

function remarkMark() {
  return (tree: Root) => {
    visit(tree, 'text', (node: Text, index, parent) => {
      if (!parent || index == null || (parent.type as string) === 'link' || (parent.type as string) === 'inlineCode') return;
      if (!node.value.includes('==')) return;
      const parts: Array<Text | { type: 'highlight'; data: { hName: string; hProperties: { className: string } }; children: Text[] }> = [];
      const pattern = /==([^=\n]+)==/g;
      let last = 0;
      let match: RegExpExecArray | null;
      while ((match = pattern.exec(node.value))) {
        if (match.index > last) parts.push({ type: 'text', value: node.value.slice(last, match.index) });
        parts.push({
          type: 'highlight',
          data: { hName: 'mark', hProperties: { className: 'md-mark' } },
          children: [{ type: 'text', value: match[1] ?? '' }],
        });
        last = match.index + match[0].length;
      }
      if (parts.length === 0) return;
      if (last < node.value.length) parts.push({ type: 'text', value: node.value.slice(last) });
      parent.children.splice(index, 1, ...(parts as typeof parent.children));
      return index + parts.length;
    });
  };
}

function taskOffset(value: unknown): number | null {
  const offset = Number(value);
  return Number.isInteger(offset) && offset >= 0 ? offset : null;
}

export const MarkdownView = memo(function MarkdownView({ text, onToggle }: { text: string; onToggle: (offset: number) => void }) {
  return (
    <div className="markdown-body">
      <Markdown
        remarkPlugins={[remarkGfm, remarkTaskIndex, remarkMark]}
        rehypePlugins={[rehypeTaskInputs]}
        allowedElements={['p', 'strong', 'em', 'del', 'code', 'pre', 'h1', 'h2', 'h3', 'ul', 'ol', 'li', 'a', 'blockquote', 'mark', 'br', 'hr', 'input']}
        unwrapDisallowed
        components={{
          a: ({ href, children }) => (safeHref(href) ? (
            <a href={href} target="_blank" rel="noopener noreferrer" className="nodrag nopan">{children}</a>
          ) : <span>{children}</span>),
          input: ({ type, checked, node }) => {
            if (type !== 'checkbox') return null;
            const offset = taskOffset(node?.properties?.dataTask);
            if (offset == null) return null;
            return (
              <input
                type="checkbox"
                className="md-check nodrag nopan"
                checked={checked === true}
                data-task={offset}
                aria-label={checked === true ? 'Completed task' : 'Open task'}
                onPointerDown={(event: PointerEvent<HTMLInputElement>) => event.stopPropagation()}
                onChange={() => onToggle(offset)}
              />
            );
          },
          li: ({ node, children }) => (
            node?.properties?.dataTask == null ? <li>{children}</li> : <li className="md-task">{children}</li>
          ),
        }}
      >
        {text}
      </Markdown>
    </div>
  );
});

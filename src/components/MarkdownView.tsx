import { memo, useRef, type PointerEvent } from 'react';
import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { visit } from 'unist-util-visit';
import type { Root, Text } from 'mdast';
import { safeHref } from '../domain/markdown';

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

export const MarkdownView = memo(function MarkdownView({ text, onToggle }: { text: string; onToggle: (index: number) => void }) {
  const cursor = useRef(0);
  cursor.current = 0;
  return (
    <div className="markdown-body">
      <Markdown
        remarkPlugins={[remarkGfm, remarkMark]}
        allowedElements={['p', 'strong', 'em', 'del', 'code', 'pre', 'h1', 'h2', 'h3', 'ul', 'ol', 'li', 'a', 'blockquote', 'mark', 'br', 'hr']}
        unwrapDisallowed
        components={{
          a: ({ href, children }) => (safeHref(href) ? (
            <a href={href} target="_blank" rel="noopener noreferrer" className="nodrag nopan">{children}</a>
          ) : <span>{children}</span>),
          li: ({ node, children }) => {
            const checked = (node as { checked?: boolean | null } | undefined)?.checked;
            if (typeof checked !== 'boolean') return <li>{children}</li>;
            const task = cursor.current;
            cursor.current += 1;
            return (
              <li className="md-task">
                <input
                  type="checkbox"
                  className="nodrag nopan"
                  checked={checked}
                  onPointerDown={(event: PointerEvent) => event.stopPropagation()}
                  onChange={() => onToggle(task)}
                />
                <span>{children}</span>
              </li>
            );
          },
        }}
      >
        {text}
      </Markdown>
    </div>
  );
});

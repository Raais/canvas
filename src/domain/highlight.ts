import { createHighlighter, type Highlighter } from '@tanstack/highlight/core';
import { css } from '@tanstack/highlight/languages/css';
import { html } from '@tanstack/highlight/languages/html';
import { js } from '@tanstack/highlight/languages/js';
import { json } from '@tanstack/highlight/languages/json';
import { jsx } from '@tanstack/highlight/languages/jsx';
import { plaintext } from '@tanstack/highlight/languages/plaintext';
import { python } from '@tanstack/highlight/languages/python';
import { shell } from '@tanstack/highlight/languages/shell';
import { ts } from '@tanstack/highlight/languages/ts';
import { tsx } from '@tanstack/highlight/languages/tsx';
import type { CodeLanguage } from './types';

const highlighter: Highlighter = createHighlighter({
  fallbackLanguage: 'plaintext',
  languages: [js, jsx, ts, tsx, python, json, html, css, shell, plaintext],
});

const LANG: Record<CodeLanguage, string> = {
  javascript: 'js',
  typescript: 'ts',
  python: 'python',
  json: 'json',
  html: 'html',
  css: 'css',
  shell: 'shell',
  plain: 'plaintext',
};

const LABEL: Record<string, string> = {
  JavaScript: 'js',
  TypeScript: 'ts',
  Python: 'python',
  JSON: 'json',
  HTML: 'html',
  CSS: 'css',
  Shell: 'shell',
};

export function resolveHighlightLanguage(codeLanguage: CodeLanguage | undefined, detected?: string): string {
  if (codeLanguage) return LANG[codeLanguage];
  return LABEL[detected ?? ''] ?? 'plaintext';
}

export function highlightCode(source: string, lang: string): { className?: string; value: string }[] {
  const fence = /^```([a-z0-9+#-]*)\s*\n([\s\S]*?)\n?```\s*$/i.exec(source.trim());
  const code = fence ? fence[2] ?? '' : source;
  const declared = fence?.[1]?.toLowerCase();
  const chosen = declared && lang === 'plaintext' ? declared : lang;
  try {
    return highlighter.tokenize(code, { lang: chosen }).tokens;
  } catch {
    return [{ value: code }];
  }
}

export function visibleCode(source: string): string {
  const fence = /^```([a-z0-9+#-]*)\s*\n([\s\S]*?)\n?```\s*$/i.exec(source.trim());
  return fence ? fence[2] ?? '' : source;
}

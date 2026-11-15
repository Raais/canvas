import { worldBounds } from './geometry';
import { isProtectedTextNode } from './text-protection';
import type { BoardNode, Rect } from './types';

export const SEARCH_LIMIT = 25;

export type SearchHit = {
  id: string;
  kind: 'text' | 'group' | 'file';
  title: string;
  snippet: string;
  parentLabel: string | null;
  score: number;
};

export type SearchResult = {
  id: string;
  kind: 'text' | 'group' | 'image' | 'file';
  title: string;
  snippet: string;
  parentLabel: string | null;
  score: number;
  section: 'date' | 'content';
};

export type SearchOutcome = {
  results: SearchResult[];
  notice: string | null;
  dateLabel: string | null;
};

type RankedHit = SearchHit & { order: number };

type IndexedNode = {
  id: string;
  kind: 'text' | 'group' | 'file';
  title: string;
  foldedTitle: string;
  body: string;
  foldedBody: string;
  parentLabel: string | null;
  order: number;
};

export function buildSearchIndex(nodes: readonly BoardNode[]): IndexedNode[] {
  const labels = new Map<string, string>();
  for (const node of nodes) {
    if (node.kind === 'group') labels.set(node.id, node.label.trim() || 'Untitled group');
  }
  const indexed: IndexedNode[] = [];
  nodes.forEach((node, order) => {
    if (node.kind === 'image' || isProtectedTextNode(node)) return;
    if (node.kind === 'file') {
      const parentLabel = node.parentId ? labels.get(node.parentId) ?? null : null;
      indexed.push({ id: node.id, kind: 'file', title: node.filename, foldedTitle: fold(node.filename), body: '', foldedBody: '', parentLabel, order });
      return;
    }
    if (node.kind === 'group') {
      const title = labels.get(node.id) ?? 'Untitled group';
      indexed.push({ id: node.id, kind: 'group', title, foldedTitle: fold(title), body: '', foldedBody: '', parentLabel: null, order });
      return;
    }
    const title = noteTitle(node.text);
    const parentLabel = node.parentId ? labels.get(node.parentId) ?? null : null;
    indexed.push({
      id: node.id,
      kind: 'text',
      title,
      foldedTitle: fold(title),
      body: node.text,
      foldedBody: fold(node.text),
      parentLabel,
      order,
    });
  });
  return indexed;
}

export function contentSignature(nodes: readonly BoardNode[]): string {
  return nodes.map((node) => {
    if (node.kind === 'text') return `t\t${node.id}\t${node.parentId ?? ''}\t${node.protection ? '' : node.text}\t${node.protection ? 'protected' : ''}\t${node.sourceFilename ?? ''}\t${node.lastEditedAt ?? ''}`;
    if (node.kind === 'file') return `f\t${node.id}\t${node.parentId ?? ''}\t${node.filename}\t${node.lastEditedAt ?? ''}`;
    if (node.kind === 'group') return `g\t${node.id}\t${node.label}`;
    return `i\t${node.id}\t${node.parentId ?? ''}\t${node.lastEditedAt ?? ''}\t${node.source.type}`;
  }).join('\n');
}

export function rankContent(index: readonly IndexedNode[], query: string): SearchHit[] {
  const folded = fold(query.trim());
  if (!folded) return [];
  const tokens = folded.split(/\s+/).filter(Boolean);
  const hits: RankedHit[] = [];
  for (const entry of index) {
    const score = Math.max(scoreField(folded, tokens, entry.foldedTitle, 1), scoreField(folded, tokens, entry.foldedBody, 0.5));
    if (score <= 0) continue;
    hits.push({
      id: entry.id,
      kind: entry.kind,
      title: entry.title,
      snippet: entry.kind === 'group' ? '' : snippetFor(entry.body, entry.title, folded, tokens),
      parentLabel: entry.parentLabel,
      score,
      order: entry.order,
    });
  }
  hits.sort((left, right) => right.score - left.score || left.order - right.order);
  return hits.map(({ order, ...hit }) => {
    void order;
    return hit;
  });
}

export function searchNodes(index: readonly IndexedNode[], query: string): SearchHit[] {
  return rankContent(index, query).slice(0, SEARCH_LIMIT);
}

export function noteTitle(text: string): string {
  const line = text.split(/\r?\n/).map((entry) => entry.trim()).find(Boolean);
  if (!line) return 'Untitled note';
  return line.length > 80 ? `${line.slice(0, 79)}…` : line;
}

export function centerOf(bounds: Rect): { x: number; y: number } {
  return { x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 };
}

export function resultBounds(nodes: readonly BoardNode[], id: string): Rect | null {
  const node = nodes.find((entry) => entry.id === id);
  if (!node) return null;
  return worldBounds(nodes, node);
}

function scoreField(query: string, tokens: string[], field: string, weight: number): number {
  if (!field) return 0;
  if (field === query) return 1000 * weight;
  if (field.startsWith(query)) return 800 * weight;
  if (field.includes(query)) return 600 * weight;
  if (tokens.length > 1 && tokens.every((token) => field.includes(token))) return 500 * weight;
  if (tokens.length === 1 && query.length >= 3 && isSubsequence(query, field)) return 200 * weight;
  return 0;
}

function snippetFor(body: string, title: string, query: string, tokens: string[]): string {
  const lines = body.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const hit = lines.find((line) => {
    const folded = fold(line);
    return folded.includes(query) || tokens.every((token) => folded.includes(token));
  }) ?? lines[0] ?? '';
  if (!hit || hit === title) return '';
  return hit.length > 72 ? `${hit.slice(0, 71)}…` : hit;
}

function isSubsequence(query: string, field: string): boolean {
  let cursor = 0;
  for (const character of field) {
    if (character === query[cursor]) cursor += 1;
    if (cursor === query.length) return true;
  }
  return false;
}

export function fold(value: string): string {
  return value.normalize('NFKC').toLocaleLowerCase().normalize('NFD').replace(/\p{M}/gu, '');
}

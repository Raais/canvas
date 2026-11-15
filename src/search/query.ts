import MiniSearch from 'minisearch';
import { formatNodeDate } from '../domain/node-date';
import {
  SEARCH_LIMIT,
  buildSearchIndex,
  contentSignature,
  fold,
  noteTitle,
  rankContent,
  type SearchHit,
  type SearchOutcome,
  type SearchResult,
} from '../domain/search';
import { isProtectedTextNode } from '../domain/text-protection';
import type { BoardNode } from '../domain/types';
import { interpretDateQuery } from './date-query';

export { contentSignature };
export type { SearchOutcome, SearchResult };

type ContentIndex = {
  legacy: ReturnType<typeof buildSearchIndex>;
  mini: MiniSearch<{ id: string; title: string; body: string }>;
};

export function buildContentIndex(nodes: readonly BoardNode[]): ContentIndex {
  const legacy = buildSearchIndex(nodes);
  const mini = new MiniSearch<{ id: string; title: string; body: string }>({
    fields: ['title', 'body'],
    storeFields: ['id'],
    tokenize: (text) => fold(text).split(/[^\p{L}\p{N}]+/u).filter(Boolean),
    searchOptions: {
      prefix: true,
      combineWith: 'AND',
      boost: { title: 3 },
      fuzzy: (term) => (term.length < 4 ? false : 0.3),
    },
  });
  mini.addAll(legacy.map((entry) => ({ id: entry.id, title: entry.foldedTitle, body: entry.foldedBody })));
  return { legacy, mini };
}

export function queryBoard(nodes: readonly BoardNode[], index: ContentIndex, raw: string, now: Date): SearchOutcome {
  const interpreted = interpretDateQuery(raw, now);
  if (interpreted.invalid) return { results: [], notice: 'That date was not recognized.', dateLabel: null };
  const content = interpreted.dateOnly || !interpreted.content.trim()
    ? []
    : mergeContent(index, interpreted.content);
  const dated = interpreted.range ? dateHits(nodes, interpreted.range.start, interpreted.range.end, now) : [];
  if (!interpreted.range) return { results: content.slice(0, SEARCH_LIMIT).map(asContent), notice: null, dateLabel: null };
  const dateIds = new Set(dated.map((hit) => hit.id));
  const contentOnly = content.filter((hit) => !dateIds.has(hit.id));
  if (interpreted.dateOnly) return { results: dated.slice(0, SEARCH_LIMIT), notice: null, dateLabel: interpreted.range.label };
  return { results: shareResults(dated, contentOnly.map(asContent)), notice: null, dateLabel: interpreted.range.label };
}

function mergeContent(index: ContentIndex, query: string): SearchHit[] {
  const ranked = rankContent(index.legacy, query);
  const seen = new Set(ranked.map((hit) => hit.id));
  const folded = fold(query.trim());
  if (folded.length >= 4) {
    for (const hit of index.mini.search(folded)) {
      const id = String(hit.id);
      if (seen.has(id)) continue;
      const entry = index.legacy.find((item) => item.id === id);
      if (!entry) continue;
      seen.add(id);
      ranked.push({ id, kind: entry.kind, title: entry.title, snippet: entry.kind === 'group' ? '' : entry.body.slice(0, 72), parentLabel: entry.parentLabel, score: 100 });
    }
  }
  ranked.sort((left, right) => right.score - left.score);
  return ranked;
}

function dateHits(nodes: readonly BoardNode[], start: number, end: number, now: Date): SearchResult[] {
  const labels = new Map<string, string>();
  for (const node of nodes) {
    if (node.kind === 'group') labels.set(node.id, node.label.trim() || 'Untitled group');
  }
  const hits: Array<SearchResult & { time: number }> = [];
  for (const node of nodes) {
    if (node.kind === 'group' || node.kind === 'drawing' || !node.lastEditedAt) continue;
    const time = Date.parse(node.lastEditedAt);
    if (!Number.isFinite(time) || time < start || time >= end) continue;
    const parentLabel = node.parentId ? labels.get(node.parentId) ?? null : null;
    const formatted = formatNodeDate(node.lastEditedAt, now);
    if (node.kind === 'file') {
      hits.push({
        id: node.id,
        kind: 'file',
        title: node.filename,
        snippet: formatted.label,
        parentLabel,
        score: time,
        section: 'date',
        time,
      });
      continue;
    }
    if (node.kind === 'website') {
      hits.push({
        id: node.id,
        kind: 'website',
        title: node.title,
        snippet: formatted.label,
        parentLabel,
        score: time,
        section: 'date',
        time,
      });
      continue;
    }
    if (node.kind === 'image') {
      hits.push({
        id: node.id,
        kind: 'image',
        title: node.source.type === 'external' ? 'External image' : 'Image',
        snippet: formatted.label,
        parentLabel,
        score: time,
        section: 'date',
        time,
      });
      continue;
    }
    hits.push({
      id: node.id,
      kind: 'text',
      title: isProtectedTextNode(node) ? 'Password protected' : noteTitle(node.text),
      snippet: formatted.label,
      parentLabel,
      score: time,
      section: 'date',
      time,
    });
  }
  hits.sort((left, right) => right.time - left.time);
  return hits.map(({ time, ...hit }) => {
    void time;
    return hit;
  });
}

function asContent(hit: SearchHit): SearchResult {
  return { ...hit, section: 'content' };
}

function shareResults(dates: SearchResult[], content: SearchResult[]): SearchResult[] {
  if (dates.length === 0) return content.slice(0, SEARCH_LIMIT);
  if (content.length === 0) return dates.slice(0, SEARCH_LIMIT);
  const reserve = 8;
  let dateTake = Math.min(dates.length, reserve);
  let contentTake = Math.min(content.length, reserve);
  let left = SEARCH_LIMIT - dateTake - contentTake;
  const dateLeft = dates.length - dateTake;
  const contentLeft = content.length - contentTake;
  if (left > 0 && dateLeft >= contentLeft) {
    const extra = Math.min(left, dateLeft);
    dateTake += extra;
    left -= extra;
  }
  if (left > 0) contentTake += Math.min(left, contentLeft);
  return [...dates.slice(0, dateTake), ...content.slice(0, contentTake)];
}

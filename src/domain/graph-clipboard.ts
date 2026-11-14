import { childrenOf } from './geometry';
import type { Board, BoardEdge, BoardNode, Point } from './types';
import { parseBoard, revise } from './board';

export const GRAPH_CLIPBOARD_FORMAT = 'canvas-graph';
export const GRAPH_CLIPBOARD_VERSION = 1;
export const GRAPH_MIME = 'application/x-canvas-graph';

export type GraphClipboard = {
  format: typeof GRAPH_CLIPBOARD_FORMAT;
  version: typeof GRAPH_CLIPBOARD_VERSION;
  nodes: BoardNode[];
  edges: BoardEdge[];
};

export function selectionClosure(board: Board, ids: readonly string[]): GraphClipboard | null {
  const selected = new Set(ids);
  const included = new Map<string, BoardNode>();
  for (const id of selected) {
    const node = board.nodes.find((entry) => entry.id === id);
    if (!node) continue;
    included.set(node.id, node);
    if (node.kind === 'group') {
      for (const child of childrenOf(board.nodes, node.id)) included.set(child.id, child);
    }
  }
  if (included.size === 0) return null;
  const nodes = [...included.values()].map((node) => ({ ...node }));
  const edges = board.edges
    .filter((edge) => included.has(edge.sourceId) && included.has(edge.targetId))
    .map((edge) => ({ ...edge }));
  return { format: GRAPH_CLIPBOARD_FORMAT, version: GRAPH_CLIPBOARD_VERSION, nodes, edges };
}

export function encodeGraphClipboard(payload: GraphClipboard): string {
  return `${GRAPH_CLIPBOARD_FORMAT}/${GRAPH_CLIPBOARD_VERSION}\n${JSON.stringify(payload)}`;
}

export function decodeGraphClipboard(raw: string): GraphClipboard | null {
  const marker = `${GRAPH_CLIPBOARD_FORMAT}/${GRAPH_CLIPBOARD_VERSION}\n`;
  if (!raw.startsWith(marker)) return null;
  let value: unknown;
  try {
    value = JSON.parse(raw.slice(marker.length));
  } catch {
    return null;
  }
  if (!value || typeof value !== 'object') return null;
  const record = value as Partial<GraphClipboard>;
  if (record.format !== GRAPH_CLIPBOARD_FORMAT || record.version !== GRAPH_CLIPBOARD_VERSION) return null;
  if (!Array.isArray(record.nodes) || !Array.isArray(record.edges)) return null;
  if (raw.length > 1_500_000 || record.nodes.length > 2000 || record.edges.length > 4000) return null;
  const parsed = parseBoard({
    schemaVersion: 3,
    id: 'clipboard',
    title: 'clipboard',
    createdAt: '2020-01-01T00:00:00.000Z',
    updatedAt: '2020-01-01T00:00:00.000Z',
    revision: 1,
    appearance: 'dark',
    nodes: record.nodes,
    edges: record.edges,
    viewport: { x: 0, y: 0, zoom: 1 },
  });
  if (!parsed || parsed.nodes.length !== record.nodes.length || parsed.edges.length !== record.edges.length) return null;
  return { format: GRAPH_CLIPBOARD_FORMAT, version: GRAPH_CLIPBOARD_VERSION, nodes: parsed.nodes, edges: parsed.edges };
}

export function pasteGraph(
  board: Board,
  payload: GraphClipboard,
  origin: Point,
  availableAssets: ReadonlySet<string>,
  repeat: number,
  now?: string,
): Board | { error: string } {
  const decoded = decodeGraphClipboard(encodeGraphClipboard(payload));
  if (!decoded || decoded.nodes.length === 0) return { error: 'The clipboard does not contain a canvas selection.' };
  const missing = decoded.nodes.filter(
    (node) => node.kind === 'image' && node.source.type === 'embedded' && !availableAssets.has(node.source.assetId),
  );
  if (missing.length > 0) return { error: 'That copy refers to an image that is not on this board.' };
  const ids = new Set(decoded.nodes.map((node) => node.id));
  const idMap = new Map<string, string>();
  for (const id of ids) idMap.set(id, crypto.randomUUID());
  const topLevel = decoded.nodes.filter((node) => node.kind === 'group' || !node.parentId || !ids.has(node.parentId));
  let minX = Infinity;
  let minY = Infinity;
  for (const node of topLevel) {
    minX = Math.min(minX, node.x);
    minY = Math.min(minY, node.y);
  }
  const dx = origin.x - minX + repeat * 32;
  const dy = origin.y - minY + repeat * 32;
  const copies: BoardNode[] = decoded.nodes.map((node) => {
    const id = idMap.get(node.id) ?? crypto.randomUUID();
    const parentInCopy = node.kind !== 'group' && node.parentId && ids.has(node.parentId);
    if (parentInCopy) {
      return { ...node, id, parentId: idMap.get(node.parentId!) };
    }
    const { parentId: _parent, ...rest } = node.kind === 'group' ? { ...node, parentId: undefined } : node;
    return { ...rest, id, x: node.x + dx, y: node.y + dy };
  });
  const edges: BoardEdge[] = [];
  for (const edge of decoded.edges) {
    const sourceId = idMap.get(edge.sourceId);
    const targetId = idMap.get(edge.targetId);
    if (!sourceId || !targetId) continue;
    edges.push({ ...edge, id: crypto.randomUUID(), sourceId, targetId });
  }
  const next = revise(board, { nodes: [...board.nodes, ...copies], edges: [...board.edges, ...edges] }, now);
  return next;
}

import { revise } from './board';
import { attachmentPoint, distance } from './geometry';
import type { Board, BoardEdge, HandleSide } from './types';

export function hasUndirectedLink(board: Board, sourceId: string, targetId: string): boolean {
  return board.edges.some(
    (edge) =>
      (edge.sourceId === sourceId && edge.targetId === targetId) ||
      (edge.sourceId === targetId && edge.targetId === sourceId),
  );
}

export function connectNodes(
  board: Board,
  sourceId: string,
  targetId: string,
  sourceHandle: HandleSide,
  targetHandle: HandleSide,
  now?: string,
): Board | null {
  if (sourceId === targetId || hasUndirectedLink(board, sourceId, targetId)) return null;
  const source = board.nodes.find((node) => node.id === sourceId);
  const target = board.nodes.find((node) => node.id === targetId);
  if (!source || !target || source.kind === 'drawing' || target.kind === 'drawing') return null;
  const restLength = distance(
    attachmentPoint(board.nodes, source, sourceHandle),
    attachmentPoint(board.nodes, target, targetHandle),
  );
  if (!Number.isFinite(restLength)) return null;
  const edge: BoardEdge = {
    id: crypto.randomUUID(),
    sourceId,
    targetId,
    sourceHandle,
    targetHandle,
    restLength,
  };
  return revise(board, { edges: [...board.edges, edge] }, now);
}

export function deleteEdges(board: Board, ids: readonly string[], now?: string): Board {
  const removing = new Set(ids);
  const edges = board.edges.filter((edge) => !removing.has(edge.id));
  if (edges.length === board.edges.length) return board;
  return revise(board, { edges }, now);
}

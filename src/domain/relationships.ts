import { revise } from './board';
import { MAX_EDGE_LABEL, type Board, type BoardEdge, type EdgeStyle } from './types';

const STYLES = new Set<EdgeStyle>(['solid', 'dashed', 'red-string']);

export function labelGestureCommits(gesture: 'enter' | 'blur' | 'escape', cancelled: boolean): boolean {
  return gesture !== 'escape' && !cancelled;
}

export function nextLabelAction(closed: boolean, cancelled: boolean, gesture: 'enter' | 'blur' | 'escape'): { closed: boolean; commit: boolean } {
  if (closed) return { closed: true, commit: false };
  return { closed: true, commit: labelGestureCommits(gesture, cancelled || gesture === 'escape') };
}

export function cleanEdgeLabel(value: string): string | null {
  if (/[\u0000-\u001F\u007F]/.test(value)) return null;
  const label = value.trim();
  if (label.length > MAX_EDGE_LABEL) return null;
  return label;
}

export function setEdgeLabel(board: Board, edgeId: string, label: string): Board | null {
  const cleaned = cleanEdgeLabel(label);
  if (cleaned === null) return null;
  return mapEdge(board, edgeId, (edge) => {
    if (!cleaned) {
      if (!edge.label) return edge;
      const { label: _label, ...rest } = edge;
      void _label;
      return rest;
    }
    if (edge.label === cleaned) return edge;
    return { ...edge, label: cleaned };
  });
}

export function setEdgeStyle(board: Board, edgeId: string, style: EdgeStyle): Board | null {
  if (!STYLES.has(style)) return null;
  return mapEdge(board, edgeId, (edge) => {
    if (style === 'solid') {
      if (!edge.style || edge.style === 'solid') {
        if (!edge.style) return edge;
        const { style: _style, ...rest } = edge;
        void _style;
        return rest;
      }
      const { style: _style, ...rest } = edge;
      void _style;
      return rest;
    }
    if (edge.style === style) return edge;
    return { ...edge, style };
  });
}

function mapEdge(board: Board, edgeId: string, update: (edge: BoardEdge) => BoardEdge): Board | null {
  let found = false;
  let changed = false;
  const edges = board.edges.map((edge) => {
    if (edge.id !== edgeId) return edge;
    found = true;
    const next = update(edge);
    if (next !== edge) changed = true;
    return next;
  });
  if (!found) return board;
  if (!changed) return board;
  return revise(board, { edges });
}

import type { Board, BoardNode, ContentNode, HandleSide, Point, Rect } from './types';

export function nodeMap(nodes: readonly BoardNode[]): Map<string, BoardNode> {
  return new Map(nodes.map((node) => [node.id, node]));
}

export function findNode(board: Board, id: string): BoardNode | undefined {
  return board.nodes.find((node) => node.id === id);
}

export function isContentNode(node: BoardNode): node is ContentNode {
  return node.kind === 'text' || node.kind === 'image' || node.kind === 'file' || node.kind === 'website' || node.kind === 'drawing' || node.kind === 'voice' || node.kind === 'suitcase' || node.kind === 'mirror';
}

export function worldTopLeft(nodes: readonly BoardNode[], node: BoardNode): Point {
  if (isContentNode(node) && node.parentId) {
    const parent = nodes.find((entry) => entry.id === node.parentId && entry.kind === 'group');
    if (parent) return { x: parent.x + node.x, y: parent.y + node.y };
  }
  return { x: node.x, y: node.y };
}

export function worldBounds(nodes: readonly BoardNode[], node: BoardNode): Rect {
  const origin = worldTopLeft(nodes, node);
  return { ...origin, width: node.width, height: node.height };
}

export function attachmentPoint(nodes: readonly BoardNode[], node: BoardNode, handle: HandleSide): Point {
  const bounds = worldBounds(nodes, node);
  if (handle === 'left') return { x: bounds.x, y: bounds.y + bounds.height / 2 };
  if (handle === 'right') return { x: bounds.x + bounds.width, y: bounds.y + bounds.height / 2 };
  if (handle === 'top') return { x: bounds.x + bounds.width / 2, y: bounds.y };
  return { x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height };
}

export function facingHandles(
  nodes: readonly BoardNode[],
  sourceId: string,
  targetId: string,
): { source: HandleSide; target: HandleSide } | null {
  if (sourceId === targetId) return null;
  const source = nodes.find((node) => node.id === sourceId);
  const target = nodes.find((node) => node.id === targetId);
  if (!source || !target) return null;
  const sourceBounds = worldBounds(nodes, source);
  const targetBounds = worldBounds(nodes, target);
  const dx = targetBounds.x + targetBounds.width / 2 - (sourceBounds.x + sourceBounds.width / 2);
  const dy = targetBounds.y + targetBounds.height / 2 - (sourceBounds.y + sourceBounds.height / 2);
  if (Math.abs(dx) >= Math.abs(dy)) {
    return dx >= 0 ? { source: 'right', target: 'left' } : { source: 'left', target: 'right' };
  }
  return dy >= 0 ? { source: 'bottom', target: 'top' } : { source: 'top', target: 'bottom' };
}

export function distance(a: Point, b: Point): number {
  return Math.hypot(b.x - a.x, b.y - a.y);
}

export function childrenOf(nodes: readonly BoardNode[], groupId: string): ContentNode[] {
  return nodes.filter((node): node is ContentNode => isContentNode(node) && node.parentId === groupId);
}

export function contentExtent(nodes: readonly BoardNode[], groupId: string): { right: number; bottom: number } | null {
  const children = childrenOf(nodes, groupId);
  if (children.length === 0) return null;
  let right = 0;
  let bottom = 0;
  for (const child of children) {
    right = Math.max(right, child.x + child.width);
    bottom = Math.max(bottom, child.y + child.height);
  }
  return { right, bottom };
}

export function boundsOfNodes(nodes: readonly BoardNode[], ids: readonly string[]): Rect | null {
  const selected = ids
    .map((id) => nodes.find((node) => node.id === id))
    .filter((node): node is BoardNode => Boolean(node));
  if (selected.length === 0) return null;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const node of selected) {
    const bounds = worldBounds(nodes, node);
    minX = Math.min(minX, bounds.x);
    minY = Math.min(minY, bounds.y);
    maxX = Math.max(maxX, bounds.x + bounds.width);
    maxY = Math.max(maxY, bounds.y + bounds.height);
  }
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

export function fullyContains(outer: Rect, inner: Rect): boolean {
  return (
    inner.x >= outer.x &&
    inner.y >= outer.y &&
    inner.x + inner.width <= outer.x + outer.width &&
    inner.y + inner.height <= outer.y + outer.height
  );
}

export function normalizeRect(a: Point, b: Point): Rect {
  const x = Math.min(a.x, b.x);
  const y = Math.min(a.y, b.y);
  return { x, y, width: Math.abs(b.x - a.x), height: Math.abs(b.y - a.y) };
}

export function effectiveBodyId(nodes: readonly BoardNode[], nodeId: string): string | null {
  const node = nodes.find((entry) => entry.id === nodeId);
  if (!node) return null;
  if (isContentNode(node) && node.parentId) return node.parentId;
  return node.id;
}

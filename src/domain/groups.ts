import { revise, withInsertedTimestamp } from './board';
import {
  boundsOfNodes,
  childrenOf,
  fullyContains,
  isContentNode,
  worldBounds,
  worldTopLeft,
} from './geometry';
import {
  DUPLICATE_OFFSET,
  GROUP_MIN_HEIGHT,
  GROUP_MIN_WIDTH,
  GROUP_PAD,
  type Board,
  type BoardEdge,
  type BoardNode,
  type ContentNode,
  type GroupNode,
  type Rect,
} from './types';

export type GroupResult = { board: Board } | { error: string };

export function groupSelection(board: Board, ids: readonly string[], now?: string): GroupResult {
  const unique = [...new Set(ids)];
  const chosen: ContentNode[] = [];
  for (const id of unique) {
    const node = board.nodes.find((entry) => entry.id === id);
    if (!node) return { error: 'The selection no longer exists.' };
    if (node.kind === 'group') return { error: 'Groups cannot be placed inside other groups.' };
    if (node.parentId) return { error: 'That selection includes a note that already belongs to a group.' };
    chosen.push(node);
  }
  if (chosen.length === 0) return { error: 'Select a note to group.' };
  const bounds = boundsOfNodes(board.nodes, chosen.map((node) => node.id));
  if (!bounds) return { error: 'Select a note to group.' };
  const group = makeGroup(bounds, GROUP_PAD);
  return { board: adopt(board, group, chosen, now) };
}

export function groupFrame(board: Board, rect: Rect, now?: string): GroupResult {
  if (!(rect.width >= 8) || !(rect.height >= 8)) return { error: 'Draw a larger frame.' };
  const chosen = board.nodes.filter((node): node is ContentNode => {
    if (!isContentNode(node) || node.parentId) return false;
    return fullyContains(rect, worldBounds(board.nodes, node));
  });
  const group = makeGroup(rect, 0);
  return { board: adopt(board, group, chosen, now) };
}

export function ungroup(board: Board, groupIds: readonly string[], now?: string): Board {
  const removing = new Set(groupIds);
  if ([...removing].every((id) => !board.nodes.some((node) => node.id === id && node.kind === 'group'))) return board;
  const nodes: BoardNode[] = [];
  for (const node of board.nodes) {
    if (node.kind === 'group' && removing.has(node.id)) continue;
    if (isContentNode(node) && node.parentId && removing.has(node.parentId)) {
      const world = worldTopLeft(board.nodes, node);
      const { parentId: _parent, ...rest } = node;
      nodes.push({ ...rest, x: world.x, y: world.y });
      continue;
    }
    nodes.push(node);
  }
  const edges = board.edges.filter((edge) => !removing.has(edge.sourceId) && !removing.has(edge.targetId));
  return revise(board, { nodes, edges }, now);
}

export function deleteGroupContents(board: Board, groupId: string, now?: string): Board {
  const childIds = childrenOf(board.nodes, groupId).map((node) => node.id);
  const removed = new Set([groupId, ...childIds]);
  const nodes = board.nodes.filter((node) => !removed.has(node.id));
  const edges = board.edges.filter((edge) => !removed.has(edge.sourceId) && !removed.has(edge.targetId));
  if (nodes.length === board.nodes.length) return board;
  return revise(board, { nodes, edges }, now);
}

export function deleteSelection(
  board: Board,
  ids: readonly string[],
  now?: string,
): { board: Board; removedAssetIds: string[] } {
  const selected = new Set(ids);
  const groupIds = board.nodes.filter((node) => node.kind === 'group' && selected.has(node.id)).map((node) => node.id);
  const preserved = new Set<string>();
  for (const groupId of groupIds) {
    for (const child of childrenOf(board.nodes, groupId)) preserved.add(child.id);
  }
  const ungrouped = ungroup(board, groupIds, now);
  const removeNotes = ungrouped.nodes
    .filter((node) => selected.has(node.id) && node.kind !== 'group' && !preserved.has(node.id))
    .map((node) => node.id);
  const before = new Set(referenced(board));
  const next = removeNotes.length === 0 ? ungrouped : removeNotesFrom(ungrouped, removeNotes, now);
  const after = new Set(referenced(next));
  return { board: next, removedAssetIds: [...before].filter((id) => !after.has(id)) };
}

export function addToGroup(board: Board, ids: readonly string[], groupId: string, now?: string): GroupResult {
  const group = board.nodes.find((node) => node.id === groupId);
  if (!group || group.kind !== 'group') return { error: 'Choose a group.' };
  const chosen: ContentNode[] = [];
  for (const id of ids) {
    const node = board.nodes.find((entry) => entry.id === id);
    if (!node || node.kind === 'group') return { error: 'Only notes can move into a group.' };
    if (node.parentId) return { error: 'That note already belongs to a group.' };
    chosen.push(node);
  }
  if (chosen.length === 0) return { error: 'Select a note to move.' };
  return { board: adoptExisting(board, group, chosen, now) };
}

export function detachNodes(board: Board, ids: readonly string[], now?: string): Board {
  let changed = false;
  const nodes = board.nodes.map((node) => {
    if (!isContentNode(node) || !node.parentId || !ids.includes(node.id)) return node;
    changed = true;
    const world = worldTopLeft(board.nodes, node);
    const { parentId: _parent, ...rest } = node;
    return { ...rest, x: world.x, y: world.y };
  });
  if (!changed) return board;
  return revise(board, { nodes }, now);
}

export function moveToGroup(board: Board, ids: readonly string[], groupId: string, now?: string): GroupResult {
  const detached = detachNodes(board, ids, now);
  return addToGroup(detached, ids, groupId, now);
}

export function expandGroup(board: Board, groupId: string): Board {
  const group = board.nodes.find((node) => node.id === groupId && node.kind === 'group');
  if (!group) return board;
  const children = childrenOf(board.nodes, groupId);
  if (children.length === 0) return board;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const child of children) {
    minX = Math.min(minX, child.x);
    minY = Math.min(minY, child.y);
    maxX = Math.max(maxX, child.x + child.width);
    maxY = Math.max(maxY, child.y + child.height);
  }
  let shiftX = 0;
  let shiftY = 0;
  let width = group.width;
  let height = group.height;
  if (minX < GROUP_PAD) shiftX = GROUP_PAD - minX;
  if (minY < GROUP_PAD) shiftY = GROUP_PAD - minY;
  width += shiftX;
  height += shiftY;
  if (maxX + shiftX + GROUP_PAD > width) width = maxX + shiftX + GROUP_PAD;
  if (maxY + shiftY + GROUP_PAD > height) height = maxY + shiftY + GROUP_PAD;
  if (shiftX === 0 && shiftY === 0 && width === group.width && height === group.height) return board;
  const nodes = board.nodes.map((node) => {
    if (node.id === group.id) return { ...node, x: node.x - shiftX, y: node.y - shiftY, width, height };
    if (isContentNode(node) && node.parentId === group.id) return { ...node, x: node.x + shiftX, y: node.y + shiftY };
    return node;
  });
  return { ...board, nodes };
}

export function duplicateSelection(board: Board, ids: readonly string[], now?: string): Board {
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
  if (included.size === 0) return board;
  const stampedAt = now ?? new Date().toISOString();
  const idMap = new Map<string, string>();
  for (const id of included.keys()) idMap.set(id, crypto.randomUUID());
  const copies: BoardNode[] = [];
  for (const node of included.values()) {
    const id = idMap.get(node.id);
    if (!id) continue;
    if (node.kind === 'group') {
      copies.push(withInsertedTimestamp({ ...node, id, x: node.x + DUPLICATE_OFFSET, y: node.y + DUPLICATE_OFFSET }, stampedAt));
      continue;
    }
    if (node.parentId && idMap.has(node.parentId)) {
      const parentId = idMap.get(node.parentId);
      copies.push(withInsertedTimestamp(parentId ? { ...node, id, parentId } : { ...node, id }, stampedAt));
      continue;
    }
    const world = worldTopLeft(board.nodes, node);
    const { parentId: _parent, ...rest } = node;
    copies.push(withInsertedTimestamp({ ...rest, id, x: world.x + DUPLICATE_OFFSET, y: world.y + DUPLICATE_OFFSET }, stampedAt));
  }
  const edges: BoardEdge[] = [];
  for (const edge of board.edges) {
    const sourceId = idMap.get(edge.sourceId);
    const targetId = idMap.get(edge.targetId);
    if (!sourceId || !targetId) continue;
    edges.push({ ...edge, id: crypto.randomUUID(), sourceId, targetId });
  }
  return revise(board, { nodes: [...board.nodes, ...copies], edges: [...board.edges, ...edges] }, stampedAt);
}

export function restoreGroupLabels(current: Board, original: Board): Board {
  let next = current;
  for (const node of original.nodes) {
    if (node.kind !== 'group') continue;
    next = renameGroup(next, node.id, node.label);
  }
  return next;
}

export function moveTargets(board: Board, selectedIds: readonly string[]): { ids: string[]; groups: { id: string; label: string }[] } {
  const ids = board.nodes
    .filter((node) => selectedIds.includes(node.id) && isContentNode(node) && !node.parentId)
    .map((node) => node.id);
  if (ids.length === 0) return { ids, groups: [] };
  return {
    ids,
    groups: board.nodes.flatMap((node) => (node.kind === 'group' ? [{ id: node.id, label: node.label }] : [])),
  };
}

export function renameGroup(board: Board, id: string, label: string, now?: string): Board {
  let changed = false;
  const nodes = board.nodes.map((node) => {
    if (node.id !== id || node.kind !== 'group' || node.label === label) return node;
    changed = true;
    return { ...node, label };
  });
  if (!changed) return board;
  return revise(board, { nodes }, now);
}

export function createTextInside(board: Board, groupId: string, textNode: ContentNode, now?: string): Board {
  const group = board.nodes.find((node) => node.id === groupId);
  if (!group || group.kind !== 'group' || textNode.kind !== 'text') return board;
  const child: ContentNode = { ...textNode, parentId: groupId, x: GROUP_PAD, y: GROUP_PAD + 16 };
  return expandGroup(revise(board, { nodes: [...board.nodes, child] }, now), group.id);
}

function adopt(board: Board, group: GroupNode, children: readonly ContentNode[], now?: string): Board {
  const adopted = new Set(children.map((node) => node.id));
  const nodes = board.nodes.map((node) => {
    if (!adopted.has(node.id) || !isContentNode(node)) return node;
    const world = worldTopLeft(board.nodes, node);
    return { ...node, parentId: group.id, x: world.x - group.x, y: world.y - group.y };
  });
  return revise(board, { nodes: [...nodes, group] }, now);
}

function adoptExisting(board: Board, group: GroupNode, children: readonly ContentNode[], now?: string): Board {
  const adopted = new Set(children.map((node) => node.id));
  const nodes = board.nodes.map((node) => {
    if (!adopted.has(node.id) || !isContentNode(node)) return node;
    const world = worldTopLeft(board.nodes, node);
    return { ...node, parentId: group.id, x: world.x - group.x, y: world.y - group.y };
  });
  return expandGroup(revise(board, { nodes }, now), group.id);
}

function makeGroup(rect: Rect, pad: number): GroupNode {
  return {
    id: crypto.randomUUID(),
    kind: 'group',
    x: rect.x - pad,
    y: rect.y - pad,
    width: Math.max(GROUP_MIN_WIDTH, rect.width + pad * 2),
    height: Math.max(GROUP_MIN_HEIGHT, rect.height + pad * 2),
    label: 'Group',
  };
}

function removeNotesFrom(board: Board, ids: readonly string[], now?: string): Board {
  const removed = new Set(ids);
  const nodes = board.nodes.filter((node) => !removed.has(node.id));
  const edges = board.edges.filter((edge) => !removed.has(edge.sourceId) && !removed.has(edge.targetId));
  return revise(board, { nodes, edges }, now);
}

function referenced(board: Board): string[] {
  const ids: string[] = [];
  for (const node of board.nodes) {
    if (node.kind === 'image' && node.source.type === 'embedded') ids.push(node.source.assetId);
  }
  return ids;
}

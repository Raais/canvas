import { addNodes, deleteNodes, revise } from './board';
import { childrenOf, worldTopLeft } from './geometry';
import { noteTitle } from './search';
import { MIRROR_LIMIT, type Board, type BoardNode, type MirrorNode, type TextNode } from './types';

export { MIRROR_LIMIT };
export const MIRROR_PROTECTED_MESSAGE = 'Password-protected notes cannot be mirrored.';
export const MIRROR_LIMIT_MESSAGE = 'This note already has 200 mirrors.';
export const MIRROR_PROTECT_MESSAGE = 'Detach or remove this note\'s mirrors before enabling password protection.';
export const MIRROR_PASTE_MESSAGE = 'That copy refers to a note that is not on this board.';

export function mirrorsOf(board: Board, sourceId: string): MirrorNode[] {
  return board.nodes.filter((node): node is MirrorNode => node.kind === 'mirror' && node.sourceId === sourceId);
}

export function textEditTarget(board: Board, nodeId: string): TextNode | null {
  const node = board.nodes.find((entry) => entry.id === nodeId);
  if (!node) return null;
  if (node.kind === 'text') return node;
  if (node.kind === 'mirror') return resolveMirrorSource(board, nodeId);
  return null;
}

export function resolveMirrorSource(board: Board, nodeId: string): TextNode | null {
  const node = board.nodes.find((entry) => entry.id === nodeId);
  if (!node) return null;
  const source = node.kind === 'mirror' ? board.nodes.find((entry) => entry.id === node.sourceId) : node;
  if (!source || source.kind !== 'text' || source.protection) return null;
  return source;
}

export function isValidMirrorReference(board: Board, mirror: MirrorNode): boolean {
  if (mirror.sourceId === mirror.id) return false;
  const source = board.nodes.find((entry) => entry.id === mirror.sourceId);
  return source?.kind === 'text' && !source.protection;
}

export function createMirror(board: Board, nodeId: string, now = new Date().toISOString()): { board: Board; id: string } | { error: string } {
  const node = board.nodes.find((entry) => entry.id === nodeId);
  if (!node || (node.kind !== 'text' && node.kind !== 'mirror')) return { error: 'Only text notes can be mirrored.' };
  const source = resolveMirrorSource(board, nodeId);
  if (!source) return { error: node.kind === 'text' && node.protection ? MIRROR_PROTECTED_MESSAGE : 'That note cannot be mirrored.' };
  if (mirrorsOf(board, source.id).length >= MIRROR_LIMIT) return { error: MIRROR_LIMIT_MESSAGE };
  const world = worldTopLeft(board.nodes, node);
  const mirror: MirrorNode = {
    id: crypto.randomUUID(),
    kind: 'mirror',
    sourceId: source.id,
    x: Math.round(world.x + node.width + 28),
    y: Math.round(world.y + 28),
    width: node.width,
    height: node.height,
    ...instanceTones(node),
    lastEditedAt: now,
  };
  return { board: addNodes(board, [mirror], now), id: mirror.id };
}

export function detachMirror(board: Board, mirrorId: string, now = new Date().toISOString()): Board | { error: string } {
  const mirror = board.nodes.find((entry) => entry.id === mirrorId);
  if (!mirror || mirror.kind !== 'mirror') return { error: 'Choose a mirror to detach.' };
  const source = resolveMirrorSource(board, mirrorId);
  if (!source) return { error: 'That mirror no longer has a source note.' };
  const text = textFromMirror(mirror, source);
  const nodes = board.nodes.map((entry) => (entry.id === mirror.id ? text : entry));
  return revise(board, { nodes }, now);
}

export type MirrorDeletePlan =
  | { kind: 'ready' }
  | { kind: 'choose'; outside: number; title: string };

export function selectionRemovalIds(board: Board, ids: readonly string[]): string[] {
  const selected = new Set(ids);
  const preserved = new Set<string>();
  for (const node of board.nodes) {
    if (node.kind !== 'group' || !selected.has(node.id)) continue;
    for (const child of childrenOf(board.nodes, node.id)) preserved.add(child.id);
  }
  return board.nodes
    .filter((node) => selected.has(node.id) && node.kind !== 'group' && !preserved.has(node.id))
    .map((node) => node.id);
}

export function contentRemovalIds(board: Board, groupId: string): string[] {
  return [groupId, ...childrenOf(board.nodes, groupId).map((node) => node.id)];
}

export function mirrorDeletePlan(board: Board, removalIds: readonly string[]): MirrorDeletePlan {
  const removing = new Set(removalIds);
  let outside = 0;
  let title = 'This note';
  for (const node of board.nodes) {
    if (node.kind !== 'text' || node.protection || !removing.has(node.id)) continue;
    let count = 0;
    for (const other of board.nodes) {
      if (other.kind === 'mirror' && other.sourceId === node.id && !removing.has(other.id)) count += 1;
    }
    if (count === 0) continue;
    outside += count;
    title = noteTitle(node.text);
  }
  if (outside === 0) return { kind: 'ready' };
  return { kind: 'choose', outside, title };
}

export function keepLinkedMirrors(board: Board, removalIds: readonly string[]): Board {
  const removing = new Set(removalIds);
  const rebind = new Map<string, string>();
  const promoted = new Map<string, TextNode>();
  for (const node of board.nodes) {
    if (node.kind !== 'text' || node.protection || !removing.has(node.id)) continue;
    const survivor = board.nodes.find((entry) => entry.kind === 'mirror' && entry.sourceId === node.id && !removing.has(entry.id));
    if (!survivor || survivor.kind !== 'mirror') continue;
    rebind.set(node.id, survivor.id);
    promoted.set(survivor.id, textFromMirror(survivor, node));
  }
  if (rebind.size === 0) return board;
  const nodes = board.nodes.map((entry) => {
    const next = promoted.get(entry.id);
    if (next) return next;
    if (entry.kind === 'mirror') {
      const sourceId = rebind.get(entry.sourceId);
      if (sourceId) return { ...entry, sourceId };
    }
    return entry;
  });
  return { ...board, nodes };
}

export function expandDeletedMirrors(board: Board, removalIds: readonly string[]): string[] {
  const removing = new Set(removalIds);
  const extra: string[] = [];
  for (const node of board.nodes) {
    if (node.kind !== 'text' || !removing.has(node.id)) continue;
    for (const other of board.nodes) {
      if (other.kind === 'mirror' && other.sourceId === node.id && !removing.has(other.id)) extra.push(other.id);
    }
  }
  return extra.length === 0 ? [...removalIds] : [...removalIds, ...extra];
}

export function rebindCopiedMirrors(nodes: BoardNode[], idMap: ReadonlyMap<string, string>): BoardNode[] {
  return nodes.map((node) => {
    if (node.kind !== 'mirror') return node;
    const sourceId = idMap.get(node.sourceId);
    return sourceId ? { ...node, sourceId } : node;
  });
}

export function mirrorFamilyLimit(existing: readonly BoardNode[], copies: readonly BoardNode[]): string | null {
  const counts = new Map<string, number>();
  for (const node of existing) {
    if (node.kind === 'mirror') counts.set(node.sourceId, (counts.get(node.sourceId) ?? 0) + 1);
  }
  for (const node of copies) {
    if (node.kind !== 'mirror') continue;
    const next = (counts.get(node.sourceId) ?? 0) + 1;
    if (next > MIRROR_LIMIT) return MIRROR_LIMIT_MESSAGE;
    counts.set(node.sourceId, next);
  }
  return null;
}

export function missingMirrorSource(board: Board, nodes: readonly BoardNode[], idMap: ReadonlyMap<string, string>): boolean {
  const local = new Set(nodes.map((node) => node.id));
  for (const node of nodes) {
    if (node.kind !== 'mirror') continue;
    if (local.has(node.sourceId) || idMap.has(node.sourceId)) continue;
    const source = board.nodes.find((entry) => entry.id === node.sourceId);
    if (!source || source.kind !== 'text' || source.protection) return true;
  }
  return false;
}

export function textFromMirror(mirror: MirrorNode, source: TextNode): TextNode {
  return {
    id: mirror.id,
    kind: 'text',
    ...(mirror.parentId ? { parentId: mirror.parentId } : {}),
    x: mirror.x,
    y: mirror.y,
    width: mirror.width,
    height: mirror.height,
    text: source.text,
    ...(source.presentation && source.presentation !== 'text' ? { presentation: source.presentation } : {}),
    ...(source.presentation === 'code' && source.language ? { language: source.language } : {}),
    ...(source.presentation === 'code' && source.codeLanguage ? { codeLanguage: source.codeLanguage } : {}),
    ...(mirror.backgroundTone ? { backgroundTone: mirror.backgroundTone } : {}),
    ...(mirror.textTone ? { textTone: mirror.textTone } : {}),
    ...(source.sourceFilename ? { sourceFilename: source.sourceFilename } : {}),
    ...(source.sourcePath ? { sourcePath: source.sourcePath } : {}),
    ...(source.lastEditedAt ? { lastEditedAt: source.lastEditedAt } : { lastEditedAt: mirror.lastEditedAt }),
  };
}

function instanceTones(node: BoardNode): Pick<MirrorNode, 'backgroundTone' | 'textTone'> {
  if (node.kind !== 'text' && node.kind !== 'mirror') return {};
  return {
    ...(node.backgroundTone ? { backgroundTone: node.backgroundTone } : {}),
    ...(node.textTone ? { textTone: node.textTone } : {}),
  };
}

export function applyContentDeletion(board: Board, groupId: string, decision: 'keep' | 'everywhere', now?: string): { board: Board; removedAssetIds: string[] } {
  const ids = contentRemovalIds(board, groupId);
  const prepared = decision === 'keep' ? keepLinkedMirrors(board, ids) : board;
  const removal = decision === 'everywhere' ? expandDeletedMirrors(board, ids) : ids;
  return deleteNodes(prepared, removal, now);
}

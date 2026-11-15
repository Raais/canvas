import { describe, expect, test } from 'bun:test';
import { ARCHIVE_VERSION } from '../archive/format';
import { buildArchive, readArchive } from '../archive/zip';
import { createEmptyBoard, createEmbeddedImageNode, parseBoard, protectTextNode, setNoteTone, updateText } from '../domain/board';
import { connectNodes } from '../domain/graph';
import { GRAPH_CLIPBOARD_VERSION, encodeGraphClipboard, pasteGraph, selectionClosure } from '../domain/graph-clipboard';
import { deleteGroupContents, deleteSelection, duplicateSelection, groupSelection } from '../domain/groups';
import { createHistory, pushHistory, redoHistory, undoHistory } from '../domain/history';
import {
  applyContentDeletion,
  createMirror,
  detachMirror,
  expandDeletedMirrors,
  keepLinkedMirrors,
  mirrorDeletePlan,
  selectionRemovalIds,
} from '../domain/mirrors';
import { protectPlaintext } from '../domain/text-crypto';
import { createNodeProjection } from '../components/flow-projection';
import { buildSearchIndex, searchNodes } from '../domain/search';
import { classifyXray } from '../domain/xray';
import { buildContentIndex, queryBoard } from '../search/query';
import { decidePwaUpdate } from './pwa-update';
import { SCHEMA_VERSION, type Board, type BoardNode, type TextNode } from '../domain/types';

const now = '2026-11-15T12:00:00.000Z';
const later = '2026-11-15T13:00:00.000Z';
const fast = { iterations: 1, memoryKiB: 8_192, parallelism: 1 };

function boardWith(nodes: BoardNode[]): Board {
  return { ...createEmptyBoard(now), nodes };
}

function text(id: string, value: string, extra: Partial<TextNode> = {}): TextNode {
  return {
    id,
    kind: 'text',
    x: 0,
    y: 0,
    width: 240,
    height: 140,
    text: value,
    lastEditedAt: now,
    ...extra,
  };
}

describe('mirror notes', () => {
  test('migrates schema 17 and rejects unsafe references', async () => {
    expect(SCHEMA_VERSION).toBe(18);
    expect(ARCHIVE_VERSION).toBe(2);
    expect(GRAPH_CLIPBOARD_VERSION).toBe(1);
    expect(parseBoard({ ...createEmptyBoard(now), schemaVersion: 17 })?.schemaVersion).toBe(18);
    expect(parseBoard({ ...createEmptyBoard(now), schemaVersion: 2 })?.schemaVersion).toBe(18);
    expect(parseBoard({ ...createEmptyBoard(now), schemaVersion: 19 })).toBeNull();
    const source = text('source', 'Roadmap');
    const mirror = {
      id: 'mirror',
      kind: 'mirror' as const,
      sourceId: 'source',
      x: 300,
      y: 40,
      width: 240,
      height: 140,
      backgroundTone: 'rose' as const,
      lastEditedAt: later,
    };
    const loaded = parseBoard(boardWith([mirror, source]));
    expect(loaded?.nodes.find((node) => node.kind === 'mirror' && node.sourceId === 'source')?.id).toBe('mirror');
    expect(parseBoard({ ...boardWith([mirror, source]), schemaVersion: 17 })).toBeNull();
    expect(parseBoard(boardWith([mirror]))).toBeNull();
    expect(parseBoard(boardWith([source, mirror, { ...mirror, id: 'other', sourceId: 'mirror' }]))).toBeNull();
    expect(parseBoard(boardWith([{ ...mirror, id: 'source', sourceId: 'source' }]))).toBeNull();
    const image = createEmbeddedImageNode({ center: { x: 20, y: 20 }, assetId: 'asset', intrinsicWidth: 8, intrinsicHeight: 8, now });
    expect(parseBoard(boardWith([{ ...mirror, sourceId: image.id }, image]))).toBeNull();
    const payload = await protectPlaintext('secret', 'correct horse', fast);
    const locked = protectTextNode(boardWith([source]), source.id, payload, later);
    const protectedSource = locked.nodes.find((node) => node.kind === 'text');
    expect(parseBoard(boardWith([protectedSource!, mirror]))).toBeNull();
    expect(parseBoard(boardWith([source, { ...mirror, width: 10 }]))).toBeNull();
    expect(parseBoard(boardWith([source, { ...mirror, backgroundTone: 'ink' as 'rose' }]))).toBeNull();
    expect(parseBoard(boardWith([source, { ...mirror, parentId: 'missing' }]))).toBeNull();
    const many: BoardNode[] = [source];
    for (let index = 0; index < 80; index += 1) {
      many.push({ ...mirror, id: `m${index}`, x: index });
    }
    expect(parseBoard(boardWith(many))?.nodes.filter((node) => node.kind === 'mirror')).toHaveLength(80);
  });

  test('shares one document across placements', () => {
    const source = text('source', 'Roadmap', { backgroundTone: 'slate', parentId: 'plan' });
    const group = { id: 'plan', kind: 'group' as const, x: 100, y: 80, width: 400, height: 300, label: 'Planning' };
    const start = boardWith([group, source]);
    const created = createMirror(start, source.id, later);
    if ('error' in created) throw new Error(created.error);
    const mirror = created.board.nodes.find((node) => node.kind === 'mirror');
    expect(mirror?.kind === 'mirror' ? mirror.sourceId : '').toBe(source.id);
    expect(JSON.stringify(mirror).includes('Roadmap')).toBe(false);
    expect(mirror && 'text' in mirror).toBe(false);
    expect(mirror?.kind === 'mirror' ? mirror.parentId ?? '' : 'stuck').toBe('');
    expect(mirror?.x).toBe(368);
    expect(mirror?.y).toBe(108);
    const again = createMirror(created.board, mirror!.id, later);
    if ('error' in again) throw new Error(again.error);
    expect(again.board.nodes.filter((node) => node.kind === 'mirror').every((node) => node.sourceId === source.id)).toBe(true);
    const edited = updateText(again.board, source.id, 'Roadmap\n- [ ] ship', later);
    expect(edited.nodes.filter((node) => node.kind === 'text')).toHaveLength(1);
    expect(edited.nodes.find((node) => node.kind === 'text')?.text).toBe('Roadmap\n- [ ] ship');
    const toned = setNoteTone(edited, mirror!.id, 'background', 'rose', later);
    const sourceNode = toned.nodes.find((node) => node.id === source.id);
    const mirrorNode = toned.nodes.find((node) => node.id === mirror!.id);
    expect(sourceNode?.kind === 'text' ? sourceNode.backgroundTone : '').toBe('slate');
    expect(mirrorNode?.kind === 'mirror' ? mirrorNode.backgroundTone : '').toBe('rose');
    const moved = { ...toned, nodes: toned.nodes.map((node) => node.id === mirror!.id ? { ...node, x: 900 } : node) };
    expect(moved.nodes.find((node) => node.id === source.id)?.x).toBe(0);
    const projection = createNodeProjection();
    const input = { selected: new Set<string>(), editingId: null, readOnly: false, unlocked: new Map(), registry: null, library: new Map() };
    const first = projection.project(toned.nodes, input);
    const changed = updateText(toned, source.id, 'changed', later);
    const second = projection.project(changed.nodes, input);
    const mirrorView = second.find((node) => node.id === mirror!.id);
    const other = second.find((node) => node.id === 'plan');
    const previousOther = first.find((node) => node.id === 'plan');
    expect(mirrorView?.type === 'text' ? mirrorView.data.text : '').toBe('changed');
    expect(other).toBe(previousOther);
    const history = undoHistory(pushHistory(createHistory(), start), created.board);
    expect(history?.board.nodes.some((node) => node.kind === 'mirror')).toBe(false);
    expect(redoHistory(history!.history, history!.board)?.board.nodes.some((node) => node.kind === 'mirror')).toBe(true);
    expect(decidePwaUpdate({
      editingNote: true,
      editingRelationship: false,
      confirming: false,
      ingesting: false,
      adjustingRotation: false,
      focusedField: false,
      readOnly: false,
      saveStatus: 'saved',
      hasUnpersisted: false,
      hasRecovery: false,
      expectationMatches: true,
    }).action).toBe('block');
  });

  test('detaches, duplicates, and deletes without orphan references', async () => {
    const source = text('source', 'Shared');
    const created = createMirror(boardWith([source]), source.id, later);
    if ('error' in created) throw new Error(created.error);
    const mirror = created.board.nodes.find((node) => node.kind === 'mirror');
    const linked = connectNodes(setNoteTone(created.board, mirror!.id, 'text', 'blue', later), mirror!.id, source.id, 'right', 'left');
    if (!linked) throw new Error('link');
    const detached = detachMirror(linked, mirror!.id, later);
    if ('error' in detached) throw new Error(detached.error);
    const note = detached.nodes.find((node) => node.id === mirror!.id);
    expect(note?.kind).toBe('text');
    expect(note?.kind === 'text' ? note.text : '').toBe('Shared');
    expect(note?.kind === 'text' ? note.textTone : '').toBe('blue');
    expect(detached.edges.some((edge) => edge.sourceId === mirror!.id || edge.targetId === mirror!.id)).toBe(true);
    const independent = updateText(detached, mirror!.id, 'Mine', later);
    const keptSource = independent.nodes.find((node) => node.id === source.id);
    expect(keptSource?.kind === 'text' ? keptSource.text : '').toBe('Shared');
    const restored = undoHistory(pushHistory(createHistory(), linked), detached);
    expect(restored?.board.nodes.find((node) => node.id === mirror!.id)?.kind).toBe('mirror');
    const family = createMirror(created.board, source.id, later);
    if ('error' in family) throw new Error(family.error);
    const ids = family.board.nodes.filter((node) => node.kind === 'mirror').map((node) => node.id);
    expect(deleteSelection(family.board, [ids[0]!], later).board.nodes.some((node) => node.id === source.id)).toBe(true);
    expect(mirrorDeletePlan(family.board, [source.id]).kind).toBe('choose');
    expect(deleteSelection(family.board, [source.id], later).board).toBe(family.board);
    const kept = deleteSelection(keepLinkedMirrors(family.board, [source.id]), [source.id], later).board;
    const promoted = kept.nodes.find((node) => node.kind === 'text');
    expect(promoted?.id).toBe(ids[0]);
    expect(kept.nodes.filter((node) => node.kind === 'mirror').every((node) => node.sourceId === ids[0])).toBe(true);
    const everywhere = deleteSelection(family.board, expandDeletedMirrors(family.board, selectionRemovalIds(family.board, [source.id])), later).board;
    expect(everywhere.nodes).toHaveLength(0);
    const grouped = groupSelection(family.board, [source.id], later);
    if ('error' in grouped) throw new Error(grouped.error);
    expect(deleteGroupContents(grouped.board, grouped.board.nodes.find((node) => node.kind === 'group')!.id, later)).toBe(grouped.board);
    const cleared = applyContentDeletion(grouped.board, grouped.board.nodes.find((node) => node.kind === 'group')!.id, 'keep', later).board;
    expect(cleared.nodes.some((node) => node.kind === 'text')).toBe(true);
    expect(cleared.nodes.some((node) => node.kind === 'mirror' && !cleared.nodes.some((sourceNode) => sourceNode.kind === 'text' && sourceNode.id === node.sourceId))).toBe(false);
    const copiedSource = duplicateSelection(family.board, [source.id], later);
    expect(copiedSource.nodes.filter((node) => node.kind === 'text')).toHaveLength(2);
    expect(copiedSource.nodes.filter((node) => node.kind === 'mirror').every((node) => node.sourceId === source.id)).toBe(true);
    const copiedMirror = duplicateSelection(family.board, [ids[0]!], later);
    expect(copiedMirror.nodes.filter((node) => node.kind === 'mirror' && node.sourceId === source.id).length).toBe(ids.length + 1);
    const copiedFamily = duplicateSelection(family.board, [source.id, ...ids], later);
    const fresh = copiedFamily.nodes.filter((node) => node.kind === 'text' && node.id !== source.id);
    expect(fresh).toHaveLength(1);
    expect(copiedFamily.nodes.filter((node) => node.kind === 'mirror' && node.sourceId === fresh[0]?.id)).toHaveLength(ids.length);
    const clip = selectionClosure(family.board, [ids[0]!]);
    expect(clip ? encodeGraphClipboard(clip).includes('Shared') : true).toBe(false);
    const same = pasteGraph(family.board, clip!, { x: 20, y: 20 }, new Set(), 0, later);
    expect('error' in same ? '' : same.nodes.filter((node) => node.kind === 'mirror' && node.sourceId === source.id).length).toBe(ids.length + 1);
    const foreign = pasteGraph(createEmptyBoard(now), clip!, { x: 0, y: 0 }, new Set(), 0, later);
    expect('error' in foreign ? foreign.error : '').toBe('That copy refers to a note that is not on this board.');
    const both = selectionClosure(family.board, [source.id, ids[0]!]);
    const moved = pasteGraph(createEmptyBoard(now), both!, { x: 0, y: 0 }, new Set(), 0, later);
    if ('error' in moved) throw new Error(moved.error);
    const pastedSource = moved.nodes.find((node) => node.kind === 'text');
    expect(moved.nodes.find((node) => node.kind === 'mirror')?.sourceId).toBe(pastedSource?.id);
    const index = buildSearchIndex(family.board.nodes);
    expect(searchNodes(index, 'Shared').map((hit) => hit.id)).toEqual([source.id]);
    const outcome = queryBoard(family.board.nodes, buildContentIndex(family.board.nodes), 'Shared', new Date(later));
    expect(outcome.results.map((result) => result.id)).toEqual([source.id]);
    expect(outcome.matchIds.includes(ids[0]!)).toBe(true);
    expect(outcome.matchIds.includes(ids[1]!)).toBe(true);
    const scene = classifyXray({ nodes: family.board.nodes, edges: [], matchIds: outcome.matchIds, enabled: true, showConnections: false, active: true });
    expect(scene.nodes.get(source.id)).toBe('match');
    expect(scene.nodes.get(ids[0]!)).toBe('match');
    const opened = await readArchive(await buildArchive(family.board, [], later));
    expect('error' in opened ? opened.error : opened.board.nodes.filter((node) => node.kind === 'mirror')).toHaveLength(ids.length);
  });
});

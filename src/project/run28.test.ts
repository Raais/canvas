import { describe, expect, test } from 'bun:test';
import { ARCHIVE_VERSION } from '../archive/format';
import { createXrayPresentation } from '../components/xray-presentation';
import { createEdgeProjection, createNodeProjection } from '../components/flow-projection';
import { addNodes, createEmbeddedImageNode, createEmptyBoard, createFileNode, createTextNode, createWebsiteNode, updateText } from '../domain/board';
import { GRAPH_CLIPBOARD_VERSION } from '../domain/graph-clipboard';
import { createHistory, pushHistory, redoHistory, undoHistory } from '../domain/history';
import { SEARCH_LIMIT } from '../domain/search';
import { SCHEMA_VERSION, type BoardNode, type ProtectedTextPayload } from '../domain/types';
import { classifyXray, clearedXrayLens, xrayLensActive, xrayQueryLabel } from '../domain/xray';
import { decideEscape } from '../editor/xray-escape';
import { searchShortcut } from '../editor/shortcuts';
import { buildContentIndex, queryBoard } from '../search/query';

const now = '2026-06-15T12:00:00.000Z';
const earlier = '2024-06-15T12:00:00.000Z';
const clock = new Date(2026, 5, 20, 12, 0, 0);

function text(id: string, body: string, edited = now, parentId?: string): BoardNode {
  return { ...createTextNode({ x: 0, y: 0 }, body, edited), id, ...(parentId ? { parentId } : {}) };
}

function drawing(id: string): BoardNode {
  return {
    id,
    kind: 'drawing',
    x: 0,
    y: 0,
    width: 40,
    height: 20,
    points: [0, 0, 20, 10],
    color: 'ink',
    brush: 'fineliner',
    strokeWidth: 2,
    lastEditedAt: now,
  };
}

const protection: ProtectedTextPayload = {
  version: 1,
  cipher: 'xchacha20poly1305',
  kdf: 'argon2id',
  iterations: 1,
  memoryKiB: 8192,
  parallelism: 1,
  salt: 'AAAAAAAAAAAAAAAAAAAAAA==',
  nonce: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
  ciphertext: 'AAAAAAAAAAAAAAAAAAAAAAAAAAA=',
};

describe('x-ray search', () => {
  test('keeps the palette capped and highlights every content match', () => {
    const notes = Array.from({ length: 40 }, (_, index) => text(`n${index}`, `harbor note ${index}`));
    const board = addNodes(createEmptyBoard(now), notes, now);
    const outcome = queryBoard(board.nodes, buildContentIndex(board.nodes), 'harbor', clock);
    expect(outcome.results).toHaveLength(SEARCH_LIMIT);
    expect(outcome.matchIds).toHaveLength(40);
    expect(outcome.notice).toBeNull();
    expect(outcome.results.map((result) => result.id)).toEqual(outcome.matchIds.slice(0, SEARCH_LIMIT));
    const scene = classifyXray({ nodes: board.nodes, edges: [], matchIds: outcome.matchIds, enabled: true, showConnections: false, active: true });
    expect(scene.matchCount).toBe(40);
    expect(scene.nodes.get('n39')).toBe('match');
    expect(scene.nodes.get('n0')).toBe('match');
  });

  test('uses one search reading for fuzzy, prefix, file, website, and group queries', () => {
    const atlas = text('atlas', 'Atlas plan');
    const file = { ...createFileNode({ center: { x: 10, y: 10 }, assetId: 'asset', filename: 'chart.pdf', now }), id: 'chart' };
    const site = { ...createWebsiteNode({ center: { x: 20, y: 20 }, url: 'https://mozilla.org/docs', title: 'API Documentation', now }), id: 'site' };
    const group: BoardNode = { id: 'shelf', kind: 'group', x: 0, y: 0, width: 200, height: 160, label: 'Harbor shelf' };
    const board = addNodes(createEmptyBoard(now), [atlas, file, site, group], now);
    const index = buildContentIndex(board.nodes);
    expect(queryBoard(board.nodes, index, 'atl', clock).matchIds[0]).toBe('atlas');
    expect(queryBoard(board.nodes, index, 'atls', clock).matchIds.includes('atlas')).toBe(true);
    expect(queryBoard(board.nodes, index, 'chart.pdf', clock).matchIds).toEqual(['chart']);
    expect(queryBoard(board.nodes, index, 'mozilla', clock).matchIds).toEqual(['site']);
    expect(queryBoard(board.nodes, index, 'Harbor', clock).matchIds).toEqual(['shelf']);
    expect(queryBoard(board.nodes, index, '   ', clock).matchIds).toEqual([]);
    expect(xrayLensActive(true, '   ', null, true)).toBe(false);
  });

  test('keeps date, mixed, invalid, image, and drawing eligibility', () => {
    const dated = text('dated', 'plain note');
    const old = text('old', 'notes from 2026', earlier);
    const image = { ...createEmbeddedImageNode({ center: { x: 30, y: 30 }, assetId: 'pic', intrinsicWidth: 40, intrinsicHeight: 40, now }), id: 'pic' };
    const ink = drawing('ink');
    const board = addNodes(createEmptyBoard(now), [dated, old, image, ink], now);
    const index = buildContentIndex(board.nodes);
    const dateOnly = queryBoard(board.nodes, index, 'edited:2026', clock);
    expect(dateOnly.notice).toBeNull();
    expect(dateOnly.matchIds.includes('dated')).toBe(true);
    expect(dateOnly.matchIds.includes('pic')).toBe(true);
    expect(dateOnly.matchIds.includes('ink')).toBe(false);
    expect(dateOnly.matchIds.includes('old')).toBe(false);
    expect(dateOnly.results.every((result) => result.section === 'date')).toBe(true);
    const mixed = queryBoard(board.nodes, index, '2026', clock);
    expect(mixed.matchIds.includes('old')).toBe(true);
    expect(mixed.matchIds.includes('dated')).toBe(true);
    expect(mixed.results.every((result) => mixed.matchIds.includes(result.id))).toBe(true);
    const contentImage = queryBoard(board.nodes, index, 'pic', clock);
    expect(contentImage.matchIds.includes('pic')).toBe(false);
    expect(contentImage.matchIds.includes('ink')).toBe(false);
    const invalid = queryBoard(board.nodes, index, 'edited:not-a-date', clock);
    expect(invalid.notice).toBe('That date was not recognized.');
    expect(invalid.matchIds).toEqual([]);
    expect(xrayLensActive(true, 'edited:not-a-date', invalid.notice, true)).toBe(false);
    const idle = classifyXray({ nodes: board.nodes, edges: [], matchIds: invalid.matchIds, enabled: true, showConnections: true, active: false });
    expect(idle.active).toBe(false);
    expect(idle.nodes.size).toBe(0);
  });

  test('does not expose protected note text', () => {
    const locked = text('locked', 'violet passphrase');
    locked.kind = 'text';
    if (locked.kind === 'text') {
      locked.text = '';
      locked.protection = protection;
    }
    const board = addNodes(createEmptyBoard(now), [locked, text('open', 'ordinary note')], now);
    const outcome = queryBoard(board.nodes, buildContentIndex(board.nodes), 'violet', clock);
    expect(outcome.matchIds.includes('locked')).toBe(false);
    expect(outcome.results.some((result) => result.title.includes('violet') || result.snippet.includes('violet'))).toBe(false);
    const dated = queryBoard(board.nodes, buildContentIndex(board.nodes), 'edited:2026', clock);
    const hit = dated.results.find((result) => result.id === 'locked');
    expect(hit?.title).toBe('Password protected');
    expect(hit?.snippet.includes('violet')).toBe(false);
  });

  test('classifies matches, one-hop context, structure, and dimmed edges', () => {
    const nodes = [
      text('a', 'alpha'),
      text('b', 'beta'),
      text('c', 'gamma'),
      text('d', 'delta', now, 'shelf'),
      { id: 'shelf', kind: 'group', x: 0, y: 0, width: 100, height: 80, label: 'Shelf' } as BoardNode,
      { id: 'other', kind: 'group', x: 0, y: 0, width: 100, height: 80, label: 'Other' } as BoardNode,
      text('nested', 'inside', now, 'other'),
    ];
    const edges = [
      { id: 'ab', sourceId: 'a', targetId: 'b' },
      { id: 'ab-2', sourceId: 'a', targetId: 'b' },
      { id: 'bc', sourceId: 'b', targetId: 'c' },
      { id: 'ad', sourceId: 'a', targetId: 'd' },
      { id: 'gone', sourceId: 'a', targetId: 'missing' },
    ];
    const before = JSON.stringify({ nodes, edges });
    const scene = classifyXray({ nodes, edges, matchIds: ['a', 'd', 'stale'], enabled: true, showConnections: true, active: true });
    expect(JSON.stringify({ nodes, edges })).toBe(before);
    expect(scene.matchCount).toBe(2);
    expect(scene.nodes.get('a')).toBe('match');
    expect(scene.nodes.get('d')).toBe('match');
    expect(scene.nodes.get('b')).toBe('context');
    expect(scene.nodes.get('c')).toBe('dimmed');
    expect(scene.nodes.get('shelf')).toBe('structure');
    expect(scene.nodes.get('other')).toBe('dimmed');
    expect(scene.nodes.get('nested')).toBe('dimmed');
    expect(scene.edges.get('ab')).toBe('context');
    expect(scene.edges.get('ab-2')).toBe('context');
    expect(scene.edges.get('bc')).toBe('dimmed');
    expect(scene.edges.get('ad')).toBe('match');
    expect(scene.edges.get('gone')).toBe('dimmed');
    const closed = classifyXray({ nodes, edges, matchIds: ['a', 'd'], enabled: true, showConnections: false, active: true });
    expect(closed.nodes.get('b')).toBe('dimmed');
    expect(closed.edges.get('ad')).toBe('match');
    expect(closed.edges.get('ab')).toBe('dimmed');
    expect(closed.nodes.get('shelf')).toBe('structure');
    const labeled = classifyXray({ nodes, edges, matchIds: ['shelf'], enabled: true, showConnections: false, active: true });
    expect(labeled.nodes.get('shelf')).toBe('match');
    expect(labeled.nodes.get('d')).toBe('dimmed');
    const none = classifyXray({ nodes, edges, matchIds: [], enabled: true, showConnections: true, active: true });
    expect(none.matchCount).toBe(0);
    expect(none.nodes.get('a')).toBe('dimmed');
    expect(none.edges.get('ab')).toBe('dimmed');
    const off = classifyXray({ nodes, edges, matchIds: ['a'], enabled: false, showConnections: true, active: true });
    expect(off.active).toBe(false);
    expect(off).toBe(classifyXray({ nodes, edges, matchIds: [], enabled: true, showConnections: false, active: false }));
  });

  test('does not expand context into a second hop', () => {
    const nodes = [0, 1, 2, 3].map((index) => ({ id: `n${index}` }));
    const edges = [0, 1, 2].map((index) => ({ id: `e${index}`, sourceId: `n${index}`, targetId: `n${index + 1}` }));
    const scene = classifyXray({ nodes, edges, matchIds: ['n0'], enabled: true, showConnections: true, active: true });
    expect(scene.nodes.get('n0')).toBe('match');
    expect(scene.nodes.get('n1')).toBe('context');
    expect(scene.nodes.get('n2')).toBe('dimmed');
    expect(scene.nodes.get('n3')).toBe('dimmed');
    expect(scene.edges.get('e0')).toBe('context');
    expect(scene.edges.get('e1')).toBe('dimmed');
  });

  test('classifies a long chain without a per-node edge scan', () => {
    const count = 2500;
    const nodes = Array.from({ length: count }, (_, index) => ({ id: `n${index}`, parentId: index === 0 ? undefined : `n${index - 1}` }));
    const edges = Array.from({ length: count - 1 }, (_, index) => ({ id: `e${index}`, sourceId: `n${index}`, targetId: `n${index + 1}` }));
    const started = performance.now();
    const scene = classifyXray({ nodes, edges, matchIds: [`n${count - 1}`], enabled: true, showConnections: true, active: true });
    expect(performance.now() - started < 1000).toBe(true);
    expect(scene.nodes.get(`n${count - 1}`)).toBe('match');
    expect(scene.nodes.get(`n${count - 2}`)).toBe('context');
    expect(scene.nodes.get(`n${count - 3}`)).toBe('structure');
    expect(scene.nodes.get('n0')).toBe('structure');
    expect(scene.nodes.size).toBe(count);
    expect(scene.edges.size).toBe(count - 1);
  });

  test('reuses projections and leaves board records untouched', () => {
    const note = text('note', 'alpha');
    const ink = drawing('ink');
    const board = addNodes(createEmptyBoard(now), [note, ink], now);
    const revision = board.revision;
    const nodeRecord = board.nodes[0];
    const outcome = queryBoard(board.nodes, buildContentIndex(board.nodes), 'alpha', clock);
    const scene = classifyXray({ nodes: board.nodes, edges: board.edges, matchIds: outcome.matchIds, enabled: true, showConnections: false, active: true });
    expect(board.revision).toBe(revision);
    expect(board.nodes[0]).toBe(nodeRecord);
    const input = { selected: new Set<string>(), editingId: null, readOnly: true, unlocked: new Map(), registry: null, library: new Map() };
    const projection = createNodeProjection();
    const edges = createEdgeProjection();
    const baseNodes = projection.project(board.nodes, input);
    const baseEdges = edges.project([{ id: 'link', sourceId: 'note', targetId: 'ink', sourceHandle: 'right', targetHandle: 'left', restLength: 40, style: 'dashed' }], new Set());
    const again = projection.project(board.nodes, input);
    expect(again[0]).toBe(baseNodes[0]);
    const view = createXrayPresentation<typeof baseNodes[number], typeof baseEdges[number]>();
    const idle = view.present(baseNodes, baseEdges, classifyXray({ nodes: [], edges: [], matchIds: [], enabled: false, showConnections: false, active: false }));
    expect(idle.nodes).toBe(baseNodes);
    expect(idle.edges).toBe(baseEdges);
    const lit = view.present(baseNodes, baseEdges, scene);
    const repeated = view.present(baseNodes, baseEdges, scene);
    const match = lit.nodes.find((node) => node.id === 'note');
    const faded = lit.nodes.find((node) => node.id === 'ink');
    const matchAgain = repeated.nodes.find((node) => node.id === 'note');
    expect(match?.className?.includes('xray-match')).toBe(true);
    expect(faded?.className?.includes('xray-dim')).toBe(true);
    expect(matchAgain).toBe(match);
    expect(match?.data).toBe(baseNodes.find((node) => node.id === 'note')?.data);
    expect(faded?.type === 'drawing' ? faded.style?.pointerEvents : '').toBe('none');
    const storedInk = board.nodes.find((node) => node.id === 'ink');
    expect(faded?.type === 'drawing' ? faded.data.points : []).toBe(storedInk?.kind === 'drawing' ? storedInk.points : []);
    expect(match?.type === 'text' ? match.data.readOnly : false).toBe(true);
    expect(baseNodes.find((node) => node.id === 'note')?.className ?? '').toBe('');
    expect(lit.edges[0]?.className?.includes('relationship-dashed')).toBe(true);
    expect(lit.edges[0]?.className?.includes('xray-edge-dim')).toBe(true);
    expect(baseEdges[0]?.className).toBe('relationship-dashed');
    const cleared = view.present(baseNodes, baseEdges, clearedScene());
    expect(cleared.nodes).toBe(baseNodes);
  });

  test('drops stale matches after edit, undo, redo, and board replacement', () => {
    const board = addNodes(createEmptyBoard(now), [text('a', 'alpha'), text('b', 'beta')], now);
    const edited = updateText(board, 'a', 'zeta', '2026-06-16T00:00:00.000Z');
    const hidden = queryBoard(edited.nodes, buildContentIndex(edited.nodes), 'alpha', clock);
    expect(hidden.matchIds.includes('a')).toBe(false);
    const undone = undoHistory(pushHistory(createHistory(), board), edited);
    const restoredNote = undone?.board.nodes.find((node) => node.id === 'a');
    expect(restoredNote?.kind === 'text' ? restoredNote.text : '').toBe('alpha');
    const restored = undone ? queryBoard(undone.board.nodes, buildContentIndex(undone.board.nodes), 'alpha', clock) : null;
    expect(restored?.matchIds.includes('a')).toBe(true);
    const redone = undone ? redoHistory(undone.history, undone.board) : null;
    const afterRedo = redone ? queryBoard(redone.board.nodes, buildContentIndex(redone.board.nodes), 'alpha', clock) : null;
    expect(afterRedo?.matchIds.includes('a')).toBe(false);
    const replacement = addNodes(createEmptyBoard(now), [text('c', 'alpha')], now);
    const moved = queryBoard(replacement.nodes, buildContentIndex(replacement.nodes), 'alpha', clock);
    expect(moved.matchIds).toEqual(['c']);
    expect(clearedXrayLens()).toEqual({ enabled: false, showConnections: false, query: '' });
    expect(xrayQueryLabel('a very long harbor query that should shrink')).toBe('a very long harbor query th…');
  });

  test('keeps search and escape guards', () => {
    expect(searchShortcut({ key: 'k', meta: true, ctrl: false, alt: false, shift: false, composing: false, repeat: false, editingField: false, confirming: false, editing: false })).toBe(true);
    expect(searchShortcut({ key: 'k', meta: false, ctrl: true, alt: false, shift: false, composing: false, repeat: false, editingField: true, confirming: false, editing: false })).toBe(false);
    expect(searchShortcut({ key: 'x', meta: false, ctrl: false, alt: false, shift: false, composing: false, repeat: false, editingField: false, confirming: false, editing: false })).toBe(false);
    const base = { passwordPrompt: false, searchOpen: false, viewsOpen: false, editingField: false, editing: false, inDialog: false, inkGesture: false, framing: false, tool: 'select', xrayLens: true };
    expect(decideEscape({ ...base, passwordPrompt: true, searchOpen: true })).toBe('password');
    expect(decideEscape({ ...base, searchOpen: true, editingField: true })).toBe('close-search');
    expect(decideEscape({ ...base, viewsOpen: true })).toBe('close-views');
    expect(decideEscape({ ...base, editingField: true })).toBe('ignore');
    expect(decideEscape({ ...base, editing: true })).toBe('ignore');
    expect(decideEscape({ ...base, inDialog: true })).toBe('idle');
    expect(decideEscape({ ...base, tool: 'pen' })).toBe('release-tool');
    expect(decideEscape({ ...base, inkGesture: true, tool: 'eraser' })).toBe('release-tool');
    expect(decideEscape({ ...base, framing: true, tool: 'frame' })).toBe('release-tool');
    expect(decideEscape(base)).toBe('exit-xray');
    expect(decideEscape({ ...base, xrayLens: false })).toBe('idle');
    expect(SCHEMA_VERSION).toBe(17);
    expect(ARCHIVE_VERSION).toBe(2);
    expect(GRAPH_CLIPBOARD_VERSION).toBe(1);
    expect(xrayLensActive(true, 'atlas', 'Search is loading.', false)).toBe(false);
    expect(xrayLensActive(false, 'atlas', null, true)).toBe(false);
    expect(xrayLensActive(true, 'atlas', null, true)).toBe(true);
  });
});

function clearedScene() {
  return classifyXray({ nodes: [], edges: [], matchIds: [], enabled: false, showConnections: false, active: false });
}

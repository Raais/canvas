import { describe, expect, test } from 'bun:test';
import { strToU8, unzipSync, zipSync } from 'fflate';
import { ARCHIVE_VERSION } from '../archive/format';
import { buildArchive, readArchive } from '../archive/zip';
import { addNodes, createEmptyBoard, createFileNode, createTextNode, createWebsiteNode, parseBoard, updateWebsite } from '../domain/board';
import { worldTopLeft } from '../domain/geometry';
import { connectNodes } from '../domain/graph';
import { GRAPH_CLIPBOARD_VERSION, decodeGraphClipboard, encodeGraphClipboard, pasteGraph, selectionClosure } from '../domain/graph-clipboard';
import { duplicateSelection, groupSelection, ungroup } from '../domain/groups';
import { createHistory, pushHistory, redoHistory, undoHistory } from '../domain/history';
import { relaxBoard } from '../domain/physics';
import { buildSearchIndex, searchNodes } from '../domain/search';
import { SCHEMA_VERSION } from '../domain/types';
import { classifyLinkDrop, resolveLinkDrop, standaloneHtmlBookmark, websiteEditsAllowed, websiteFromExplicit, websiteFromStandalone } from '../domain/websites';
import { interpretClipboard } from '../ingest/clipboard';
import { createNodeProjection } from '../components/flow-projection';
import { buildContentIndex, queryBoard } from '../search/query';

const now = '2026-11-15T12:00:00.000Z';
const later = '2026-11-15T13:00:00.000Z';
const mdn = 'https://developer.mozilla.org/en-US/docs/Web/API';

function fields(url: string, title = 'Docs') {
  const parsed = websiteFromExplicit(url, title);
  if (!parsed.ok) throw new Error(parsed.message);
  return parsed;
}

describe('website nodes', () => {
  test('stores schema 13 and still opens a schema 12 board', () => {
    expect(SCHEMA_VERSION).toBe(14);
    expect(ARCHIVE_VERSION).toBe(2);
    expect(GRAPH_CLIPBOARD_VERSION).toBe(1);
    const created = createWebsiteNode({ center: { x: 260, y: 140 }, ...fields('https://example.com', 'Example'), now });
    expect(created.kind).toBe('website');
    expect(created.x).toBe(130);
    expect(created.y).toBe(70);
    expect(created.width).toBe(260);
    expect(created.height).toBe(140);
    const legacy = parseBoard({ ...createEmptyBoard(now), schemaVersion: 12 });
    expect(legacy?.schemaVersion).toBe(14);
    expect(legacy?.nodes).toHaveLength(0);
    expect(parseBoard({ ...createEmptyBoard(now), schemaVersion: 2, appearance: undefined, backgroundPattern: undefined, ditherAtlas: undefined })?.schemaVersion).toBe(14);
    expect(parseBoard({ ...createEmptyBoard(now), schemaVersion: 15 })).toBeNull();
    const stored = parseBoard(addNodes(createEmptyBoard(now), [created], now));
    expect(stored?.nodes.some((node) => node.kind === 'website' && node.url === 'https://example.com/' && node.title === 'Example')).toBe(true);
  });

  test('accepts http and https, normalizes a bare domain, and rejects unsafe addresses', () => {
    const http = websiteFromExplicit('http://localhost:5173/docs', '');
    expect(http.ok && http.url).toBe('http://localhost:5173/docs');
    expect(http.ok && http.title).toBe('localhost');
    const bare = websiteFromExplicit('www.wikipedia.org', '  Encyclopedia  ');
    expect(bare.ok && bare.url).toBe('https://www.wikipedia.org/');
    expect(bare.ok && bare.title).toBe('Encyclopedia');
    const derived = websiteFromExplicit('https://www.wikipedia.org/wiki/Canvas', '');
    expect(derived.ok && derived.title).toBe('wikipedia.org');
    expect(derived.ok && derived.url).toBe('https://www.wikipedia.org/wiki/Canvas');
    expect(websiteFromExplicit('javascript:alert(1)', '').ok).toBe(false);
    expect(websiteFromExplicit('data:text/html,hi', '').ok).toBe(false);
    expect(websiteFromExplicit('file:///tmp/secret', '').ok).toBe(false);
    expect(websiteFromExplicit('https://user:secret@example.com', '').ok).toBe(false);
    expect(websiteFromExplicit('https://example.com/\npath', '').ok).toBe(false);
    expect(websiteFromExplicit(`https://example.com/${'a'.repeat(2100)}`, '').ok).toBe(false);
    expect(websiteFromExplicit('https://example.com', 'x'.repeat(121)).ok).toBe(false);
    expect(websiteFromExplicit('not a website', '').ok).toBe(false);
    expect(websiteFromStandalone('example.com')).toBeNull();
    expect(websiteFromStandalone('see https://example.com')).toBeNull();
    expect(websiteFromStandalone('https://example.com/photo.png')).toBeNull();
  });

  test('edits metadata once, ignores a no-op, and undoes it', () => {
    const node = { ...createWebsiteNode({ center: { x: 0, y: 0 }, ...fields(mdn, 'API Documentation'), now }), id: 'site' };
    const board = addNodes(createEmptyBoard(now), [node], now);
    const same = updateWebsite(board, 'site', { url: node.url, title: node.title }, later);
    expect(same).toBe(board);
    const next = fields('https://github.com/Raais/canvas', 'Canvas');
    const edited = updateWebsite(board, 'site', next, later);
    const stored = edited.nodes.find((entry) => entry.id === 'site');
    expect(stored?.kind === 'website' ? stored.url : '').toBe('https://github.com/Raais/canvas');
    expect(stored?.kind === 'website' ? stored.title : '').toBe('Canvas');
    expect(stored?.kind === 'website' ? stored.lastEditedAt : '').toBe(later);
    const undone = undoHistory(pushHistory(createHistory(), board), edited);
    const undoneNode = undone?.board.nodes.find((entry) => entry.id === 'site');
    expect(undoneNode?.kind === 'website' ? undoneNode.title : '').toBe('API Documentation');
    const redone = undone ? redoHistory(undone.history, undone.board) : null;
    const redoneNode = redone?.board.nodes.find((entry) => entry.id === 'site');
    expect(redoneNode?.kind === 'website' ? redoneNode.url : '').toBe('https://github.com/Raais/canvas');
  });

  test('duplicates independently, groups in local coordinates, and links with tension', () => {
    const first = { ...createWebsiteNode({ center: { x: 40, y: 40 }, ...fields('https://example.com', 'One'), now }), id: 'a', x: 40, y: 40 };
    const second = { ...createWebsiteNode({ center: { x: 400, y: 40 }, ...fields('https://example.com/other', 'Two'), now }), id: 'b', x: 400, y: 40 };
    const board = addNodes(createEmptyBoard(now), [first, second], now);
    const copied = duplicateSelection(board, ['a'], later);
    const twin = copied.nodes.find((node) => node.id !== 'a' && node.kind === 'website' && node.title === 'One');
    expect(twin?.id === 'a').toBe(false);
    expect(twin?.kind === 'website' ? twin.url : '').toBe(first.url);
    expect(twin?.kind === 'website' ? twin.lastEditedAt : '').toBe(later);
    const grouped = groupSelection(board, ['a']);
    if ('error' in grouped) throw new Error(grouped.error);
    const child = grouped.board.nodes.find((node) => node.id === 'a');
    expect(child?.kind === 'website' ? child.parentId?.length ?? 0 : 0).toBeGreaterThan(0);
    const world = child ? worldTopLeft(grouped.board.nodes, child) : null;
    expect(world).toEqual({ x: 40, y: 40 });
    const released = ungroup(grouped.board, grouped.board.nodes.filter((node) => node.kind === 'group').map((node) => node.id));
    const releasedNode = released.nodes.find((node) => node.id === 'a');
    expect(releasedNode?.kind === 'website' ? releasedNode.parentId ?? '' : 'grouped').toBe('');
    const linked = connectNodes(board, 'a', 'b', 'right', 'left', now);
    expect(linked?.edges).toHaveLength(1);
    const stretched = linked ? { ...linked, edges: linked.edges.map((edge) => ({ ...edge, restLength: 20 })) } : null;
    const relaxed = stretched ? relaxBoard(stretched, [], 40) : null;
    const moved = relaxed?.nodes.find((node) => node.id === 'b');
    expect(moved ? 400 - moved.x : 0).toBeGreaterThan(0);
  });

  test('classifies paste and drag without taking image or text precedence', () => {
    expect(interpretClipboard({ imageKeys: [], html: null, plainText: 'https://www.notion.so/' }).actions).toEqual([
      { type: 'website', url: 'https://www.notion.so/', title: 'notion.so' },
    ]);
    expect(interpretClipboard({ imageKeys: [], html: null, plainText: 'http://localhost:5173/docs' }).actions[0]?.type).toBe('website');
    expect(interpretClipboard({ imageKeys: [], html: null, plainText: 'https://example.com/photo.webp' }).actions[0]?.type).toBe('external-image');
    expect(interpretClipboard({ imageKeys: [{ key: 'img', mimeType: 'image/png' }], html: null, plainText: 'https://example.com' }).actions[0]?.type).toBe('file-image');
    expect(interpretClipboard({ imageKeys: [], html: null, plainText: 'Notes about https://example.com\nand more' }).actions[0]?.type).toBe('text');
    const anchor = standaloneHtmlBookmark('<a href="https://github.com/Raais/canvas">Canvas</a>');
    expect(anchor).toEqual({ url: 'https://github.com/Raais/canvas', title: 'Canvas' });
    expect(interpretClipboard({ imageKeys: [], html: '<p>See <a href="https://example.com">Example</a></p>', plainText: 'See Example' }).actions[0]?.type).toBe('text');
    expect(classifyLinkDrop({ uriList: '# comment\nhttps://example.com/docs\n', plain: 'Docs', html: null })).toEqual({ url: 'https://example.com/docs', title: 'Docs' });
    expect(classifyLinkDrop({ uriList: 'https://one.example\nhttps://two.example\n', plain: null, html: null })).toBeNull();
    expect(classifyLinkDrop({ uriList: 'javascript:alert(1)\n', plain: null, html: null })).toBeNull();
    expect(classifyLinkDrop({ uriList: null, plain: 'https://example.com/plain', html: null })).toEqual({ url: 'https://example.com/plain', title: 'example.com' });
    expect(classifyLinkDrop({ uriList: null, plain: 'just words', html: null })).toBeNull();
    expect(classifyLinkDrop({
      uriList: null,
      plain: null,
      html: '<a href="https://github.com/Raais/canvas">Canvas</a>',
    })).toEqual({ url: 'https://github.com/Raais/canvas', title: 'Canvas' });
    expect(classifyLinkDrop({
      uriList: null,
      plain: 'see the notes',
      html: '<a href="https://github.com/Raais/canvas">Canvas</a>',
    })).toEqual({ url: 'https://github.com/Raais/canvas', title: 'Canvas' });
    expect(classifyLinkDrop({
      uriList: null,
      plain: null,
      html: '<p>See <a href="https://example.com">Example</a></p>',
    })).toBeNull();
    expect(resolveLinkDrop({
      types: ['text/uri-list', 'text/plain'],
      uriList: 'https://example.com/docs',
      plain: 'Docs',
      html: null,
    })).toEqual({ preventDefault: true, website: { url: 'https://example.com/docs', title: 'Docs' } });
    expect(resolveLinkDrop({
      types: ['text/uri-list'],
      uriList: 'javascript:alert(1)',
      plain: null,
      html: '<a href="https://example.com">Example</a>',
    })).toEqual({ preventDefault: true, website: null });
    expect(resolveLinkDrop({
      types: ['text/uri-list', 'text/plain'],
      uriList: 'https://one.example\nhttps://two.example',
      plain: 'https://one.example',
      html: null,
    })).toEqual({ preventDefault: true, website: null });
    expect(resolveLinkDrop({
      types: ['text/html'],
      uriList: null,
      plain: null,
      html: '<a href="https://example.com/only">Only</a>',
    })).toEqual({ preventDefault: true, website: { url: 'https://example.com/only', title: 'Only' } });
    expect(resolveLinkDrop({
      types: ['text/plain'],
      uriList: null,
      plain: 'not a url',
      html: null,
    })).toEqual({ preventDefault: true, website: null });
    expect(resolveLinkDrop({
      types: ['Files', 'text/uri-list'],
      uriList: 'https://example.com',
      plain: null,
      html: null,
    })).toEqual({ preventDefault: true, website: null });
    expect(resolveLinkDrop({
      types: ['application/reactflow'],
      uriList: null,
      plain: null,
      html: null,
    }).preventDefault).toBe(false);
    expect(websiteEditsAllowed(false)).toBe(true);
    expect(websiteEditsAllowed(true)).toBe(false);
  });

  test('searches title, domain, and path, including dates', () => {
    const node = { ...createWebsiteNode({ center: { x: 0, y: 0 }, ...fields(mdn, 'API Documentation'), now }), id: 'site' };
    const board = addNodes(createEmptyBoard(now), [node], now);
    expect(searchNodes(buildSearchIndex(board.nodes), 'API Documentation')[0]?.kind).toBe('website');
    expect(searchNodes(buildSearchIndex(board.nodes), 'mozilla')[0]?.id).toBe('site');
    expect(searchNodes(buildSearchIndex(board.nodes), 'Web/API')[0]?.title).toBe('API Documentation');
    const dated = queryBoard(board.nodes, buildContentIndex(board.nodes), '2026', new Date('2026-11-15T18:00:00.000Z'));
    expect(dated.results.some((result) => result.kind === 'website' && result.section === 'date')).toBe(true);
  });

  test('projects a website without refreshing an unchanged card', () => {
    const node = createWebsiteNode({ center: { x: 10, y: 10 }, ...fields('https://example.com', 'Example'), now });
    const board = addNodes(createEmptyBoard(now), [node], now);
    const projection = createNodeProjection();
    const input = { selected: new Set<string>(), editingId: null, readOnly: false, unlocked: new Map(), registry: null, library: new Map() };
    const first = projection.project(board.nodes, input).find((entry) => entry.type === 'website');
    const second = projection.project(board.nodes, input).find((entry) => entry.type === 'website');
    expect(second).toBe(first);
    expect(first?.type === 'website' ? first.data.url : '').toBe('https://example.com/');
    const renamed = updateWebsite(board, node.id, { url: 'https://example.com/', title: 'Renamed' }, later);
    const third = projection.project(renamed.nodes, input).find((entry) => entry.type === 'website');
    expect(third?.type === 'website' ? third.data.title : '').toBe('Renamed');
  });

  test('round-trips a website in clipboard format 1 and archive format 2 without an asset', async () => {
    const site = { ...createWebsiteNode({ center: { x: 30, y: 30 }, ...fields('https://example.com/path?q=1#here', 'Path'), now }), id: 'site' };
    const file = createFileNode({ center: { x: 300, y: 0 }, assetId: 'asset-1', filename: 'notes.txt', now });
    const note = createTextNode({ x: 0, y: 200 }, 'Still a note', now);
    const board = addNodes(createEmptyBoard(now), [site, file, note], now);
    const payload = selectionClosure(board, ['site']);
    const decoded = payload ? decodeGraphClipboard(encodeGraphClipboard(payload)) : null;
    const pasted = decoded ? pasteGraph(createEmptyBoard(later), decoded, { x: 80, y: 80 }, new Set(), 0, later) : null;
    const copy = pasted && !('error' in pasted) ? pasted.nodes.find((node) => node.kind === 'website') : null;
    expect(copy?.kind === 'website' ? copy.url : '').toBe(site.url);
    expect(copy?.kind === 'website' ? copy.title : '').toBe('Path');
    expect(copy?.kind === 'website' ? copy.lastEditedAt : '').toBe(later);
    expect(copy?.id === 'site').toBe(false);
    const packed = await buildArchive(addNodes(createEmptyBoard(now), [site], now), [], now);
    const opened = await readArchive(packed);
    if ('error' in opened) throw new Error(opened.error);
    expect(opened.assets).toHaveLength(0);
    const restored = opened.board.nodes.find((node) => node.kind === 'website');
    expect(restored?.kind === 'website' ? restored.url : '').toBe(site.url);
    expect(restored?.kind === 'website' ? restored.title : '').toBe('Path');
    const files = unzipSync(packed);
    const manifest = JSON.parse(new TextDecoder().decode(files['manifest.json'] ?? new Uint8Array())) as { archiveVersion: number };
    manifest.archiveVersion = 1;
    files['manifest.json'] = strToU8(JSON.stringify(manifest));
    const legacy = await readArchive(zipSync(files));
    expect('error' in legacy ? legacy.error : legacy.board.schemaVersion).toBe(14);
    const oldBoard = parseBoard({ ...createEmptyBoard(now), schemaVersion: 11, nodes: [note], physicsEnabled: false });
    expect(oldBoard?.nodes.some((node) => node.kind === 'text')).toBe(true);
    expect(oldBoard?.nodes.some((node) => node.kind === 'website')).toBe(false);
  });
});

import { describe, expect, test } from 'bun:test';
import { ARCHIVE_VERSION } from '../archive/format';
import { buildArchive, readArchive } from '../archive/zip';
import {
  addNodes,
  createEmptyBoard,
  createEmbeddedImageNode,
  createExternalImageNode,
  createTextNode,
  parseBoard,
  placeNode,
  setAppearance,
  setCodeLanguage,
  setCornerStyle,
  setImageMode,
  setImageRotation,
  setNoteTone,
  setPresentation,
  setViewport,
  toggleImageFlip,
  updateText,
  withInsertedTimestamp,
} from '../domain/board';
import { connectNodes } from '../domain/graph';
import { decodeGraphClipboard, encodeGraphClipboard, GRAPH_CLIPBOARD_VERSION, pasteGraph, selectionClosure } from '../domain/graph-clipboard';
import { duplicateSelection, groupSelection, ungroup } from '../domain/groups';
import { createHistory, pushHistory, redoHistory, undoHistory } from '../domain/history';
import { formatNodeDate, parseStoredTimestamp } from '../domain/node-date';
import { contentSignature, resultBounds } from '../domain/search';
import { SCHEMA_VERSION, type BoardNode } from '../domain/types';
import { worldBounds } from '../domain/geometry';
import { interpretDateQuery } from '../search/date-query';
import { buildContentIndex, queryBoard } from '../search/query';

const now = '2026-04-15T08:00:00.000Z';
const later = '2026-04-15T09:00:00.000Z';
const clock = new Date(2026, 3, 15, 12, 0, 0);

function editedAt(board: { nodes: readonly BoardNode[] }, id: string): string | undefined {
  const node = board.nodes.find((entry) => entry.id === id);
  return node && node.kind !== 'group' ? node.lastEditedAt : undefined;
}

function text(id: string, text = 'Hello', edited = now): BoardNode {
  return { ...createTextNode({ x: 10, y: 20 }, text, edited), id };
}

describe('node dates and natural-language search', () => {
  test('stamps text only when the words change and leaves images dated at insertion', () => {
    const note = createTextNode({ x: 40, y: 40 }, 'Start', now);
    const image = createEmbeddedImageNode({ center: { x: 80, y: 80 }, assetId: 'asset', intrinsicWidth: 200, intrinsicHeight: 100, now });
    expect(note.lastEditedAt).toBe(now);
    expect(image.lastEditedAt).toBe(now);
    const board = addNodes(createEmptyBoard(now), [note, image, { id: 'group', kind: 'group', x: 0, y: 0, width: 200, height: 160, label: 'Cluster' }], now);
    const edited = updateText(board, note.id, 'Changed', later);
    expect(editedAt(edited, note.id)).toBe(later);
    expect(updateText(edited, note.id, 'Changed', '2026-05-01T00:00:00.000Z')).toBe(edited);
    const checked = updateText(edited, note.id, '- [x] Changed', later);
    expect(editedAt(checked, note.id)).toBe(later);
    const coded = updateText(setPresentation(checked, note.id, 'code', later), note.id, 'const n = 1', '2026-04-16T00:00:00.000Z');
    expect(editedAt(coded, note.id)).toBe('2026-04-16T00:00:00.000Z');
    const moved = placeNode(coded, note.id, { x: 30, y: 40 });
    const resized = placeNode(moved, image.id, { width: 120, height: 80 });
    expect(editedAt(resized, note.id)).toBe('2026-04-16T00:00:00.000Z');
    expect(editedAt(resized, image.id)).toBe(now);
    const styled = setCornerStyle(setImageMode(toggleImageFlip(setImageRotation(resized, image.id, 30, later), image.id, 'x', later), image.id, 'stretch', later), image.id, 'square', later);
    const toned = setCodeLanguage(setNoteTone(setPresentation(styled, note.id, 'text', later), note.id, 'text', 'muted'), note.id, 'plain', later);
    const linked = connectNodes(toned, note.id, image.id, 'right', 'left', later) ?? toned;
    const grouped = groupSelection(linked, [note.id], later);
    const groupedBoard = 'error' in grouped ? linked : grouped.board;
    const loose = ungroup(groupedBoard, groupedBoard.nodes.filter((node) => node.kind === 'group').map((node) => node.id), later);
    expect(editedAt(loose, image.id)).toBe(now);
    expect(editedAt(loose, note.id)).toBe('2026-04-16T00:00:00.000Z');
    const titled = setViewport(setAppearance(loose, 'light', later), { x: 3, y: 4, zoom: 1.2 }, later);
    expect(editedAt(titled, image.id)).toBe(now);
    const undone = undoHistory(pushHistory(createHistory(), board), edited);
    expect(undone ? editedAt(undone.board, note.id) : '').toBe(now);
    const redone = undone ? redoHistory(undone.history, undone.board) : null;
    expect(redone ? editedAt(redone.board, note.id) : '').toBe(later);
    const duplicated = duplicateSelection(board, [note.id], later);
    const copy = duplicated.nodes.find((node) => node.kind === 'text' && node.id !== note.id);
    expect(copy?.kind === 'text' ? copy.lastEditedAt : '').toBe(later);
    expect(editedAt(duplicated, note.id)).toBe(now);
    expect(SCHEMA_VERSION).toBe(10);
    expect(ARCHIVE_VERSION).toBe(1);
    expect(GRAPH_CLIPBOARD_VERSION).toBe(1);
  });

  test('keeps legacy dates absent and accepts only real timestamps', async () => {
    const undated = text('old', 'Keep');
    if (undated.kind === 'text') delete undated.lastEditedAt;
    const legacy = parseBoard({ ...createEmptyBoard(now), schemaVersion: 8, nodes: [undated, { id: 'pic', kind: 'image', x: 0, y: 0, width: 40, height: 40, mode: 'aspect', intrinsicWidth: 40, intrinsicHeight: 40, sizedFromImage: true, source: { type: 'external', url: 'https://example.com/a.png' }, rotation: 15 }] });
    const oldNote = legacy?.nodes.find((node) => node.id === 'old');
    const oldImage = legacy?.nodes.find((node) => node.id === 'pic');
    expect(legacy?.schemaVersion).toBe(10);
    expect(oldNote?.kind === 'text' ? oldNote.lastEditedAt : 'set').toBe(undefined);
    expect(oldImage?.kind === 'image' ? oldImage.lastEditedAt : 'set').toBe(undefined);
    expect(oldImage?.kind === 'image' ? oldImage.rotation : 0).toBe(15);
    expect(updateText(legacy ?? createEmptyBoard(now), 'old', 'Keep', later)).toBe(legacy);
    const dated = updateText(legacy ?? createEmptyBoard(now), 'old', 'Edited', later);
    expect(editedAt(dated, 'old')).toBe(later);
    expect(editedAt(placeNode(legacy ?? dated, 'pic', { width: 80 }), 'pic')).toBe(undefined);
    const contours = parseBoard({ ...createEmptyBoard(now), schemaVersion: 7, backgroundPattern: 'topographic-contours', topographicContours: { seed: 4, rendererVersion: 1 } });
    expect(contours?.topographicContours).toEqual({ seed: 4, rendererVersion: 1 });
    const atlas = parseBoard({ ...createEmptyBoard(now), schemaVersion: 8, backgroundPattern: 'dither-atlas', ditherAtlas: { seed: 3, rendererVersion: 2 } });
    expect(atlas?.ditherAtlas).toEqual({ seed: 3, rendererVersion: 2 });
    expect(parseBoard({ ...createEmptyBoard(now), nodes: [{ ...text('bad'), lastEditedAt: 'yesterday' }] })).toBeNull();
    expect(parseStoredTimestamp('2026-02-31T00:00:00.000Z')).toBeNull();
    const group = parseBoard({ ...createEmptyBoard(now), nodes: [{ id: 'g', kind: 'group', x: 0, y: 0, width: 100, height: 80, label: 'G', lastEditedAt: now }] });
    expect(group?.nodes[0] && 'lastEditedAt' in group.nodes[0]).toBe(false);
    const external = createExternalImageNode({ center: { x: 0, y: 0 }, url: 'https://example.com/a.png', intrinsicWidth: 20, intrinsicHeight: 20, sizedFromImage: true, now });
    const payload = selectionClosure(addNodes(createEmptyBoard(now), [external], now), [external.id]);
    const decoded = payload ? decodeGraphClipboard(encodeGraphClipboard(payload)) : null;
    expect(decoded?.nodes[0]?.kind === 'image' ? decoded.nodes[0].lastEditedAt : '').toBe(now);
    const pasted = payload ? pasteGraph(createEmptyBoard(now), payload, { x: 10, y: 10 }, new Set(), 0, later) : null;
    expect(pasted && !('error' in pasted) ? pasted.nodes[0]?.kind === 'image' && pasted.nodes[0].lastEditedAt : '').toBe(later);
    const archive = await readArchive(await buildArchive(addNodes(createEmptyBoard(now), [withInsertedTimestamp(external, now)], now), [], now));
    expect('error' in archive ? '' : archive.board.nodes[0]?.kind === 'image' && archive.board.nodes[0].lastEditedAt).toBe(now);
    const oldArchive = await readArchive(await buildArchive({ ...addNodes(createEmptyBoard(now), [external], now), schemaVersion: 8 } as never, [], now));
    expect('error' in oldArchive ? '' : oldArchive.board.schemaVersion).toBe(10);
  });

  test('formats relative dates without revising the board', () => {
    const board = createEmptyBoard(now);
    const current = new Date('2026-11-15T12:00:00.000Z');
    expect(formatNodeDate(undefined, current).label).toBe('-');
    expect(formatNodeDate(new Date(current.getTime() - 20_000).toISOString(), current).label.startsWith('just now | ')).toBe(true);
    expect(formatNodeDate(new Date(current.getTime() - 2 * 60_000).toISOString(), current).label.startsWith('2m ago | ')).toBe(true);
    expect(formatNodeDate(new Date(current.getTime() - 4 * 60 * 60_000).toISOString(), current).label.startsWith('4h ago | ')).toBe(true);
    expect(formatNodeDate(new Date(current.getTime() - 4 * 24 * 60 * 60_000).toISOString(), current).label.startsWith('4d ago | ')).toBe(true);
    expect(formatNodeDate(new Date(current.getTime() - 7 * 24 * 60 * 60_000).toISOString(), current).label.startsWith('1w ago | ')).toBe(true);
    expect(formatNodeDate(new Date(current.getTime() - 40 * 24 * 60 * 60_000).toISOString(), current).label.startsWith('1mo ago | ')).toBe(true);
    expect(formatNodeDate(new Date(current.getTime() - 400 * 24 * 60 * 60_000).toISOString(), current).label.startsWith('1y ago | ')).toBe(true);
    const yearBoundary = new Date(2026, 0, 1, 1, 0, 0);
    const previous = new Date(2025, 11, 31, 23, 0, 0);
    expect(formatNodeDate(previous.toISOString(), yearBoundary).label.startsWith('2h ago | 31/12')).toBe(true);
    const sample = new Date(Date.UTC(2026, 10, 14, 23, 30));
    const label = formatNodeDate(sample.toISOString(), new Date(sample.getTime() + 5 * 60_000));
    expect(label.label.includes(`${String(sample.getDate()).padStart(2, '0')}/${String(sample.getMonth() + 1).padStart(2, '0')}`)).toBe(true);
    expect(label.title.includes(String(sample.getFullYear()))).toBe(true);
    expect(formatNodeDate(now, current).label).toBe(formatNodeDate(now, current).label);
    expect(board.revision).toBe(createEmptyBoard(now).revision);
  });

  test('resolves calendar ranges and keeps text search beside them', () => {
    expect(clock.getDay()).toBe(3);
    const today = interpretDateQuery('today', clock);
    expect(today.range?.start).toBe(new Date(2026, 3, 15).getTime());
    expect(today.range?.end).toBe(new Date(2026, 3, 16).getTime());
    const yesterday = interpretDateQuery('yesterday', clock);
    expect(yesterday.range?.start).toBe(new Date(2026, 3, 14).getTime());
    const friday = interpretDateQuery('last friday', clock);
    expect(friday.range?.start).toBe(new Date(2026, 3, 10).getTime());
    expect(friday.range?.end).toBe(new Date(2026, 3, 11).getTime());
    const ago = interpretDateQuery('three days ago', clock);
    expect(ago.range?.start).toBe(new Date(2026, 3, 12).getTime());
    const lastWeek = interpretDateQuery('last week', clock);
    expect(lastWeek.range?.start).toBe(new Date(2026, 3, 6).getTime());
    expect(lastWeek.range?.end).toBe(new Date(2026, 3, 13).getTime());
    const past = interpretDateQuery('past 7 days', clock);
    expect(past.range?.start).toBe(new Date(2026, 3, 9).getTime());
    expect(past.range?.end).toBe(new Date(2026, 3, 16).getTime());
    const june = interpretDateQuery('june', clock);
    expect(june.range?.start).toBe(new Date(2025, 5, 1).getTime());
    expect(june.range?.end).toBe(new Date(2025, 6, 1).getTime());
    const named = interpretDateQuery('june 2025', clock);
    expect(named.range?.start).toBe(new Date(2025, 5, 1).getTime());
    expect(named.range?.end).toBe(new Date(2025, 6, 1).getTime());
    const recentJune = interpretDateQuery('june', new Date(2026, 7, 2, 12));
    expect(recentJune.range?.start).toBe(new Date(2026, 5, 1).getTime());
    const slash = interpretDateQuery('14/11', clock);
    expect(slash.range?.start).toBe(new Date(2025, 10, 14).getTime());
    const exact = interpretDateQuery('14/11/2025', clock);
    expect(exact.range?.start).toBe(new Date(2025, 10, 14).getTime());
    expect(exact.range?.end).toBe(new Date(2025, 10, 15).getTime());
    const year = interpretDateQuery('2025', clock);
    expect(year.range?.start).toBe(new Date(2025, 0, 1).getTime());
    expect(year.range?.end).toBe(new Date(2026, 0, 1).getTime());
    expect(interpretDateQuery('project roadmap', clock).range).toBeNull();
    expect(interpretDateQuery('may need fixing', clock).range).toBeNull();
    expect(interpretDateQuery('edited:nope', clock).invalid).toBe(true);
    const nodes: BoardNode[] = [
      text('plan', 'Project planning', '2025-06-02T12:00:00.000Z'),
      text('road', 'June roadmap', '2026-04-01T12:00:00.000Z'),
      text('blank', 'Holiday plans'),
      { ...createEmbeddedImageNode({ center: { x: 0, y: 0 }, assetId: 'a', intrinsicWidth: 10, intrinsicHeight: 10, now: '2025-06-20T00:00:00.000Z' }), id: 'shot' },
      { id: 'cluster', kind: 'group', x: 0, y: 0, width: 100, height: 80, label: 'June cluster' },
    ];
    delete (nodes[2] as { lastEditedAt?: string }).lastEditedAt;
    const outcome = queryBoard(nodes, buildContentIndex(nodes), 'june', new Date(2026, 3, 15, 12));
    expect(outcome.results.filter((hit) => hit.section === 'date').map((hit) => hit.id)).toEqual(['shot', 'plan']);
    expect(outcome.results.some((hit) => hit.id === 'plan' && hit.section === 'content')).toBe(false);
    expect(outcome.results.some((hit) => hit.section === 'content' && hit.id === 'road')).toBe(true);
    expect(outcome.results.some((hit) => hit.id === 'cluster' && hit.section === 'date')).toBe(false);
    expect(queryBoard(nodes, buildContentIndex(nodes), 'edited:june', new Date(2026, 3, 15)).results.every((hit) => hit.section === 'date')).toBe(true);
    const accented = queryBoard([{ ...text('cafe', 'Café notes', now) }], buildContentIndex([{ ...text('cafe', 'Café notes', now) }]), 'cafe', clock);
    expect(accented.results[0]?.id).toBe('cafe');
    const fuzzy = queryBoard([text('title', 'Atlas plan', now)], buildContentIndex([text('title', 'Atlas plan', now)]), 'atls', clock);
    expect(fuzzy.results[0]?.id).toBe('title');
    const inside = queryBoard([text('code', 'function atlas() { return 1 }', now)], buildContentIndex([text('code', 'function atlas() { return 1 }', now)]), 'function', clock);
    expect(inside.results[0]?.id).toBe('code');
    const imageBounds = resultBounds(nodes, 'shot');
    expect(imageBounds).toEqual(worldBounds(nodes, nodes[3]));
    const groupBounds = resultBounds(nodes, 'cluster');
    expect(groupBounds).toEqual(worldBounds(nodes, nodes[4]));
    const moved = nodes.map((node) => node.id === 'plan' && node.kind === 'text' ? { ...node, x: node.x + 40 } : node);
    expect(contentSignature(moved)).toBe(contentSignature(nodes));
  });
});

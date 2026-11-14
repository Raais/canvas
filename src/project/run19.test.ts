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
  setCornerStyle,
  setImageMode,
  setImageRotation,
  toggleImageFlip,
} from '../domain/board';
import { decodeGraphClipboard, encodeGraphClipboard, GRAPH_CLIPBOARD_VERSION, selectionClosure } from '../domain/graph-clipboard';
import { duplicateSelection, groupSelection } from '../domain/groups';
import { createHistory, pushHistory, redoHistory, undoHistory } from '../domain/history';
import {
  cancelRotationDrag,
  coverScale,
  finishRotationDrag,
  imageContentTransform,
  mayCommitRotation,
  moveRotationDrag,
  normalizeRotation,
  nudgeRotation,
  pendingRotationBlocksReplacement,
  startRotationDrag,
} from '../domain/image-rotation';
import { SCHEMA_VERSION, type Board, type ImageNode } from '../domain/types';
import { decidePwaUpdate, type PwaUpdateInput } from './pwa-update';
import { placeRotationPanel } from '../components/rotation-placement';

declare const Bun: { file(path: URL): { text(): Promise<string> } };

const now = '2026-11-14T00:00:00.000Z';

function rotationOf(board: Pick<Board, 'nodes'> | null | undefined, id: string): number | undefined {
  const node = board?.nodes.find((entry) => entry.id === id);
  return node?.kind === 'image' ? node.rotation : undefined;
}

function picture(id = 'pic'): ImageNode {
  return {
    ...createEmbeddedImageNode({ center: { x: 40, y: 50 }, assetId: 'asset-1', intrinsicWidth: 320, intrinsicHeight: 200 }),
    id,
    flipX: true,
    cornerStyle: 'square',
  };
}

const ready: PwaUpdateInput = {
  editingNote: false,
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
};

describe('image content rotation', () => {
  test('fills a fixed frame and composes with flips', () => {
    expect(coverScale(320, 200, 0)).toBe(1);
    expect(coverScale(320, 200, 180)).toBe(1);
    expect(coverScale(320, 200, -180)).toBe(1);
    expect(Math.abs(coverScale(200, 200, 90) - 1) < 0.000001).toBe(true);
    expect(coverScale(320, 200, 15)).toBeGreaterThan(1);
    expect(coverScale(320, 200, -15)).toBeGreaterThan(1);
    expect(coverScale(200, 320, 15)).toBeGreaterThan(1);
    expect(coverScale(320, 200, 45)).toBeGreaterThan(coverScale(320, 200, 15));
    expect(coverScale(320, 200, 90)).toBeGreaterThan(1);
    expect(Number.isFinite(coverScale(1000, 1, 45))).toBe(true);
    expect(coverScale(0, 20, 30)).toBe(1);
    expect(coverScale(20, Number.NaN, 30)).toBe(1);
    expect(normalizeRotation(190)).toBe(-170);
    expect(normalizeRotation(-190)).toBe(170);
    expect(nudgeRotation(170, 15)).toBe(-175);
    expect(nudgeRotation(-170, -15)).toBe(175);
    expect(normalizeRotation(Number.POSITIVE_INFINITY)).toBeNull();
    expect(imageContentTransform({ width: 320, height: 200, degrees: 0, flipX: false, flipY: false })).toBe('scale(1, 1)');
    expect(imageContentTransform({ width: 320, height: 200, degrees: 0, flipX: true, flipY: true })).toBe('scale(-1, -1)');
    const turned = imageContentTransform({ width: 320, height: 200, degrees: 90, flipX: true, flipY: false });
    expect(turned.startsWith('rotate(90deg) scale(-')).toBe(true);
    expect(SCHEMA_VERSION).toBe(8);
    expect(ARCHIVE_VERSION).toBe(1);
    expect(GRAPH_CLIPBOARD_VERSION).toBe(1);
  });

  test('stores a normalized angle and migrates older boards', () => {
    const board = addNodes(createEmptyBoard(now), [picture()], now);
    const image = board.nodes.find((node) => node.kind === 'image');
    expect(image?.kind === 'image' ? image.rotation : 1).toBe(undefined);
    const turned = setImageRotation(board, 'pic', 27.2, now);
    const node = turned.nodes.find((entry) => entry.id === 'pic');
    expect(node?.kind === 'image' ? node.rotation : 0).toBe(27);
    expect(node?.x).toBe(image?.x);
    expect(node?.width).toBe(image?.width);
    expect(turned.edges).toEqual(board.edges);
    expect(setImageRotation(board, 'note', 20, now)).toBe(board);
    const withNote = addNodes(board, [createTextNode({ x: 0, y: 0 })], now);
    expect(setImageRotation(withNote, withNote.nodes.find((entry) => entry.kind === 'text')?.id ?? '', 10, now)).toBe(withNote);
    expect(setImageRotation(turned, 'pic', 27, now)).toBe(turned);
    const reset = setImageRotation(turned, 'pic', 0, now);
    expect(rotationOf(reset, 'pic')).toBe(undefined);
    expect(setImageRotation(board, 'pic', Number.NaN, now)).toBe(board);
    const undone = undoHistory(pushHistory(createHistory(), board), turned);
    expect(rotationOf(undone?.board, 'pic')).toBe(undefined);
    const redone = undone ? redoHistory(undone.history, undone.board) : null;
    expect(rotationOf(redone?.board, 'pic')).toBe(27);
    const flipped = toggleImageFlip(turned, 'pic', 'y', now);
    const flippedNode = flipped.nodes.find((entry) => entry.id === 'pic');
    expect(flippedNode?.kind === 'image' && flippedNode.rotation).toBe(27);
    expect(flippedNode?.kind === 'image' && flippedNode.flipY).toBe(true);
    const stretched = setImageMode(turned, 'pic', 'stretch', now);
    const squared = setCornerStyle(stretched, 'pic', 'square', now);
    const styled = squared.nodes.find((entry) => entry.id === 'pic');
    expect(styled?.kind === 'image' && styled.mode).toBe('stretch');
    expect(styled?.kind === 'image' && styled.cornerStyle).toBe('square');
    expect(styled?.kind === 'image' && styled.rotation).toBe(27);

    const legacy = parseBoard({ ...createEmptyBoard(now), schemaVersion: 7 });
    expect(legacy?.schemaVersion).toBe(8);
    expect(legacy?.ditherAtlas?.rendererVersion).toBe(3);
    const contours = parseBoard({
      ...createEmptyBoard(now),
      schemaVersion: 7,
      backgroundPattern: 'topographic-contours',
      topographicContours: { seed: 7, rendererVersion: 1 },
    });
    expect(contours?.topographicContours).toEqual({ seed: 7, rendererVersion: 1 });
    const kept = parseBoard({
      ...createEmptyBoard(now),
      schemaVersion: 7,
      nodes: [picture('solo')],
      savedViews: [{ id: 'view', name: 'Here', viewport: { x: 1, y: 2, zoom: 1 } }],
    });
    const keptImage = kept?.nodes.find((entry) => entry.kind === 'image');
    expect(kept?.schemaVersion).toBe(8);
    expect(keptImage?.kind === 'image' ? keptImage.rotation : 1).toBe(undefined);
    expect(keptImage?.kind === 'image' && keptImage.flipX).toBe(true);
    expect(keptImage?.kind === 'image' && keptImage.cornerStyle).toBe('square');
    expect(kept?.savedViews).toHaveLength(1);
    expect(parseBoard({ ...turned, nodes: turned.nodes.map((entry) => entry.kind === 'image' ? { ...entry, rotation: 181 } : entry) })).toBeNull();
    expect(rotationOf(parseBoard(turned), 'pic')).toBe(27);
  });

  test('keeps the angle through clipboard, duplication, and archives', async () => {
    const external = createExternalImageNode({
      center: { x: 10, y: 12 },
      url: 'https://example.com/photo.png',
      intrinsicWidth: 300,
      intrinsicHeight: 200,
      sizedFromImage: true,
    });
    const embedded = picture('inside');
    const board = setImageRotation(addNodes(createEmptyBoard(now), [embedded, external], now), 'inside', 33, now);
    const rotatedExternal = setImageRotation(board, external.id, -12, now);
    const payload = selectionClosure(rotatedExternal, ['inside']);
    const decoded = payload ? decodeGraphClipboard(encodeGraphClipboard(payload)) : null;
    expect(rotationOf(decoded, 'inside')).toBe(33);
    const legacyPayload = selectionClosure(addNodes(createEmptyBoard(now), [picture('plain')], now), ['plain']);
    const legacy = legacyPayload ? decodeGraphClipboard(encodeGraphClipboard(legacyPayload)) : null;
    expect(rotationOf(legacy, 'plain')).toBe(undefined);
    const broken = payload ? encodeGraphClipboard(payload).replace('"rotation":33', '"rotation":999') : '';
    expect(decodeGraphClipboard(broken)).toBeNull();
    const pasted = payload ? decodeGraphClipboard(encodeGraphClipboard(payload)) : null;
    expect(rotationOf(pasted, pasted?.nodes[0]?.id ?? '')).toBe(33);
    const duplicated = duplicateSelection(rotatedExternal, ['inside'], now);
    const previous = new Set(rotatedExternal.nodes.map((node) => node.id));
    const clone = duplicated.nodes.find((node) => !previous.has(node.id));
    expect(clone?.kind === 'image' ? clone.rotation : 0).toBe(33);
    const grouped = groupSelection(rotatedExternal, ['inside'], now);
    expect(rotationOf('error' in grouped ? null : grouped.board, 'inside')).toBe(33);
    const outside = { ...external, id: 'outside', x: 400 };
    const zipBoard = setImageRotation(setImageRotation(addNodes(createEmptyBoard(now), [outside, { ...external, id: 'web', x: 700 }], now), 'outside', 33, now), 'web', -12, now);
    const archive = await readArchive(await buildArchive(zipBoard, [], now));
    expect('error' in archive).toBe(false);
    if (!('error' in archive)) {
      expect(archive.board.schemaVersion).toBe(8);
      expect(rotationOf(archive.board, 'outside')).toBe(33);
      expect(rotationOf(archive.board, 'web')).toBe(-12);
    }
    const legacyBoard = { ...addNodes(createEmptyBoard(now), [{ ...external, id: 'old' }], now), schemaVersion: 7 } as unknown as Board;
    const legacyArchive = await readArchive(await buildArchive(legacyBoard, [], now));
    expect('error' in legacyArchive).toBe(false);
    if (!('error' in legacyArchive)) {
      expect(legacyArchive.board.schemaVersion).toBe(8);
      expect(rotationOf(legacyArchive.board, 'old')).toBe(undefined);
    }
    const invalid = parseBoard({ ...rotatedExternal, nodes: rotatedExternal.nodes.map((node) => node.kind === 'image' && node.id === 'inside' ? { ...node, rotation: 'sideways' } : node) });
    expect(invalid).toBeNull();
  });

  test('commits one slider gesture and blocks unsafe updates', () => {
    const board = addNodes(createEmptyBoard(now), [picture()], now);
    let drag = startRotationDrag(0);
    drag = moveRotationDrag(drag, 12);
    drag = moveRotationDrag(drag, 28);
    drag = moveRotationDrag(drag, 41);
    expect(drag.preview).toBe(41);
    expect(board.revision).toBe(addNodes(createEmptyBoard(now), [picture()], now).revision);
    const finished = finishRotationDrag(drag);
    expect(finished.commit).toBe(true);
    const committed = setImageRotation(board, 'pic', finished.angle, now);
    const history = pushHistory(createHistory(), board);
    expect(history.past).toHaveLength(1);
    expect(rotationOf(committed, 'pic')).toBe(41);
    expect(cancelRotationDrag(moveRotationDrag(startRotationDrag(8), 50))).toBe(8);
    expect(mayCommitRotation(true)).toBe(false);
    expect(mayCommitRotation(false)).toBe(true);
    expect(decidePwaUpdate({ ...ready, adjustingRotation: true }).action).toBe('block');
    expect(pendingRotationBlocksReplacement(true)).toBe(true);
    expect(pendingRotationBlocksReplacement(false)).toBe(false);
    expect(setImageRotation(board, 'pic', 0, now)).toBe(board);
  });

  test('keeps the rotation panel above the image and inside the viewport', async () => {
    const above = placeRotationPanel(
      { top: 200, right: 420, bottom: 240, left: 100 },
      { width: 220, height: 140 },
      { width: 1000, height: 800 },
    );
    expect(above).toEqual({ top: 54, left: 100, maxHeight: 784 });
    const flipped = placeRotationPanel(
      { top: 10, right: 320, bottom: 50, left: 100 },
      { width: 220, height: 140 },
      { width: 1000, height: 800 },
    );
    expect(flipped.top).toBe(56);
    const shifted = placeRotationPanel(
      { top: 200, right: 990, bottom: 240, left: 900 },
      { width: 220, height: 140 },
      { width: 1000, height: 800 },
    );
    expect(shifted.left).toBe(772);
    const clamped = placeRotationPanel(
      { top: 4, right: 40, bottom: 40, left: -30 },
      { width: 220, height: 140 },
      { width: 1000, height: 120 },
    );
    expect(clamped.top).toBe(8);
    expect(clamped.left).toBe(8);
    expect(clamped.maxHeight).toBe(104);
    const css = await Bun.file(new URL('../styles/app.css', import.meta.url)).text();
    const node = await Bun.file(new URL('../components/ImageNoteNode.tsx', import.meta.url)).text();
    expect(css.includes('.image-tools { z-index: 5; }')).toBe(true);
    expect(css.includes('top: calc(100% + 6px)')).toBe(false);
    expect(node.includes('popover="manual"')).toBe(true);
    expect(node.includes('<NodeToolbar')).toBe(true);
    const group = await Bun.file(new URL('../components/GroupNode.tsx', import.meta.url)).text();
    expect(group.includes('<NodeToolbar')).toBe(true);
    expect(css.includes('transform: translateY(calc(-100% - 6px))')).toBe(false);
  });
});

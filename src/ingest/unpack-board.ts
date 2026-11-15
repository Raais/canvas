import { EMBEDDED_ASSET_BUDGET } from './admission';
import { canonicalRasterMime } from './clipboard';
import { readRasterDimensions } from './image-optimizer-config';
import {
  addNodes,
  createEmbeddedImageNode,
  createFileNode,
  createTextNode,
  referencedAssetIds,
  staggeredPositions,
} from '../domain/board';
import { classifyIncomingFile, decodeTextFile, fileExtension, sanitizeFilename } from '../domain/files';
import { groupSelection } from '../domain/groups';
import { worldTopLeft } from '../domain/geometry';
import { extractionGroupLabel } from '../domain/suitcase';
import { createAssetRecord } from '../persistence/db';
import type { AssetRecord, Board, BoardNode, Point } from '../domain/types';

export type UnpackedBytes = {
  path: string;
  bytes: Uint8Array;
};

export function materializeUnpacked(entries: readonly UnpackedBytes[]): { pieces: PreparedPiece[] } | { error: string } {
  const pieces: PreparedPiece[] = [];
  for (const entry of entries) {
    const leaf = sanitizeFilename(entry.path);
    if (!leaf) return { error: 'A file in that ZIP has a name that cannot be used.' };
    const file = { name: leaf, size: entry.bytes.byteLength, type: '' };
    const decision = classifyIncomingFile(file);
    if (decision.kind === 'reject') return { error: 'A file in that ZIP cannot be added.' };
    if (decision.kind === 'text') {
      const decoded = decodeTextFile(entry.bytes);
      if (decoded === null) {
        pieces.push({ kind: 'file', path: entry.path, filename: leaf, bytes: entry.bytes, mimeType: 'application/octet-stream' });
        continue;
      }
      pieces.push({
        kind: 'text',
        path: entry.path,
        filename: leaf,
        text: decoded,
        presentation: decision.presentation,
        ...(decision.codeLanguage ? { codeLanguage: decision.codeLanguage } : {}),
        ...(decision.language ? { language: decision.language } : {}),
      });
      continue;
    }
    if (decision.kind === 'image') {
      const mimeType = canonicalRasterMime(mimeForExtension(fileExtension(leaf))) ?? mimeForExtension(fileExtension(leaf));
      const measured = mimeType ? readRasterDimensions(entry.bytes, mimeType) : null;
      if (!mimeType || !measured) {
        pieces.push({ kind: 'file', path: entry.path, filename: leaf, bytes: entry.bytes, mimeType: 'application/octet-stream' });
        continue;
      }
      pieces.push({ kind: 'image', path: entry.path, filename: leaf, bytes: entry.bytes, mimeType, width: measured.width, height: measured.height });
      continue;
    }
    pieces.push({ kind: 'file', path: entry.path, filename: leaf, bytes: entry.bytes, mimeType: decision.mimeType });
  }
  return { pieces };
}

export function commitUnpacked(input: {
  board: Board;
  suitcaseId: string;
  pieces: readonly PreparedPiece[];
  group: boolean;
  now: string;
  assets?: readonly { id: string; byteSize: number }[];
}): { board: Board; assets: AssetRecord[]; nodeIds: string[] } | { error: string } {
  const suitcase = input.board.nodes.find((node) => node.id === input.suitcaseId);
  if (!suitcase || suitcase.kind !== 'suitcase') return { error: 'That ZIP suitcase is no longer on the board.' };
  if (input.pieces.length === 0) return { error: 'Select a file to unpack.' };
  const existing = new Set(referencedAssetIds(input.board));
  const known = new Map((input.assets ?? []).map((asset) => [asset.id, asset.byteSize]));
  let used = 0;
  for (const id of existing) used += known.get(id) ?? 0;
  let incoming = 0;
  for (const piece of input.pieces) {
    if (piece.kind === 'text') incoming += new TextEncoder().encode(piece.text).byteLength;
    else incoming += piece.bytes.byteLength;
  }
  if (used + incoming > EMBEDDED_ASSET_BUDGET) return { error: 'Unpacking those files would make the board too large to export.' };
  const origin = unpackOrigin(input.board, suitcase);
  const positions = staggeredPositions(origin, input.pieces.length);
  const assets: AssetRecord[] = [];
  const nodes: BoardNode[] = [];
  input.pieces.forEach((piece, index) => {
    const center = positions[index] ?? origin;
    if (piece.kind === 'text') {
      const node = createTextNode(center, piece.text, input.now, {
        ...(piece.presentation ? { presentation: piece.presentation } : {}),
        ...(piece.codeLanguage ? { codeLanguage: piece.codeLanguage } : {}),
        ...(piece.language ? { language: piece.language } : {}),
        sourceFilename: piece.filename,
      });
      nodes.push(piece.path === piece.filename ? node : { ...node, sourcePath: piece.path });
      return;
    }
    const blob = bytesToBlob(piece.bytes, piece.mimeType);
    const asset = createAssetRecord(blob, piece.mimeType, input.now);
    assets.push(asset);
    if (piece.kind === 'image') {
      const node = createEmbeddedImageNode({
        center,
        assetId: asset.id,
        intrinsicWidth: piece.width,
        intrinsicHeight: piece.height,
        now: input.now,
      });
      nodes.push({ ...node, sourcePath: piece.path });
      return;
    }
    const node = createFileNode({ center, assetId: asset.id, filename: piece.filename, now: input.now });
    nodes.push(piece.path === piece.filename ? node : { ...node, sourcePath: piece.path });
  });
  let next = addNodes(input.board, nodes, input.now);
  const nodeIds = nodes.map((node) => node.id);
  if (input.group && nodes.length > 1) {
    const grouped = groupSelection(next, nodeIds, input.now);
    if ('error' in grouped) return grouped;
    const group = grouped.board.nodes.find((node) => node.kind === 'group' && !input.board.nodes.some((entry) => entry.id === node.id));
    next = group
      ? {
          ...grouped.board,
          nodes: grouped.board.nodes.map((node) => node.id === group.id && node.kind === 'group'
            ? { ...node, label: extractionGroupLabel(suitcase.filename) }
            : node),
        }
      : grouped.board;
    if (group) nodeIds.push(group.id);
  }
  return { board: next, assets, nodeIds };
}

export function unpackOrigin(board: Board, suitcase: { id: string; width: number }): Point {
  const node = board.nodes.find((entry) => entry.id === suitcase.id);
  if (!node) return { x: suitcase.width + 48, y: 40 };
  const world = worldTopLeft(board.nodes, node);
  return { x: world.x + node.width + 48, y: world.y + 40 };
}

type PreparedPiece =
  | {
      kind: 'text';
      path: string;
      filename: string;
      text: string;
      presentation?: 'text' | 'markdown' | 'code';
      codeLanguage?: 'javascript' | 'typescript' | 'python' | 'json' | 'html' | 'css' | 'shell' | 'plain';
      language?: string;
    }
  | { kind: 'file'; path: string; filename: string; bytes: Uint8Array; mimeType: string }
  | { kind: 'image'; path: string; filename: string; bytes: Uint8Array; mimeType: string; width: number; height: number };

function mimeForExtension(extension: string): string {
  if (extension === 'png') return 'image/png';
  if (extension === 'jpg' || extension === 'jpeg') return 'image/jpeg';
  if (extension === 'webp') return 'image/webp';
  if (extension === 'gif') return 'image/gif';
  if (extension === 'avif') return 'image/avif';
  if (extension === 'pdf') return 'application/pdf';
  if (extension === 'webm') return 'video/webm';
  if (extension === 'mp3') return 'audio/mpeg';
  if (extension === 'wav') return 'audio/wav';
  if (extension === 'zip') return 'application/zip';
  return 'application/octet-stream';
}

function bytesToBlob(bytes: Uint8Array, mimeType: string): Blob {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return new Blob([copy.buffer], { type: mimeType });
}

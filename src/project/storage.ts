import { referencedAssetIds } from '../domain/board';
import type { AssetRecord, Board } from '../domain/types';

export type LogicalUsage = {
  assetBytes: number;
  documentBytes: number;
  totalBytes: number;
  embeddedAssets: number;
  externalImages: number;
  notes: number;
  groups: number;
  links: number;
};

export function logicalUsage(board: Board, assets: readonly { id: string; byteSize: number }[]): LogicalUsage {
  const sizes = new Map(assets.map((asset) => [asset.id, asset.byteSize]));
  let assetBytes = 0;
  for (const id of referencedAssetIds(board)) assetBytes += sizes.get(id) ?? 0;
  let externalImages = 0;
  let notes = 0;
  let groups = 0;
  for (const node of board.nodes) {
    if (node.kind === 'group') groups += 1;
    else notes += 1;
    if (node.kind === 'image' && node.source.type === 'external') externalImages += 1;
  }
  const documentBytes = new TextEncoder().encode(JSON.stringify(board)).length;
  return {
    assetBytes,
    documentBytes,
    totalBytes: assetBytes + documentBytes,
    embeddedAssets: referencedAssetIds(board).size,
    externalImages,
    notes,
    groups,
    links: board.edges.length,
  };
}

export function boardSnapshotKey(board: Board): string {
  return JSON.stringify({
    id: board.id,
    title: board.title,
    nodes: board.nodes,
    edges: board.edges,
    viewport: board.viewport,
  });
}

export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return 'Unavailable';
  if (bytes < 1024) return `${Math.round(bytes)} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function formatOriginEstimate(estimate: { usage?: number; quota?: number } | null): {
  usage: string;
  quota: string;
  percent: string;
} {
  if (!estimate || estimate.usage === undefined || estimate.quota === undefined || estimate.quota <= 0) {
    return { usage: 'Unavailable', quota: 'Unavailable', percent: 'Unavailable' };
  }
  return {
    usage: formatBytes(estimate.usage),
    quota: formatBytes(estimate.quota),
    percent: `${Math.min(100, Math.round((estimate.usage / estimate.quota) * 100))}%`,
  };
}

export function snapshotAssets(board: Board, library: ReadonlyMap<string, AssetRecord>): { assets: AssetRecord[]; missing: string[] } {
  const assets: AssetRecord[] = [];
  const missing: string[] = [];
  for (const id of referencedAssetIds(board)) {
    const asset = library.get(id);
    if (!asset) missing.push(id);
    else assets.push(asset);
  }
  return { assets, missing };
}

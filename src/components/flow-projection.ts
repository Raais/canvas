import type { Edge } from '@xyflow/react';
import { lookupEmbeddedByteSize } from '../domain/image-size';
import { isContentNode } from '../domain/geometry';
import { isProtectedTextNode } from '../domain/text-protection';
import {
  GROUP_MIN_HEIGHT,
  GROUP_MIN_WIDTH,
  GROUP_PAD,
  type AssetRecord,
  type BoardEdge,
  type BoardNode,
} from '../domain/types';
import type { DrawingFlowNode } from './DrawingNode';
import type { FileFlowNode } from './FileNode';
import type { GroupFlowNode } from './GroupNode';
import type { ImageFlowNode } from './ImageNoteNode';
import type { TextFlowNode } from './TextNoteNode';
import type { SuitcaseFlowNode } from './SuitcaseNode';
import type { VoiceFlowNode } from './VoiceNoteNode';
import type { WebsiteFlowNode } from './WebsiteNode';

export type CanvasFlowNode = TextFlowNode | ImageFlowNode | FileFlowNode | WebsiteFlowNode | DrawingFlowNode | VoiceFlowNode | SuitcaseFlowNode | GroupFlowNode;

export type NodeProjectionInput = {
  selected: ReadonlySet<string>;
  editingId: string | null;
  readOnly: boolean;
  unlocked: ReadonlyMap<string, { text: string }>;
  registry: { get(id: string): string | null } | null;
  library: ReadonlyMap<string, AssetRecord>;
};

type Extent = { right: number; bottom: number };

type NodeCacheEntry = {
  node: BoardNode;
  selected: boolean;
  editing: boolean;
  readOnly: boolean;
  session: string;
  asset: string;
  extent: string;
  projected: CanvasFlowNode;
};

type EdgeCacheEntry = {
  edge: BoardEdge;
  selected: boolean;
  solo: boolean;
  projected: Edge;
};

export function createNodeProjection() {
  const cache = new Map<string, NodeCacheEntry>();
  return {
    project(nodes: readonly BoardNode[], input: NodeProjectionInput): CanvasFlowNode[] {
      const extents = groupExtents(nodes);
      const ordered = [...nodes].sort((left, right) => Number(left.kind !== 'group') - Number(right.kind !== 'group'));
      const seen = new Set<string>();
      const projected: CanvasFlowNode[] = [];
      for (const node of ordered) {
        seen.add(node.id);
        const selected = input.selected.has(node.id);
        const editing = input.editingId === node.id;
        const readOnly = node.kind === 'text' || node.kind === 'website' || node.kind === 'voice' ? input.readOnly : false;
        const session = sessionStamp(node, input.unlocked);
        const asset = assetStamp(node, input.registry, input.library);
        const extent = node.kind === 'group' ? (extents.get(node.id) ?? '') : '';
        const previous = cache.get(node.id);
        if (
          previous &&
          previous.node === node &&
          previous.selected === selected &&
          previous.editing === editing &&
          previous.readOnly === readOnly &&
          previous.session === session &&
          previous.asset === asset &&
          previous.extent === extent
        ) {
          projected.push(previous.projected);
          continue;
        }
        const next = toFlowNode(node, extents.get(node.id) ?? null, selected, editing, input);
        cache.set(node.id, {
          node,
          selected,
          editing,
          readOnly,
          session,
          asset,
          extent,
          projected: next,
        });
        projected.push(next);
      }
      for (const id of cache.keys()) {
        if (!seen.has(id)) cache.delete(id);
      }
      return projected;
    },
  };
}

export function createEdgeProjection() {
  const cache = new Map<string, EdgeCacheEntry>();
  let previous: Edge[] = [];
  return {
    project(edges: readonly BoardEdge[], selected: ReadonlySet<string>): Edge[] {
      const solo = selected.size === 1;
      const seen = new Set<string>();
      const next: Edge[] = [];
      let identical = edges.length === previous.length;
      for (let index = 0; index < edges.length; index += 1) {
        const edge = edges[index];
        if (!edge) continue;
        seen.add(edge.id);
        const isSelected = selected.has(edge.id);
        const cached = cache.get(edge.id);
        const projected = cached && cached.edge === edge && cached.selected === isSelected && cached.solo === solo
          ? cached.projected
          : projectEdge(edge, isSelected, solo);
        if (!cached || cached.projected !== projected) {
          cache.set(edge.id, { edge, selected: isSelected, solo, projected });
        }
        if (previous[index] !== projected) identical = false;
        next.push(projected);
      }
      for (const id of cache.keys()) {
        if (!seen.has(id)) cache.delete(id);
      }
      if (identical) return previous;
      previous = next;
      return next;
    },
  };
}

function projectEdge(edge: BoardEdge, selected: boolean, solo: boolean): Edge {
  return {
    id: edge.id,
    type: 'relationship',
    source: edge.sourceId,
    target: edge.targetId,
    sourceHandle: edge.sourceHandle,
    targetHandle: edge.targetHandle,
    selected,
    interactionWidth: 18,
    className: edge.style === 'dashed' ? 'relationship-dashed' : edge.style === 'red-string' ? 'relationship-string' : undefined,
    data: { label: edge.label, style: edge.style, solo },
  };
}

function groupExtents(nodes: readonly BoardNode[]): Map<string, string> {
  const boxes = new Map<string, Extent>();
  for (const node of nodes) {
    if (!isContentNode(node) || !node.parentId) continue;
    const box = boxes.get(node.parentId) ?? { right: 0, bottom: 0 };
    box.right = Math.max(box.right, node.x + node.width);
    box.bottom = Math.max(box.bottom, node.y + node.height);
    boxes.set(node.parentId, box);
  }
  const stamps = new Map<string, string>();
  for (const [id, box] of boxes) stamps.set(id, `${box.right}:${box.bottom}`);
  return stamps;
}

function sessionStamp(node: BoardNode, unlocked: ReadonlyMap<string, { text: string }>): string {
  if (!isProtectedTextNode(node)) return '';
  const session = unlocked.get(node.id);
  return session ? `1:${session.text}` : '0';
}

function assetStamp(
  node: BoardNode,
  registry: { get(id: string): string | null } | null,
  library: ReadonlyMap<string, AssetRecord>,
): string {
  if (node.kind === 'file') {
    const asset = library.get(node.assetId);
    return asset ? `file:${asset.byteSize}` : 'file:missing';
  }
  if (node.kind === 'suitcase') {
    const asset = library.get(node.assetId);
    return asset ? `suitcase:${asset.byteSize}` : 'suitcase:missing';
  }
  if (node.kind === 'voice') {
    const asset = library.get(node.assetId);
    return asset ? `voice:${asset.byteSize}:${asset.mimeType}` : 'voice:missing';
  }
  if (node.kind === 'image' && node.source.type === 'embedded') {
    const asset = library.get(node.source.assetId);
    return `image:${registry?.get(node.source.assetId) ?? ''}:${asset?.byteSize ?? ''}`;
  }
  return '';
}

function toFlowNode(
  node: BoardNode,
  extentStamp: string | null,
  selected: boolean,
  editing: boolean,
  input: NodeProjectionInput,
): CanvasFlowNode {
  const base = {
    id: node.id,
    position: { x: node.x, y: node.y },
    width: node.width,
    height: node.height,
    selected,
    parentId: isContentNode(node) ? node.parentId : undefined,
    zIndex: node.kind === 'group' ? 0 : node.kind === 'drawing' ? 2 : 1,
    draggable: node.kind !== 'text' || !editing,
    style: { width: node.width, height: node.height },
    measured: { width: node.width, height: node.height },
  };
  if (node.kind === 'group') {
    const extent = parseExtent(extentStamp);
    return {
      ...base,
      type: 'group',
      dragHandle: '.group-node',
      data: {
        label: node.label,
        minWidth: Math.max(GROUP_MIN_WIDTH, extent ? extent.right + GROUP_PAD : GROUP_MIN_WIDTH),
        minHeight: Math.max(GROUP_MIN_HEIGHT, extent ? extent.bottom + GROUP_PAD : GROUP_MIN_HEIGHT),
        backgroundTone: node.backgroundTone,
      },
    };
  }
  if (node.kind === 'text') {
    const protectedNote = isProtectedTextNode(node);
    return {
      ...base,
      type: 'text',
      data: {
        text: protectedNote ? (input.unlocked.get(node.id)?.text ?? '') : node.text,
        editing: protectedNote && !input.unlocked.has(node.id) ? false : editing,
        presentation: node.presentation ?? 'text',
        language: node.language,
        codeLanguage: node.codeLanguage,
        backgroundTone: node.backgroundTone,
        textTone: node.textTone,
        lastEditedAt: node.lastEditedAt,
        protected: protectedNote,
        unlocked: protectedNote && input.unlocked.has(node.id),
        readOnly: input.readOnly,
        sourceFilename: node.sourceFilename,
      },
    };
  }
  if (node.kind === 'drawing') {
    return {
      ...base,
      type: 'drawing',
      connectable: false,
      focusable: true,
      style: { ...base.style, pointerEvents: 'none' },
      data: {
        color: node.color,
        brush: node.brush,
        strokeWidth: node.strokeWidth,
        points: node.points,
        dot: node.points.length <= 2,
      },
    };
  }
  if (node.kind === 'voice') {
    return {
      ...base,
      type: 'voice',
      data: {
        title: node.title,
        durationMs: node.durationMs,
        missing: !input.library.has(node.assetId),
        readOnly: input.readOnly,
        lastEditedAt: node.lastEditedAt,
      },
    };
  }
  if (node.kind === 'website') {
    return {
      ...base,
      type: 'website',
      data: {
        url: node.url,
        title: node.title,
        lastEditedAt: node.lastEditedAt,
        readOnly: input.readOnly,
      },
    };
  }
  if (node.kind === 'file') {
    const asset = input.library.get(node.assetId);
    return {
      ...base,
      type: 'file',
      data: {
        filename: node.sourcePath ?? node.filename,
        sourcePath: node.sourcePath,
        byteSize: asset?.byteSize,
        missing: !asset,
        lastEditedAt: node.lastEditedAt,
      },
    };
  }
  if (node.kind === 'suitcase') {
    const asset = input.library.get(node.assetId);
    return {
      ...base,
      type: 'suitcase',
      data: {
        filename: node.filename,
        fileCount: node.fileCount,
        byteSize: asset?.byteSize,
        missing: !asset,
        readOnly: input.readOnly,
        lastEditedAt: node.lastEditedAt,
      },
    };
  }
  const src = node.source.type === 'external' ? node.source.url : (input.registry?.get(node.source.assetId) ?? null);
  return {
    ...base,
    type: 'image',
    data: {
      mode: node.mode,
      src,
      externalUrl: node.source.type === 'external' ? node.source.url : null,
      flipX: node.flipX === true,
      flipY: node.flipY === true,
      cornerStyle: node.cornerStyle === 'square' ? 'square' : 'rounded',
      rotation: node.rotation ?? 0,
      lastEditedAt: node.lastEditedAt,
      byteSize: lookupEmbeddedByteSize(node.source, input.library),
    },
  };
}

function parseExtent(stamp: string | null): Extent | null {
  if (!stamp) return null;
  const [right, bottom] = stamp.split(':');
  const parsedRight = Number(right);
  const parsedBottom = Number(bottom);
  if (!Number.isFinite(parsedRight) || !Number.isFinite(parsedBottom)) return null;
  return { right: parsedRight, bottom: parsedBottom };
}

import {
  FALLBACK_IMAGE_HEIGHT,
  FALLBACK_IMAGE_WIDTH,
  IMAGE_MAX_HEIGHT,
  IMAGE_MAX_WIDTH,
  IMAGE_MIN_EDGE,
  IMAGE_MIN_SIZE,
  TEXT_MIN_HEIGHT,
  TEXT_MIN_WIDTH,
  TEXT_NOTE_HEIGHT,
  TEXT_NOTE_WIDTH,
  type Board,
  type BoardEdge,
  type BoardNode,
  type ImageDisplayMode,
  type ImageNode,
  type Point,
  type TextNode,
  type Viewport,
} from './types';

const PASTE_STAGGER = 36;

export function createEmptyBoard(now = new Date().toISOString()): Board {
  return {
    schemaVersion: 1,
    id: crypto.randomUUID(),
    title: 'Untitled board',
    createdAt: now,
    updatedAt: now,
    revision: 1,
    nodes: [],
    edges: [],
    viewport: { x: 0, y: 0, zoom: 1 },
  };
}

export function createTextNode(center: Point, text = ''): TextNode {
  return {
    id: crypto.randomUUID(),
    kind: 'text',
    x: Math.round(center.x - TEXT_NOTE_WIDTH / 2),
    y: Math.round(center.y - TEXT_NOTE_HEIGHT / 2),
    width: TEXT_NOTE_WIDTH,
    height: TEXT_NOTE_HEIGHT,
    text,
  };
}

export function fitDisplaySize(width: number, height: number): { width: number; height: number } {
  if (!(width > 0) || !(height > 0) || !Number.isFinite(width) || !Number.isFinite(height)) {
    return { width: FALLBACK_IMAGE_WIDTH, height: FALLBACK_IMAGE_HEIGHT };
  }
  const scale = Math.min(IMAGE_MAX_WIDTH / width, IMAGE_MAX_HEIGHT / height, 1);
  let nextWidth = width * scale;
  let nextHeight = height * scale;
  const longest = Math.max(nextWidth, nextHeight);
  if (longest < IMAGE_MIN_EDGE) {
    const boost = IMAGE_MIN_EDGE / longest;
    nextWidth *= boost;
    nextHeight *= boost;
  }
  return {
    width: Math.max(IMAGE_MIN_SIZE, Math.round(nextWidth)),
    height: Math.max(IMAGE_MIN_SIZE, Math.round(nextHeight)),
  };
}

export function createEmbeddedImageNode(input: {
  center: Point;
  assetId: string;
  intrinsicWidth: number;
  intrinsicHeight: number;
}): ImageNode {
  const display = fitDisplaySize(input.intrinsicWidth, input.intrinsicHeight);
  return {
    id: crypto.randomUUID(),
    kind: 'image',
    x: Math.round(input.center.x - display.width / 2),
    y: Math.round(input.center.y - display.height / 2),
    width: display.width,
    height: display.height,
    mode: 'aspect',
    intrinsicWidth: input.intrinsicWidth,
    intrinsicHeight: input.intrinsicHeight,
    sizedFromImage: true,
    source: { type: 'embedded', assetId: input.assetId },
  };
}

export function createExternalImageNode(input: {
  center: Point;
  url: string;
  intrinsicWidth: number;
  intrinsicHeight: number;
  sizedFromImage: boolean;
}): ImageNode {
  const display = fitDisplaySize(input.intrinsicWidth, input.intrinsicHeight);
  return {
    id: crypto.randomUUID(),
    kind: 'image',
    x: Math.round(input.center.x - display.width / 2),
    y: Math.round(input.center.y - display.height / 2),
    width: display.width,
    height: display.height,
    mode: 'aspect',
    intrinsicWidth: input.intrinsicWidth,
    intrinsicHeight: input.intrinsicHeight,
    sizedFromImage: input.sizedFromImage,
    source: { type: 'external', url: input.url },
  };
}

export function staggeredPositions(origin: Point, count: number): Point[] {
  if (count <= 0) return [];
  const columns = Math.ceil(Math.sqrt(count));
  return Array.from({ length: count }, (_, index) => ({
    x: origin.x + (index % columns) * PASTE_STAGGER,
    y: origin.y + Math.floor(index / columns) * PASTE_STAGGER,
  }));
}

export function referencedAssetIds(board: Board): Set<string> {
  const ids = new Set<string>();
  for (const node of board.nodes) {
    if (node.kind === 'image' && node.source.type === 'embedded') ids.add(node.source.assetId);
  }
  return ids;
}

export function addNodes(board: Board, nodes: BoardNode[], now?: string): Board {
  if (nodes.length === 0) return board;
  return touch(board, { nodes: [...board.nodes, ...nodes] }, now);
}

export function renameBoard(board: Board, title: string, now?: string): Board {
  if (board.title === title) return board;
  return touch(board, { title }, now);
}

export function updateText(board: Board, id: string, text: string, now?: string): Board {
  return mapNode(board, id, (node) => {
    if (node.kind !== 'text' || node.text === text) return node;
    return { ...node, text };
  }, now);
}

export function setViewport(board: Board, viewport: Viewport, now?: string): Board {
  if (
    board.viewport.x === viewport.x &&
    board.viewport.y === viewport.y &&
    board.viewport.zoom === viewport.zoom
  ) {
    return board;
  }
  return touch(board, { viewport: { ...viewport } }, now);
}

export function placeNode(
  board: Board,
  id: string,
  patch: { x?: number; y?: number; width?: number; height?: number; lockImageSize?: boolean },
): Board {
  const nodes = board.nodes.map((node) => {
    if (node.id !== id) return node;
    const width = patch.width === undefined ? node.width : Math.max(minWidth(node), patch.width);
    const height = patch.height === undefined ? node.height : Math.max(minHeight(node), patch.height);
    const x = patch.x ?? node.x;
    const y = patch.y ?? node.y;
    if (node.kind === 'image') {
      const sizedFromImage = patch.lockImageSize ? true : node.sizedFromImage;
      if (
        x === node.x &&
        y === node.y &&
        width === node.width &&
        height === node.height &&
        sizedFromImage === node.sizedFromImage
      ) {
        return node;
      }
      return { ...node, x, y, width, height, sizedFromImage };
    }
    if (x === node.x && y === node.y && width === node.width && height === node.height) return node;
    return { ...node, x, y, width, height };
  });
  if (nodes.every((node, index) => node === board.nodes[index])) return board;
  return { ...board, nodes };
}

export function commitInteraction(board: Board, now = new Date().toISOString()): Board {
  return touch(board, {}, now);
}

export function setImageMode(board: Board, id: string, mode: ImageDisplayMode, now?: string): Board {
  return mapNode(board, id, (node) => {
    if (node.kind !== 'image' || node.mode === mode) return node;
    if (mode === 'aspect' && node.intrinsicWidth > 0 && node.intrinsicHeight > 0) {
      const height = Math.max(
        IMAGE_MIN_SIZE,
        Math.round(node.width * (node.intrinsicHeight / node.intrinsicWidth)),
      );
      return { ...node, mode, height };
    }
    return { ...node, mode };
  }, now);
}

export function noteImageIntrinsic(
  board: Board,
  id: string,
  width: number,
  height: number,
  now?: string,
): Board {
  return mapNode(board, id, (node) => {
    if (node.kind !== 'image' || node.sizedFromImage) return node;
    if (!(width > 0) || !(height > 0) || !Number.isFinite(width) || !Number.isFinite(height)) return node;
    const display = fitDisplaySize(width, height);
    return {
      ...node,
      intrinsicWidth: width,
      intrinsicHeight: height,
      width: display.width,
      height: display.height,
      sizedFromImage: true,
    };
  }, now);
}

export function deleteNodes(
  board: Board,
  ids: readonly string[],
  now?: string,
): { board: Board; removedAssetIds: string[] } {
  if (ids.length === 0) return { board, removedAssetIds: [] };
  const removed = new Set(ids);
  const before = referencedAssetIds(board);
  const nodes = board.nodes.filter((node) => !removed.has(node.id));
  if (nodes.length === board.nodes.length) return { board, removedAssetIds: [] };
  const edges = board.edges.filter((edge) => !removed.has(edge.sourceId) && !removed.has(edge.targetId));
  const next = touch(board, { nodes, edges }, now);
  const after = referencedAssetIds(next);
  const removedAssetIds = [...before].filter((id) => !after.has(id));
  return { board: next, removedAssetIds };
}

export function parseBoard(value: unknown): Board | null {
  if (!isRecord(value)) return null;
  if (value.schemaVersion !== 1) return null;
  if (!isNonEmptyString(value.id) || typeof value.title !== 'string') return null;
  if (typeof value.createdAt !== 'string' || typeof value.updatedAt !== 'string') return null;
  if (!isFiniteNumber(value.revision)) return null;
  if (!Array.isArray(value.nodes) || !Array.isArray(value.edges)) return null;

  const seen = new Set<string>();
  const nodes: BoardNode[] = [];
  for (const entry of value.nodes) {
    const node = parseNode(entry);
    if (!node || seen.has(node.id)) return null;
    seen.add(node.id);
    nodes.push(node);
  }

  const edges: BoardEdge[] = [];
  const edgeIds = new Set<string>();
  for (const entry of value.edges) {
    const edge = parseEdge(entry);
    if (!edge || edgeIds.has(edge.id)) return null;
    edgeIds.add(edge.id);
    edges.push(edge);
  }

  const viewport = parseViewport(value.viewport);
  if (!viewport) return null;

  return {
    schemaVersion: 1,
    id: value.id,
    title: value.title,
    createdAt: value.createdAt,
    updatedAt: value.updatedAt,
    revision: value.revision,
    nodes,
    edges,
    viewport,
  };
}

export function isSafeHttpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}

function mapNode(
  board: Board,
  id: string,
  update: (node: BoardNode) => BoardNode,
  now?: string,
): Board {
  let changed = false;
  const nodes = board.nodes.map((node) => {
    if (node.id !== id) return node;
    const next = update(node);
    if (next !== node) changed = true;
    return next;
  });
  if (!changed) return board;
  return touch(board, { nodes }, now);
}

function touch(
  board: Board,
  patch: Partial<Pick<Board, 'title' | 'nodes' | 'edges' | 'viewport'>>,
  now = new Date().toISOString(),
): Board {
  return {
    ...board,
    ...patch,
    revision: board.revision + 1,
    updatedAt: now,
  };
}

function minWidth(node: BoardNode): number {
  return node.kind === 'text' ? TEXT_MIN_WIDTH : IMAGE_MIN_SIZE;
}

function minHeight(node: BoardNode): number {
  return node.kind === 'text' ? TEXT_MIN_HEIGHT : IMAGE_MIN_SIZE;
}

function parseNode(value: unknown): BoardNode | null {
  if (!isRecord(value) || !isNonEmptyString(value.id)) return null;
  if (!isFiniteNumber(value.x) || !isFiniteNumber(value.y)) return null;
  if (!isPositive(value.width) || !isPositive(value.height)) return null;
  if (value.kind === 'text') {
    if (typeof value.text !== 'string') return null;
    return {
      id: value.id,
      kind: 'text',
      x: value.x,
      y: value.y,
      width: value.width,
      height: value.height,
      text: value.text,
    };
  }
  if (value.kind === 'image') {
    if (value.mode !== 'aspect' && value.mode !== 'contain') return null;
    if (!isPositive(value.intrinsicWidth) || !isPositive(value.intrinsicHeight)) return null;
    if (typeof value.sizedFromImage !== 'boolean') return null;
    const source = parseImageSource(value.source);
    if (!source) return null;
    return {
      id: value.id,
      kind: 'image',
      x: value.x,
      y: value.y,
      width: value.width,
      height: value.height,
      mode: value.mode,
      intrinsicWidth: value.intrinsicWidth,
      intrinsicHeight: value.intrinsicHeight,
      sizedFromImage: value.sizedFromImage,
      source,
    };
  }
  return null;
}

function parseImageSource(value: unknown): ImageNode['source'] | null {
  if (!isRecord(value)) return null;
  if (value.type === 'embedded' && isNonEmptyString(value.assetId)) {
    return { type: 'embedded', assetId: value.assetId };
  }
  if (value.type === 'external' && typeof value.url === 'string' && isSafeHttpUrl(value.url)) {
    return { type: 'external', url: value.url };
  }
  return null;
}

function parseEdge(value: unknown): BoardEdge | null {
  if (!isRecord(value)) return null;
  if (!isNonEmptyString(value.id) || !isNonEmptyString(value.sourceId) || !isNonEmptyString(value.targetId)) {
    return null;
  }
  const edge: BoardEdge = { id: value.id, sourceId: value.sourceId, targetId: value.targetId };
  if (value.restLength !== undefined) {
    if (!isFiniteNumber(value.restLength) || value.restLength < 0) return null;
    edge.restLength = value.restLength;
  }
  return edge;
}

function parseViewport(value: unknown): Viewport | null {
  if (!isRecord(value)) return null;
  if (!isFiniteNumber(value.x) || !isFiniteNumber(value.y) || !isPositive(value.zoom)) return null;
  return { x: value.x, y: value.y, zoom: value.zoom };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function isPositive(value: unknown): value is number {
  return isFiniteNumber(value) && value > 0;
}

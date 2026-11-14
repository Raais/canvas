import { seedFromProjectName } from '../backgrounds/atlas-seed';
import { normalizeRotation } from './image-rotation';
import { parseStoredTimestamp } from './node-date';
import { contentExtent } from './geometry';
import { classifyPlainText } from './code';
import {
  ASPECT_MIN_SIZE,
  FALLBACK_IMAGE_HEIGHT,
  FALLBACK_IMAGE_WIDTH,
  GROUP_MIN_HEIGHT,
  GROUP_MIN_WIDTH,
  GROUP_PAD,
  IMAGE_MAX_HEIGHT,
  IMAGE_MAX_WIDTH,
  IMAGE_MIN_EDGE,
  IMAGE_MIN_SIZE,
  TEXT_MIN_HEIGHT,
  TEXT_MIN_WIDTH,
  TEXT_NOTE_HEIGHT,
  TEXT_NOTE_WIDTH,
  MAX_EDGE_LABEL,
  MAX_SAVED_VIEW_NAME,
  MAX_SAVED_VIEWS,
  MAX_ZOOM,
  MIN_ZOOM,
  SCHEMA_VERSION,
  type Board,
  type BoardEdge,
  type BoardNode,
  type HandleSide,
  type ImageDisplayMode,
  type ImageNode,
  type Point,
  type TextNode,
  type Viewport,
  type Appearance,
  type BackgroundPattern,
  type EdgeStyle,
  type SavedView,
  type BackgroundTone,
  type CodeLanguage,
  type CornerStyle,
  type TextTone,
} from './types';

const PASTE_STAGGER = 36;

export function createEmptyBoard(now = new Date().toISOString()): Board {
  return {
    schemaVersion: SCHEMA_VERSION,
    id: crypto.randomUUID(),
    title: 'Untitled board',
    createdAt: now,
    updatedAt: now,
    revision: 1,
    appearance: 'dark',
    backgroundPattern: 'dither-atlas',
    ditherAtlas: { seed: seedFromProjectName('Untitled board'), rendererVersion: 3 },
    nodes: [],
    edges: [],
    savedViews: [],
    viewport: { x: 0, y: 0, zoom: 1 },
  };
}

export function createTextNode(center: Point, text = '', now = new Date().toISOString()): TextNode {
    const guess = text.trim() ? classifyPlainText(text) : null;
    return {
    id: crypto.randomUUID(),
    kind: 'text',
    x: Math.round(center.x - TEXT_NOTE_WIDTH / 2),
    y: Math.round(center.y - TEXT_NOTE_HEIGHT / 2),
    width: TEXT_NOTE_WIDTH,
    height: TEXT_NOTE_HEIGHT,
    text,
    lastEditedAt: now,
    ...(guess?.presentation === 'code' ? { presentation: 'code' as const, ...(guess.language ? { language: guess.language } : {}) } : {}),
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
    width: Math.max(1, Math.round(nextWidth)),
    height: Math.max(1, Math.round(nextHeight)),
  };
}

export function createEmbeddedImageNode(input: {
  center: Point;
  assetId: string;
  intrinsicWidth: number;
  intrinsicHeight: number;
  now?: string;
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
    lastEditedAt: input.now ?? new Date().toISOString(),
  };
}

export function createExternalImageNode(input: {
  center: Point;
  url: string;
  intrinsicWidth: number;
  intrinsicHeight: number;
  sizedFromImage: boolean;
  now?: string;
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
    lastEditedAt: input.now ?? new Date().toISOString(),
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
  const seed = seedFromProjectName(title);
  return touch(board, {
    title,
    ...(board.ditherAtlas ? { ditherAtlas: { ...board.ditherAtlas, seed } } : {}),
    ...(board.topographicContours ? { topographicContours: { ...board.topographicContours, seed } } : {}),
  }, now);
}

export function updateText(board: Board, id: string, text: string, now?: string): Board {
  return mapNode(board, id, (node) => {
    if (node.kind !== 'text' || node.text === text) return node;
    return { ...node, text, lastEditedAt: now ?? new Date().toISOString() };
  }, now);
}

export function withInsertedTimestamp<T extends BoardNode>(node: T, now: string): T {
  if (node.kind === 'group') return node;
  return { ...node, lastEditedAt: now };
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
    if (node.kind === 'group') {
      const extent = contentExtent(board.nodes, node.id);
      const nextWidth = Math.max(width, GROUP_MIN_WIDTH, extent ? extent.right + GROUP_PAD : 0);
      const nextHeight = Math.max(height, GROUP_MIN_HEIGHT, extent ? extent.bottom + GROUP_PAD : 0);
      if (x === node.x && y === node.y && nextWidth === node.width && nextHeight === node.height) return node;
      return { ...node, x, y, width: nextWidth, height: nextHeight };
    }
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
      const height = Math.max(1, Math.round(node.width * (node.intrinsicHeight / node.intrinsicWidth)));
      return { ...node, mode, height };
    }
    return { ...node, mode: mode === 'aspect' ? mode : 'stretch' };
  }, now);
}

export function setPresentation(
  board: Board,
  id: string,
  presentation: 'text' | 'markdown' | 'code',
  now?: string,
): Board {
  return mapNode(board, id, (node) => {
    if (node.kind !== 'text') return node;
    const next = { ...node };
    if (presentation === 'text') delete next.presentation;
    else next.presentation = presentation;
    return next;
  }, now);
}

export function setBackgroundPattern(board: Board, backgroundPattern: BackgroundPattern, now?: string): Board {
  if (backgroundPattern === 'dither-atlas') {
    const ditherAtlas = board.ditherAtlas ?? { seed: seedFromProjectName(board.title), rendererVersion: 3 as const };
    if (board.backgroundPattern === 'dither-atlas' && board.ditherAtlas?.seed === ditherAtlas.seed) return board;
    return touch(board, { backgroundPattern, ditherAtlas }, now);
  }
  if (backgroundPattern === 'topographic-contours') {
    const topographicContours = board.topographicContours ?? { seed: seedFromProjectName(board.title), rendererVersion: 1 as const };
    if (board.backgroundPattern === 'topographic-contours' && board.topographicContours) return board;
    return touch(board, { backgroundPattern, topographicContours }, now);
  }
  if (board.backgroundPattern === backgroundPattern) return board;
  return touch(board, { backgroundPattern }, now);
}

export function upgradeAtlasRenderer(board: Board, now?: string): Board {
  const atlas = board.ditherAtlas;
  if (board.backgroundPattern !== 'dither-atlas' || !atlas || (atlas.rendererVersion !== 1 && atlas.rendererVersion !== 2)) return board;
  return touch(board, { ditherAtlas: { seed: atlas.seed, rendererVersion: 3 } }, now);
}

export function setGroupBackgroundTone(board: Board, id: string, tone: BackgroundTone | 'default', now?: string): Board {
  return mapNode(board, id, (node) => {
    if (node.kind !== 'group') return node;
    const next = { ...node };
    if (tone === 'default') delete next.backgroundTone;
    else next.backgroundTone = tone;
    if (next.backgroundTone === node.backgroundTone && tone !== 'default') return node;
    if (tone === 'default' && node.backgroundTone == null) return node;
    return next;
  }, now);
}

export function setNoteTone(
  board: Board,
  id: string,
  kind: 'background' | 'text',
  tone: BackgroundTone | TextTone | 'default',
  now?: string,
): Board {
  return mapNode(board, id, (node) => {
    if (node.kind !== 'text') return node;
    const next = { ...node };
    if (kind === 'background') {
      if (tone === 'default') delete next.backgroundTone;
      else if (tone === 'slate' || tone === 'sage' || tone === 'sand' || tone === 'rose') next.backgroundTone = tone;
    } else if (tone === 'default') delete next.textTone;
    else if (tone === 'muted' || tone === 'blue' || tone === 'sage' || tone === 'warm') next.textTone = tone;
    return next;
  }, now);
}

export function setCodeLanguage(
  board: Board,
  id: string,
  codeLanguage: CodeLanguage | 'auto',
  now?: string,
): Board {
  return mapNode(board, id, (node) => {
    if (node.kind !== 'text') return node;
    const next = { ...node };
    if (codeLanguage === 'auto') delete next.codeLanguage;
    else next.codeLanguage = codeLanguage;
    return next;
  }, now);
}

export function setCornerStyle(board: Board, id: string, cornerStyle: CornerStyle, now?: string): Board {
  return mapNode(board, id, (node) => {
    if (node.kind !== 'image') return node;
    const next = { ...node };
    if (cornerStyle === 'rounded') delete next.cornerStyle;
    else next.cornerStyle = 'square';
    return next;
  }, now);
}

export function migrateStoredAppearance(
  board: Board,
  storedSchema: number,
  storedAppearance: Appearance | null,
  legacy: Appearance,
): Board {
  if (storedAppearance && (storedSchema === 5 || storedSchema === 6 || storedSchema === 7 || storedSchema === 8 || storedSchema === SCHEMA_VERSION)) return board;
  return { ...board, appearance: storedAppearance ?? legacy };
}

export function setAppearance(board: Board, appearance: Appearance, now?: string): Board {
  if (board.appearance === appearance) return board;
  return touch(board, { appearance }, now);
}

export function setImageRotation(board: Board, id: string, rotation: number, now?: string): Board {
  const angle = normalizeRotation(rotation);
  if (angle === null) return board;
  return mapNode(board, id, (node) => {
    if (node.kind !== 'image') return node;
    if ((node.rotation ?? 0) === angle) return node;
    const next = { ...node };
    if (angle === 0) delete next.rotation;
    else next.rotation = angle;
    return next;
  }, now);
}

export function toggleImageFlip(board: Board, id: string, axis: 'x' | 'y', now?: string): Board {
  return mapNode(board, id, (node) => {
    if (node.kind !== 'image') return node;
    const flipX = axis === 'x' ? !node.flipX : Boolean(node.flipX);
    const flipY = axis === 'y' ? !node.flipY : Boolean(node.flipY);
    const next = { ...node };
    if (flipX) next.flipX = true;
    else delete next.flipX;
    if (flipY) next.flipY = true;
    else delete next.flipY;
    return next;
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

export function revise(
  board: Board,
  patch: Partial<Pick<Board, 'title' | 'nodes' | 'edges' | 'viewport' | 'savedViews'>>,
  now = new Date().toISOString(),
): Board {
  return touch(board, patch, now);
}

export function parseBoard(value: unknown): Board | null {
  if (!isRecord(value)) return null;
  if (value.schemaVersion === 1) return migrateVersion1(value);
  const version = value.schemaVersion;
  if (version !== 2 && version !== 3 && version !== 4 && version !== 5 && version !== 6 && version !== 7 && version !== 8 && version !== SCHEMA_VERSION) return null;
  const relationshipStrict = version === 6 || version === 7 || version === 8 || version === SCHEMA_VERSION;
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
    const edge = parseEdge(entry, relationshipStrict);
    if (!edge || edgeIds.has(edge.id)) return null;
    edgeIds.add(edge.id);
    edges.push(edge);
  }
  const savedViews = parseSavedViews(value.savedViews, relationshipStrict);
  if (!savedViews) return null;

  const viewport = parseViewport(value.viewport);
  const appearance = parseAppearanceField(value.schemaVersion, value.appearance);
  const backgroundPattern = parsePattern(value.schemaVersion, value.backgroundPattern);
  const ditherAtlas = parseDither(value.ditherAtlas);
  const topographicContours = parseContours(value.schemaVersion, value.topographicContours);
  if (!viewport || !appearance || !backgroundPattern || ditherAtlas === null || topographicContours === null || !validGraph(nodes, edges)) return null;
  if (backgroundPattern === 'dither-atlas' && !ditherAtlas) return null;
  if (backgroundPattern === 'topographic-contours' && !topographicContours) return null;

  return {
    schemaVersion: SCHEMA_VERSION,
    id: value.id,
    title: value.title,
    createdAt: value.createdAt,
    updatedAt: value.updatedAt,
    revision: value.revision,
    appearance,
    backgroundPattern,
    ...(ditherAtlas ? { ditherAtlas } : {}),
    ...(topographicContours ? { topographicContours } : {}),
    nodes,
    edges,
    savedViews,
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

function strictDocument(schemaVersion: unknown): boolean {
  return schemaVersion === 5 || schemaVersion === 6 || schemaVersion === 7 || schemaVersion === 8 || schemaVersion === SCHEMA_VERSION;
}

function supportsContours(schemaVersion: unknown): boolean {
  return schemaVersion === 7 || schemaVersion === 8 || schemaVersion === SCHEMA_VERSION;
}

function parseAppearanceField(schemaVersion: unknown, value: unknown): Appearance | null {
  if (value === 'dark' || value === 'light') return value;
  if (strictDocument(schemaVersion)) return null;
  if (value == null) return 'dark';
  return null;
}

function parsePattern(schemaVersion: unknown, value: unknown): BackgroundPattern | null {
  if (value === 'dots' || value === 'grid' || value === 'cross' || value === 'blank' || value === 'dither-atlas') return value;
  if (value === 'topographic-contours' && supportsContours(schemaVersion)) return value;
  if (strictDocument(schemaVersion)) return null;
  if (value == null) return 'dots';
  return null;
}

function parseContours(schemaVersion: unknown, value: unknown): Board['topographicContours'] | null {
  if (!supportsContours(schemaVersion)) return undefined;
  if (value == null) return undefined;
  if (!isRecord(value) || value.rendererVersion !== 1) return null;
  if (typeof value.seed !== 'number' || !Number.isInteger(value.seed) || value.seed < 0 || value.seed > 4294967295) return null;
  return { seed: value.seed, rendererVersion: 1 };
}

function parseDither(value: unknown): Board['ditherAtlas'] | null {
  if (value == null) return undefined;
  if (!isRecord(value) || (value.rendererVersion !== 1 && value.rendererVersion !== 2 && value.rendererVersion !== 3)) return null;
  if (typeof value.seed !== 'number' || !Number.isInteger(value.seed) || value.seed < 0 || value.seed > 4294967295) return null;
  return { seed: value.seed, rendererVersion: value.rendererVersion };
}

function parseTone<T extends string>(value: unknown, allowed: readonly T[]): T | undefined | null {
  if (value == null) return undefined;
  return allowed.includes(value as T) ? (value as T) : null;
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
  patch: Partial<Pick<Board, 'title' | 'nodes' | 'edges' | 'viewport' | 'appearance' | 'backgroundPattern' | 'ditherAtlas' | 'topographicContours' | 'savedViews'>>,
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
  if (node.kind === 'text') return TEXT_MIN_WIDTH;
  if (node.kind === 'group') return GROUP_MIN_WIDTH;
  if (node.mode === 'aspect') return ASPECT_MIN_SIZE;
  return IMAGE_MIN_SIZE;
}

function minHeight(node: BoardNode): number {
  if (node.kind === 'text') return TEXT_MIN_HEIGHT;
  if (node.kind === 'group') return GROUP_MIN_HEIGHT;
  if (node.mode === 'aspect') return ASPECT_MIN_SIZE;
  return IMAGE_MIN_SIZE;
}

function parseNode(value: unknown): BoardNode | null {
  if (!isRecord(value) || !isNonEmptyString(value.id)) return null;
  if (!isFiniteNumber(value.x) || !isFiniteNumber(value.y)) return null;
  if (!isPositive(value.width) || !isPositive(value.height)) return null;
  const parentId = parseParentId(value.parentId);
  if (parentId === false) return null;
  if (value.kind === 'group') {
    if (parentId) return null;
    if (typeof value.label !== 'string') return null;
    const backgroundTone = parseTone(value.backgroundTone, ['slate', 'sage', 'sand', 'rose'] as const);
    if (backgroundTone === null) return null;
    return {
      id: value.id,
      kind: 'group',
      x: value.x,
      y: value.y,
      width: value.width,
      height: value.height,
      label: value.label,
      ...(backgroundTone ? { backgroundTone } : {}),
    };
  }
  if (value.kind === 'text') {
    if (typeof value.text !== 'string') return null;
    const presentation = value.presentation === 'code' || value.presentation === 'markdown' || value.presentation === 'text' ? value.presentation : value.presentation == null ? 'text' : null;
    if (!presentation) return null;
    const language = typeof value.language === 'string' && value.language.length > 0 && value.language.length <= 32 ? value.language : undefined;
    if (value.language != null && language === undefined) return null;
    const codeLanguage = parseTone(value.codeLanguage, ['javascript', 'typescript', 'python', 'json', 'html', 'css', 'shell', 'plain'] as const);
    const backgroundTone = parseTone(value.backgroundTone, ['slate', 'sage', 'sand', 'rose'] as const);
    const textTone = parseTone(value.textTone, ['muted', 'blue', 'sage', 'warm'] as const);
    if (codeLanguage === null || backgroundTone === null || textTone === null) return null;
    const stamped = timestampFields(value.lastEditedAt);
    if (stamped === null) return null;
    return {
      id: value.id,
      kind: 'text',
      ...(parentId ? { parentId } : {}),
      x: value.x,
      y: value.y,
      width: value.width,
      height: value.height,
      text: value.text,
      ...(presentation === 'text' ? {} : { presentation }),
      ...(presentation === 'code' && language ? { language } : {}),
      ...(presentation === 'code' && codeLanguage ? { codeLanguage } : {}),
      ...(backgroundTone ? { backgroundTone } : {}),
      ...(textTone ? { textTone } : {}),
      ...stamped,
    };
  }
  if (value.kind === 'image') {
    const mode = value.mode === 'contain' ? 'stretch' : value.mode;
    if (mode !== 'aspect' && mode !== 'stretch') return null;
    if (!isPositive(value.intrinsicWidth) || !isPositive(value.intrinsicHeight)) return null;
    if (typeof value.sizedFromImage !== 'boolean') return null;
    if (value.flipX != null && value.flipX !== true && value.flipX !== false) return null;
    if (value.flipY != null && value.flipY !== true && value.flipY !== false) return null;
    const cornerStyle = value.cornerStyle == null ? undefined : value.cornerStyle === 'rounded' || value.cornerStyle === 'square' ? value.cornerStyle : null;
    if (cornerStyle === null) return null;
    const rotation = parseRotation(value.rotation);
    if (rotation === null) return null;
    const source = parseImageSource(value.source);
    if (!source) return null;
    const stamped = timestampFields(value.lastEditedAt);
    if (stamped === null) return null;
    return {
      id: value.id,
      kind: 'image',
      ...(parentId ? { parentId } : {}),
      x: value.x,
      y: value.y,
      width: value.width,
      height: value.height,
      mode,
      intrinsicWidth: value.intrinsicWidth,
      intrinsicHeight: value.intrinsicHeight,
      sizedFromImage: value.sizedFromImage,
      source,
      ...(value.flipX === true ? { flipX: true } : {}),
      ...(value.flipY === true ? { flipY: true } : {}),
      ...(cornerStyle === 'square' ? { cornerStyle } : {}),
      ...(rotation ? { rotation } : {}),
      ...stamped,
    };
  }
  return null;
}

function timestampFields(value: unknown): { lastEditedAt: string } | null | Record<string, never> {
  const timestamp = parseStoredTimestamp(value);
  if (timestamp === null) return null;
  return timestamp ? { lastEditedAt: timestamp } : {};
}

function parseRotation(value: unknown): number | undefined | null {
  if (value == null) return undefined;
  if (typeof value !== 'number' || !Number.isInteger(value) || value < -180 || value > 180) return null;
  if (value === 0) return undefined;
  return value;
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

function parseEdge(value: unknown, strict: boolean): BoardEdge | null {
  if (!isRecord(value)) return null;
  if (!isNonEmptyString(value.id) || !isNonEmptyString(value.sourceId) || !isNonEmptyString(value.targetId)) {
    return null;
  }
  if (!isHandle(value.sourceHandle) || !isHandle(value.targetHandle)) return null;
  if (!isFiniteNumber(value.restLength) || value.restLength < 0) return null;
  if (value.sourceId === value.targetId) return null;
  const label = parseEdgeLabel(value.label, strict);
  const style = parseEdgeStyle(value.style, strict);
  if (label === null || style === null) return null;
  return {
    id: value.id,
    sourceId: value.sourceId,
    targetId: value.targetId,
    sourceHandle: value.sourceHandle,
    targetHandle: value.targetHandle,
    restLength: value.restLength,
    ...(label ? { label } : {}),
    ...(style ? { style } : {}),
  };
}

function parseEdgeLabel(value: unknown, strict: boolean): string | undefined | null {
  if (value == null) return undefined;
  if (typeof value !== 'string' || hasControlCharacter(value)) return strict ? null : undefined;
  const label = value.trim();
  if (!label || label.length > MAX_EDGE_LABEL) return strict ? null : undefined;
  return label;
}

function parseEdgeStyle(value: unknown, strict: boolean): EdgeStyle | undefined | null {
  if (value == null) return undefined;
  if (value === 'solid' || value === 'dashed' || value === 'red-string') return value;
  return strict ? null : undefined;
}

function parseSavedViews(value: unknown, strict: boolean): SavedView[] | null {
  if (!strict) return [];
  if (!Array.isArray(value) || value.length > MAX_SAVED_VIEWS) return null;
  const seen = new Set<string>();
  const views: SavedView[] = [];
  for (const entry of value) {
    if (!isRecord(entry) || !isNonEmptyString(entry.id) || seen.has(entry.id)) return null;
    if (typeof entry.name !== 'string' || hasControlCharacter(entry.name)) return null;
    const name = entry.name.trim();
    if (!name || name.length > MAX_SAVED_VIEW_NAME) return null;
    const viewport = parseSavedViewport(entry.viewport);
    if (!viewport) return null;
    seen.add(entry.id);
    views.push({ id: entry.id, name, viewport });
  }
  return views;
}

function parseSavedViewport(value: unknown): Viewport | null {
  const viewport = parseViewport(value);
  if (!viewport || viewport.zoom < MIN_ZOOM || viewport.zoom > MAX_ZOOM) return null;
  return viewport;
}

function hasControlCharacter(value: string): boolean {
  return /[\u0000-\u001F\u007F]/.test(value);
}

function validGraph(nodes: readonly BoardNode[], edges: readonly BoardEdge[]): boolean {
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const pairs = new Set<string>();
  for (const node of nodes) {
    if (node.kind === 'group' || !node.parentId) continue;
    const parent = byId.get(node.parentId);
    if (!parent || parent.kind !== 'group') return false;
  }
  for (const edge of edges) {
    if (!byId.has(edge.sourceId) || !byId.has(edge.targetId)) return false;
    const key = edge.sourceId < edge.targetId ? `${edge.sourceId}\0${edge.targetId}` : `${edge.targetId}\0${edge.sourceId}`;
    if (pairs.has(key)) return false;
    pairs.add(key);
  }
  return true;
}

function migrateVersion1(value: Record<string, unknown>): Board | null {
  if (!Array.isArray(value.nodes) || !Array.isArray(value.edges)) return null;
  const nodes: Record<string, unknown>[] = [];
  for (const entry of value.nodes) {
    if (!isRecord(entry) || entry.kind === 'group' || entry.parentId !== undefined) return null;
    nodes.push(entry);
  }
  const ids = new Set(nodes.map((node) => (typeof node.id === 'string' ? node.id : '')));
  const edges: Record<string, unknown>[] = [];
  const pairs = new Set<string>();
  for (const entry of value.edges) {
    if (!isRecord(entry) || typeof entry.sourceId !== 'string' || typeof entry.targetId !== 'string') return null;
    if (!ids.has(entry.sourceId) || !ids.has(entry.targetId) || entry.sourceId === entry.targetId) continue;
    const key = entry.sourceId < entry.targetId ? `${entry.sourceId}\0${entry.targetId}` : `${entry.targetId}\0${entry.sourceId}`;
    if (pairs.has(key)) continue;
    pairs.add(key);
    edges.push({
      id: entry.id,
      sourceId: entry.sourceId,
      targetId: entry.targetId,
      sourceHandle: isHandle(entry.sourceHandle) ? entry.sourceHandle : 'right',
      targetHandle: isHandle(entry.targetHandle) ? entry.targetHandle : 'left',
      restLength:
        isFiniteNumber(entry.restLength) && entry.restLength >= 0
          ? entry.restLength
          : centerDistance(nodes, entry.sourceId, entry.targetId),
    });
  }
  return parseBoard({ ...value, schemaVersion: 2, nodes, edges });
}

function centerDistance(nodes: readonly Record<string, unknown>[], sourceId: string, targetId: string): number {
  const source = nodes.find((node) => node.id === sourceId);
  const target = nodes.find((node) => node.id === targetId);
  if (!source || !target) return 0;
  if (!isFiniteNumber(source.x) || !isFiniteNumber(source.y) || !isFiniteNumber(source.width) || !isFiniteNumber(source.height)) return 0;
  if (!isFiniteNumber(target.x) || !isFiniteNumber(target.y) || !isFiniteNumber(target.width) || !isFiniteNumber(target.height)) return 0;
  const sx = source.x + source.width / 2;
  const sy = source.y + source.height / 2;
  const tx = target.x + target.width / 2;
  const ty = target.y + target.height / 2;
  const length = Math.hypot(tx - sx, ty - sy);
  return Number.isFinite(length) ? length : 0;
}

function parseParentId(value: unknown): string | false | undefined {
  if (value === undefined) return undefined;
  if (typeof value === 'string' && value.length > 0) return value;
  return false;
}

function isHandle(value: unknown): value is HandleSide {
  return value === 'top' || value === 'right' || value === 'bottom' || value === 'left';
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

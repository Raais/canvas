export const SCHEMA_VERSION = 11 as const;
export const MAX_SAVED_VIEWS = 32;
export const MAX_SAVED_VIEW_NAME = 60;
export const MAX_EDGE_LABEL = 80;
export const MIN_ZOOM = 0.1;
export const MAX_ZOOM = 6;

export const TEXT_NOTE_WIDTH = 240;
export const TEXT_NOTE_HEIGHT = 140;
export const TEXT_MIN_WIDTH = 160;
export const TEXT_MIN_HEIGHT = 72;
export const IMAGE_MIN_SIZE = 48;
export const IMAGE_MAX_WIDTH = 360;
export const IMAGE_MAX_HEIGHT = 280;
export const IMAGE_MIN_EDGE = 72;
export const ASPECT_MIN_SIZE = 1;
export const FALLBACK_IMAGE_WIDTH = 320;
export const FALLBACK_IMAGE_HEIGHT = 200;
export const GROUP_PAD = 20;
export const GROUP_MIN_WIDTH = 120;
export const GROUP_MIN_HEIGHT = 88;
export const DUPLICATE_OFFSET = 32;

export type Viewport = {
  x: number;
  y: number;
  zoom: number;
};

export type ImageDisplayMode = 'aspect' | 'stretch';

export type Appearance = 'dark' | 'light';

export type NotePresentation = 'text' | 'markdown' | 'code';
export type BackgroundTone = 'slate' | 'sage' | 'sand' | 'rose';
export type TextTone = 'muted' | 'blue' | 'sage' | 'warm';
export type CodeLanguage = 'javascript' | 'typescript' | 'python' | 'json' | 'html' | 'css' | 'shell' | 'plain';
export type BackgroundPattern = 'dots' | 'grid' | 'cross' | 'blank' | 'dither-atlas' | 'topographic-contours';
export type DitherAtlasConfig = { seed: number; rendererVersion: 1 | 2 | 3 };
export type TopographicContoursConfig = { seed: number; rendererVersion: 1 };
export type CornerStyle = 'rounded' | 'square';

export type HandleSide = 'top' | 'right' | 'bottom' | 'left';

export type EdgeStyle = 'solid' | 'dashed' | 'red-string';

export type SavedView = {
  id: string;
  name: string;
  viewport: Viewport;
};

export type ProtectedTextPayload = {
  version: 1;
  cipher: 'xchacha20poly1305';
  kdf: 'argon2id';
  salt: string;
  nonce: string;
  ciphertext: string;
  iterations: number;
  memoryKiB: number;
  parallelism: number;
};

export type TextNode = {
  id: string;
  kind: 'text';
  parentId?: string;
  x: number;
  y: number;
  width: number;
  height: number;
  text: string;
  presentation?: NotePresentation;
  language?: string;
  codeLanguage?: CodeLanguage;
  backgroundTone?: BackgroundTone;
  textTone?: TextTone;
  /** Present only while the note is password protected. `text` is empty in that case. */
  protection?: ProtectedTextPayload;
  /** ISO timestamp of the last genuine text change. Omitted on legacy notes. */
  lastEditedAt?: string;
};

export type EmbeddedImageSource = {
  type: 'embedded';
  assetId: string;
};

export type ExternalImageSource = {
  type: 'external';
  url: string;
};

export type ImageNode = {
  id: string;
  kind: 'image';
  parentId?: string;
  x: number;
  y: number;
  width: number;
  height: number;
  mode: ImageDisplayMode;
  intrinsicWidth: number;
  intrinsicHeight: number;
  sizedFromImage: boolean;
  source: EmbeddedImageSource | ExternalImageSource;
  flipX?: boolean;
  flipY?: boolean;
  cornerStyle?: CornerStyle;
  /** Degrees, clockwise. Omitted at 0°. The frame itself stays axis-aligned. */
  rotation?: number;
  /** ISO timestamp from when this image node was added. Omitted on legacy images. */
  lastEditedAt?: string;
};

export type GroupNode = {
  id: string;
  kind: 'group';
  x: number;
  y: number;
  width: number;
  height: number;
  label: string;
  backgroundTone?: BackgroundTone;
};

export type ContentNode = TextNode | ImageNode;

export type BoardNode = ContentNode | GroupNode;

export type BoardEdge = {
  id: string;
  sourceId: string;
  targetId: string;
  sourceHandle: HandleSide;
  targetHandle: HandleSide;
  restLength: number;
  label?: string;
  style?: EdgeStyle;
};

export type Board = {
  schemaVersion: typeof SCHEMA_VERSION;
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  revision: number;
  appearance: Appearance;
  backgroundPattern: BackgroundPattern;
  ditherAtlas?: DitherAtlasConfig;
  topographicContours?: TopographicContoursConfig;
  nodes: BoardNode[];
  edges: BoardEdge[];
  savedViews: SavedView[];
  viewport: Viewport;
  /** Omitted when pulling force is on. `false` turns project pulling off. */
  physicsEnabled?: boolean;
};

export type AssetRecord = {
  id: string;
  mimeType: string;
  byteSize: number;
  createdAt: string;
  blob: Blob;
};

export type Point = {
  x: number;
  y: number;
};

export type Rect = Point & {
  width: number;
  height: number;
};

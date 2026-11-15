export const SCHEMA_VERSION = 18 as const;
export const MIRROR_LIMIT = 200;
export const MAX_SAVED_VIEWS = 32;
export const MAX_SAVED_VIEW_NAME = 60;
export const MAX_EDGE_LABEL = 80;
export const MIN_ZOOM = 0.1;
export const MAX_ZOOM = 6;

export const TEXT_NOTE_WIDTH = 240;
export const TEXT_NOTE_HEIGHT = 140;
export const FILE_NOTE_WIDTH = 240;
export const FILE_NOTE_HEIGHT = 116;
export const FILE_MIN_WIDTH = 180;
export const FILE_MIN_HEIGHT = 88;
export const WEBSITE_NOTE_WIDTH = 260;
export const WEBSITE_NOTE_HEIGHT = 140;
export const WEBSITE_MIN_WIDTH = 185;
export const WEBSITE_MIN_HEIGHT = 100;
export const WEBSITE_URL_LIMIT = 2048;
export const WEBSITE_TITLE_LIMIT = 120;
export const VOICE_NOTE_WIDTH = 260;
export const VOICE_NOTE_HEIGHT = 148;
export const VOICE_MIN_WIDTH = 220;
export const VOICE_MIN_HEIGHT = 120;
export const VOICE_TITLE_LIMIT = 120;
export const VOICE_MAX_MS = 15 * 60 * 1000;
export const TEXT_MIN_WIDTH = 160;
export const TEXT_MIN_HEIGHT = 72;
export const TEXT_RESIZE_MIN_HEIGHT = 96;
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
export const MAX_DRAWING_POINTS = 1024;
export const MAX_DRAWING_NODES = 2000;
export const DRAWING_STROKE_MIN = 0.2;
export const DRAWING_STROKE_MAX = 96;
export const ERASER_RADIUS_PX = 12;

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
  /** Original filename when this note was imported from a text file. */
  sourceFilename?: string;
  /** Relative path inside a ZIP suitcase. Omitted for ordinary notes. */
  sourcePath?: string;
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
  /** Relative path inside a ZIP suitcase. */
  sourcePath?: string;
};

export type FileNode = {
  id: string;
  kind: 'file';
  parentId?: string;
  x: number;
  y: number;
  width: number;
  height: number;
  assetId: string;
  filename: string;
  /** ISO timestamp from when this file node was added. */
  lastEditedAt?: string;
  /** Relative path inside a ZIP suitcase. Distinguishes identical names in different folders. */
  sourcePath?: string;
};

export type MirrorNode = {
  id: string;
  kind: 'mirror';
  sourceId: string;
  parentId?: string;
  x: number;
  y: number;
  width: number;
  height: number;
  backgroundTone?: BackgroundTone;
  textTone?: TextTone;
  /** Instance metadata time. Shared note edits stay on the canonical text note. */
  lastEditedAt: string;
};

export type SuitcaseNode = {
  id: string;
  kind: 'suitcase';
  parentId?: string;
  x: number;
  y: number;
  width: number;
  height: number;
  assetId: string;
  filename: string;
  fileCount: number;
  lastEditedAt: string;
};

export type DrawingColor = 'ink' | 'blue' | 'sage' | 'rose' | 'sand';

/** `legacy` is the Run 26 constant-width stroke. It is not a toolbar brush. */
export type DrawingBrush = 'legacy' | 'fineliner' | 'fountain' | 'brush';

export type DrawingNode = {
  id: string;
  kind: 'drawing';
  parentId?: string;
  x: number;
  y: number;
  width: number;
  height: number;
  /** Local coordinates as flat pairs: [x0, y0, x1, y1, ...]. */
  points: number[];
  color: DrawingColor;
  brush: DrawingBrush;
  strokeWidth: number;
  lastEditedAt: string;
};

export type VoiceNode = {
  id: string;
  kind: 'voice';
  parentId?: string;
  x: number;
  y: number;
  width: number;
  height: number;
  assetId: string;
  title: string;
  durationMs: number;
  lastEditedAt: string;
};

export type WebsiteNode = {
  id: string;
  kind: 'website';
  parentId?: string;
  x: number;
  y: number;
  width: number;
  height: number;
  url: string;
  title: string;
  /** ISO timestamp of the last URL or title change, or of insertion. */
  lastEditedAt: string;
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

export type ContentNode = TextNode | ImageNode | FileNode | WebsiteNode | DrawingNode | VoiceNode | SuitcaseNode | MirrorNode;

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

export const SCHEMA_VERSION = 1 as const;

export const TEXT_NOTE_WIDTH = 240;
export const TEXT_NOTE_HEIGHT = 140;
export const TEXT_MIN_WIDTH = 160;
export const TEXT_MIN_HEIGHT = 72;
export const IMAGE_MIN_SIZE = 48;
export const IMAGE_MAX_WIDTH = 360;
export const IMAGE_MAX_HEIGHT = 280;
export const IMAGE_MIN_EDGE = 72;
export const FALLBACK_IMAGE_WIDTH = 320;
export const FALLBACK_IMAGE_HEIGHT = 200;

export type Viewport = {
  x: number;
  y: number;
  zoom: number;
};

export type ImageDisplayMode = 'aspect' | 'contain';

export type TextNode = {
  id: string;
  kind: 'text';
  x: number;
  y: number;
  width: number;
  height: number;
  text: string;
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
  x: number;
  y: number;
  width: number;
  height: number;
  mode: ImageDisplayMode;
  intrinsicWidth: number;
  intrinsicHeight: number;
  sizedFromImage: boolean;
  source: EmbeddedImageSource | ExternalImageSource;
};

export type BoardNode = TextNode | ImageNode;

export type BoardEdge = {
  id: string;
  sourceId: string;
  targetId: string;
  restLength?: number;
};

export type Board = {
  schemaVersion: typeof SCHEMA_VERSION;
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  revision: number;
  nodes: BoardNode[];
  edges: BoardEdge[];
  viewport: Viewport;
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

import { MAX_ZOOM, MIN_ZOOM, type Rect, type Viewport } from './types';

export function noteJumpZoom(currentZoom: number): number {
  const readable = currentZoom < 0.85 ? 1 : currentZoom;
  return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, readable));
}

export function cameraDuration(milliseconds: number): number {
  if (typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return 0;
  return milliseconds;
}

export function frameViewport(bounds: Rect, width: number, height: number, padding = 0.2): Viewport {
  const availableWidth = Math.max(1, width * (1 - padding * 2));
  const availableHeight = Math.max(1, height * (1 - padding * 2));
  const zoom = Math.min(1, availableWidth / Math.max(bounds.width, 1), availableHeight / Math.max(bounds.height, 1));
  const clamped = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, zoom));
  return {
    x: width / 2 - (bounds.x + bounds.width / 2) * clamped,
    y: height / 2 - (bounds.y + bounds.height / 2) * clamped,
    zoom: clamped,
  };
}

export function clampCamera(viewport: Viewport): Viewport {
  return {
    x: viewport.x,
    y: viewport.y,
    zoom: Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, viewport.zoom)),
  };
}

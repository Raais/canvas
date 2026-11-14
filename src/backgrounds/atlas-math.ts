export const ATLAS_QUANTUM = 256;

export type AtlasViewport = { x: number; y: number; zoom: number };

export function screenToWorld(screenX: number, screenY: number, viewport: AtlasViewport): { x: number; y: number } {
  const zoom = viewport.zoom || 1;
  return { x: (screenX - viewport.x) / zoom, y: (screenY - viewport.y) / zoom };
}

export function worldToScreen(worldX: number, worldY: number, viewport: AtlasViewport): { x: number; y: number } {
  return { x: worldX * viewport.zoom + viewport.x, y: worldY * viewport.zoom + viewport.y };
}

export function splitWorld(x: number, y: number, quantum = ATLAS_QUANTUM): { tileX: number; tileY: number; localX: number; localY: number } {
  const tileX = Math.floor(x / quantum) * quantum;
  const tileY = Math.floor(y / quantum) * quantum;
  return { tileX, tileY, localX: x - tileX, localY: y - tileY };
}

export function atlasOrigin(viewport: AtlasViewport, quantum = ATLAS_QUANTUM) {
  const origin = screenToWorld(0, 0, viewport);
  const split = splitWorld(origin.x, origin.y, quantum);
  return { ...split, zoom: viewport.zoom || 1 };
}

export function backingSize(cssWidth: number, cssHeight: number, devicePixelRatio: number): { width: number; height: number; dpr: number } {
  const dpr = Math.min(Math.max(devicePixelRatio || 1, 1), 1.5);
  let width = Math.max(1, Math.floor(cssWidth * dpr));
  let height = Math.max(1, Math.floor(cssHeight * dpr));
  const cap = 2_500_000;
  if (width * height > cap) {
    const scale = Math.sqrt(cap / (width * height));
    width = Math.max(1, Math.floor(width * scale));
    height = Math.max(1, Math.floor(height * scale));
  }
  return { width, height, dpr };
}

export class DrawScheduler {
  private pending = false;

  request(): boolean {
    if (this.pending) return false;
    this.pending = true;
    return true;
  }

  finish(): void {
    this.pending = false;
  }
}

export function frameChanged(previous: string, next: string): boolean {
  return previous !== next;
}

const DISPLAY_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/gif', 'image/avif']);

/** Raster images need a display URL. Download-only attachments do not. */
export function isDisplayAsset(asset: { mimeType: string }): boolean {
  return DISPLAY_TYPES.has(asset.mimeType.trim().toLowerCase());
}

export function createObjectUrlRegistry() {
  const urls = new Map<string, string>();
  return {
    remember(asset: { id: string; mimeType: string; blob: Blob }): string | null {
      if (!isDisplayAsset(asset)) return null;
      const existing = urls.get(asset.id);
      if (existing) return existing;
      const url = URL.createObjectURL(asset.blob);
      urls.set(asset.id, url);
      return url;
    },
    get(id: string): string | null {
      return urls.get(id) ?? null;
    },
    revoke(id: string): void {
      const url = urls.get(id);
      if (!url) return;
      URL.revokeObjectURL(url);
      urls.delete(id);
    },
    revokeAll(): void {
      for (const url of urls.values()) URL.revokeObjectURL(url);
      urls.clear();
    },
  };
}

export function createAudioUrlKeeper() {
  const urls = new Map<string, { url: string; users: number }>();
  return {
    acquire(asset: { id: string; blob: Blob }): string {
      const existing = urls.get(asset.id);
      if (existing) {
        existing.users += 1;
        return existing.url;
      }
      const url = URL.createObjectURL(asset.blob);
      urls.set(asset.id, { url, users: 1 });
      return url;
    },
    forget(id: string): void {
      const existing = urls.get(id);
      if (!existing) return;
      URL.revokeObjectURL(existing.url);
      urls.delete(id);
    },
    release(id: string): void {
      const existing = urls.get(id);
      if (!existing) return;
      existing.users -= 1;
      if (existing.users > 0) return;
      URL.revokeObjectURL(existing.url);
      urls.delete(id);
    },
    revokeAll(): void {
      for (const entry of urls.values()) URL.revokeObjectURL(entry.url);
      urls.clear();
    },
    size(): number {
      return urls.size;
    },
  };
}

export type ObjectUrlRegistry = ReturnType<typeof createObjectUrlRegistry>;

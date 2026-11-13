export function createObjectUrlRegistry() {
  const urls = new Map<string, string>();
  return {
    remember(asset: { id: string; blob: Blob }): string {
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

export type ObjectUrlRegistry = ReturnType<typeof createObjectUrlRegistry>;

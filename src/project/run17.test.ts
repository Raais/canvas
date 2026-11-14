import { describe, expect, test } from 'bun:test';
import { decidePwaUpdate, shouldActivateWorker, type PwaUpdateInput } from './pwa-update';

declare const Bun: { file(path: string | URL): { arrayBuffer(): Promise<ArrayBuffer>; text(): Promise<string> } };

const ready: PwaUpdateInput = {
  editingNote: false,
  editingRelationship: false,
  confirming: false,
  ingesting: false,
  focusedField: false,
  readOnly: false,
  saveStatus: 'saved',
  hasUnpersisted: false,
  hasRecovery: false,
  expectationMatches: true,
};

function pngSize(bytes: Uint8Array): { width: number; height: number } {
  return { width: new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(16), height: new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(20) };
}

describe('pwa icons and manifest source', () => {
  test('uses the supplied icon bytes and a stable canvas manifest', async () => {
    const root = new URL('../../', import.meta.url);
    const files = [
      ['public/favicon-16x16.png', 16],
      ['public/favicon-32x32.png', 32],
      ['public/apple-touch-icon.png', 180],
      ['public/icons/app-192.png', 192],
      ['public/icons/app-512.png', 512],
      ['public/icons/app-maskable-512.png', 512],
    ] as const;
    for (const [path, size] of files) {
      const bytes = new Uint8Array(await Bun.file(new URL(path, root)).arrayBuffer());
      expect(pngSize(bytes)).toEqual({ width: size, height: size });
    }
    const ico = new Uint8Array(await Bun.file(new URL('public/favicon.ico', root)).arrayBuffer());
    expect(ico[0]).toBe(0);
    expect(ico[1]).toBe(0);
    expect(ico[2]).toBe(1);
    const html = await Bun.file(new URL('index.html', root)).text();
    const config = await Bun.file(new URL('vite.config.ts', root)).text();
    expect(html.includes('%BASE_URL%favicon.ico')).toBe(true);
    expect(html.includes('%BASE_URL%favicon-32x32.png')).toBe(true);
    expect(html.includes('%BASE_URL%favicon-16x16.png')).toBe(true);
    expect(html.includes('%BASE_URL%apple-touch-icon.png')).toBe(true);
    expect(html.includes('theme-color" content="#14171b"')).toBe(true);
    expect(config.includes("registerType: 'prompt'")).toBe(true);
    expect(config.includes('autoUpdate')).toBe(false);
    expect(config.includes("id: '/canvas/'")).toBe(true);
    expect(config.includes("start_url: '/canvas/'")).toBe(true);
    expect(config.includes("scope: '/canvas/'")).toBe(true);
    expect(config.includes("display: 'standalone'")).toBe(true);
    expect(config.includes("name: 'canvas'")).toBe(true);
    expect(config.includes("short_name: 'canvas'")).toBe(true);
    expect(config.includes('app-maskable-512.png')).toBe(true);
    expect(config.includes('site.webmanifest')).toBe(false);
    const notice = await Bun.file(new URL('../components/PwaUpdateNotice.tsx', import.meta.url)).text();
    expect(notice.includes('setNeedRefresh(false)')).toBe(true);
    expect(notice.includes('await updateServiceWorker(true)')).toBe(true);
    expect(notice.includes("onClick={() => { setNeedRefresh(false); setDetail(null); }}")).toBe(true);
  });
});

describe('pwa update gate', () => {
  test('activates only after the board is idle and the user approves', () => {
    expect(shouldActivateWorker(decidePwaUpdate(ready))).toBe(true);
    expect(decidePwaUpdate({ ...ready, editingNote: true }).action).toBe('block');
    expect(decidePwaUpdate({ ...ready, editingRelationship: true }).action).toBe('block');
    expect(decidePwaUpdate({ ...ready, focusedField: true }).action).toBe('block');
    expect(decidePwaUpdate({ ...ready, confirming: true }).action).toBe('block');
    expect(decidePwaUpdate({ ...ready, ingesting: true }).action).toBe('block');
    expect(decidePwaUpdate({ ...ready, hasUnpersisted: true }).action).toBe('flush');
    expect(shouldActivateWorker(decidePwaUpdate({ ...ready, hasUnpersisted: true }))).toBe(false);
    expect(decidePwaUpdate({ ...ready, saveStatus: 'saving' }).action).toBe('flush');
    expect(decidePwaUpdate({ ...ready, saveStatus: 'error' }).action).toBe('block');
    expect(decidePwaUpdate({ ...ready, hasRecovery: true }).action).toBe('block');
    expect(decidePwaUpdate({ ...ready, readOnly: true }).action).toBe('allow');
    expect(decidePwaUpdate({ ...ready, readOnly: true, hasUnpersisted: true }).action).toBe('block');
    expect(decidePwaUpdate({ ...ready, expectationMatches: false }).action).toBe('block');
  });
});

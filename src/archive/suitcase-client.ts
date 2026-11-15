import type { ZipListing } from './zip-directory';
import type { ExtractedZipEntry } from './zip-extract';

type InspectResult = { listing: ZipListing } | { error: string };
type ExtractResult = { entries: ExtractedZipEntry[] } | { error: string };
type WorkerResponse =
  | { id: number; type: 'inspect'; result: InspectResult }
  | { id: number; type: 'extract'; result: ExtractResult };

export function createSuitcaseClient() {
  let worker: Worker | null = null;
  let serial = 0;
  const pending = new Map<number, { resolve: (value: InspectResult | ExtractResult) => void; reject: (error: Error) => void }>();

  function port(): Worker {
    if (worker) return worker;
    worker = new Worker(new URL('./suitcase.worker.ts', import.meta.url), { type: 'module' });
    worker.onmessage = (event: MessageEvent<WorkerResponse>) => {
      const waiting = pending.get(event.data.id);
      if (!waiting) return;
      pending.delete(event.data.id);
      waiting.resolve(event.data.result);
    };
    worker.onerror = () => {
      for (const waiting of pending.values()) waiting.reject(new Error('The ZIP worker stopped.'));
      pending.clear();
      worker?.terminate();
      worker = null;
    };
    return worker;
  }

  function cancel(): void {
    serial += 1;
    for (const waiting of pending.values()) waiting.reject(new Error('The ZIP operation was canceled.'));
    pending.clear();
    worker?.terminate();
    worker = null;
  }

  function request<T>(message: { type: 'inspect'; archive: ArrayBuffer } | { type: 'extract'; archive: ArrayBuffer; paths: string[] }, transfer: Transferable[]): Promise<T> {
    const id = ++serial;
    const current = port();
    return new Promise((resolve, reject) => {
      pending.set(id, { resolve: (value) => resolve(value as T), reject });
      current.postMessage({ ...message, id }, transfer);
    });
  }

  return {
    inspect(archive: ArrayBuffer): Promise<InspectResult> {
      return request({ type: 'inspect', archive }, [archive]);
    },
    extract(archive: ArrayBuffer, paths: string[]): Promise<ExtractResult> {
      return request({ type: 'extract', archive, paths }, [archive]);
    },
    cancel,
  };
}

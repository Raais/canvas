import { extractZip } from './zip-extract';
import { inspectZip } from './zip-directory';

type InspectRequest = { id: number; type: 'inspect'; archive: ArrayBuffer };
type ExtractRequest = { id: number; type: 'extract'; archive: ArrayBuffer; paths: string[] };
type WorkerRequest = InspectRequest | ExtractRequest;

const scope = self as unknown as {
  onmessage: ((event: MessageEvent<WorkerRequest>) => void) | null;
  postMessage(message: unknown, transfer?: Transferable[]): void;
};

scope.onmessage = (event) => {
  const message = event.data;
  if (message.type === 'inspect') {
    scope.postMessage({ id: message.id, type: 'inspect', result: inspectZip(new Uint8Array(message.archive)) });
    return;
  }
  const result = extractZip(new Uint8Array(message.archive), message.paths);
  const transfer = 'entries' in result ? result.entries.flatMap((entry) => (entry.bytes.buffer instanceof ArrayBuffer ? [entry.bytes.buffer] : [])) : [];
  scope.postMessage({ id: message.id, type: 'extract', result }, transfer);
};

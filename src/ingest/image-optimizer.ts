export type OptimizerPort = {
  postMessage(message: unknown): void;
  terminate(): void;
  onmessage: ((event: { data: unknown }) => void) | null;
  onerror: ((event: Event) => void) | null;
};

export type OptimizerResult =
  | { ok: true; blob: Blob; width: number; height: number; sourceWidth: number; sourceHeight: number }
  | { ok: false; reason: 'failed' | 'cancelled' | 'timeout' | 'pixels'; sourceWidth?: number; sourceHeight?: number };

type WorkerReply = {
  id?: number;
  ok?: boolean;
  reason?: string;
  blob?: Blob;
  width?: number;
  height?: number;
  sourceWidth?: number;
  sourceHeight?: number;
};

type Job = {
  id: number;
  generation: number;
  blob: Blob;
  width: number;
  height: number;
  settled: boolean;
  timer: ReturnType<typeof setTimeout> | null;
  resolve: (result: OptimizerResult) => void;
};

export type ImageOptimizer = {
  readonly started: boolean;
  optimize(input: { blob: Blob; width: number; height: number }): Promise<OptimizerResult>;
  cancel(): void;
  dispose(): void;
};

export function createImageOptimizer(createPort: () => OptimizerPort = defaultPort, timeoutMs = 30_000): ImageOptimizer {
  let port: OptimizerPort | null = null;
  let generation = 0;
  let sequence = 0;
  const queue: Job[] = [];
  let active: Job | null = null;

  const finish = (job: Job, result: OptimizerResult) => {
    if (job.settled) return;
    job.settled = true;
    if (job.timer !== null) clearTimeout(job.timer);
    job.resolve(job.generation === generation ? result : { ok: false, reason: 'cancelled' });
  };

  const failActive = (reason: 'failed' | 'timeout') => {
    const job = active;
    active = null;
    if (job) finish(job, { ok: false, reason });
    port?.terminate();
    port = null;
    pump();
  };

  const pump = () => {
    if (active || queue.length === 0) return;
    if (!port) {
      port = createPort();
      const current = port;
      port.onmessage = (event) => {
        const data = event.data as WorkerReply;
        if (port !== current || !active || data.id !== active.id) return;
        const job = active;
        active = null;
        if (job.timer !== null) clearTimeout(job.timer);
        if (data.ok && data.blob && data.width && data.height && data.sourceWidth && data.sourceHeight) {
          finish(job, {
            ok: true,
            blob: data.blob,
            width: data.width,
            height: data.height,
            sourceWidth: data.sourceWidth,
            sourceHeight: data.sourceHeight,
          });
        } else if (data.reason === 'pixels') {
          finish(job, { ok: false, reason: 'pixels', sourceWidth: data.sourceWidth, sourceHeight: data.sourceHeight });
        } else {
          finish(job, { ok: false, reason: 'failed', sourceWidth: data.sourceWidth, sourceHeight: data.sourceHeight });
        }
        pump();
      };
      port.onerror = () => {
        if (port === current) failActive('failed');
      };
    }
    const current = port;
    const job = queue.shift();
    if (!job || !current) return;
    active = job;
    job.timer = setTimeout(() => {
      if (active !== job || port !== current) return;
      failActive('timeout');
    }, timeoutMs);
    current.postMessage({ id: job.id, blob: job.blob, width: job.width, height: job.height });
  };

  return {
    get started() {
      return port !== null;
    },
    optimize(input) {
      const jobGeneration = generation;
      return new Promise((resolve) => {
        const job: Job = {
          id: sequence + 1,
          generation: jobGeneration,
          blob: input.blob,
          width: input.width,
          height: input.height,
          settled: false,
          timer: null,
          resolve,
        };
        sequence = job.id;
        queue.push(job);
        pump();
      });
    },
    cancel() {
      generation += 1;
      const pending = active ? [active, ...queue] : [...queue];
      queue.length = 0;
      active = null;
      for (const job of pending) finish(job, { ok: false, reason: 'cancelled' });
    },
    dispose() {
      generation += 1;
      const pending = active ? [active, ...queue] : [...queue];
      queue.length = 0;
      active = null;
      for (const job of pending) finish(job, { ok: false, reason: 'cancelled' });
      port?.terminate();
      port = null;
    },
  };
}

function defaultPort(): OptimizerPort {
  return new Worker(new URL('./image-optimizer.worker.ts', import.meta.url), { type: 'module' }) as OptimizerPort;
}

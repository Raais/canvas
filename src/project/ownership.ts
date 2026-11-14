export const WRITE_LOCK_NAME = 'raais-canvas-active-board-v1';

export type LockManager = {
  request(
    name: string,
    options: { mode: 'exclusive'; ifAvailable: true },
    callback: (lock: { name: string } | null) => Promise<void> | void,
  ): Promise<void>;
};

export type WriteClaim = 'owned' | 'denied' | 'unavailable';

export function createWriteSession(locks: LockManager | null) {
  let clients = 0;
  let releaseHold: (() => void) | null = null;
  let pending: Promise<WriteClaim> | null = null;

  return {
    retain(): Promise<WriteClaim> {
      clients += 1;
      if (!locks) return Promise.resolve('unavailable');
      if (!pending) {
        pending = new Promise((resolve) => {
          void locks.request(WRITE_LOCK_NAME, { mode: 'exclusive', ifAvailable: true }, async (lock) => {
            if (!lock || clients === 0) {
              resolve('denied');
              if (clients === 0) pending = null;
              return;
            }
            resolve('owned');
            await new Promise<void>((release) => {
              releaseHold = release;
            });
          }).catch(() => {
            if (pending) resolve('denied');
          });
        });
      }
      return pending;
    },
    release(): void {
      clients = Math.max(0, clients - 1);
      queueMicrotask(() => {
        if (clients > 0 || !releaseHold) return;
        const release = releaseHold;
        releaseHold = null;
        pending = null;
        release();
      });
    },
  };
}

const browserLocks = typeof navigator !== 'undefined' && navigator.locks ? (navigator.locks as unknown as LockManager) : null;
const browserSession = createWriteSession(browserLocks);

export function retainWriteLock(): Promise<WriteClaim> {
  return browserSession.retain();
}

export function releaseWriteLock(): void {
  browserSession.release();
}

export function createMockLocks(): LockManager {
  let held = false;
  return {
    request(_name, _options, callback) {
      if (held) return Promise.resolve(callback(null)).then(() => undefined);
      held = true;
      return Promise.resolve(callback({ name: WRITE_LOCK_NAME })).finally(() => {
        held = false;
      });
    },
  };
}

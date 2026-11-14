export type TabMessage =
  | { type: 'hello'; tabId: string; openedAt: number }
  | { type: 'hello-ack'; tabId: string; openedAt: number; writer: boolean }
  | { type: 'saved'; tabId: string; boardId: string; revision: number };

export type TabBus = {
  post(message: TabMessage): void;
  listen(handler: (message: TabMessage) => void): () => void;
};

export type BoardChannel = {
  close(): void;
  announce(boardId: string, revision: number): void;
};

export function otherTabWins(
  self: { tabId: string; openedAt: number },
  other: { tabId: string; openedAt: number },
): boolean {
  if (other.openedAt !== self.openedAt) return other.openedAt < self.openedAt;
  return other.tabId < self.tabId;
}

export function memoryTabHub() {
  const listeners = new Set<(message: TabMessage) => void>();
  return {
    connect(): TabBus {
      return {
        post(message) {
          for (const listener of [...listeners]) listener(message);
        },
        listen(handler) {
          listeners.add(handler);
          return () => listeners.delete(handler);
        },
      };
    },
  };
}

export function openBoardChannel(
  self: { tabId: string; openedAt: number },
  hooks: {
    isWriter: () => boolean;
    locksAuthoritative: boolean;
    onYield: () => void;
    onRemoteSave: (message: { boardId: string; revision: number }) => void;
  },
  bus: TabBus | null = browserBus(),
): BoardChannel {
  if (!bus) return { close() {}, announce() {} };
  const stop = bus.listen((data) => {
    if (!data || data.tabId === self.tabId) return;
    if (data.type === 'hello') {
      bus.post({ type: 'hello-ack', tabId: self.tabId, openedAt: self.openedAt, writer: hooks.isWriter() });
      if (!hooks.locksAuthoritative && otherTabWins(self, data)) hooks.onYield();
      return;
    }
    if (data.type === 'hello-ack') {
      if (!hooks.locksAuthoritative && (data.writer || otherTabWins(self, data))) hooks.onYield();
      return;
    }
    if (data.type === 'saved' && typeof data.boardId === 'string' && typeof data.revision === 'number') {
      hooks.onRemoteSave({ boardId: data.boardId, revision: data.revision });
    }
  });
  bus.post({ type: 'hello', tabId: self.tabId, openedAt: self.openedAt });
  return {
    close() {
      stop();
    },
    announce(boardId, revision) {
      bus.post({ type: 'saved', tabId: self.tabId, boardId, revision });
    },
  };
}

function browserBus(): TabBus | null {
  if (typeof BroadcastChannel === 'undefined') return null;
  const channel = new BroadcastChannel('canvas-board');
  return {
    post(message) {
      channel.postMessage(message);
    },
    listen(handler) {
      const onMessage = (event: MessageEvent) => handler(event.data as TabMessage);
      channel.addEventListener('message', onMessage);
      return () => {
        channel.removeEventListener('message', onMessage);
        channel.close();
      };
    },
  };
}

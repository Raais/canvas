export type BoardChannel = {
  close(): void;
  announce(boardId: string, revision: number): void;
};

export function openBoardChannel(
  self: { tabId: string; openedAt: number },
  onForeign: () => void,
  onRemoteSave: (message: { boardId: string; revision: number }) => void,
): BoardChannel {
  if (typeof BroadcastChannel === 'undefined') {
    return { close() {}, announce() {} };
  }
  const channel = new BroadcastChannel('canvas-board');
  let replied = false;
  channel.onmessage = (event: MessageEvent) => {
    const data = event.data as { type?: string; tabId?: string; openedAt?: number; boardId?: string; revision?: number } | null;
    if (!data || data.tabId === self.tabId) return;
    if (data.type === 'hello' && typeof data.openedAt === 'number') {
      if (data.openedAt < self.openedAt) onForeign();
      else if (!replied) {
        replied = true;
        channel.postMessage({ type: 'hello', tabId: self.tabId, openedAt: self.openedAt });
      }
    }
    if (data.type === 'saved' && typeof data.boardId === 'string' && typeof data.revision === 'number') {
      onRemoteSave({ boardId: data.boardId, revision: data.revision });
    }
  };
  channel.postMessage({ type: 'hello', tabId: self.tabId, openedAt: self.openedAt });
  return {
    close() {
      channel.close();
    },
    announce(boardId, revision) {
      channel.postMessage({ type: 'saved', tabId: self.tabId, boardId, revision });
    },
  };
}

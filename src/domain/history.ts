import type { Board } from './types';

const HISTORY_LIMIT = 100;

export type History = {
  past: Board[];
  future: Board[];
};

export function createHistory(): History {
  return { past: [], future: [] };
}

export function pushHistory(history: History, before: Board): History {
  const past = [...history.past, cloneBoard(before)];
  if (past.length > HISTORY_LIMIT) past.shift();
  return { past, future: [] };
}

export function undoHistory(history: History, current: Board): { history: History; board: Board } | null {
  const previous = history.past[history.past.length - 1];
  if (!previous) return null;
  return {
    history: { past: history.past.slice(0, -1), future: [...history.future, cloneBoard(current)] },
    board: revive(previous, current),
  };
}

export function redoHistory(history: History, current: Board): { history: History; board: Board } | null {
  const next = history.future[history.future.length - 1];
  if (!next) return null;
  return {
    history: { past: [...history.past, cloneBoard(current)], future: history.future.slice(0, -1) },
    board: revive(next, current),
  };
}

export function retainedAssetIds(current: Board, history: History): Set<string> {
  const ids = new Set<string>();
  for (const board of [current, ...history.past, ...history.future]) {
    for (const node of board.nodes) {
      if (node.kind === 'image' && node.source.type === 'embedded') ids.add(node.source.assetId);
    }
  }
  return ids;
}

function revive(snapshot: Board, current: Board): Board {
  return {
    ...cloneBoard(snapshot),
    appearance: current.appearance,
    viewport: { ...current.viewport },
    revision: current.revision + 1,
    updatedAt: new Date().toISOString(),
  };
}

function cloneBoard(board: Board): Board {
  return structuredClone(board);
}

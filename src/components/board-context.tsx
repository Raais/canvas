import { createContext, useContext } from 'react';
import type { ImageDisplayMode } from '../domain/types';

export type BoardActions = {
  beginEditing: (id: string) => void;
  updateText: (id: string, text: string) => void;
  endEditing: () => void;
  setMode: (id: string, mode: ImageDisplayMode) => void;
  noteIntrinsicSize: (id: string, width: number, height: number) => void;
};

const BoardActionsContext = createContext<BoardActions | null>(null);

export const BoardActionsProvider = BoardActionsContext.Provider;

export function useBoardActions(): BoardActions {
  const actions = useContext(BoardActionsContext);
  if (!actions) throw new Error('Board actions are unavailable');
  return actions;
}

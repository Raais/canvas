import { createContext, useContext } from 'react';
import type { EdgeStyle, ImageDisplayMode } from '../domain/types';

export type BoardActions = {
  beginEditing: (id: string) => void;
  requestProtect: (id: string) => void;
  requestUnlock: (id: string) => void;
  lockNote: (id: string) => void;
  removeProtection: (id: string) => void;
  updateText: (id: string, text: string) => void;
  editingToken: (id: string) => number | null;
  endEditing: (token: number) => void;
  setMode: (id: string, mode: ImageDisplayMode) => void;
  setPresentation: (id: string, presentation: 'text' | 'markdown' | 'code') => void;
  setNoteTone: (id: string, kind: 'background' | 'text', tone: string) => void;
  setCodeLanguage: (id: string, language: string) => void;
  toggleTask: (id: string, index: number) => void;
  setCornerStyle: (id: string, style: 'rounded' | 'square') => void;
  toggleFlip: (id: string, axis: 'x' | 'y') => void;
  setRotation: (id: string, rotation: number) => void;
  setRotationAdjusting: (active: boolean) => void;
  noteIntrinsicSize: (id: string, width: number, height: number) => void;
  renameGroup: (id: string, label: string) => void;
  endRename: () => void;
  cancelRename: () => void;
  createNoteIn: (groupId: string) => void;
  requestDeleteContents: (groupId: string) => void;
  deleteContents: (groupId: string) => void;
  setGroupTone: (id: string, tone: string) => void;
  commitEdgeLabel: (id: string, label: string) => void;
  setRelationshipStyle: (id: string, style: EdgeStyle) => void;
  downloadFile: (id: string) => void;
  renameVoice: (id: string, title: string) => void;
  downloadVoice: (id: string) => void;
  playVoice: (id: string) => Promise<void>;
  releaseVoice: (id: string) => void;
  editWebsite: (id: string) => void;
  deleteRelationship: (id: string) => void;
  claimEdgeEditor: (id: string) => number;
  ownsEdgeEditor: (id: string, token: number) => boolean;
  releaseEdgeEditor: (id: string, token: number) => boolean;
};

const BoardActionsContext = createContext<BoardActions | null>(null);

export const BoardActionsProvider = BoardActionsContext.Provider;

export function useBoardActions(): BoardActions {
  const actions = useContext(BoardActionsContext);
  if (!actions) throw new Error('Board actions are unavailable');
  return actions;
}

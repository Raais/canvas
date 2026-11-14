import { setViewport } from '../domain/board';
import type { Board, Viewport } from '../domain/types';

/** Zoom controls may move the local view. Only the owning tab stores that viewport. */
export function canonicalViewportUpdate(blocked: boolean, board: Board, viewport: Viewport): Board | null {
  if (blocked) return null;
  const next = setViewport(board, viewport);
  return next === board ? null : next;
}

import { revise } from './board';
import { MAX_SAVED_VIEW_NAME, MAX_SAVED_VIEWS, MAX_ZOOM, MIN_ZOOM, type Board, type SavedView, type Viewport } from './types';

export type SavedViewEdit =
  | { type: 'add'; name: string; viewport: Viewport }
  | { type: 'rename'; id: string; name: string }
  | { type: 'update'; id: string; viewport: Viewport }
  | { type: 'delete'; id: string };

export function nextViewName(views: readonly SavedView[]): string {
  const used = new Set(views.map((view) => view.name));
  for (let index = 1; index <= MAX_SAVED_VIEWS; index += 1) {
    const name = `View ${index}`;
    if (!used.has(name)) return name;
  }
  return 'View';
}

export function cleanViewName(value: string): string | null {
  if (/[\u0000-\u001F\u007F]/.test(value)) return null;
  const name = value.trim();
  if (!name || name.length > MAX_SAVED_VIEW_NAME) return null;
  return name;
}

export function viewViewport(viewport: Viewport): Viewport | null {
  if (!Number.isFinite(viewport.x) || !Number.isFinite(viewport.y) || !Number.isFinite(viewport.zoom)) return null;
  if (viewport.zoom < MIN_ZOOM || viewport.zoom > MAX_ZOOM) return null;
  return { x: viewport.x, y: viewport.y, zoom: viewport.zoom };
}

export function recallViewport(view: SavedView): Viewport {
  return {
    x: view.viewport.x,
    y: view.viewport.y,
    zoom: Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, view.viewport.zoom)),
  };
}

export function editSavedView(blocked: boolean, board: Board, edit: SavedViewEdit): Board | null {
  if (blocked) return null;
  if (edit.type === 'add') return addSavedView(board, edit.name, edit.viewport);
  if (edit.type === 'rename') return renameSavedView(board, edit.id, edit.name);
  if (edit.type === 'update') return updateSavedView(board, edit.id, edit.viewport);
  return deleteSavedView(board, edit.id);
}

export function addSavedView(board: Board, name: string, viewport: Viewport): Board | null {
  const clean = cleanViewName(name);
  const stored = viewViewport(viewport);
  if (!clean || !stored || board.savedViews.length >= MAX_SAVED_VIEWS) return null;
  const view: SavedView = { id: crypto.randomUUID(), name: clean, viewport: stored };
  return revise(board, { savedViews: [...board.savedViews, view] });
}

export function renameSavedView(board: Board, id: string, name: string): Board | null {
  const clean = cleanViewName(name);
  if (!clean) return null;
  let changed = false;
  const savedViews = board.savedViews.map((view) => {
    if (view.id !== id || view.name === clean) return view;
    changed = true;
    return { ...view, name: clean };
  });
  if (!changed) return board;
  return revise(board, { savedViews });
}

export function updateSavedView(board: Board, id: string, viewport: Viewport): Board | null {
  const stored = viewViewport(viewport);
  if (!stored) return null;
  let changed = false;
  const savedViews = board.savedViews.map((view) => {
    if (view.id !== id) return view;
    if (view.viewport.x === stored.x && view.viewport.y === stored.y && view.viewport.zoom === stored.zoom) return view;
    changed = true;
    return { ...view, viewport: stored };
  });
  if (!changed) return board;
  return revise(board, { savedViews });
}

export function deleteSavedView(board: Board, id: string): Board | null {
  const savedViews = board.savedViews.filter((view) => view.id !== id);
  if (savedViews.length === board.savedViews.length) return board;
  return revise(board, { savedViews });
}

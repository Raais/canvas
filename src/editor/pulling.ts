import { relaxBoard } from '../domain/physics';
import type { Board } from '../domain/types';

/** React Flow selection modifier. Shift still draws a selection on the pane. */
export const FLOW_SELECTION_KEY = 'Shift' as const;
/** Adding to a selection stays on Cmd/Ctrl. Shift does not become the multi-select key. */
export const FLOW_MULTI_SELECTION_KEYS = ['Meta', 'Control'] as const;

export function effectivePullingForce(
  projectEnabled: boolean,
  shiftHeld: boolean,
  draggedNodeCount: number,
): boolean {
  return draggedNodeCount === 1 ? projectEnabled !== shiftHeld : projectEnabled;
}

export function shouldRelaxDrag(sawDrag: boolean, dragFinished: boolean): boolean {
  return sawDrag || dragFinished;
}

export type ShiftSignal = 'shift-down' | 'shift-up' | 'blur' | 'hide' | 'cancel' | { pointer: boolean };

export function nextShiftHeld(_held: boolean, signal: ShiftSignal): boolean {
  if (signal === 'shift-down') return true;
  if (signal === 'shift-up' || signal === 'blur' || signal === 'hide' || signal === 'cancel') return false;
  return signal.pointer;
}

type DragChange = { type: string; id?: string; dragging?: boolean };
type DragNode = { id: string; kind: string; parentId?: string };

/** Count physics bodies being dragged. Children carried by a dragged group frame are not extra drags. */
export function dragBodyUpdates(changes: readonly DragChange[], nodes: readonly DragNode[]): { id: string; dragging: boolean }[] {
  const draggingParents = new Set(
    changes.flatMap((change) =>
      change.type === 'position' && change.dragging === true && change.id != null && nodes.some((node) => node.id === change.id && node.kind === 'group')
        ? [change.id]
        : [],
    ),
  );
  const updates: { id: string; dragging: boolean }[] = [];
  for (const change of changes) {
    if (change.type !== 'position' || !change.id || (change.dragging !== true && change.dragging !== false)) continue;
    const node = nodes.find((entry) => entry.id === change.id);
    if (!node) continue;
    if (node.parentId && draggingParents.has(node.parentId)) continue;
    updates.push({ id: change.id, dragging: change.dragging === true });
  }
  return updates;
}

/** Returns how many bodies are in the gesture, including ones that finish in this batch. */
export function syncDragLedger(ledger: Set<string>, updates: readonly { id: string; dragging: boolean }[]): number {
  if (updates.length === 0) return ledger.size;
  const ending = new Set<string>();
  for (const update of updates) {
    if (update.dragging) ledger.add(update.id);
    else ending.add(update.id);
  }
  for (const id of ending) ledger.add(id);
  const count = ledger.size;
  const stillDragging = [...ledger].some((id) => !ending.has(id));
  if (!stillDragging) ledger.clear();
  else {
    for (const id of ending) ledger.delete(id);
  }
  return count;
}

export function relaxDrag(
  board: Board,
  pinnedNodeIds: readonly string[],
  input: {
    projectEnabled: boolean;
    shiftHeld: boolean;
    draggedNodeCount: number;
    live: boolean;
    settle: boolean;
  },
): Board {
  if (!effectivePullingForce(input.projectEnabled, input.shiftHeld, input.draggedNodeCount)) return board;
  let next = board;
  if (input.live) next = relaxBoard(next, pinnedNodeIds, 4);
  if (input.settle) next = relaxBoard(next, pinnedNodeIds, 40);
  return next;
}

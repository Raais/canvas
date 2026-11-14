import type { HandleSide } from '../domain/types';

/** React Flow's native centering. This stays on the measured handle and must not include zoom scale. */
export function handleAnchorTransform(side: HandleSide): string {
  if (side === 'right') return 'translate(50%, -50%)';
  if (side === 'bottom') return 'translate(-50%, 50%)';
  return 'translate(-50%, -50%)';
}

/** Decorative circle only. Scaling this does not move the measured attachment point. */
export function visualHandleTransform(): string {
  return 'translate(-50%, -50%) scale(var(--handle-scale, 1))';
}

export const HANDLE_SIDES = ['top', 'right', 'bottom', 'left'] as const satisfies readonly HandleSide[];

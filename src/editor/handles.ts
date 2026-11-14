import type { HandleSide } from '../domain/types';

export function handleTransform(side: HandleSide): string {
  const shift = {
    top: 'translate(-50%, -50%)',
    right: 'translate(50%, -50%)',
    bottom: 'translate(-50%, 50%)',
    left: 'translate(-50%, -50%)',
  }[side];
  return `${shift} scale(var(--handle-scale, 1))`;
}

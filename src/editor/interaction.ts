export function sameSelection(left: readonly string[], right: readonly string[]): boolean {
  if (left.length !== right.length) return false;
  const seen = new Set(right);
  if (seen.size !== right.length) return false;
  return left.every((id) => seen.has(id));
}

export type GestureFlags = {
  sawDrag: boolean;
  dragFinished: boolean;
  resizeActive: boolean;
  resizeFinished: boolean;
  barePosition: boolean;
  changed: boolean;
  tracking: boolean;
};

export function gesturePhase(input: GestureFlags): 'commit' | 'live' | 'idle' {
  const finish = input.dragFinished || input.resizeFinished || (input.barePosition && !input.resizeActive);
  if (finish) return input.tracking || input.changed ? 'commit' : 'idle';
  if (input.changed) return 'live';
  return 'idle';
}

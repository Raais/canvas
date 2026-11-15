export type InkPointerState = {
  open: boolean;
};

export type InkPointerInput = {
  isPrimary: boolean;
  button: number;
  readOnly: boolean;
  spaceHeld: boolean;
};

export function onInkPointerDown(
  state: InkPointerState,
  input: InkPointerInput,
): { state: InkPointerState; effect: 'start' | 'cancel' | 'ignore' } {
  if (state.open) return { state: { open: false }, effect: 'cancel' };
  if (input.readOnly || input.spaceHeld || input.button !== 0 || !input.isPrimary) return { state, effect: 'ignore' };
  return { state: { open: true }, effect: 'start' };
}

export function onInkPointerFinish(
  state: InkPointerState,
  matchesActive: boolean,
  reason: 'up' | 'cancel',
): { state: InkPointerState; effect: 'commit' | 'cancel' | 'ignore' } {
  if (!state.open || !matchesActive) return { state: { open: false }, effect: 'ignore' };
  if (reason === 'cancel') return { state: { open: false }, effect: 'cancel' };
  return { state: { open: false }, effect: 'commit' };
}

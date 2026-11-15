export type InkPointerState = {
  open: boolean;
};

export type InkPointerInput = {
  isPrimary: boolean;
  button: number;
  readOnly: boolean;
  spaceHeld: boolean;
};

export type InkGestureState = {
  open: boolean;
  pointerId: number | null;
  sessionId: string;
  readOnly: boolean;
};

export type InkEvent =
  | { type: 'down'; pointerId: number; isPrimary: boolean; button: number; readOnly: boolean; spaceHeld: boolean; sessionId: string }
  | { type: 'up'; pointerId: number }
  | { type: 'cancel'; pointerId: number }
  | { type: 'lost-capture'; pointerId: number }
  | { type: 'revision' }
  | { type: 'replace'; sessionId: string }
  | { type: 'read-only'; readOnly: boolean }
  | { type: 'escape' }
  | { type: 'tool' }
  | { type: 'blur' }
  | { type: 'viewport' };

export type InkGestureEffect = 'start' | 'commit' | 'cancel' | 'ignore';

function close(state: InkGestureState, patch: Partial<InkGestureState> = {}): InkGestureState {
  return { ...state, ...patch, open: false, pointerId: null };
}

export function reduceInkGesture(state: InkGestureState, event: InkEvent): { state: InkGestureState; effect: InkGestureEffect } {
  if (event.type === 'revision' || event.type === 'lost-capture') return { state, effect: 'ignore' };
  if (event.type === 'escape' || event.type === 'tool' || event.type === 'blur' || event.type === 'viewport') {
    if (!state.open) return { state, effect: 'ignore' };
    return { state: close(state), effect: 'cancel' };
  }
  if (event.type === 'replace') {
    if (!state.open) return { state: { ...state, sessionId: event.sessionId }, effect: 'ignore' };
    if (event.sessionId === state.sessionId) return { state, effect: 'ignore' };
    return { state: close(state, { sessionId: event.sessionId }), effect: 'cancel' };
  }
  if (event.type === 'read-only') {
    if (!state.open) return { state: { ...state, readOnly: event.readOnly }, effect: 'ignore' };
    if (event.readOnly === state.readOnly) return { state, effect: 'ignore' };
    return { state: close(state, { readOnly: event.readOnly }), effect: 'cancel' };
  }
  if (event.type === 'down') {
    if (state.open) return { state: close(state), effect: 'cancel' };
    if (event.readOnly || event.spaceHeld || event.button !== 0 || !event.isPrimary) return { state, effect: 'ignore' };
    return {
      state: { open: true, pointerId: event.pointerId, sessionId: event.sessionId, readOnly: false },
      effect: 'start',
    };
  }
  if (event.type === 'cancel') {
    if (!state.open || state.pointerId !== event.pointerId) return { state, effect: 'ignore' };
    return { state: close(state), effect: 'cancel' };
  }
  if (!state.open || state.pointerId !== event.pointerId || state.readOnly) {
    if (state.open && state.pointerId === event.pointerId && state.readOnly) return { state: close(state), effect: 'cancel' };
    return { state, effect: 'ignore' };
  }
  return { state: close(state), effect: 'commit' };
}

export function onInkPointerDown(
  state: InkPointerState,
  input: InkPointerInput,
): { state: InkPointerState; effect: 'start' | 'cancel' | 'ignore' } {
  const result = reduceInkGesture(
    { open: state.open, pointerId: state.open ? 1 : null, sessionId: '', readOnly: false },
    { type: 'down', pointerId: state.open ? 2 : 1, isPrimary: input.isPrimary, button: input.button, readOnly: input.readOnly, spaceHeld: input.spaceHeld, sessionId: '' },
  );
  return { state: { open: result.state.open }, effect: result.effect === 'commit' ? 'ignore' : result.effect };
}

export function onInkPointerFinish(
  state: InkPointerState,
  matchesActive: boolean,
  reason: 'up' | 'cancel',
): { state: InkPointerState; effect: 'commit' | 'cancel' | 'ignore' } {
  if (!state.open || !matchesActive) return { state: { open: false }, effect: 'ignore' };
  const result = reduceInkGesture(
    { open: true, pointerId: 1, sessionId: '', readOnly: false },
    reason === 'cancel' ? { type: 'cancel', pointerId: 1 } : { type: 'up', pointerId: 1 },
  );
  return { state: { open: result.state.open }, effect: result.effect === 'start' ? 'ignore' : result.effect };
}

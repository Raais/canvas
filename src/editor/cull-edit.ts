/** A Strict Mode remount bumps the generation before the deferred cleanup runs. */
export function isFinalUnmount(mountedGeneration: number, currentGeneration: number): boolean {
  return currentGeneration === mountedGeneration;
}

export type OwnedSession = { id: string; token: number };

/** Each begin gets a new token, so a deferred cleanup cannot close a later session. */
export function nextOwnedSession(currentToken: number, id: string): { token: number; session: OwnedSession } {
  const token = currentToken + 1;
  return { token, session: { id, token } };
}

export function textCleanupAction(active: OwnedSession | null, requestedToken: number): 'close' | 'ignore' {
  if (!active || active.token !== requestedToken) return 'ignore';
  return 'close';
}

/** Decide what an edge-label cleanup should do after the component is gone. */
export function finalizeCulledEdgeLabel(input: {
  finalUnmount: boolean;
  closed: boolean;
  cancelled: boolean;
  owns: boolean;
}): 'ignore' | 'commit' | 'commit-only' | 'clear' {
  if (!input.finalUnmount || input.closed) return 'ignore';
  if (!input.owns) return input.cancelled ? 'ignore' : 'commit-only';
  return input.cancelled ? 'clear' : 'commit';
}

/** A Strict Mode remount bumps the generation before the deferred cleanup runs. */
export function isFinalUnmount(mountedGeneration: number, currentGeneration: number): boolean {
  return currentGeneration === mountedGeneration;
}

/** Decide what an edge-label cleanup should do after the component is gone. */
export function finalizeCulledEdgeLabel(input: {
  finalUnmount: boolean;
  closed: boolean;
  cancelled: boolean;
}): 'ignore' | 'commit' | 'clear' {
  if (!input.finalUnmount || input.closed) return 'ignore';
  return input.cancelled ? 'clear' : 'commit';
}

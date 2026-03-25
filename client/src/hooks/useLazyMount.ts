import { useReducer } from 'react';

/**
 * Returns true once `trigger` has been truthy at least once.
 * Used to defer mounting lazy-loaded components until first needed,
 * while keeping them mounted afterwards to preserve exit animations.
 *
 * Uses useReducer to derive the latch state without render-time ref
 * mutation (unsafe in concurrent mode) or setState-in-effect (lint).
 * React re-evaluates the reducer when `trigger` changes via the parent.
 */
export function useLazyMount(trigger: unknown): boolean {
  // One-way latch: once dispatched, stays true forever.
  const [mounted, mount] = useReducer(() => true, Boolean(trigger));

  // When trigger becomes truthy for the first time, latch on.
  if (trigger && !mounted) mount();

  return mounted;
}

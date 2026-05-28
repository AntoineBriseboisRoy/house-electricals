import { useEffect, useState, type Dispatch, type SetStateAction } from 'react';

/**
 * Cycle-60: lightweight filter+sort state with localStorage persistence.
 *
 * Intentionally simpler than HousesTracker's `usePersistedReducer` —
 * House Electricals has no URL-deep-linkable filter requirement (yet) so we
 * skip URL sync + reducer machinery. If URL sync is needed in a future
 * cycle, that's an additive bolt-on, not a rewrite.
 *
 * Reads from localStorage on mount (with a shallow merge over defaults so
 * adding a new field in a later cycle doesn't break older serialized
 * state). Writes on every state change.
 */
export const useFilterState = <S extends object>(
  storageKey: string,
  defaults: S
): [S, Dispatch<SetStateAction<S>>] => {
  const [state, setState] = useState<S>(() => {
    if (typeof window === 'undefined') return defaults;
    try {
      const raw = window.localStorage.getItem(storageKey);
      if (!raw) return defaults;
      const parsed = JSON.parse(raw) as Partial<S>;
      return { ...defaults, ...parsed };
    } catch {
      return defaults;
    }
  });

  useEffect(() => {
    if (typeof window === 'undefined') return;
    try {
      window.localStorage.setItem(storageKey, JSON.stringify(state));
    } catch {
      // localStorage may be unavailable (private browsing, quota); ignore.
    }
  }, [storageKey, state]);

  return [state, setState];
};

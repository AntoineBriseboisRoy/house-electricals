import { useEffect, useRef } from 'react';
import { toast } from '../ui/toast.js';
import type { PatchError } from './useOptimisticPatch.js';

/**
 * Drain a `useOptimisticPatch` error stream into sonner toasts.
 *
 * The hook holds a ref of the ids it has already shown so re-renders don't
 * re-fire the same toast. The optimistic hook also calls `clear()` from the
 * caller side — that path is unaffected.
 *
 * Usage:
 *   const optimistic = useOptimisticPatch(...);
 *   useToastSink(optimistic.errors);
 *
 * The inline error banner can then be removed from the screen.
 */
export const useToastSink = (errors: ReadonlyArray<PatchError>): void => {
  // We dedupe by id+message — if the same id fails again with a different
  // message, that's worth re-toasting; same id+same message is not.
  const seen = useRef<Set<string>>(new Set());

  useEffect(() => {
    for (const e of errors) {
      const key = `${e.id}::${e.message}`;
      if (seen.current.has(key)) continue;
      seen.current.add(key);
      toast.error(e.message, {
        // Keep the toast around long enough for the user to read it on mobile.
        duration: 5000,
      });
    }
    // If the errors list shrinks (caller `clear()`d or all items retried OK),
    // prune the seen-set so a future failure of the same id can re-toast.
    const live = new Set(errors.map((e) => `${e.id}::${e.message}`));
    for (const k of seen.current) {
      if (!live.has(k)) seen.current.delete(k);
    }
  }, [errors]);
};

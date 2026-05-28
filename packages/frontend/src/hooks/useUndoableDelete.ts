/**
 * useUndoableDelete (G42(c) — cycle-47, extended G42(f) — cycle-50).
 *
 * Generic hook for deferred-DELETE with a 30-second undo window. Wraps
 * sonner via ui/toast.ts; the actual server DELETE is held by a
 * setTimeout, cancelled if the user clicks "Undo" on the toast.
 *
 * Cycle-50 adds `deleteManyWithUndo(entries[])` for batched bulk delete:
 * ONE shared timer fires Promise.allSettled across all per-id commits at
 * T+30s, ONE shared sonner toast hosts a single Undo button that cancels
 * the shared timer + restores ALL entries' optimistic state. Per-id
 * entries are still tracked in `pendingDeletes` (so an in-flight bulk
 * survives a route change), but they all share the same `timer` and
 * `toastId` — cancelling any one of them cancels the batch.
 *
 * See CLAUDE.md "Undoable delete (G42(c) — cycle-47)" + "Bulk-actions on
 * ComponentsScreen (G42(f) — cycle-50)" for the pinned contract — including
 * why this is deferred-DELETE rather than delete-then-recreate, and why
 * bulk delete shares one timer instead of N independent ones.
 */

import { useCallback } from 'react';
import { toast } from '../ui/toast.js';
import {
  cancelPendingDelete,
  completePendingDelete,
  schedulePendingDelete,
} from '../lib/pendingDeletes.js';

const UNDO_WINDOW_MS = 30_000;

export type UndoableDeleteOptions = {
  /** Stable id of the resource being deleted. */
  id: string;
  /** Resource type for queue keying / debugging. e.g. 'component'. */
  resourceType: string;
  /** Human-readable label for the toast message. e.g. "Kitchen Outlet". */
  label: string;
  /** Optimistic UI removal — run immediately on call. */
  removeOptimistically: () => void;
  /** Restore the optimistic UI on undo (or on commit error). */
  restore: () => void;
  /** Server-side commit fn (the real api.deleteX). Called at T+30s if
   *  the user never clicked Undo. */
  commit: () => Promise<void>;
  /** Optional callback after the server commit succeeds. */
  onCommitted?: () => void;
};

/** Per-id entry in a batched delete. The optimistic + restore halves are
 *  invoked from the caller's hook setup; the hook only needs the id +
 *  commit to wire the shared queue. */
export type UndoableBatchEntry = {
  id: string;
  resourceType: string;
  /** Optional per-id label used only for the failure-tail toast. */
  label?: string;
  commit: () => Promise<void>;
};

export type UndoableBatchOptions = {
  /** Per-id entries. Each gets its own pendingDeletes row + commit. */
  entries: readonly UndoableBatchEntry[];
  /** Optimistic UI removal of ALL rows — run immediately. */
  removeOptimistically: () => void;
  /** Restore ALL rows on undo (or on commit error). One callback for
   *  the whole batch — the caller typically snapshots prevList up front
   *  and `setComponents(prevList)` here. */
  restore: () => void;
  /** Pluralized resource name for the toast, e.g. 'components'. */
  resourceNamePlural: string;
  /** Optional callback once all commits succeed. */
  onCommitted?: () => void;
};

export const useUndoableDelete = (): {
  deleteWithUndo: (opts: UndoableDeleteOptions) => void;
  deleteManyWithUndo: (opts: UndoableBatchOptions) => void;
} => {
  const deleteWithUndo = useCallback((opts: UndoableDeleteOptions): void => {
    // Optimistic UI removal — fire immediately so the row disappears.
    opts.removeOptimistically();

    // Schedule the deferred server commit. If the user clicks Undo
    // within UNDO_WINDOW_MS, cancelPendingDelete clears this timer.
    const timer = setTimeout(() => {
      void (async () => {
        try {
          await opts.commit();
          completePendingDelete(opts.id);
          opts.onCommitted?.();
        } catch (err) {
          // Server commit failed at T+30s — restore the UI so the user
          // isn't lying to themselves about the row being gone.
          opts.restore();
          completePendingDelete(opts.id);
          toast.error(
            err instanceof Error
              ? `Failed to delete: ${err.message}`
              : 'Failed to delete.'
          );
        }
      })();
    }, UNDO_WINDOW_MS);

    // Show the undo toast — sonner's `action` button hosts the cancel.
    const toastId = toast(`Deleted ${opts.label}`, {
      duration: UNDO_WINDOW_MS,
      action: {
        label: 'Undo',
        onClick: () => {
          const cancelled = cancelPendingDelete(opts.id);
          if (cancelled) {
            opts.restore();
          }
        },
      },
    });

    schedulePendingDelete({
      id: opts.id,
      resourceType: opts.resourceType,
      commit: opts.commit,
      onUndo: opts.restore,
      timer,
      toastId,
    });
  }, []);

  /**
   * Batched variant — ONE shared timer + ONE shared toast for N deletes.
   *
   * Per-id entries land in the same `pendingDeletes` queue (so they
   * survive a route change), but they all share the same `timer` and
   * `toastId`. The Undo handler iterates the ids and `cancelPendingDelete`s
   * each one (cancelling any of them clears the shared timer via
   * clearTimeout; subsequent cancels are idempotent no-ops because the
   * entry has been removed from the queue).
   */
  const deleteManyWithUndo = useCallback(
    (opts: UndoableBatchOptions): void => {
      const { entries } = opts;
      if (entries.length === 0) return;

      // Optimistic removal of all rows up front.
      opts.removeOptimistically();

      // ONE shared timer — fires Promise.allSettled across all commits.
      const ids = entries.map((e) => e.id);
      const sharedTimer = setTimeout(() => {
        void (async () => {
          const results = await Promise.allSettled(
            entries.map((e) => e.commit())
          );
          // Complete every per-id entry in the queue.
          for (const id of ids) {
            completePendingDelete(id);
          }
          const failures = results.filter(
            (r): r is PromiseRejectedResult => r.status === 'rejected'
          );
          if (failures.length === 0) {
            opts.onCommitted?.();
          } else if (failures.length === entries.length) {
            // All failed — restore everything.
            opts.restore();
            toast.error(
              `Failed to delete ${entries.length} ${opts.resourceNamePlural}.`
            );
          } else {
            // Partial failure — we can't easily restore the failures
            // individually (the optimistic removal collapsed them all),
            // so restore everything and surface the count.
            opts.restore();
            toast.error(
              `${failures.length} of ${entries.length} ${opts.resourceNamePlural} failed to delete; the list was restored.`
            );
          }
        })();
      }, UNDO_WINDOW_MS);

      // ONE shared sonner toast with a single Undo button.
      const sharedToastId = toast(
        `Deleted ${entries.length} ${opts.resourceNamePlural}`,
        {
          duration: UNDO_WINDOW_MS,
          action: {
            label: 'Undo',
            onClick: () => {
              // Cancel every per-id pending entry. The first cancel
              // clearTimeout's the shared timer; subsequent cancels
              // return false (idempotent — entry already gone).
              let anyCancelled = false;
              for (const id of ids) {
                if (cancelPendingDelete(id)) anyCancelled = true;
              }
              if (anyCancelled) {
                opts.restore();
              }
            },
          },
        }
      );

      // Schedule one queue entry per id — sharing the same timer +
      // toastId. The `onUndo` is the shared restore (called once if
      // any cancel succeeds; subsequent cancels are no-ops).
      for (const entry of entries) {
        schedulePendingDelete({
          id: entry.id,
          resourceType: entry.resourceType,
          commit: entry.commit,
          onUndo: opts.restore,
          timer: sharedTimer,
          toastId: sharedToastId,
        });
      }
    },
    []
  );

  return { deleteWithUndo, deleteManyWithUndo };
};

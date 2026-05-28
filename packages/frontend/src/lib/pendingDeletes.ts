/**
 * Pending-deletes queue (G42(c) — cycle-47).
 *
 * Module-level singleton tracking deferred DELETE operations during the
 * 30-second undo window. The actual server DELETE is held by a setTimeout
 * stashed in each entry; clicking "Undo" cancels the timer (no server
 * traffic), letting the optimistic UI restore cleanly. See CLAUDE.md
 * "Undoable delete (G42(c) — cycle-47)" for the pinned contract.
 *
 * Module-level — NOT React state — so an in-flight pending delete
 * survives a route change (e.g. user clicks Delete on /components, then
 * navigates to /panels/:id mid-window; the timer still fires at T+30s).
 */

export type PendingId = string;

export type PendingEntry = {
  id: PendingId;
  /** Resource type ('component', 'breaker', etc.) — for debugging only. */
  resourceType: string;
  /** Server-side commit fn (the real api.deleteX). */
  commit: () => Promise<void>;
  /** Restores the optimistic UI on undo. */
  onUndo: () => void;
  /** The setTimeout handle that fires `commit` at T+30s. */
  timer: ReturnType<typeof setTimeout>;
  /** sonner toast id, for explicit dismiss if needed. */
  toastId: string | number;
};

const queue = new Map<PendingId, PendingEntry>();

export const schedulePendingDelete = (entry: PendingEntry): void => {
  queue.set(entry.id, entry);
};

/** Cancel the pending DELETE for `id`. Returns true if a pending entry
 *  existed (and was cancelled), false if there was nothing to cancel. */
export const cancelPendingDelete = (id: PendingId): boolean => {
  const entry = queue.get(id);
  if (!entry) return false;
  clearTimeout(entry.timer);
  queue.delete(id);
  return true;
};

export const hasPending = (id: PendingId): boolean => queue.has(id);

/** Remove the entry from the queue after the server commit fires (or
 *  after a commit error has been handled). Does NOT clear the timer —
 *  the caller is responsible for that since this is typically called
 *  from inside the timer's own callback. */
export const completePendingDelete = (id: PendingId): void => {
  queue.delete(id);
};

/** Test/debug helper — current queue size. */
export const _pendingCount = (): number => queue.size;

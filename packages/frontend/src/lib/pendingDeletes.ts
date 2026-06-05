/**
 * Pending-deletes queue (G42(c) — cycle-47).
 *
 * Module-level singleton tracking deferred DELETE operations during the
 * (short) undo window. The actual server DELETE is held by a setTimeout
 * stashed in each entry; clicking "Undo" cancels the timer (no server
 * traffic), letting the optimistic UI restore cleanly. See CLAUDE.md
 * "Undoable delete (G42(c) — cycle-47)" for the pinned contract.
 *
 * Module-level — NOT React state — so an in-flight pending delete
 * survives a route change (e.g. user clicks Delete on /components, then
 * navigates to /panels/:id mid-window; the timer still fires at T+window).
 *
 * 2026-06: leaving/refreshing now FINALIZES pending deletes instead of
 * resurrecting them. A `pagehide` listener flushes the queue (firing each
 * commit immediately via a `keepalive` fetch) so a refresh or tab-close
 * during the undo window leaves the rows deleted — the user's expectation.
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

/**
 * Finalize every pending delete RIGHT NOW — clear each timer and fire its
 * commit immediately, then empty the queue. Used by the `pagehide` flush so
 * leaving/refreshing the app commits in-flight deletes (the commit's fetch
 * is `keepalive`, so it survives page unload) instead of leaving the row on
 * the server to "reappear" on next load.
 *
 * Errors from commits are swallowed — there is no UI left to surface them to
 * during unload, and the optimistic removal has already happened.
 */
export const flushPendingDeletes = (): void => {
  for (const entry of queue.values()) {
    clearTimeout(entry.timer);
    void entry.commit().catch(() => {
      /* page is unloading — nothing to restore or report */
    });
  }
  queue.clear();
};

// Flush on `pagehide` (the reliable cross-browser/mobile unload signal —
// `beforeunload` is unreliable on mobile). In-app SPA navigation does NOT
// fire this; those pending deletes simply commit at the normal T+window
// timer, which is fine. Guarded for non-DOM (SSR/test) environments.
if (typeof window !== 'undefined') {
  window.addEventListener('pagehide', flushPendingDeletes);
}

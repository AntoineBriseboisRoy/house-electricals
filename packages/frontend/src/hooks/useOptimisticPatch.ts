import { useCallback, useRef, useState } from 'react';

export type PatchError = { id: string; message: string };

type Options = {
  maxRetries?: number;
  retryBackoffMs?: number;
};

export type OptimisticPatchApi<TBody, TResult> = {
  patch: (id: string, body: TBody) => Promise<TResult | null>;
  pending: ReadonlySet<string>;
  errors: ReadonlyArray<PatchError>;
  clear: () => void;
};

/**
 * House pattern for idempotent PATCH-style write paths from the PWA.
 *
 * - Optimistic: the caller updates its own state immediately; this hook only
 *   tracks pending + errors keyed by item id.
 * - Last-write-wins: re-patching the same id during a pending call cancels the
 *   prior result reporting (the second call's outcome wins).
 * - Retry: up to `maxRetries` attempts (default 2) on thrown errors, with
 *   linear `retryBackoffMs` backoff (default 250ms).
 * - Idempotency contract: the underlying PATCH must be safe to repeat.
 *
 * Errors are accumulated in a list keyed by id so the UI can surface a
 * per-row indicator until the user clears or successfully retries.
 *
 * See CLAUDE.md for the broader write-path policy.
 */
export const useOptimisticPatch = <TBody, TResult>(
  patchFn: (id: string, body: TBody) => Promise<TResult>,
  options: Options = {}
): OptimisticPatchApi<TBody, TResult> => {
  const { maxRetries = 2, retryBackoffMs = 250 } = options;
  const [pending, setPending] = useState<Set<string>>(() => new Set());
  const [errors, setErrors] = useState<PatchError[]>([]);
  const tokens = useRef<Map<string, number>>(new Map());

  const setPendingFor = useCallback((id: string, on: boolean) => {
    setPending((prev) => {
      const next = new Set(prev);
      if (on) next.add(id);
      else next.delete(id);
      return next;
    });
  }, []);

  const setErrorFor = useCallback((id: string, message: string | null) => {
    setErrors((prev) => {
      const without = prev.filter((e) => e.id !== id);
      return message === null ? without : [...without, { id, message }];
    });
  }, []);

  const patch = useCallback(
    async (id: string, body: TBody): Promise<TResult | null> => {
      const token = (tokens.current.get(id) ?? 0) + 1;
      tokens.current.set(id, token);
      setPendingFor(id, true);
      setErrorFor(id, null);

      let attempt = 0;
      let lastError: unknown = null;
      while (attempt <= maxRetries) {
        try {
          const result = await patchFn(id, body);
          if (tokens.current.get(id) === token) {
            setPendingFor(id, false);
          }
          return result;
        } catch (e) {
          lastError = e;
          if (attempt < maxRetries) {
            await new Promise((r) => setTimeout(r, retryBackoffMs * (attempt + 1)));
          }
          attempt += 1;
        }
      }

      if (tokens.current.get(id) === token) {
        setPendingFor(id, false);
        const msg =
          lastError instanceof Error ? lastError.message : 'Failed to save change.';
        setErrorFor(id, msg);
      }
      return null;
    },
    [patchFn, maxRetries, retryBackoffMs, setPendingFor, setErrorFor]
  );

  const clear = useCallback(() => {
    tokens.current.clear();
    setPending(new Set());
    setErrors([]);
  }, []);

  return { patch, pending, errors, clear };
};

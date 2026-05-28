/**
 * useMultiSelect<T> — G42(f) cycle-50.
 *
 * Generic multi-selection state for list surfaces (e.g. the ComponentsScreen
 * row list). Owns a `Set<string>` of selected ids plus convenience helpers
 * (toggle, selectAll, clear, derived selectedItems + count).
 *
 * Pinned in CLAUDE.md "Bulk-actions on ComponentsScreen (G42(f) — cycle-50)":
 *
 *  - Items are `readonly T[]` where `T extends { id: string }`.
 *  - State is `Set<string>` of IDs (NOT array, NOT `Map<id, T>`) so React
 *    state-equality is cheap and we don't snapshot rows that may change.
 *  - Auto-prunes ids removed from `items` between renders (e.g. a row was
 *    deleted) so the selection stays in sync with the source-of-truth list.
 *  - No persistence (localStorage / URL).
 *  - No range / shift-select in v1.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';

export type MultiSelect<T extends { id: string }> = {
  selectedIds: ReadonlySet<string>;
  isSelected: (id: string) => boolean;
  toggle: (id: string) => void;
  selectAll: () => void;
  clear: () => void;
  selectedItems: readonly T[];
  count: number;
};

export const useMultiSelect = <T extends { id: string }>(
  items: readonly T[]
): MultiSelect<T> => {
  const [selectedIds, setSelectedIds] = useState<ReadonlySet<string>>(
    () => new Set()
  );

  // Auto-prune: if an id disappears from `items` between renders (e.g. row
  // was deleted), drop it from the selection. Pinned per Lockin OBJ2 — this
  // is the only intersect-on-membership guarantee callers can rely on.
  useEffect(() => {
    setSelectedIds((cur) => {
      let changed = false;
      const next = new Set<string>();
      const itemIds = new Set(items.map((it) => it.id));
      for (const id of cur) {
        if (itemIds.has(id)) {
          next.add(id);
        } else {
          changed = true;
        }
      }
      return changed ? next : cur;
    });
  }, [items]);

  const isSelected = useCallback(
    (id: string): boolean => selectedIds.has(id),
    [selectedIds]
  );

  const toggle = useCallback((id: string): void => {
    setSelectedIds((cur) => {
      const next = new Set(cur);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const selectAll = useCallback((): void => {
    setSelectedIds(new Set(items.map((it) => it.id)));
  }, [items]);

  const clear = useCallback((): void => {
    setSelectedIds(new Set());
  }, []);

  const selectedItems = useMemo(
    (): readonly T[] => items.filter((it) => selectedIds.has(it.id)),
    [items, selectedIds]
  );

  return {
    selectedIds,
    isSelected,
    toggle,
    selectAll,
    clear,
    selectedItems,
    count: selectedIds.size,
  };
};

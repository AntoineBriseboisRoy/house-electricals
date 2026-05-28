import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * Cycle-60: Ported from HousesTracker `client/src/hooks/useComboboxKeyboard.ts`.
 *
 * Shared keyboard navigation for typeable dropdowns. Behavior:
 *  - ArrowDown / ArrowUp cycle through `items`, skipping disabled entries.
 *  - Enter selects the highlighted item (ignored if disabled).
 *  - Escape calls `onClose`.
 *  - When `isOpen` flips true, the highlight resets to the first non-disabled
 *    item.
 *  - The highlighted item is scrolled into view on arrow navigation — attach
 *    `listRef` to the scrollable list container and mark each option with
 *    `data-combobox-item`.
 */

type UseComboboxKeyboardArgs<T> = {
  items: T[];
  isOpen: boolean;
  onSelect: (item: T, index: number) => void;
  onClose: () => void;
  isItemDisabled?: (item: T, index: number) => boolean;
};

export type UseComboboxKeyboardReturn = {
  highlightedIndex: number;
  setHighlightedIndex: (i: number) => void;
  onKeyDown: (e: React.KeyboardEvent) => void;
  listRef: React.RefObject<HTMLDivElement | null>;
};

export const useComboboxKeyboard = <T>({
  items,
  isOpen,
  onSelect,
  onClose,
  isItemDisabled,
}: UseComboboxKeyboardArgs<T>): UseComboboxKeyboardReturn => {
  const [highlightedIndex, setHighlightedIndex] = useState(0);
  const listRef = useRef<HTMLDivElement | null>(null);

  // Latest items + disabled predicate kept in refs so the key handler doesn't
  // need to be re-created on every render. Matches the HT pattern.
  const itemsRef = useRef(items);
  itemsRef.current = items;
  const isItemDisabledRef = useRef(isItemDisabled);
  isItemDisabledRef.current = isItemDisabled;

  const isDisabled = useCallback((index: number): boolean => {
    const item = itemsRef.current[index];
    if (item === undefined) return true;
    const pred = isItemDisabledRef.current;
    return pred ? pred(item, index) : false;
  }, []);

  const itemsLength = items.length;

  // Reset highlight when opening or when the list length changes while open.
  useEffect(() => {
    if (!isOpen) return;
    let first = 0;
    while (first < itemsLength && isDisabled(first)) first++;
    setHighlightedIndex(first < itemsLength ? first : 0);
  }, [isOpen, itemsLength, isDisabled]);

  // Scroll highlighted item into view on change.
  useEffect(() => {
    if (!isOpen || !listRef.current) return;
    const nodes = listRef.current.querySelectorAll('[data-combobox-item]');
    nodes[highlightedIndex]?.scrollIntoView({ block: 'nearest' });
  }, [highlightedIndex, isOpen]);

  const onSelectRef = useRef(onSelect);
  onSelectRef.current = onSelect;
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  const onKeyDown = useCallback(
    (e: React.KeyboardEvent): void => {
      if (!isOpen) return;
      const currentItems = itemsRef.current;
      switch (e.key) {
        case 'ArrowDown': {
          e.preventDefault();
          setHighlightedIndex((i) => {
            let next = i + 1;
            while (next < currentItems.length && isDisabled(next)) next++;
            return next < currentItems.length ? next : i;
          });
          break;
        }
        case 'ArrowUp': {
          e.preventDefault();
          setHighlightedIndex((i) => {
            let next = i - 1;
            while (next >= 0 && isDisabled(next)) next--;
            return next >= 0 ? next : i;
          });
          break;
        }
        case 'Enter': {
          const item = currentItems[highlightedIndex];
          if (item !== undefined && !isDisabled(highlightedIndex)) {
            e.preventDefault();
            onSelectRef.current(item, highlightedIndex);
          }
          break;
        }
        case 'Escape': {
          e.preventDefault();
          onCloseRef.current();
          break;
        }
      }
    },
    [isOpen, highlightedIndex, isDisabled]
  );

  return { highlightedIndex, setHighlightedIndex, onKeyDown, listRef };
};

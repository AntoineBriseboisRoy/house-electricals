import { useState } from 'react';
import type { Breaker, BreakerTest, Component } from '@he/shared';
import type { BreakerLoad } from '../lib/load.js';
import { BreakerRow } from './BreakerRow.js';
import { listComponents } from '../api.js';
import { toast } from '../ui/index.js';

type Props = {
  breaker: Breaker;
  /** Open the edit bottom-sheet for this breaker (2026-06 — the row no
   *  longer renders an inline edit form; editing pops up in a Modal owned
   *  by PanelDetailScreen). */
  onStartEdit: () => void;
  onDelete: () => Promise<void>;
  componentCount: number;
  /** 2026-05 — toggle the breaker's persistent on/off state. Pass-through. */
  onToggleState?: (nextIsOn: boolean) => void | Promise<void>;
  stateToggling?: boolean;
  /** 2026-05 — per-circuit load summary for this breaker. Pass-through. */
  load?: BreakerLoad | null;
  /** G36 cycle-61 — most-recent BreakerTest for this breaker. Pass-through. */
  lastTest?: BreakerTest | null;
  /** G40 Part 1 cycle-66 — service-log entry count + open-modal callback. */
  serviceLogCount?: number;
  onShowServiceLog?: () => void;
  /** 2026-05 — open the PhotosModal for this breaker. Pass-through. */
  onShowPhotos?: () => void;
};

/**
 * Owns the lazy-loaded list of components wired to a breaker and threads it
 * into BreakerRow's in-card "components" footer (design-1 rework, 2026-05).
 * The components used to render as a SEPARATE row below the breaker, which
 * read as disconnected — especially when the breaker was off. They now live
 * inside the same card.
 */
export const BreakerWithComponents = ({
  breaker,
  onStartEdit,
  onDelete,
  componentCount,
  onToggleState,
  stateToggling,
  load,
  lastTest,
  serviceLogCount,
  onShowServiceLog,
  onShowPhotos,
}: Props): JSX.Element => {
  const [expanded, setExpanded] = useState(false);
  const [components, setComponents] = useState<Component[] | null>(null);
  const [loading, setLoading] = useState(false);

  const toggleExpand = (): void => {
    const next = !expanded;
    setExpanded(next);
    if (next && components === null) {
      setLoading(true);
      void (async () => {
        try {
          setComponents(await listComponents({ breakerId: breaker.id }));
        } catch (e) {
          toast.error(
            e instanceof Error ? e.message : 'Failed to load components.'
          );
        } finally {
          setLoading(false);
        }
      })();
    }
  };

  return (
    <BreakerRow
      breaker={breaker}
      onStartEdit={onStartEdit}
      onDelete={onDelete}
      onToggleState={onToggleState}
      stateToggling={stateToggling}
      load={load}
      lastTest={lastTest}
      serviceLogCount={serviceLogCount}
      onShowServiceLog={onShowServiceLog}
      onShowPhotos={onShowPhotos}
      componentCount={componentCount}
      componentsExpanded={expanded}
      componentsLoading={loading}
      components={components}
      onToggleComponents={toggleExpand}
    />
  );
};

import { useState } from 'react';
import type { Breaker, BreakerInput, BreakerTest, Component, Panel } from '@he/shared';
import type { BreakerLoad } from '../lib/load.js';
import { BreakerRow } from './BreakerRow.js';
import { ComponentTypeIcon, componentTypeLabel } from './ComponentTypeIcon.js';
import { listComponents } from '../api.js';
import { Button, Spinner, toast } from '../ui/index.js';

type Props = {
  breaker: Breaker;
  isEditing: boolean;
  onStartEdit: () => void;
  onCancelEdit: () => void;
  onSave: (patch: Partial<BreakerInput>) => Promise<void>;
  onDelete: () => Promise<void>;
  componentCount: number;
  /** G33 cycle-41 — thread slot-validation context down to BreakerRow → BreakerForm. */
  slotCount: number;
  siblings: Breaker[];
  /** G39 cycle-56 — thread "Feeds subpanel" picker context. */
  allPanels?: Panel[];
  currentSubpanelId?: string | null;
  onChangeFeedsSubpanel?: (subpanelId: string | null) => void | Promise<void>;
  /** G35 Part 1 (cycle-58) — open the Impact modal for this breaker. */
  onShowImpact?: () => void;
  /** 2026-05 — per-circuit load summary for this breaker. Pass-through. */
  load?: BreakerLoad | null;
  /** G36 cycle-61 — most-recent BreakerTest for this breaker. Pass-through. */
  lastTest?: BreakerTest | null;
  /** G40 Part 1 cycle-66 — service-log entry count + open-modal callback.
   *  Pass-through to BreakerRow. */
  serviceLogCount?: number;
  onShowServiceLog?: () => void;
  /** 2026-05 — open the PhotosModal for this breaker. Pass-through. */
  onShowPhotos?: () => void;
};

export const BreakerWithComponents = ({
  breaker,
  isEditing,
  onStartEdit,
  onCancelEdit,
  onSave,
  onDelete,
  componentCount,
  slotCount,
  siblings,
  allPanels,
  currentSubpanelId,
  onChangeFeedsSubpanel,
  onShowImpact,
  load,
  lastTest,
  serviceLogCount,
  onShowServiceLog,
  onShowPhotos,
}: Props): JSX.Element => {
  const [expanded, setExpanded] = useState(false);
  const [components, setComponents] = useState<Component[] | null>(null);
  const [loading, setLoading] = useState(false);

  const toggleExpand = async (): Promise<void> => {
    const next = !expanded;
    setExpanded(next);
    if (next && components === null) {
      setLoading(true);
      try {
        setComponents(await listComponents({ breakerId: breaker.id }));
      } catch (e) {
        toast.error(e instanceof Error ? e.message : 'Failed to load components.');
      } finally {
        setLoading(false);
      }
    }
  };

  return (
    <>
      <BreakerRow
        breaker={breaker}
        isEditing={isEditing}
        onStartEdit={onStartEdit}
        onCancelEdit={onCancelEdit}
        onSave={onSave}
        onDelete={onDelete}
        slotCount={slotCount}
        siblings={siblings}
        allPanels={allPanels}
        currentSubpanelId={currentSubpanelId}
        onChangeFeedsSubpanel={onChangeFeedsSubpanel}
        onShowImpact={onShowImpact}
        load={load}
        lastTest={lastTest}
        serviceLogCount={serviceLogCount}
        onShowServiceLog={onShowServiceLog}
        onShowPhotos={onShowPhotos}
      />
      {!isEditing && (
        <li className="breaker-row breaker-row--expandable">
          {componentCount > 0 ? (
            <span className="badge badge--count breaker-row__count">
              {componentCount} component{componentCount === 1 ? '' : 's'}
            </span>
          ) : (
            <span className="muted breaker-row__count">No components</span>
          )}
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              void toggleExpand();
            }}
            aria-expanded={expanded}
            aria-label={`Toggle components on breaker ${breaker.slot}`}
            disabled={componentCount === 0}
          >
            {expanded ? 'Hide' : 'Show'}
          </Button>
          {expanded && (
            <div className="breaker-row__expanded">
              {loading && <Spinner label="Loading breakers" />}
              {!loading && components !== null && components.length === 0 && (
                <p className="muted">No components on this breaker.</p>
              )}
              {!loading &&
                components !== null &&
                components.map((c) => (
                  <div key={c.id} className="breaker-row__expanded-item">
                    <ComponentTypeIcon type={c.type} size={20} />
                    <span>{c.name}</span>
                    {c.room && <span className="muted">· {c.room}</span>}
                    <span className="muted">· {componentTypeLabel(c.type)}</span>
                  </div>
                ))}
            </div>
          )}
        </li>
      )}
    </>
  );
};

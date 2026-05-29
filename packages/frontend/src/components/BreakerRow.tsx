import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { AlertCircle, Camera, ClipboardList, Trash2, Zap } from 'lucide-react';
import {
  breakerInputSchema,
  type Breaker,
  type BreakerInput,
  type BreakerTest,
  type Panel,
} from '@he/shared';
import { BreakerForm } from './BreakerForm.js';
import { Button, IconButton } from '../ui/index.js';
import { formatRelative, isStaleOlderThanOneYear } from '../lib/relativeTime.js';
import { formatWatts, type BreakerLoad } from '../lib/load.js';

type Props = {
  breaker: Breaker;
  isEditing: boolean;
  onStartEdit: () => void;
  onCancelEdit: () => void;
  onSave: (patch: Partial<BreakerInput>) => Promise<void>;
  onDelete: () => Promise<void>;
  /** G33 cycle-41 — context for BreakerForm's strict slot validation
   *  while editing. slotCount is the panel's slot capacity; siblings
   *  are the other breakers on this panel (used to detect collisions).
   *  The breaker being edited is skipped from the collision check
   *  inside BreakerForm via its own id. */
  slotCount: number;
  siblings: Breaker[];
  /** G39 cycle-56 — thread the "Feeds subpanel" picker context down to
   *  the BreakerForm when editing. */
  allPanels?: Panel[];
  currentSubpanelId?: string | null;
  onChangeFeedsSubpanel?: (subpanelId: string | null) => void | Promise<void>;
  /** G35 Part 1 (cycle-58) — open the Impact modal for this breaker. The
   *  screen owns modal state + the precomputed item list; the row only
   *  fires the request. */
  onShowImpact?: () => void;
  /** 2026-05 — per-circuit load summary (sum of wired components' watts vs
   *  continuous capacity). Renders a "Load X W / Y W (Z%)" line, colored
   *  amber > 80% and red > 100%. Undefined/null or zero-watts → hidden. */
  load?: BreakerLoad | null;
  /** G36 cycle-61 — most-recent BreakerTest for this breaker, or null if
   *  no test was ever logged. The row renders "Last verified: X ago"
   *  below the slot label, plus a warn dot when verification is stale
   *  (never tested OR >12 months ago). */
  lastTest?: BreakerTest | null;
  /** G40 Part 1 cycle-66 — count of service-log entries for THIS breaker.
   *  When undefined the badge is hidden (e.g. consumers where the log
   *  isn't loaded yet). When provided (even =0), a small "Log · N" badge
   *  renders below the slot label; clicking opens the ServiceLogModal. */
  serviceLogCount?: number;
  /** G40 Part 1 cycle-66 — open the ServiceLogModal for this breaker. The
   *  parent owns modal state + the entries fetch. */
  onShowServiceLog?: () => void;
  /** 2026-05 — open the PhotosModal for this breaker (quick view/add without
   *  entering the edit form). Parent owns the modal state. */
  onShowPhotos?: () => void;
};

const formatPoles = (poles: Breaker['poles']): string =>
  poles === 'single' ? '1P' : poles === 'double' ? '2P' : 'Tandem';

export const BreakerRow = ({
  breaker,
  isEditing,
  onStartEdit,
  onCancelEdit,
  onSave,
  onDelete,
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
  const form = useForm<BreakerInput>({
    resolver: zodResolver(breakerInputSchema),
    values: {
      slot: breaker.slot,
      amperage: breaker.amperage,
      poles: breaker.poles,
      label: breaker.label,
      slotPosition: breaker.slotPosition,
      // G37 cycle-68 — seed protection so the edit form shows current value.
      protection: breaker.protection,
    },
  });

  if (isEditing) {
    return (
      <li className="breaker-row breaker-row--editing">
        <BreakerForm
          form={form}
          onSubmit={(values) => onSave(values)}
          onCancel={onCancelEdit}
          submitLabel="Save"
          slotCount={slotCount}
          existingBreakers={siblings}
          editingBreakerId={breaker.id}
          allPanels={allPanels}
          currentPanelId={breaker.panelId}
          currentSubpanelId={currentSubpanelId}
          onChangeFeedsSubpanel={onChangeFeedsSubpanel}
        />
      </li>
    );
  }

  // G36 cycle-61 — "Last verified" hint values. `lastTest === undefined`
  // means the parent didn't supply the prop (e.g. embedded surfaces where
  // audit info isn't loaded); hide the hint entirely in that case to
  // preserve backward-compatible rendering. `lastTest === null` means we
  // KNOW there's no test yet — show "Last verified: never" + warn dot.
  const showVerifiedHint = lastTest !== undefined;
  const verifiedNever = lastTest === null;
  const verifiedStale =
    lastTest !== null && lastTest !== undefined
      ? isStaleOlderThanOneYear(lastTest.testedAt)
      : false;
  const verifiedText =
    lastTest === null || lastTest === undefined
      ? 'never'
      : formatRelative(lastTest.testedAt);
  const showWarnDot = verifiedNever || verifiedStale;

  return (
    <li id={`breaker-${breaker.id}`} className="breaker-row">
      <div className="breaker-row__slot">
        {/* G34 cycle-42: tandem halves render with their letter suffix
            (e.g. "Slot 6a" / "Slot 6b") so the user can tell two tandem
            circuits on slot 6 apart at a glance. */}
        <span className="breaker-row__slot-label">
          Slot {breaker.slot}
          {breaker.poles === 'tandem' && breaker.tandemHalf !== null
            ? breaker.tandemHalf
            : ''}
        </span>
        {breaker.slotPosition !== null && (
          <span className="breaker-row__pos">#{breaker.slotPosition}</span>
        )}
        {showVerifiedHint && (
          <span
            className={
              'breaker-row__verified' +
              (showWarnDot ? ' breaker-row__verified--warn' : '')
            }
            data-testid="breaker-row-verified"
            data-breaker-id={breaker.id}
            data-verified-state={
              verifiedNever ? 'never' : verifiedStale ? 'stale' : 'fresh'
            }
            title={
              verifiedNever
                ? 'No verification on record.'
                : `Last verified ${verifiedText}`
            }
          >
            {showWarnDot && (
              <AlertCircle
                size={12}
                strokeWidth={2.5}
                aria-hidden="true"
                className="breaker-row__verified-dot"
              />
            )}
            <span className="breaker-row__verified-text">
              Last verified: {verifiedText}
            </span>
          </span>
        )}
        {/* G40 Part 1 cycle-66 — service-log badge. Clickable surface
            that opens the ServiceLogModal (mobile contract: timeline
            ALWAYS opens in Modal, NEVER inline-expanded). The
            ClipboardList icon is a lucide pin to match other breaker
            action icons. */}
        {serviceLogCount !== undefined && onShowServiceLog !== undefined && (
          <button
            type="button"
            className={
              'breaker-row__service-log' +
              (serviceLogCount === 0 ? ' breaker-row__service-log--empty' : '')
            }
            onClick={onShowServiceLog}
            data-testid="breaker-row-service-log"
            data-breaker-id={breaker.id}
            data-log-count={serviceLogCount}
            aria-label={
              serviceLogCount === 0
                ? 'Open service log (empty)'
                : `Open service log (${serviceLogCount} entr${serviceLogCount === 1 ? 'y' : 'ies'})`
            }
            title={
              serviceLogCount === 0
                ? 'No service entries yet'
                : `${serviceLogCount} service entr${serviceLogCount === 1 ? 'y' : 'ies'}`
            }
          >
            <ClipboardList
              size={12}
              strokeWidth={2.25}
              aria-hidden="true"
              className="breaker-row__service-log-icon"
            />
            <span className="breaker-row__service-log-text">
              Log · {serviceLogCount}
            </span>
          </button>
        )}
      </div>
      <div className="breaker-row__meta">
        <span>
          {breaker.amperage}A · {formatPoles(breaker.poles)}
        </span>
        <span className="breaker-row__label">{breaker.label}</span>
        {load != null && load.watts > 0 && (
          <span
            className="breaker-row__load"
            data-testid="breaker-row-load"
            data-breaker-id={breaker.id}
            data-load-status={load.status}
            title={`Estimated load ${formatWatts(load.watts)} of ${formatWatts(
              load.capacity
            )} continuous capacity (${Math.round(load.pct * 100)}%)`}
          >
            Load {formatWatts(load.watts)} / {formatWatts(load.capacity)} (
            {Math.round(load.pct * 100)}%)
          </span>
        )}
      </div>
      <div className="breaker-row__actions">
        {onShowImpact !== undefined && (
          <Button
            variant="secondary"
            size="sm"
            onClick={onShowImpact}
            aria-label="What loses power if this breaker is off"
            className="breaker-row__impact-btn"
            leadingIcon={<Zap size={16} strokeWidth={2.25} />}
            data-testid="breaker-impact-btn"
            data-breaker-id={breaker.id}
          >
            Impact
          </Button>
        )}
        {onShowPhotos !== undefined && (
          <IconButton
            icon={<Camera size={16} strokeWidth={2.25} />}
            variant="default"
            onClick={onShowPhotos}
            aria-label={`Photos for breaker ${breaker.slot}`}
            data-testid="breaker-row-photos"
            data-breaker-id={breaker.id}
          />
        )}
        <Button
          variant="secondary"
          size="sm"
          onClick={onStartEdit}
          aria-label={`Edit breaker ${breaker.slot}`}
        >
          Edit
        </Button>
        {/* Cycle-70 polish-pass-2 P2 #16 — demote per-row Delete from a
            full red Button to an icon-only IconButton with danger color.
            On desktop the previous coral text-buttons stacked vertically
            (one per row) drew the eye away from the row content. The
            icon-only affordance preserves the destructive-color cue + the
            >=44px hit area + the cycle-47 undoable-delete safety net,
            while removing the visual noise. aria-label intact for SR. */}
        <IconButton
          icon={<Trash2 size={16} strokeWidth={2.25} />}
          variant="danger"
          onClick={() => {
            void onDelete();
          }}
          aria-label={`Delete breaker ${breaker.slot}`}
        />

      </div>
    </li>
  );
};

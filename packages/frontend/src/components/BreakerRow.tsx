import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import {
  AlertCircle,
  Camera,
  ChevronDown,
  ClipboardList,
  Power,
  PowerOff,
  Trash2,
} from 'lucide-react';
import {
  breakerInputSchema,
  type Breaker,
  type BreakerInput,
  type BreakerTest,
  type Component,
  type Panel,
} from '@he/shared';
import { BreakerForm } from './BreakerForm.js';
import { ComponentTypeIcon } from './ComponentTypeIcon.js';
import { Button, IconButton, Spinner } from '../ui/index.js';
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
  /** 2026-05 — toggle the breaker's persistent on/off energization state.
   *  Replaces the removed Impact button. `nextIsOn` is the desired state.
   *  The whole card reflects `breaker.isOn` (danger-tinted when off). */
  onToggleState?: (nextIsOn: boolean) => void | Promise<void>;
  /** 2026-05 — true while a state toggle POST is in flight (busy + disabled). */
  stateToggling?: boolean;
  /** 2026-05 — per-circuit load summary (sum of wired components' watts vs
   *  continuous capacity). Renders a load BAR colored amber > 80% / red >
   *  100%. Undefined/null or zero-watts → hidden. */
  load?: BreakerLoad | null;
  /** G36 cycle-61 — most-recent BreakerTest for this breaker, or null if
   *  no test was ever logged. Renders "Last verified: X ago" + a warn dot
   *  when stale (never tested OR >12 months ago). */
  lastTest?: BreakerTest | null;
  /** G40 Part 1 cycle-66 — count of service-log entries for THIS breaker. */
  serviceLogCount?: number;
  onShowServiceLog?: () => void;
  /** 2026-05 — open the PhotosModal for this breaker. */
  onShowPhotos?: () => void;
  /** 2026-05 (design-1 rework) — components footer disclosure. The parent
   *  (BreakerWithComponents) owns the lazy-load; the row renders the footer
   *  INSIDE the same card so the components clearly belong to the breaker.
   *  When `onToggleComponents` is undefined the footer is omitted. */
  componentCount?: number;
  componentsExpanded?: boolean;
  componentsLoading?: boolean;
  components?: Component[] | null;
  onToggleComponents?: () => void;
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
  onToggleState,
  stateToggling,
  load,
  lastTest,
  serviceLogCount,
  onShowServiceLog,
  onShowPhotos,
  componentCount,
  componentsExpanded,
  componentsLoading,
  components,
  onToggleComponents,
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
  // means the parent didn't supply the prop; hide the hint entirely.
  // `lastTest === null` means no test yet → "never" + warn dot.
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

  const slotLabel =
    `Slot ${breaker.slot}` +
    (breaker.poles === 'tandem' && breaker.tandemHalf !== null
      ? breaker.tandemHalf
      : '');

  const hasFooter = onToggleComponents !== undefined;
  const count = componentCount ?? 0;

  return (
    <li
      id={`breaker-${breaker.id}`}
      className={'breaker-row breaker-row--card' + (!breaker.isOn ? ' breaker-row--off' : '')}
      data-breaker-on={breaker.isOn ? 'true' : 'false'}
    >
      {/* ── Header: identity (left) + actions cluster (upper-right) ── */}
      <div className="breaker-row__header">
        <div className="breaker-row__id">
          <div className="breaker-row__slot-line">
            {/* G34 cycle-42: tandem halves render with their letter suffix. */}
            <span className="breaker-row__slot-label">{slotLabel}</span>
            {breaker.slotPosition !== null && (
              <span className="breaker-row__pos">#{breaker.slotPosition}</span>
            )}
          </div>
          <div className="breaker-row__amp">
            {breaker.amperage}A · {formatPoles(breaker.poles)}
          </div>
        </div>

        <div className="breaker-row__actions">
          {onToggleState !== undefined && (
            <Button
              variant={breaker.isOn ? 'secondary' : 'danger'}
              size="sm"
              busy={stateToggling}
              disabled={stateToggling}
              onClick={() => {
                void onToggleState(!breaker.isOn);
              }}
              aria-label={
                breaker.isOn
                  ? `Turn off breaker ${breaker.slot}`
                  : `Turn on breaker ${breaker.slot}`
              }
              className="breaker-row__state-toggle"
              leadingIcon={
                breaker.isOn ? (
                  <Power size={16} strokeWidth={2.25} />
                ) : (
                  <PowerOff size={16} strokeWidth={2.25} />
                )
              }
              data-testid="breaker-state-toggle"
              data-breaker-id={breaker.id}
              data-breaker-on={breaker.isOn ? 'true' : 'false'}
            >
              {breaker.isOn ? 'On' : 'Off'}
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
          {/* Cycle-70 — icon-only danger delete (undoable; cycle-47). */}
          <IconButton
            icon={<Trash2 size={16} strokeWidth={2.25} />}
            variant="danger"
            onClick={() => {
              void onDelete();
            }}
            aria-label={`Delete breaker ${breaker.slot}`}
          />
        </div>
      </div>

      {/* ── Body: label (+ off badge), meta hints, load bar ── */}
      <div className="breaker-row__body">
        <div className="breaker-row__name-line">
          <span className="breaker-row__label">{breaker.label}</span>
          {!breaker.isOn && (
            <span
              className="breaker-row__off-badge"
              data-testid="breaker-off-badge"
              data-breaker-id={breaker.id}
            >
              <PowerOff size={11} strokeWidth={2.5} aria-hidden="true" />
              Off
            </span>
          )}
        </div>

        {(showVerifiedHint ||
          (serviceLogCount !== undefined && onShowServiceLog !== undefined)) && (
          <div className="breaker-row__hints">
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
        )}

        {load != null && load.watts > 0 && (
          <div
            className="breaker-row__load"
            data-testid="breaker-row-load"
            data-breaker-id={breaker.id}
            data-load-status={load.status}
            title={`Estimated load ${formatWatts(load.watts)} of ${formatWatts(
              load.capacity
            )} continuous capacity (${Math.round(load.pct * 100)}%)`}
          >
            <div className="breaker-row__load-track">
              <div
                className="breaker-row__load-fill"
                data-load-status={load.status}
                style={{ width: `${Math.min(Math.round(load.pct * 100), 100)}%` }}
              />
            </div>
            <span className="breaker-row__load-text">
              {formatWatts(load.watts)} / {formatWatts(load.capacity)} ·{' '}
              {Math.round(load.pct * 100)}%
            </span>
          </div>
        )}
      </div>

      {/* ── Footer: components disclosure (inside the card) ── */}
      {hasFooter && (
        <div className="breaker-row__footer">
          <button
            type="button"
            className="breaker-row__comp-toggle"
            onClick={onToggleComponents}
            aria-expanded={componentsExpanded ?? false}
            disabled={count === 0}
            data-testid="breaker-row-components-toggle"
            data-breaker-id={breaker.id}
            data-count={count}
          >
            <span className="breaker-row__comp-count">
              {count} component{count === 1 ? '' : 's'}
            </span>
            <span className="breaker-row__comp-hint">
              {count === 0
                ? 'nothing wired'
                : !breaker.isOn
                  ? 'on this off circuit'
                  : 'wired here'}
            </span>
            {count > 0 && (
              <ChevronDown
                size={16}
                strokeWidth={2.25}
                aria-hidden="true"
                className="breaker-row__comp-chev"
              />
            )}
          </button>
          {componentsExpanded && (
            <div className="breaker-row__comp-list">
              {componentsLoading && <Spinner label="Loading components" />}
              {!componentsLoading &&
                components !== null &&
                components !== undefined &&
                components.length === 0 && (
                  <p className="muted breaker-row__comp-empty">
                    No components on this breaker.
                  </p>
                )}
              {!componentsLoading &&
                components !== null &&
                components !== undefined &&
                components.map((c) => (
                  <div key={c.id} className="breaker-row__comp-item">
                    <span className="breaker-row__comp-icon" aria-hidden="true">
                      <ComponentTypeIcon type={c.type} size={16} />
                    </span>
                    <span className="breaker-row__comp-name">{c.name}</span>
                    {c.room && (
                      <span className="breaker-row__comp-room">{c.room}</span>
                    )}
                  </div>
                ))}
            </div>
          )}
        </div>
      )}
    </li>
  );
};

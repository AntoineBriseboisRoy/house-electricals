import { useEffect, useMemo, useState } from 'react';
import type { UseFormReturn } from 'react-hook-form';
import type {
  ComponentInput,
  ComponentType,
  ProtectionKind,
} from '@he/shared';
import type { PanelWithBreakers } from '../api.js';
import { componentTypeLabel } from './ComponentTypeIcon.js';
import { Button, Checkbox, Combobox, Input, Select } from '../ui/index.js';

type Props = {
  form: UseFormReturn<ComponentInput>;
  onSubmit: (input: ComponentInput) => void | Promise<void>;
  submitLabel: string;
  onCancel?: () => void;
  /** G31 cycle-39 — panel + breaker pair for the wiring dropdowns. Pass
   *  the result of `listAllBreakersGrouped()` from the parent. Empty array
   *  hides the Wiring section (no panels exist yet). */
  breakerGroups?: PanelWithBreakers[];
  /** Cycle-85 — distinct room names already in use (drawn on a floor map
   *  or typed on existing components). Refactor 2026-05 follow-up: Room
   *  is now a STRICT Combobox dropdown (no free text). New rooms come
   *  from the floor-plan Room drawing tool; this list is the source of
   *  truth for the picker. */
  roomSuggestions?: string[];
  /** Cycle-85 — the linked-panel id of the floor the component lives on
   *  (null when the floor isn't linked to a panel, or the component has no
   *  floor). When non-null AND the component currently has no `breakerId`,
   *  the Wiring section's Panel select defaults to this id so the user only
   *  needs to pick a slot. The user can still override to a different panel.
   *  Hint copy under the Panel select explains the default is from the floor. */
  floorPanelId?: string | null;
};

const TYPES: ComponentType[] = [
  'outlet',
  'light',
  'switch',
  'appliance',
  'junction_box',
  'smoke_detector',
  'other',
];

/** G37 cycle-68 — same closed enum as BreakerForm. The "None" placeholder
 *  is rendered by the cycle-71 Select primitive (maps to null on select). */
const PROTECTION_OPTIONS: { value: ProtectionKind; label: string }[] = [
  { value: 'gfci', label: 'GFCI' },
  { value: 'afci', label: 'AFCI' },
  { value: 'dual', label: 'GFCI + AFCI (dual)' },
];

const formatBreaker = (
  b: PanelWithBreakers['breakers'][number]
): string => {
  const pos = b.slotPosition !== null ? `#${b.slotPosition} ` : '';
  // G34: tandem halves render as "slot 6a" so the user can distinguish.
  const half = b.poles === 'tandem' && b.tandemHalf !== null ? b.tandemHalf : '';
  return `slot ${b.slot}${half} · ${pos}${b.label} · ${b.amperage}A`;
};

export const ComponentForm = ({
  form,
  onSubmit,
  submitLabel,
  onCancel,
  breakerGroups = [],
  roomSuggestions = [],
  floorPanelId = null,
}: Props): JSX.Element => {
  const {
    register,
    handleSubmit,
    setValue,
    watch,
    formState: { errors, isSubmitting },
  } = form;

  // G31 cycle-39 — Wiring: two cascading dropdowns (panel → breaker).
  // The form's canonical state is `breakerId` (the only field the API
  // cares about); the panel select is a UX scaffold that filters the
  // breaker list. We derive the initial selected panel from whichever
  // group contains the current breakerId.
  const currentBreakerId = watch('breakerId') ?? null;

  const panelIdForBreaker = useMemo(() => {
    if (currentBreakerId === null) return null;
    for (const g of breakerGroups) {
      if (g.breakers.some((b) => b.id === currentBreakerId)) return g.panel.id;
    }
    return null;
  }, [breakerGroups, currentBreakerId]);

  // Cycle-85 — when the component has no wired breaker (typical for new
  // components on a floor with a linked panel), default the Panel select
  // to the floor's linked panel. The user can override to a different
  // panel; switching panel clears the breaker per the existing flow.
  // Validate against the loaded breakerGroups so a stale floor.panelId
  // (panel deleted) gracefully falls through to "no default".
  const floorPanelDefault = useMemo(() => {
    if (floorPanelId === null) return null;
    return breakerGroups.some((g) => g.panel.id === floorPanelId)
      ? floorPanelId
      : null;
  }, [floorPanelId, breakerGroups]);

  const initialPanelId = panelIdForBreaker ?? floorPanelDefault;

  const [selectedPanelId, setSelectedPanelId] = useState<string | null>(
    initialPanelId
  );

  // Re-seed when the form's external breakerId changes (e.g. opening the
  // edit form for a different component). Cycle-85: also re-seed when the
  // floor default changes so the EditingRow can flip in mid-life if the
  // floor/panel context changes.
  useEffect(() => {
    setSelectedPanelId(panelIdForBreaker ?? floorPanelDefault);
  }, [panelIdForBreaker, floorPanelDefault]);

  const handlePanelChange = (next: string | null): void => {
    setSelectedPanelId(next);
    // Switching panel always clears the breaker — the user must pick one
    // from the new panel's list. Same behavior when they pick Unassigned.
    setValue('breakerId', null, { shouldDirty: true, shouldValidate: true });
  };

  const handleBreakerChange = (next: string | null): void => {
    setValue('breakerId', next, {
      shouldDirty: true,
      shouldValidate: true,
    });
  };

  const breakersForSelectedPanel = useMemo(() => {
    if (selectedPanelId === null) return [];
    return (
      breakerGroups.find((g) => g.panel.id === selectedPanelId)?.breakers ?? []
    );
  }, [breakerGroups, selectedPanelId]);

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="component-form" noValidate>
      <div className="form-grid">
        <Select<ComponentType>
          id="cf-type"
          label="Type"
          value={(watch('type') as ComponentType | null | undefined) ?? 'outlet'}
          onChange={(next) => {
            // `type` is required (non-null) — fall back to 'outlet' if a
            // consumer somehow clears it.
            setValue('type', next ?? 'outlet', {
              shouldDirty: true,
              shouldValidate: true,
            });
          }}
          options={TYPES.map((t) => ({ value: t, label: componentTypeLabel(t) }))}
          error={errors.type?.message ?? null}
        />

        {/* Refactor 2026-05 follow-up — Room is now a STRICT Combobox
            dropdown (was Input + datalist). The user asked for a dropdown
            "never a free text" so typos can't fragment "Kitchen" /
            "kitchen" / "Kichen" into three logical rooms. New rooms come
            from the floor-plan Room drawing tool. If the current value
            isn't in the roomSuggestions list (legacy free-text data), we
            inject it so it stays selectable. */}
        {(() => {
          // Use existing room as id-and-label option (strings are PK here).
          const current = (watch('room') as string | null | undefined) ?? null;
          const merged: { value: string; label: string }[] = [];
          const seen = new Set<string>();
          for (const r of roomSuggestions) {
            if (!seen.has(r)) {
              merged.push({ value: r, label: r });
              seen.add(r);
            }
          }
          // Include the current value if it's a legacy free-text entry
          // not already covered by the suggestions list.
          if (current !== null && !seen.has(current)) {
            merged.push({ value: current, label: `${current} (legacy)` });
          }
          return (
            <div className="input">
              <label
                htmlFor="cf-room-combobox"
                className="input__label"
              >
                Room
              </label>
              <Combobox<string>
                id="cf-room-combobox"
                testId="cf-room"
                value={current}
                onChange={(next) =>
                  setValue('room', next, {
                    shouldDirty: true,
                    shouldValidate: true,
                  })
                }
                options={merged}
                placeholder={
                  merged.length === 0
                    ? 'No rooms yet — draw one on the floor map'
                    : 'Select a room…'
                }
                emptyMessage="No matching rooms"
                disabled={merged.length === 0}
                ariaLabel="Room"
                allowClear
              />
              {errors.room?.message != null && (
                <p className="input__error" role="alert">
                  {errors.room.message}
                </p>
              )}
            </div>
          );
        })()}

        <div className="form-grid--wide">
          <Input
            label="Name"
            type="text"
            placeholder="e.g. Counter outlet"
            autoComplete="off"
            error={errors.name?.message ?? null}
            {...register('name')}
          />
        </div>

        <div className="form-grid--wide">
          <Input
            label="Notes"
            type="text"
            placeholder="(optional)"
            autoComplete="off"
            error={errors.notes?.message ?? null}
            {...register('notes', {
              setValueAs: (v) =>
                typeof v === 'string' && v.trim() === '' ? null : v,
            })}
          />
        </div>

        {/* G37 cycle-68 — GFCI/AFCI protection picker. Same closed enum as
            BreakerForm. Cycle-71 Select primitive maps placeholder → null. */}
        <Select<ProtectionKind>
          id="cf-protection"
          label="Protection"
          data-testid="cf-protection"
          value={
            (watch('protection') as ProtectionKind | null | undefined) ?? null
          }
          onChange={(next) => {
            setValue('protection', next, {
              shouldDirty: true,
              shouldValidate: true,
            });
          }}
          placeholder="None"
          options={PROTECTION_OPTIONS}
          error={errors.protection?.message ?? null}
        />

        {/* G35 Part 2 cycle-59 — critical flag. Controlled API via watch +
            setValue (NOT register-spread per cycle-50 Checkbox primitive
            contract). Default false on create; the form's defaultValues
            from the screen seed `critical: false`. */}
        <div className="form-grid--wide component-form__critical">
          <Checkbox
            checked={watch('critical') ?? false}
            onChange={(next) =>
              setValue('critical', next, { shouldDirty: true })
            }
            label="Critical (priority for backup power)"
            testId="cf-critical"
          />
          <p className="component-form__critical-help">
            Mark fridges, freezers, well pumps, sump pumps, modems, medical
            devices, etc. so they’re flagged in the Impact view.
          </p>
        </div>

        {/* G31 cycle-39 — Wiring section. Hidden when there are no panels
            (early setup, before the user has created their first panel). */}
        {breakerGroups.length > 0 && (
          <div className="form-grid--wide component-form__wiring">
            <h3 className="component-form__wiring-heading">Wiring</h3>
            <div className="form-grid">
              <Select<string>
                id="cf-panel"
                label="Panel"
                data-testid="cf-panel"
                value={selectedPanelId}
                onChange={handlePanelChange}
                placeholder="Unassigned (not wired)"
                options={breakerGroups.map(({ panel }) => ({
                  value: panel.id,
                  label: panel.name,
                }))}
                hint={
                  /* Cycle-85 — hint surfaces only when the floor-linked
                     default is in effect (no breaker wired AND the floor
                     supplied a panel) so users understand WHY the Panel
                     was pre-selected. Hides once the user picks a breaker
                     (or overrides the Panel). */
                  currentBreakerId === null &&
                  floorPanelDefault !== null &&
                  selectedPanelId === floorPanelDefault
                    ? "Default from this component's floor — change to override."
                    : undefined
                }
              />
              <Select<string>
                id="cf-breaker"
                label="Breaker"
                data-testid="cf-breaker"
                aria-label="Breaker (pick a panel first)"
                value={currentBreakerId}
                onChange={handleBreakerChange}
                disabled={selectedPanelId === null}
                placeholder={
                  selectedPanelId === null
                    ? 'Pick a panel first'
                    : breakersForSelectedPanel.length === 0
                      ? 'No breakers on this panel'
                      : 'Choose a breaker'
                }
                options={breakersForSelectedPanel.map((b) => ({
                  value: b.id,
                  label: formatBreaker(b),
                }))}
              />
            </div>
          </div>
        )}
      </div>

      <div className="form-actions">
        {onCancel && (
          <Button type="button" variant="secondary" onClick={onCancel}>
            Cancel
          </Button>
        )}
        <Button type="submit" busy={isSubmitting} disabled={isSubmitting}>
          {isSubmitting ? 'Saving…' : submitLabel}
        </Button>
      </div>
    </form>
  );
};

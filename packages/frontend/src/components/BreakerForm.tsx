import { useEffect } from 'react';
import type { UseFormReturn } from 'react-hook-form';
import type {
  BreakerInput,
  Breaker,
  Panel,
  Poles,
  ProtectionKind,
  TandemHalf,
} from '@he/shared';
import { Button, Input, Select } from '../ui/index.js';

type Props = {
  form: UseFormReturn<BreakerInput>;
  onSubmit: (input: BreakerInput) => void | Promise<void>;
  submitLabel: string;
  onCancel?: () => void;
  /** G33 cycle-41 — context for strict slot validation.
   *  `slotCount` is the panel's slot capacity (1..slotCount valid).
   *  `existingBreakers` is the rest of the panel's breakers, so we can
   *  detect collisions (single → 1 slot taken, double → 2 slots taken).
   *  `editingBreakerId` (optional) excludes the breaker being edited
   *  from the collision check, so you can save without changing slot. */
  slotCount: number;
  existingBreakers: Breaker[];
  editingBreakerId?: string;
  /** G39 cycle-56 — when editing an EXISTING breaker, render a "Feeds
   *  subpanel" picker so the user can wire this breaker as the feeder
   *  for another panel. The current panel id is excluded (a panel can't
   *  feed itself); cycle prevention is enforced server-side too.
   *
   *  `allPanels` is every panel in the house (for the picker options).
   *  `currentPanelId` is THIS breaker's panel (excluded from options).
   *  `currentSubpanelId` is the panel currently fed by this breaker (or
   *  null if none). `onChangeFeedsSubpanel` writes the chosen subpanel's
   *  parent_breaker_id — it's the PANEL that owns the field, not the
   *  breaker. Pass null for "(no subpanel)". */
  allPanels?: Panel[];
  currentPanelId?: string;
  currentSubpanelId?: string | null;
  onChangeFeedsSubpanel?: (subpanelId: string | null) => void | Promise<void>;
};

const POLES_OPTIONS: { value: Poles; label: string }[] = [
  { value: 'single', label: 'Single (120V)' },
  { value: 'double', label: 'Double (240V)' },
  { value: 'tandem', label: 'Tandem' },
];

/** G37 cycle-68 — GFCI/AFCI/dual protection picker. Values map to the
 *  closed ProtectionKind enum on the breaker. The placeholder "None" row
 *  is rendered by the Select primitive (cycle-71) — selecting it resolves
 *  to null on the form. */
const PROTECTION_OPTIONS: { value: ProtectionKind; label: string }[] = [
  { value: 'gfci', label: 'GFCI' },
  { value: 'afci', label: 'AFCI' },
  { value: 'dual', label: 'GFCI + AFCI (dual)' },
];

/** G33+G34 — track per-slot occupancy with awareness of tandem halves.
 *  A slot N is "fully" taken (no further breakers allowed) when ANY of:
 *    - a single-pole breaker is there
 *    - a double-pole breaker's primary OR secondary slot covers N
 *    - BOTH tandem halves (a + b) are already there
 *  A slot N is "partially" taken with tandem-a (or -b) when exactly one
 *  half is present — the OTHER half is still available.
 *  We skip the breaker being edited so the user can resave without
 *  flagging itself as a collision. */
type SlotOccupancy = {
  /** Set of slots where no breaker of ANY kind can be added. */
  full: Set<number>;
  /** Slots that have ONLY a tandem-a → tandem-b is still possible. */
  tandemAOnly: Set<number>;
  /** Slots that have ONLY a tandem-b → tandem-a is still possible. */
  tandemBOnly: Set<number>;
};
const buildOccupancy = (
  existing: Breaker[],
  editingId: string | undefined
): SlotOccupancy => {
  const full = new Set<number>();
  const tandemAOnly = new Set<number>();
  const tandemBOnly = new Set<number>();
  // Two-pass: first collect tandem halves; then mark single/double slots full.
  for (const b of existing) {
    if (b.id === editingId) continue;
    if (b.slotPosition === null) continue;
    if (b.poles === 'tandem') {
      const half = b.tandemHalf ?? 'a';
      if (half === 'a') tandemAOnly.add(b.slotPosition);
      else tandemBOnly.add(b.slotPosition);
    } else {
      full.add(b.slotPosition);
      if (b.poles === 'double') full.add(b.slotPosition + 1);
    }
  }
  // Promote slots with BOTH tandem halves to "full".
  for (const n of tandemAOnly) {
    if (tandemBOnly.has(n)) {
      full.add(n);
      tandemAOnly.delete(n);
      tandemBOnly.delete(n);
    }
  }
  return { full, tandemAOnly, tandemBOnly };
};

export const BreakerForm = ({
  form,
  onSubmit,
  submitLabel,
  onCancel,
  slotCount,
  existingBreakers,
  editingBreakerId,
  allPanels,
  currentPanelId,
  currentSubpanelId,
  onChangeFeedsSubpanel,
}: Props): JSX.Element => {
  const {
    register,
    handleSubmit,
    setValue,
    watch,
    formState: { errors, isSubmitting },
  } = form;

  const occupancy = buildOccupancy(existingBreakers, editingBreakerId);
  // Watch poles + tandemHalf so validate re-runs on those changes.
  const polesValue = watch('poles');
  const tandemHalfValue = watch('tandemHalf') as TandemHalf | null | undefined;

  /** G33+G34 — validate slot input against panel + occupancy + tandem rules. */
  const validateSlot = (raw: string): true | string => {
    if (raw === '' || raw === undefined || raw === null) return 'Slot is required.';
    const n = Number.parseInt(raw, 10);
    if (!Number.isFinite(n) || String(n) !== raw.trim()) {
      return 'Slot must be a whole number.';
    }
    if (n < 1) return 'Slot must be at least 1.';
    if (n > slotCount) {
      return `This panel has ${slotCount} slots — pick 1–${slotCount}.`;
    }
    if (polesValue === 'tandem') {
      if (tandemHalfValue !== 'a' && tandemHalfValue !== 'b') {
        return 'Tandem breakers must pick a half (a or b).';
      }
      if (occupancy.full.has(n)) {
        return `Slot ${n} is already taken — tandem halves can't share with a single/double-pole breaker.`;
      }
      const sameHalfTaken =
        tandemHalfValue === 'a'
          ? occupancy.tandemAOnly.has(n)
          : occupancy.tandemBOnly.has(n);
      if (sameHalfTaken) {
        return `Slot ${n}${tandemHalfValue} is already taken by another tandem breaker.`;
      }
    } else {
      if (
        occupancy.full.has(n) ||
        occupancy.tandemAOnly.has(n) ||
        occupancy.tandemBOnly.has(n)
      ) {
        return `Slot ${n} is already taken by another breaker.`;
      }
      if (polesValue === 'double') {
        if (n + 1 > slotCount) {
          return `A double-pole breaker spans slots ${n}+${n + 1}, but slot ${n + 1} is past the panel's ${slotCount}-slot limit.`;
        }
        if (
          occupancy.full.has(n + 1) ||
          occupancy.tandemAOnly.has(n + 1) ||
          occupancy.tandemBOnly.has(n + 1)
        ) {
          return `A double-pole breaker would also need slot ${n + 1}, but that's already taken.`;
        }
      }
    }
    return true;
  };

  // G34 — when poles flips away from 'tandem', clear tandemHalf.
  useEffect(() => {
    if (polesValue !== 'tandem' && tandemHalfValue !== null && tandemHalfValue !== undefined) {
      setValue('tandemHalf', null, { shouldDirty: true });
    }
  }, [polesValue, tandemHalfValue, setValue]);

  /** G39 cycle-56 — compute the set of panel ids that are ANCESTORS of the
   *  current panel. Those panels cannot be made into a subpanel of this
   *  breaker without creating a cycle. The current panel itself is also
   *  excluded (a panel can't feed itself). */
  const subpanelOptions = (): Panel[] => {
    if (!allPanels || currentPanelId === undefined) return [];
    const ancestorPanelIds = new Set<string>();
    ancestorPanelIds.add(currentPanelId);
    let cursorPanelId: string | undefined = currentPanelId;
    const maxDepth = allPanels.length + 1;
    for (let depth = 0; depth < maxDepth; depth++) {
      const cursor: Panel | undefined = allPanels.find(
        (p) => p.id === cursorPanelId
      );
      if (!cursor || cursor.parentBreakerId === null) break;
      // Find the breaker (across all panels) — we only have the current
      // panel's existingBreakers reliably; for ancestor walk we just check
      // which panel owns the cursor's parentBreaker. We can't fully resolve
      // without the breaker→panel map, but the server enforces cycles
      // server-side as the final guard. UI just hides obvious cycles.
      // Look through OTHER panels' parentBreakerIds to find the ancestor:
      // the ancestor panel is whichever panel has a breaker matching
      // cursor.parentBreakerId. Without the full breaker map we fall back
      // to existingBreakers (which only covers the current panel). For
      // single-level subpanels this still works; deeper chains rely on the
      // server check.
      const parentBreaker = existingBreakers.find(
        (b) => b.id === cursor.parentBreakerId
      );
      if (!parentBreaker) break;
      ancestorPanelIds.add(parentBreaker.panelId);
      cursorPanelId = parentBreaker.panelId;
    }
    return allPanels.filter((p) => !ancestorPanelIds.has(p.id));
  };

  const feedsPickerEnabled =
    editingBreakerId !== undefined &&
    allPanels !== undefined &&
    onChangeFeedsSubpanel !== undefined;
  const feedsDisabledByTandem = polesValue === 'tandem';
  const subpanelChoices = feedsPickerEnabled ? subpanelOptions() : [];
  const handleSubpanelChange = async (next: string | null): Promise<void> => {
    if (!onChangeFeedsSubpanel) return;
    await onChangeFeedsSubpanel(next);
  };

  // G33 — keep `slotPosition` in sync with `slot` automatically. When the
  // user types a valid slot, slotPosition gets the same integer value. This
  // hides the separate Position field from the form while still populating
  // the canonical numeric field the panel viz reads from. Manual override
  // of slotPosition (different from slot) is no longer exposed in the UI;
  // an out-of-band data path could still set it.
  const slotRaw = watch('slot');
  useEffect(() => {
    if (slotRaw === undefined || slotRaw === '') return;
    const n = Number.parseInt(String(slotRaw), 10);
    if (Number.isFinite(n) && n >= 1 && n <= slotCount) {
      setValue('slotPosition', n, { shouldDirty: true });
    }
  }, [slotRaw, slotCount, setValue]);

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="breaker-form" noValidate>
      <div className="form-grid">
        <Input
          label="Slot"
          type="number"
          inputMode="numeric"
          min={1}
          max={slotCount}
          step={1}
          placeholder={`1–${slotCount}`}
          autoComplete="off"
          error={errors.slot?.message ?? null}
          hint={
            errors.slot?.message === undefined
              ? `Pick a number from 1 to ${slotCount}.`
              : undefined
          }
          {...register('slot', { validate: validateSlot })}
        />

        <Input
          label="Amps"
          type="number"
          inputMode="numeric"
          min={1}
          max={400}
          step={1}
          error={errors.amperage?.message ?? null}
          {...register('amperage', { valueAsNumber: true })}
        />

        <Select<Poles>
          id="bf-poles"
          label="Poles"
          value={(watch('poles') as Poles | null | undefined) ?? 'single'}
          onChange={(next) => {
            // poles is required (non-null) — fall back to 'single' when
            // the consumer somehow clears it.
            setValue('poles', next ?? 'single', {
              shouldDirty: true,
              shouldValidate: true,
            });
          }}
          options={POLES_OPTIONS}
          error={errors.poles?.message ?? null}
        />

        {/* G34 cycle-42 — tandem half picker, visible only when
            poles === 'tandem'. Two tandem breakers share one slot;
            this picks which half (the top or bottom stab) this is.
            Cycle-71: Select primitive hoists the setValueAs mapping
            (empty string → null) into onChange. */}
        {polesValue === 'tandem' && (
          <Select<TandemHalf>
            id="bf-tandem-half"
            label="Tandem half"
            data-testid="bf-tandem-half"
            value={tandemHalfValue ?? null}
            onChange={(next) => {
              setValue('tandemHalf', next, {
                shouldDirty: true,
                shouldValidate: true,
              });
            }}
            placeholder="— pick a half —"
            options={[
              { value: 'a', label: 'a (first half)' },
              { value: 'b', label: 'b (second half)' },
            ]}
            error={errors.tandemHalf?.message ?? null}
          />
        )}

        {/* G37 cycle-68 — GFCI/AFCI protection picker. Single-select below
            Poles. Writes a ProtectionKind | null; cycle-71 Select primitive
            maps placeholder → null in onChange. */}
        <Select<ProtectionKind>
          id="bf-protection"
          label="Protection"
          data-testid="bf-protection"
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

        <div className="form-grid--wide">
          <Input
            label="Label"
            type="text"
            placeholder="e.g. Kitchen counter"
            autoComplete="off"
            error={errors.label?.message ?? null}
            {...register('label')}
          />
        </div>

        {/* G33 cycle-41 — slotPosition is auto-synced from `slot` via the
            useEffect above, hidden from the UI to avoid two-field confusion.
            The field is still registered so react-hook-form keeps it in the
            submit payload. Manual override is no longer surfaced. */}
        <input
          type="hidden"
          {...register('slotPosition', {
            setValueAs: (v) => (v === '' || v === null ? null : Number(v)),
          })}
        />

        {/* G39 cycle-56 — "Feeds subpanel" picker. Visible only when editing
            an existing breaker (the picker writes to PANELS.parent_breaker_id,
            which requires this breaker to have an id). Disabled for tandem
            breakers (tandems are single-circuit halves — not feeder candidates).
            Cycle prevention: ancestor panels of this panel are excluded from
            the option list; server is the final guard. */}
        {feedsPickerEnabled && (
          <div className="form-grid--wide">
            <Select<string>
              id="bf-feeds-subpanel"
              label="Feeds subpanel"
              data-testid="bf-feeds-subpanel"
              disabled={feedsDisabledByTandem}
              value={currentSubpanelId ?? null}
              onChange={(next) => {
                void handleSubpanelChange(next);
              }}
              placeholder="(no subpanel)"
              options={subpanelChoices.map((p) => ({
                value: p.id,
                label: p.name,
              }))}
              hint={
                feedsDisabledByTandem
                  ? 'Tandem breakers are single-circuit halves and cannot feed a subpanel.'
                  : 'If this breaker feeds another panel (e.g. garage subpanel), pick it here.'
              }
            />
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

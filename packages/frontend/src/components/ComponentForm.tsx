import type { UseFormReturn } from 'react-hook-form';
import type {
  ComponentInput,
  ComponentType,
  ProtectionKind,
} from '@he/shared';
import type { PanelWithBreakers } from '../api.js';
import { componentTypeLabel } from './ComponentTypeIcon.js';
import { BreakerComboField } from './BreakerComboField.js';
import { Button, Checkbox, Combobox, Input, Select } from '../ui/index.js';
import { TYPICAL_LOAD_WATTS } from '../lib/load.js';

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
   *  When set, that panel's breaker group sorts first in the picker. */
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

  // Wiring: ONE step (2026-05). `breakerId` is the only field the API cares
  // about — the panel a component lives on is DERIVED from its breaker
  // (component.breakerId → breaker.panelId), never stored separately. So a
  // single breaker picker, grouped by panel, is all that's needed: picking a
  // breaker assigns the panel automatically. (Replaces the old cycle-39
  // cascading Panel → Breaker pair, which made wiring a 2-step chore.)
  const currentBreakerId = watch('breakerId') ?? null;

  const handleBreakerChange = (next: string | null): void => {
    setValue('breakerId', next, { shouldDirty: true, shouldValidate: true });
  };

  // 2026-05 — typical continuous-load default OFFERED for the current type.
  const typicalLoad =
    TYPICAL_LOAD_WATTS[(watch('type') as ComponentType | undefined) ?? 'outlet'];

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

        {/* Wiring — elevated near the top (2026-05): which breaker powers this
            component is the most important relationship to capture, so it sits
            right under the identity fields, above the optional details below.
            Single breaker picker (panel derived from the breaker; create a new
            circuit inline). Hidden when there are no panels (early setup). */}
        {breakerGroups.length > 0 && (
          <div className="form-grid--wide component-form__wiring">
            <h3 className="component-form__wiring-heading">Wiring</h3>
            <label className="input__label" htmlFor="cf-breaker-trigger">
              Breaker
            </label>
            <BreakerComboField
              panels={breakerGroups}
              value={currentBreakerId}
              onChange={handleBreakerChange}
              floorPanelId={floorPanelId}
              testId="cf-breaker"
            />
            <p className="component-form__wiring-hint">
              Pick the breaker — the panel it’s on is set automatically. New
              circuit? Use <strong>+ New breaker</strong> in the picker.
            </p>
          </div>
        )}

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

        {/* 2026-05 — per-circuit load (watts). Optional; null = unknown. A
            typical value for the chosen type is offered (placeholder + a
            one-tap "Use typical" button); the user can override or clear. */}
        <div className="form-grid--wide component-form__load">
          <Input
            label="Load (watts)"
            type="number"
            inputMode="numeric"
            min={0}
            step={10}
            data-testid="cf-load-watts"
            placeholder={
              typicalLoad !== null ? `Typical: ${typicalLoad} W` : 'e.g. 1500'
            }
            autoComplete="off"
            hint="Estimated continuous draw — used for overload warnings. Leave blank if unknown."
            error={errors.loadWatts?.message ?? null}
            {...register('loadWatts', {
              setValueAs: (v) => {
                if (v === '' || v === null || v === undefined) return null;
                const n =
                  typeof v === 'number' ? v : Number.parseInt(String(v), 10);
                return Number.isFinite(n) ? n : null;
              },
            })}
          />
          {typicalLoad !== null && typicalLoad > 0 && (
            <button
              type="button"
              className="component-form__load-typical"
              data-testid="cf-load-typical"
              onClick={() =>
                setValue('loadWatts', typicalLoad, {
                  shouldDirty: true,
                  shouldValidate: true,
                })
              }
            >
              Use typical ({typicalLoad} W)
            </button>
          )}
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

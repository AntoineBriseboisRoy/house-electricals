import type { PanelWithBreakers } from '../api.js';
import { Combobox } from '../ui/index.js';

type Props = {
  value: string | null;
  groups: PanelWithBreakers[];
  onChange: (breakerId: string | null) => void;
  disabled?: boolean;
  ariaLabel?: string;
};

const formatBreaker = (b: PanelWithBreakers['breakers'][number]): string => {
  const pos = b.slotPosition !== null ? `#${b.slotPosition} ` : '';
  // G34: include tandem half letter for clarity.
  const half = b.poles === 'tandem' && b.tandemHalf !== null ? b.tandemHalf : '';
  return `slot ${b.slot}${half} · ${pos}${b.label} · ${b.amperage}A`;
};

/**
 * Breaker picker — 2026-05: ported to the shared `<Combobox>` primitive
 * (themed popover, grouped via `optGroups`) so every dropdown in the app
 * shares one styled component. The "Unassigned" placeholder maps to null;
 * search auto-appears once there are enough breakers to warrant it.
 */
export const BreakerPicker = ({
  value,
  groups,
  onChange,
  disabled = false,
  ariaLabel = 'Assign to breaker',
}: Props): JSX.Element => {
  return (
    <Combobox<string>
      value={value}
      onChange={onChange}
      disabled={disabled}
      ariaLabel={ariaLabel}
      placeholder="Unassigned"
      optGroups={groups.map(({ panel, breakers }) => ({
        label: panel.name,
        options: breakers.map((b) => ({
          value: b.id,
          label: formatBreaker(b),
        })),
      }))}
    />
  );
};

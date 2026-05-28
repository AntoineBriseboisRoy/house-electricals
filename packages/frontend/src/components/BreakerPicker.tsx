import type { PanelWithBreakers } from '../api.js';
import { Select } from '../ui/index.js';

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
 * Breaker picker — cycle-71: ported to the shared `<Select>` primitive
 * using its optGroups prop (panel → breakers). The "Unassigned" row maps
 * to null via the primitive's placeholder semantics.
 */
export const BreakerPicker = ({
  value,
  groups,
  onChange,
  disabled = false,
  ariaLabel = 'Assign to breaker',
}: Props): JSX.Element => {
  return (
    <Select<string>
      value={value}
      onChange={onChange}
      disabled={disabled}
      aria-label={ariaLabel}
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

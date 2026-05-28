import type { ProtectionKind } from '@he/shared';

/**
 * G37 cycle-68 — GFCI/AFCI/dual safety badge.
 *
 * Reused across ComponentsScreen rows, PanelDetailScreen components-on-panel
 * rows, and TestPanelScreen visible-when-off list. Same visual treatment
 * everywhere: a pill in the cycle-59 `--color-warning*` amber family (safety
 * indicator → warn tier). DOM test-hook contract: `data-testid="protection-
 * badge"` + `data-protection="<kind>"` on every render.
 *
 * The panel viz uses its own slot-corner-positioned `.panel-viz__protection-
 * badge` class (absolutely-positioned inside the slot button); this component
 * is for inline-row contexts where the badge sits in the text flow.
 */
const protectionLabel = (kind: ProtectionKind): string =>
  kind === 'dual' ? 'DUAL' : kind.toUpperCase();

const protectionTitle = (kind: ProtectionKind): string =>
  kind === 'gfci'
    ? 'GFCI-protected — test monthly'
    : kind === 'afci'
      ? 'AFCI-protected — test monthly'
      : 'GFCI + AFCI (dual) — test monthly';

export const ProtectionBadge = ({
  kind,
}: {
  kind: ProtectionKind;
}): JSX.Element => (
  <span
    className="badge badge--protection"
    data-testid="protection-badge"
    data-protection={kind}
    title={protectionTitle(kind)}
  >
    {protectionLabel(kind)}
  </span>
);

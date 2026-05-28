/*
 * Cycle-76 — bespoke SVG illustrations for the EmptyState `illustration`
 * slot. Used on first-impression empty surfaces (PanelList, MapLanding,
 * ComponentsScreen truly-empty, PanelDetail no-breakers). Lucide remains
 * canonical for ICONS — these are one-off art pieces.
 *
 * STRICT CONTRACT (Lockin FATAL #3, cycle-11/17/20 token rule):
 * - NO hex literals. Stroke + fill MUST be `currentColor` or
 *   `var(--color-*)` only.
 * - NO new token NAMES.
 * - viewBox 0 0 140 140 standard.
 * - forwardRef<SVGSVGElement> for composability.
 */

export { NoPanels } from './NoPanels.js';
export { NoFloors } from './NoFloors.js';
export { NoComponents } from './NoComponents.js';
export { NoBreakers } from './NoBreakers.js';

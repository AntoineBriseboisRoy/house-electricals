import type { ComponentType } from '@he/shared';

type Props = {
  type: ComponentType;
  size?: number;
};

const PATHS: Record<ComponentType, JSX.Element> = {
  outlet: (
    <>
      <rect x="3" y="3" width="18" height="18" rx="2" />
      <circle cx="9" cy="11" r="1.4" />
      <circle cx="15" cy="11" r="1.4" />
      <rect x="11" y="15" width="2" height="3" rx="0.5" />
    </>
  ),
  light: (
    <>
      <path d="M9 18h6" />
      <path d="M10 21h4" />
      <path d="M12 3a6 6 0 0 0-3.5 10.8c.6.5 1 1.2 1 2v.2h5v-.2c0-.8.4-1.5 1-2A6 6 0 0 0 12 3z" />
    </>
  ),
  switch: (
    <>
      <rect x="6" y="3" width="12" height="18" rx="2" />
      <rect x="9" y="7" width="6" height="6" rx="1" fill="currentColor" stroke="none" />
    </>
  ),
  appliance: (
    <>
      <rect x="4" y="3" width="16" height="18" rx="2" />
      <line x1="4" y1="9" x2="20" y2="9" />
      <circle cx="8" cy="6" r="0.8" fill="currentColor" stroke="none" />
      <line x1="9" y1="14" x2="15" y2="14" />
    </>
  ),
  junction_box: (
    <>
      <rect x="4" y="4" width="16" height="16" rx="1" />
      <line x1="4" y1="12" x2="20" y2="12" />
      <line x1="12" y1="4" x2="12" y2="20" />
    </>
  ),
  smoke_detector: (
    <>
      <circle cx="12" cy="12" r="9" />
      <circle cx="12" cy="12" r="5" />
      <circle cx="12" cy="12" r="1" fill="currentColor" stroke="none" />
    </>
  ),
  other: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M9.5 9.5a2.5 2.5 0 1 1 3.5 2.3c-.7.3-1 .9-1 1.7" />
      <circle cx="12" cy="17" r="0.8" fill="currentColor" stroke="none" />
    </>
  ),
};

const LABELS: Record<ComponentType, string> = {
  outlet: 'Outlet',
  light: 'Light',
  switch: 'Switch',
  appliance: 'Appliance',
  junction_box: 'Junction box',
  smoke_detector: 'Smoke detector',
  other: 'Other',
};

export const ComponentTypeIcon = ({ type, size = 24 }: Props): JSX.Element => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth={1.6}
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-label={LABELS[type]}
    role="img"
  >
    {PATHS[type]}
  </svg>
);

export const componentTypeLabel = (type: ComponentType): string => LABELS[type];

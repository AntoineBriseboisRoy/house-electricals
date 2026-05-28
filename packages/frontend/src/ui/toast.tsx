/*
 * Thin wrapper over `sonner` so the rest of the app imports `ui/toast`,
 * not the library directly. If we ever swap toast vendors, only this file
 * + the ThemedToaster mount point need to change.
 *
 * Usage:
 *   import { toast } from '../ui/toast';
 *   toast.success('Saved');
 *   toast.error('Could not delete');
 *
 * G11 cycle-52: adds `<ThemedToaster />`, a theme-bound mount wrapper that
 * binds sonner's `theme` prop to the user's he.theme preference (resolved
 * to 'light' | 'dark') instead of falling back to OS prefers-color-scheme.
 * Mounted ONCE at the route-tree root in main.tsx (OUTSIDE the AppShell-
 * wrapped Switch) so toasts are reachable from escape-hatch routes
 * (FloorEdit, /print) too. See CLAUDE.md "Library choices (pinned)".
 */

import { Toaster as SonnerToaster, toast, type ToasterProps } from 'sonner';
import { useTheme } from '../contexts/ThemeContext.js';

export { toast };
export { SonnerToaster as Toaster };
export type { ToasterProps };

export type ThemedToasterProps = Omit<ToasterProps, 'theme'>;

/**
 * G11 cycle-52: theme-bound Toaster mount. Calls useTheme() to bind
 * sonner's `theme` prop to the user's he.theme preference (resolved
 * to 'light' | 'dark') instead of falling back to OS prefers-color-
 * scheme. Mounted ONCE at the route-tree root in main.tsx — see
 * CLAUDE.md "Library choices (pinned)" for the post-cycle-52 pin.
 */
export const ThemedToaster = (props: ThemedToasterProps): JSX.Element => {
  const { resolvedTheme } = useTheme();
  return <SonnerToaster theme={resolvedTheme} {...props} />;
};

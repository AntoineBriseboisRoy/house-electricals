import { Moon, Sun, Monitor } from 'lucide-react';
import { useTheme } from '../contexts/ThemeContext.js';
import { IconButton } from './IconButton.js';

/**
 * G22 cycle-23 — floating theme toggle.
 *
 * Cycles through dark → light → system → dark. Rendered fixed at the
 * top-right of the viewport so it's reachable from any screen without
 * threading a prop through every ScreenHeader.
 *
 * Lives in its own ui/* primitive so future cycles can move it (e.g. into
 * a Settings page or a dropdown) without touching every consumer.
 */
export const ThemeToggle = (): JSX.Element => {
  const { theme, cycleTheme } = useTheme();
  const icon =
    theme === 'dark' ? (
      <Moon size={18} strokeWidth={2.25} />
    ) : theme === 'light' ? (
      <Sun size={18} strokeWidth={2.25} />
    ) : (
      <Monitor size={18} strokeWidth={2.25} />
    );
  const label =
    theme === 'dark'
      ? 'Theme: dark (tap for light)'
      : theme === 'light'
        ? 'Theme: light (tap for system)'
        : 'Theme: system (tap for dark)';
  return (
    <div className="theme-toggle" data-testid="theme-toggle">
      <IconButton
        icon={icon}
        aria-label={label}
        title={label}
        variant="ghost"
        onClick={cycleTheme}
        data-theme={theme}
      />
    </div>
  );
};

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from 'react';

/**
 * G22 cycle-23 — Theme provider.
 *
 * Pattern adopted from HousesTracker's `client/src/contexts/ThemeContext.tsx`,
 * renamed to House Electricals's namespace. Pins:
 *
 * - Storage key is `he.theme` (NOT `centris_theme`) — namespace collision
 *   avoidance per Lockin FATAL #2.
 * - Default = 'dark' (matches HousesTracker default + preserves the
 *   cycle-11/17/20 shipped UX so existing users don't get flashbanged on
 *   the cycle-23 deploy).
 * - Three modes: 'light' | 'dark' | 'system' (system = match
 *   prefers-color-scheme).
 * - On mount + change, adds `.theme-transitioning` to <html> for 850ms
 *   so the swap fades smoothly. Carve-outs for heavy surfaces (.floor-plan,
 *   .panel-viz) live in styles.css so the canvas doesn't stutter.
 */

export type Theme = 'light' | 'dark' | 'system';
type ResolvedTheme = 'light' | 'dark';

type ThemeContextValue = {
  theme: Theme;
  setTheme: (next: Theme) => void;
  resolvedTheme: ResolvedTheme;
  /** Convenience: cycle through dark → light → system → dark. */
  cycleTheme: () => void;
};

const ThemeContext = createContext<ThemeContextValue | null>(null);

const STORAGE_KEY = 'he.theme';

const getSystemTheme = (): ResolvedTheme =>
  typeof window !== 'undefined' &&
  window.matchMedia('(prefers-color-scheme: dark)').matches
    ? 'dark'
    : 'light';

const readStored = (): Theme => {
  if (typeof window === 'undefined') return 'dark';
  try {
    const v = window.localStorage.getItem(STORAGE_KEY);
    if (v === 'light' || v === 'dark' || v === 'system') return v;
  } catch {
    /* localStorage disabled */
  }
  return 'dark';
};

export const ThemeProvider = ({ children }: { children: ReactNode }): JSX.Element => {
  const [theme, setThemeState] = useState<Theme>(readStored);
  const resolvedTheme: ResolvedTheme =
    theme === 'system' ? getSystemTheme() : theme;

  useEffect(() => {
    const root = document.documentElement;
    root.classList.add('theme-transitioning');
    root.classList.remove('light', 'dark');
    root.classList.add(resolvedTheme);
    try {
      window.localStorage.setItem(STORAGE_KEY, theme);
    } catch {
      /* ignore */
    }
    const t = window.setTimeout(
      () => root.classList.remove('theme-transitioning'),
      850
    );
    return () => window.clearTimeout(t);
  }, [theme, resolvedTheme]);

  // When the user picks 'system', re-evaluate on OS-level theme changes.
  useEffect(() => {
    if (theme !== 'system') return;
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const handler = (): void => {
      const root = document.documentElement;
      root.classList.remove('light', 'dark');
      root.classList.add(getSystemTheme());
    };
    mq.addEventListener('change', handler);
    return () => mq.removeEventListener('change', handler);
  }, [theme]);

  const setTheme = useCallback((next: Theme): void => {
    setThemeState(next);
  }, []);

  const cycleTheme = useCallback((): void => {
    setThemeState((cur) => (cur === 'dark' ? 'light' : cur === 'light' ? 'system' : 'dark'));
  }, []);

  return (
    <ThemeContext.Provider value={{ theme, setTheme, resolvedTheme, cycleTheme }}>
      {children}
    </ThemeContext.Provider>
  );
};

export const useTheme = (): ThemeContextValue => {
  const ctx = useContext(ThemeContext);
  if (ctx === null) {
    throw new Error('useTheme must be used inside ThemeProvider');
  }
  return ctx;
};

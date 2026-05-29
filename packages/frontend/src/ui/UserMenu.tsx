import { useState } from 'react';
import { createPortal } from 'react-dom';
import { LogOut, KeyRound, Monitor, Moon, Sun, User } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext.js';
import { useTheme, type Theme } from '../contexts/ThemeContext.js';
import { Button } from './Button.js';
import { Modal } from './Modal.js';
import { ChangePasswordModal } from '../components/ChangePasswordModal.js';

/**
 * fix/mobile-floating-cluster — account menu lives in the BOTTOM TAB BAR.
 *
 * The account/theme/logout controls used to be floating fixed chips on
 * every screen (the feat/auth-gate-signup 3-button cluster: `<ThemeToggle />`
 * + `<AccountButton />` + `<LogoutButton />`). On mobile those overlapped
 * the in-header Add CTAs (Add panel / Add component / Add floor) — the user
 * flagged it. An interim single-chip consolidation was ALSO rejected: the
 * user wants NOTHING user/theme-related floating over page content.
 *
 * The resolution (HousesTracker pattern): this component renders an
 * "Account" item that AppShell threads into `BottomTabs` as its `trailing`
 * cell, so it sits alongside Map / Panels / Test / Library as the last tab.
 * Tapping it opens a Modal-as-sheet (cycle-73 `presentation="sheet"`)
 * housing:
 *
 *   - "Signed in as <username>" header
 *   - Theme picker: Light / Dark / System (three buttons)
 *   - Change password (opens ChangePasswordModal)
 *   - Sign out
 *
 * Because the trigger is a tab-bar item, no fixed-position chrome floats
 * over the page — the screen-header no longer reserves right-edge padding
 * for it. The trigger uses the `.bottom-tabs__link` classes so it matches
 * the navigation tabs visually; the two Modals portal to <body> so only
 * the button appears inside the tab grid.
 */

type ThemeOption = {
  value: Theme;
  label: string;
  icon: JSX.Element;
};

const THEME_OPTIONS: ThemeOption[] = [
  { value: 'light', label: 'Light', icon: <Sun size={16} strokeWidth={2.25} /> },
  { value: 'dark', label: 'Dark', icon: <Moon size={16} strokeWidth={2.25} /> },
  {
    value: 'system',
    label: 'System',
    icon: <Monitor size={16} strokeWidth={2.25} />,
  },
];

export const UserMenu = (): JSX.Element | null => {
  const { state, logout } = useAuth();
  const { theme, setTheme } = useTheme();
  const [menuOpen, setMenuOpen] = useState(false);
  const [changePasswordOpen, setChangePasswordOpen] = useState(false);

  if (state.phase !== 'authed') return null;

  const handleChangePassword = (): void => {
    // Close the menu sheet BEFORE opening the change-password modal so
    // we don't stack two Modals on top of each other (avoids the
    // "modal in modal" focus-trap interleave).
    setMenuOpen(false);
    setChangePasswordOpen(true);
  };

  const handleLogout = (): void => {
    setMenuOpen(false);
    void logout();
  };

  return (
    <>
      <button
        type="button"
        className={
          menuOpen
            ? 'bottom-tabs__link bottom-tabs__link--active'
            : 'bottom-tabs__link'
        }
        onClick={() => setMenuOpen(true)}
        aria-haspopup="dialog"
        aria-expanded={menuOpen}
        aria-label={`Account menu (${state.user.username})`}
        data-testid="user-menu-button"
      >
        <span className="bottom-tabs__icon" aria-hidden="true">
          <User size={22} strokeWidth={2} />
        </span>
        <span className="bottom-tabs__label">Account</span>
      </button>

      {/* The base Modal renders its overlay INLINE at this point in the
          tree. Because the trigger above lives inside `.bottom-tabs`, an
          inline overlay would be a descendant of the tab bar — and the
          `body:has(.modal-overlay) .bottom-tabs { display: none }` rule
          (cycle-50/73) would then hide the sheet along with the bar. So
          we portal both Modals to <body>: only the trigger button stays
          inside the tab grid; the sheet mounts at document root and the
          tab-bar-hide rule still fires correctly. */}
      {createPortal(
        <>
          <Modal
            open={menuOpen}
            onClose={() => setMenuOpen(false)}
            title="Account"
            testId="user-menu-modal"
            presentation="sheet"
          >
        <div className="user-menu__body">
          <p className="user-menu__signed-in">
            <span className="user-menu__signed-in-label">Signed in as</span>
            <span
              className="user-menu__username"
              data-testid="user-menu-username"
            >
              {state.user.username}
            </span>
          </p>

          <section
            className="user-menu__section"
            aria-labelledby="user-menu-theme-heading"
          >
            <h3
              id="user-menu-theme-heading"
              className="user-menu__section-title"
            >
              Theme
            </h3>
            <div
              className="user-menu__theme-row"
              role="radiogroup"
              aria-label="Theme"
            >
              {THEME_OPTIONS.map((opt) => (
                <button
                  key={opt.value}
                  type="button"
                  role="radio"
                  aria-checked={theme === opt.value}
                  className="user-menu__theme-option"
                  data-selected={theme === opt.value}
                  data-testid={`user-menu-theme-${opt.value}`}
                  onClick={() => setTheme(opt.value)}
                >
                  <span className="user-menu__theme-icon" aria-hidden="true">
                    {opt.icon}
                  </span>
                  <span className="user-menu__theme-label">{opt.label}</span>
                </button>
              ))}
            </div>
          </section>

          <section className="user-menu__section">
            <Button
              type="button"
              variant="ghost"
              block
              leadingIcon={<KeyRound size={16} strokeWidth={2.25} />}
              onClick={handleChangePassword}
              data-testid="user-menu-change-password"
            >
              Change password
            </Button>
            <Button
              type="button"
              variant="danger"
              block
              leadingIcon={<LogOut size={16} strokeWidth={2.25} />}
              onClick={handleLogout}
              data-testid="user-menu-logout"
            >
              Sign out
            </Button>
          </section>
            </div>
          </Modal>

          <ChangePasswordModal
            open={changePasswordOpen}
            onClose={() => setChangePasswordOpen(false)}
          />
        </>,
        document.body
      )}
    </>
  );
};

import { useState } from 'react';
import { RefreshCw } from 'lucide-react';
import { Modal } from './Modal.js';
import { Button } from './Button.js';
import { toast } from './toast.js';

/**
 * Cycle-68 — version stamp + force-refresh affordance.
 * Cycle-83 — switched display from git SHA → incremental semver from
 * `packages/frontend/package.json`. The user wanted human-friendly
 * release markers (v0.1, v0.2, v0.3…) instead of the 7-char SHA.
 *
 * A small fixed chip anchored bottom-left, just above the bottom tab bar
 * (see `.version-pill` in styles.css). Renders a "v0.X" marker that opens
 * a modal offering "Force refresh" — which unregisters every service
 * worker + clears every cache + reloads. (fix/mobile-floating-cluster:
 * the old top-right ThemeToggle it once sat beside is gone; theme + account
 * controls now live in the bottom-tab Account sheet.)
 *
 * Backup mechanism for users stuck on a stale PWA. The PRIMARY update path
 * stays vite-plugin-pwa's `registerType: 'autoUpdate' + skipWaiting +
 * clientsClaim` triad (cycle-22/54 ADR — DO NOT change). This affordance
 * just gives users an escape hatch when iOS PWA holds the old SW across
 * refresh, without invalidating the autoUpdate strategy.
 *
 * `__APP_VERSION__` is injected via `vite.config.ts` `define:` from
 * `packages/frontend/package.json` `"version"`. Bump that field to
 * release a new marker. Patch (`.0`) is stripped at build time so
 * `0.2.0` → `0.2`. Local `pnpm dev` shows the same — the value comes
 * from package.json, not from an env variable.
 *
 * The build SHA is still injected via the CI `--build-arg GIT_SHA` flow
 * and shown inside the modal body for ops/debugging, but no longer
 * dominates the chip surface.
 */
declare const __APP_VERSION__: string;
const APP_VERSION = __APP_VERSION__;

const RAW_SHA = (import.meta.env.VITE_GIT_SHA ?? '').trim();
const SHORT_SHA = RAW_SHA.length >= 7 ? RAW_SHA.slice(0, 7) : '';

async function forceRefresh(): Promise<void> {
  try {
    if ('serviceWorker' in navigator) {
      const regs = await navigator.serviceWorker.getRegistrations();
      await Promise.all(regs.map((r) => r.unregister()));
    }
    if ('caches' in window) {
      const keys = await caches.keys();
      await Promise.all(keys.map((k) => caches.delete(k)));
    }
  } catch (err) {
    // Best-effort — even if unregister / delete throws, still reload so
    // the user gets a fresh fetch attempt. Surface the error in case it's
    // useful for debugging.
    toast.error(`Cache clear partially failed: ${(err as Error).message}`);
  }
  window.location.reload();
}

export const VersionPill = (): JSX.Element => {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  return (
    <>
      <button
        type="button"
        className="version-pill"
        onClick={() => setOpen(true)}
        aria-label={`App version ${APP_VERSION} — tap to force refresh`}
        title={`App version ${APP_VERSION}`}
        data-testid="version-pill"
        data-version={APP_VERSION}
      >
        v{APP_VERSION}
      </button>
      <Modal
        open={open}
        onClose={() => {
          if (!busy) setOpen(false);
        }}
        title="Force refresh"
        testId="force-refresh-modal"
        footer={
          <>
            <Button
              variant="ghost"
              onClick={() => setOpen(false)}
              disabled={busy}
              data-testid="force-refresh-cancel"
            >
              Cancel
            </Button>
            <Button
              variant="danger"
              onClick={() => {
                setBusy(true);
                void forceRefresh();
              }}
              disabled={busy}
              data-testid="force-refresh-confirm"
            >
              <RefreshCw size={16} strokeWidth={2.25} />
              {busy ? 'Refreshing…' : 'Force refresh'}
            </Button>
          </>
        }
      >
        <p className="modal__message">
          Currently running version <strong>v{APP_VERSION}</strong>
          {SHORT_SHA ? <span className="version-pill__sha"> ({SHORT_SHA})</span> : null}.
        </p>
        <p className="modal__message">
          If the app feels stuck on an old version after a deploy, this will
          unregister the service worker, clear every cache, and reload.
          You won't lose any data — everything is stored on the server.
        </p>
      </Modal>
    </>
  );
};

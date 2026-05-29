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
 * Real build versioning (2026-05): all four stamps are inlined at build
 * time via `vite.config.ts` `define:` (ENV-first so CI/Docker inject them
 * as build-args; git fallback for local builds). The chip shows the human
 * semver + the short commit SHA — so it CHANGES every deploy instead of
 * being frozen at "v0.2" — and the modal carries the full provenance
 * (git-describe, full SHA, build date) for ops/debugging.
 *   __APP_VERSION__  — semver from packages/frontend/package.json
 *   __GIT_DESCRIBE__ — `git describe --tags --always --dirty`
 *   __GIT_SHA__      — full commit SHA
 *   __BUILD_TIME__   — ISO build timestamp
 */
declare const __APP_VERSION__: string;
declare const __GIT_SHA__: string;
declare const __GIT_DESCRIBE__: string;
declare const __BUILD_TIME__: string;

const APP_VERSION = __APP_VERSION__;
const GIT_SHA = (__GIT_SHA__ ?? '').trim();
const SHORT_SHA = GIT_SHA.length >= 7 ? GIT_SHA.slice(0, 7) : '';
const GIT_DESCRIBE = (__GIT_DESCRIBE__ ?? '').trim();
const BUILD_TIME = (__BUILD_TIME__ ?? '').trim();

/** Human "May 29, 2026, 14:05 UTC" from the ISO stamp; '' when unparseable. */
const formatBuildTime = (iso: string): string => {
  if (iso === '') return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleString(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  });
};
const BUILD_TIME_LABEL = formatBuildTime(BUILD_TIME);

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
        aria-label={
          `App version ${APP_VERSION}` +
          (SHORT_SHA ? ` build ${SHORT_SHA}` : '') +
          ' — tap for build info'
        }
        title={`v${APP_VERSION}${SHORT_SHA ? ` · ${SHORT_SHA}` : ''}`}
        data-testid="version-pill"
        data-version={APP_VERSION}
        data-sha={SHORT_SHA}
      >
        v{APP_VERSION}
        {SHORT_SHA ? (
          <span className="version-pill__sha"> · {SHORT_SHA}</span>
        ) : null}
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
          Currently running version <strong>v{APP_VERSION}</strong>.
        </p>
        <dl className="version-pill__build" data-testid="version-pill-build">
          {GIT_DESCRIBE ? (
            <>
              <dt>Build</dt>
              <dd>{GIT_DESCRIBE}</dd>
            </>
          ) : null}
          {SHORT_SHA ? (
            <>
              <dt>Commit</dt>
              <dd>{GIT_SHA}</dd>
            </>
          ) : null}
          {BUILD_TIME_LABEL ? (
            <>
              <dt>Built</dt>
              <dd>{BUILD_TIME_LABEL}</dd>
            </>
          ) : null}
        </dl>
        <p className="modal__message">
          If the app feels stuck on an old version after a deploy, this will
          unregister the service worker, clear every cache, and reload.
          You won't lose any data — everything is stored on the server.
        </p>
      </Modal>
    </>
  );
};

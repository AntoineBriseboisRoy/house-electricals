import { Hono } from 'hono';
import type { ApiEnvelope, AppConfig } from '@he/shared';

/**
 * Public runtime-config endpoint. The Node process already honors the `TZ`
 * env var for its own `Date` math; this surfaces the configured zone to the
 * SPA so the whole app can DISPLAY dates in one timezone regardless of the
 * viewing device. An empty/unset `TZ` reports `null` — the frontend then
 * falls back to each device's local timezone (the historical behavior).
 *
 * Mounted PUBLIC (before the JWT gate) — the timezone is not sensitive and
 * the SPA needs it to render dates on every screen. NOT folded into
 * /api/v1/health, whose `{ data: { ok: true } }` shape is pinned (see
 * CLAUDE.md auth-gate rule #14).
 */
export const configRoutes = new Hono();

configRoutes.get('/config', (c) => {
  const raw = process.env.TZ?.trim();
  const tz = raw && raw.length > 0 ? raw : null;
  const body: ApiEnvelope<AppConfig> = { data: { tz } };
  return c.json(body, 200);
});

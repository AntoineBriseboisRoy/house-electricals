import { Hono } from 'hono';
import type { ApiEnvelope } from '@he/shared';

export const healthRoutes = new Hono();

healthRoutes.get('/health', (c) => {
  const body: ApiEnvelope<{ ok: true }> = { data: { ok: true } };
  return c.json(body, 200);
});

#!/usr/bin/env node
// Ensure the local-dev data dirs exist before `pnpm dev` boots the backend.
// Relational data now lives in Postgres, but the backend still writes
// floor-plans/*.png (and the auto-generated .auth-secret) under ./data; the
// directory must exist or the first write fails.
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';

const root = process.cwd();
const dataDir = join(root, 'data');
const floorDir = join(dataDir, 'floor-plans');

mkdirSync(floorDir, { recursive: true });
console.log(`[predev] ensured ${dataDir} + floor-plans/`);

/**
 * Demo-only global shims. The real backend + its browserified deps
 * (crypto-browserify, memfs) assume Node globals: `process`, `Buffer`, and
 * `global`. Browsers have none of these, so install them here.
 *
 * This module MUST be the FIRST import in `main.demo.tsx`: ES-module imports
 * are evaluated in source order, so importing this first guarantees the
 * globals exist before any backend module (or browserified dep) evaluates.
 */
import { Buffer } from 'buffer';

const g = globalThis as unknown as {
  process?: { env: Record<string, string | undefined> };
  Buffer?: typeof Buffer;
  global?: typeof globalThis;
};

if (g.global === undefined) g.global = globalThis;
if (g.Buffer === undefined) g.Buffer = Buffer;
if (g.process === undefined) g.process = { env: { NODE_ENV: 'production' } };

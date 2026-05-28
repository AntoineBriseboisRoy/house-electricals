/**
 * Playwright globalTeardown (G21 cycle-21).
 *
 * Reads `e2e/.state.json` written by globalSetup.ts, kills the backend
 * process tree (Windows uses taskkill /T /F; POSIX uses process.kill on
 * the negative pid for the detached process group), removes the tmpdir,
 * and unlinks the state file.
 */

import { spawn } from 'node:child_process';
import { existsSync, readFileSync, rmSync, unlinkSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const STATE_FILE = join(__dirname, '.state.json');

type State = {
  tmpdir: string;
  pid: number;
  port: number;
};

export default async function globalTeardown(): Promise<void> {
  if (!existsSync(STATE_FILE)) {
    console.warn('[e2e globalTeardown] no .state.json — nothing to clean up');
    return;
  }

  const state = JSON.parse(readFileSync(STATE_FILE, 'utf8')) as State;
  console.log(
    `[e2e globalTeardown] killing backend pid=${state.pid} and removing tmpdir=${state.tmpdir}`
  );

  // Kill the backend process tree.
  try {
    if (process.platform === 'win32') {
      // taskkill /T = kill tree, /F = force.
      await new Promise<void>((resolve) => {
        const kill = spawn('taskkill.exe', ['/PID', String(state.pid), '/T', '/F'], {
          windowsHide: true,
          stdio: 'ignore',
        });
        kill.on('exit', () => resolve());
      });
    } else {
      // Negative pid kills the detached process group.
      try {
        process.kill(-state.pid, 'SIGTERM');
      } catch {
        // Fallback to single-pid kill if the group is gone.
        try {
          process.kill(state.pid, 'SIGTERM');
        } catch {
          // ignore
        }
      }
    }
  } catch (err) {
    console.error('[e2e globalTeardown] kill failed:', err);
  }

  // Best-effort rm tmpdir.
  try {
    rmSync(state.tmpdir, { recursive: true, force: true });
  } catch (err) {
    console.error(`[e2e globalTeardown] rm tmpdir failed: ${(err as Error).message}`);
  }

  // Unlink state file.
  try {
    unlinkSync(STATE_FILE);
  } catch {
    // ignore
  }

  console.log('[e2e globalTeardown] done');
}

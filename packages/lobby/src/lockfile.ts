import {
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  unlinkSync,
  writeSync,
} from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { logger } from './logger.js';

export const LOCK_FILE =
  process.env.AAA_LOBBY_LOCK ??
  resolve(homedir(), '.local', 'share', 'agent-ask-anywhere', 'lobby.lock');

export type LockData = {
  pid: number;
  port: number;
  startedAt: string;
};

export class LockFileBusyError extends Error {
  constructor(
    message: string,
    public existing: LockData,
  ) {
    super(message);
    this.name = 'LockFileBusyError';
  }
}

function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    // EPERM means the process exists but we can't signal it (it's alive)
    return code === 'EPERM';
  }
}

function readLock(path: string): LockData | null {
  try {
    const raw = readFileSync(path, 'utf8');
    const parsed = JSON.parse(raw);
    if (
      parsed &&
      typeof parsed.pid === 'number' &&
      typeof parsed.port === 'number' &&
      typeof parsed.startedAt === 'string'
    ) {
      return parsed as LockData;
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Acquire an exclusive lock file. Throws LockFileBusyError if a live owner is
 * detected. Stale lock files (orphaned PID) are removed and re-attempted.
 */
export function acquireLock(port: number, path: string = LOCK_FILE): () => void {
  mkdirSync(dirname(path), { recursive: true });

  if (existsSync(path)) {
    const existing = readLock(path);
    if (existing && isProcessAlive(existing.pid) && existing.pid !== process.pid) {
      throw new LockFileBusyError(
        `lobby already running (pid=${existing.pid}, port=${existing.port})`,
        existing,
      );
    }
    // stale lock file, remove
    try {
      unlinkSync(path);
      logger.info({ path }, 'removed stale lock file');
    } catch (err) {
      logger.warn({ err: String(err), path }, 'failed to remove stale lock');
    }
  }

  let fd: number;
  try {
    // O_EXCL | O_CREAT — fails if file exists. Race-safe with another spawning lobby.
    fd = openSync(path, 'wx');
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === 'EEXIST') {
      const existing = readLock(path);
      if (existing) {
        throw new LockFileBusyError(
          `lobby spawn race lost (pid=${existing.pid}, port=${existing.port})`,
          existing,
        );
      }
    }
    throw err;
  }

  const data: LockData = {
    pid: process.pid,
    port,
    startedAt: new Date().toISOString(),
  };
  writeSync(fd, JSON.stringify(data, null, 2));
  closeSync(fd);

  let released = false;
  const release = (): void => {
    if (released) return;
    released = true;
    try {
      const current = readLock(path);
      if (current?.pid === process.pid) {
        unlinkSync(path);
      }
    } catch {
      // ignore
    }
  };

  process.on('exit', release);
  process.on('SIGINT', () => {
    release();
    process.exit(0);
  });
  process.on('SIGTERM', () => {
    release();
    process.exit(0);
  });

  return release;
}

export { join };

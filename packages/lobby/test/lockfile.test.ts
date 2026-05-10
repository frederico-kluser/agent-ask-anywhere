import './setup-tmpdir.js';
import { strict as assert } from 'node:assert';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import { LockFileBusyError, acquireLock } from '../src/lockfile.js';

const TEST_ROOT = process.env.AAA_SKILLS_ROOT!;

describe('lockfile', () => {
  it('writes a parsable lock with this process pid + port', () => {
    const lockPath = join(TEST_ROOT, 'test-lock-1');
    const release = acquireLock(7891, lockPath);
    try {
      assert.equal(existsSync(lockPath), true);
      const data = JSON.parse(readFileSync(lockPath, 'utf8'));
      assert.equal(data.pid, process.pid);
      assert.equal(data.port, 7891);
      assert.match(String(data.startedAt), /^\d{4}-\d{2}-\d{2}T/);
    } finally {
      release();
    }
  });

  it('release() removes the lock file', () => {
    const lockPath = join(TEST_ROOT, 'test-lock-2');
    const release = acquireLock(7892, lockPath);
    assert.equal(existsSync(lockPath), true);
    release();
    assert.equal(existsSync(lockPath), false);
  });

  it('removes a stale lock with a non-existent pid', () => {
    const lockPath = join(TEST_ROOT, 'test-lock-3');
    // Pid 999999 is almost certainly not alive.
    writeFileSync(
      lockPath,
      JSON.stringify({ pid: 999_999, port: 9999, startedAt: new Date().toISOString() }),
    );
    const release = acquireLock(7893, lockPath);
    try {
      const data = JSON.parse(readFileSync(lockPath, 'utf8'));
      assert.equal(data.pid, process.pid);
    } finally {
      release();
    }
  });

  it('throws LockFileBusyError when an alive owner exists', () => {
    const lockPath = join(TEST_ROOT, 'test-lock-4');
    // Use the current process pid as a "live" owner.
    writeFileSync(
      lockPath,
      JSON.stringify({
        pid: process.pid + 1_000_000,
        port: 7894,
        startedAt: new Date().toISOString(),
      }),
    );
    // Replace with own pid so it's truly alive but not us.
    // Actually: process.kill(process.pid, 0) returns true. So if existing.pid !== process.pid
    // and is alive we should throw. Use process.pid directly with a "different" check by
    // injecting a modifiable owner.
    writeFileSync(
      lockPath,
      JSON.stringify({ pid: process.pid, port: 7894, startedAt: new Date().toISOString() }),
    );
    // Here existing.pid === process.pid → the function treats it as "stale" and removes.
    // To test the busy path we need a different alive pid; the parent pid usually qualifies.
    writeFileSync(
      lockPath,
      JSON.stringify({ pid: process.ppid, port: 7894, startedAt: new Date().toISOString() }),
    );
    assert.throws(
      () => acquireLock(7894, lockPath),
      (err: unknown) => err instanceof LockFileBusyError,
    );
  });
});

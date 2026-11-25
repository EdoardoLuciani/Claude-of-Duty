import { randomUUID } from 'node:crypto';
import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

import { isRecord } from '../../src/core/guards.ts';

/** Write through a temporary file so readers never see partial data. */
export function writeAtomic(file: string, data: string | Uint8Array): void {
  mkdirSync(dirname(file), { recursive: true });
  const tmp = `${file}.tmp-${process.pid}`;
  writeFileSync(tmp, data);
  renameSync(tmp, file);
}

const sleep = (ms: number): Promise<void> =>
  new Promise((done): void => {
    setTimeout(done, ms);
  });

/** Only ESRCH proves the PID is gone; EPERM denotes an inaccessible live process. */
function pidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return !isRecord(error) || error.code !== 'ESRCH';
  }
}

interface LockOptions {
  label: string;
  graceMs?: number;
  timeoutMs: number;
  pollMs: number;
}

/** mkdir claims the lock atomically. Allow time to publish owner.json; release only our token. */
export async function withLock(
  lockDir: string,
  { label, graceMs = 10000, timeoutMs, pollMs }: LockOptions,
  fn: () => Promise<void>
): Promise<void> {
  const ownerFile = join(lockDir, 'owner.json');
  const token = `${process.pid}-${randomUUID()}`;
  const started = Date.now();
  mkdirSync(dirname(lockDir), { recursive: true });
  for (;;) {
    try {
      mkdirSync(lockDir);
      writeFileSync(ownerFile, JSON.stringify({ pid: process.pid, token, createdAt: Date.now() }));
      break;
    } catch (error) {
      if (!isRecord(error) || error.code !== 'EEXIST') throw error;
      let owner: unknown = null;
      try {
        owner = JSON.parse(readFileSync(ownerFile, 'utf8'));
      } catch {
        // Missing or partially written owner.json.
      }
      const waitingMs = Date.now() - started;
      const pid =
        isRecord(owner) &&
        typeof owner.pid === 'number' &&
        Number.isSafeInteger(owner.pid) &&
        owner.pid > 0
          ? owner.pid
          : null;
      if (pid === null ? waitingMs > graceMs : !pidAlive(pid)) {
        rmSync(lockDir, { recursive: true, force: true });
        continue;
      }
      if (waitingMs > timeoutMs) {
        throw new Error(
          `[${label}] exporter lock held for >${timeoutMs / 1000}s by pid ${pid ?? '<unknown>'} — remove ${lockDir}`,
          { cause: error }
        );
      }
      await sleep(pollMs);
    }
  }
  try {
    return await fn();
  } finally {
    try {
      const owner: unknown = JSON.parse(readFileSync(ownerFile, 'utf8'));
      if (isRecord(owner) && owner.token === token)
        rmSync(lockDir, { recursive: true, force: true });
    } catch {
      /* lock already gone or replaced */
    }
  }
}

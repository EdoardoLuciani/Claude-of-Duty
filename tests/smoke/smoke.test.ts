import { test } from 'bun:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { promisify } from 'node:util';

const run = promisify(execFile);
const dir = import.meta.dirname;
const files = readdirSync(dir)
  .filter((file): boolean => file.startsWith('smoke-') && file.endsWith('.ts'))
  .sort();
// Hang guard only (wall clock under parallel load); physical simulation limits stay intact.
const TIMEOUT_MS = 30000;

for (const file of files) {
  test.concurrent(
    file,
    async (): Promise<void> => {
      try {
        await run(process.execPath, ['test', '--timeout', String(TIMEOUT_MS), join(dir, file)], {
          timeout: TIMEOUT_MS,
        });
      } catch (error) {
        if (
          !(error instanceof Error) ||
          !('killed' in error && 'code' in error && 'stdout' in error && 'stderr' in error)
        )
          throw error;
        const reason = error.killed
          ? `timed out after ${TIMEOUT_MS} ms`
          : `exited with ${String(error.code)}`;
        assert.fail(`${file} ${reason}\n${String(error.stdout)}${String(error.stderr)}`);
      }
    },
    TIMEOUT_MS + 1000
  );
}

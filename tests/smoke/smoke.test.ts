import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { readdirSync } from 'node:fs';
import { availableParallelism } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { promisify } from 'node:util';

const run = promisify(execFile);
const dir = import.meta.dirname;
const files = readdirSync(dir)
  .filter((file): boolean => file.startsWith('smoke-') && file.endsWith('.ts'))
  .sort();
// Hang guard only (wall clock under parallel load); physical simulation limits stay intact.
const TIMEOUT_MS = 30000;

// Each smoke script is an independent process; run about one per physical core.
await test('smoke', { concurrency: Math.ceil(availableParallelism() / 2) }, async (t): Promise<void> => {
  const children: Promise<void>[] = [];
  for (const file of files) {
    children.push(t.test(file, async (): Promise<void> => {
      try {
        await run(process.execPath, [join(dir, file)], { timeout: TIMEOUT_MS });
      } catch (error) {
        assert(error instanceof Error);
        assert('killed' in error && 'code' in error && 'stdout' in error && 'stderr' in error);
        const reason = error.killed
          ? `timed out after ${TIMEOUT_MS} ms`
          : `exited with ${String(error.code)}`;
        assert.fail(`${file} ${reason}\n${String(error.stdout)}${String(error.stderr)}`);
      }
    }));
  }
  await Promise.all(children);
});

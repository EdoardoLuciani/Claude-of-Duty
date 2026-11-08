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
  .filter((file) => file.startsWith('smoke-') && file.endsWith('.ts'))
  .sort();
// Hang guard only (wall clock under parallel load); physical simulation limits stay intact.
const TIMEOUT_MS = 30000;

// Each smoke script is an independent process; run about one per physical core.
test('smoke', { concurrency: Math.ceil(availableParallelism() / 2) }, (t) => {
  for (const file of files) {
    t.test(file, async () => {
      try {
        await run(process.execPath, [join(dir, file)], { timeout: TIMEOUT_MS });
      } catch (error) {
        const reason = error.killed
          ? `timed out after ${TIMEOUT_MS} ms`
          : `exited with ${error.code}`;
        assert.fail(`${file} ${reason}\n${error.stdout}${error.stderr}`);
      }
    });
  }
});

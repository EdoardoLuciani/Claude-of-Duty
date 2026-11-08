import { spawnSync } from 'node:child_process';
import { availableParallelism } from 'node:os';

// Keep process-isolated smoke scripts near one per physical core.
const { status, error } = spawnSync(
  process.execPath,
  [
    'test',
    '--max-concurrency',
    String(Math.ceil(availableParallelism() / 2)),
    './tests/smoke/smoke.test.ts',
    './tests/lib',
    ...process.argv.slice(2),
  ],
  { stdio: 'inherit' }
);
if (error) throw error;
process.exit(status ?? 1);

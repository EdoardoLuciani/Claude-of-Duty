import { spawnSync } from 'node:child_process';
import { readdirSync } from 'node:fs';
import { join } from 'node:path';

import { expect, test } from 'vitest';

const dir = import.meta.dirname;
for (const file of readdirSync(dir).sort()) {
  if (!file.startsWith('smoke-') || !file.endsWith('.mjs')) continue;
  // Longer wall-clock allowance only; physical simulation limits stay intact.
  const longSweep = file === 'smoke-ai-ladder-live.mjs';
  const integrationSweep = file === 'smoke-ai-ladder.mjs';
  test(
    file,
    () => {
      const r = spawnSync(process.execPath, [join(dir, file)], {
        encoding: 'utf8',
        timeout: longSweep ? 60000 : integrationSweep ? 30000 : undefined,
      });
      expect(r.status, r.stdout + r.stderr).toBe(0);
    },
    longSweep ? 65000 : integrationSweep ? 35000 : 5000
  );
}

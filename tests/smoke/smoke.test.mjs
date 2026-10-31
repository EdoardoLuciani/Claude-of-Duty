import { spawnSync } from 'node:child_process';
import { readdirSync } from 'node:fs';
import { join } from 'node:path';

import { expect, test } from 'vitest';

const dir = import.meta.dirname;
for (const file of readdirSync(dir).sort()) {
  if (!file.startsWith('smoke-') || !file.endsWith('.mjs')) continue;
  // Longer wall-clock allowance only; physical simulation limits stay intact.
  const longSweep = [
    'smoke-ax338-contact.mjs',
    'smoke-ai-ladder-live.mjs',
    'smoke-evolys-skin.mjs',
  ].includes(file);
  const longSweepTimeout = file === 'smoke-evolys-skin.mjs' ? 120000 : 60000;
  const integrationSweep = ['smoke-ai-ladder.mjs', 'smoke-audio-reloads.mjs'].includes(file);
  const geometrySweep = [
    'smoke-ai-access.mjs',
    'smoke-cable-support.mjs',
    'smoke-floating-props.mjs',
    'smoke-export-cache.mjs',
    'smoke-evolys-clearance.mjs',
    'smoke-m4.mjs',
    'smoke-m4-skin.mjs',
    'smoke-mpx-skin.mjs',
  ].includes(file);
  test(
    file,
    () => {
      const r = spawnSync(process.execPath, [join(dir, file)], {
        encoding: 'utf8',
        timeout: longSweep
          ? longSweepTimeout
          : integrationSweep
            ? 30000
            : geometrySweep
              ? 18000
              : undefined,
      });
      expect(r.status, r.stdout + r.stderr).toBe(0);
    },
    longSweep
      ? longSweepTimeout + 5000
      : integrationSweep
        ? 35000
        : geometrySweep ||
            file === 'smoke-collision-fidelity.mjs' ||
            file === 'smoke-fx-tracer-world.mjs'
          ? 20000
          : 5000
  );
}

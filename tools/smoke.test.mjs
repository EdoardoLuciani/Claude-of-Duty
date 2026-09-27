import { spawnSync } from 'node:child_process';
import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test } from 'vitest';

const dir = import.meta.dirname;
for (const file of readdirSync(dir).sort()) {
  if (!file.startsWith('smoke-') || !file.endsWith('.mjs')) continue;
  // Longer wall-clock allowance only; physical simulation limits stay intact.
  const geometrySweep = ['smoke-ai-access.mjs', 'smoke-floating-props.mjs', 'smoke-export-cache.mjs'].includes(file);
  test(file, () => {
    const r = spawnSync(process.execPath, [join(dir, file)], {
      encoding: 'utf8',
      timeout: geometrySweep ? 18000 : undefined,
    });
    expect(r.status, r.stdout + r.stderr).toBe(0);
  }, (geometrySweep || file === 'smoke-collision-fidelity.mjs' || file === 'smoke-fx-tracer-world.mjs') ? 20000 : 5000);
}

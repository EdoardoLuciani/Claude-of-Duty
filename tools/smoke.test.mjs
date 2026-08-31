import { spawnSync } from 'node:child_process';
import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test } from 'vitest';

const dir = import.meta.dirname;
for (const file of readdirSync(dir).sort()) {
  if (!file.startsWith('smoke-') || !file.endsWith('.mjs')) continue;
  test(file, () => {
    const r = spawnSync(process.execPath, [join(dir, file)], {
      encoding: 'utf8',
      timeout: file === 'smoke-floating-props.mjs' ? 75000 : file === 'smoke-map-overlaps.mjs' ? 30000 : undefined,
    });
    expect(r.status, r.stdout + r.stderr).toBe(0);
  }, file === 'smoke-floating-props.mjs' ? 80000
    : (file === 'smoke-collision-fidelity.mjs' || file === 'smoke-fx-tracer-world.mjs' || file === 'smoke-map-overlaps.mjs') ? 35000 : 5000);
}

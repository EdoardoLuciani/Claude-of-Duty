import { spawnSync } from 'node:child_process';
import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test } from 'vitest';

const dir = import.meta.dirname;
for (const file of readdirSync(dir).sort()) {
  if (!file.startsWith('smoke-') || !file.endsWith('.mjs')) continue;
  test(file, () => {
    const r = spawnSync(process.execPath, [join(dir, file)], { encoding: 'utf8' });
    expect(r.status, r.stdout + r.stderr).toBe(0);
  });
}

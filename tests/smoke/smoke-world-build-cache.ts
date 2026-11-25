import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { PLAYABLE_MAPS, SESSION_MODE_POLICY } from '../../src/core/playable-maps.ts';
import { BUN } from '../../tools/lib/browser-harness.ts';

const root = fileURLToPath(new URL('../../', import.meta.url));
const directory = join(root, 'public/models/world');
const files = PLAYABLE_MAPS.flatMap(({ bundleDirectory, mode }): string[] => {
  const bundle = join(directory, bundleDirectory);
  const names = readdirSync(bundle).filter(
    (name): boolean => name === 'level.json' || /^level-(visual|collision|nav|minimap)\./.test(name)
  );
  assert.equal(
    names.length,
    SESSION_MODE_POLICY[mode].survivalSystems ? 5 : 4,
    `${bundle} has a complete generated bundle`
  );
  return names.map((name): string => join(bundle, name));
});
const mtimes = files.map((name): number => statSync(name).mtimeMs);
const output = execFileSync(BUN, ['tools/export-world.ts', `--out=${directory}`], {
  cwd: root,
  encoding: 'utf8',
  timeout: 20000,
});
for (const { label } of PLAYABLE_MAPS) assert(output.includes(`[world] up to date: ${label}`));
assert.equal(Array.from(output.matchAll(/\[validate-world\] ok/g)).length, PLAYABLE_MAPS.length);
assert.deepEqual(
  files.map((name): number => statSync(name).mtimeMs),
  mtimes,
  'unchanged world inputs reuse the existing files without rewriting them'
);
console.log('world build: all playable bundles are validated and reused');

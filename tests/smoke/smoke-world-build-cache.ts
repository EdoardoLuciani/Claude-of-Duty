import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../../', import.meta.url));
const directory = join(root, 'public/models/world');
const files = readdirSync(directory).filter(
  (name): boolean => name === 'level.json' || /^level-(visual|collision|nav)\..*\.gz$/.test(name)
);
assert.equal(files.length, 4, 'test setup generates one complete world bundle');
const mtimes = files.map((name): number => statSync(join(directory, name)).mtimeMs);
const output = execFileSync(process.execPath, ['tools/export-world.mjs', `--out=${directory}`], {
  cwd: root,
  encoding: 'utf8',
  timeout: 20000,
});
assert.match(output, /\[world\] up to date/);
assert.match(output, /\[world:validate\] ok/);
assert.deepEqual(
  files.map((name): number => statSync(join(directory, name)).mtimeMs),
  mtimes,
  'unchanged world inputs reuse the existing files without rewriting them'
);
console.log('world build: complete generated bundle is validated and reused');

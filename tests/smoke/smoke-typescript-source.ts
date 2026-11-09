import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';

const root = resolve(import.meta.dirname, '../..');
function filesUnder(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry): string[] => {
    const path = join(directory, entry.name);
    return entry.isDirectory() ? filesUnder(path) : [path];
  });
}
const sources = ['src', 'tools', 'build', 'tests'].flatMap((directory): string[] =>
  filesUnder(join(root, directory))
);
assert.deepEqual(
  sources.filter((path): boolean => /\.m?js$/.test(path)),
  [],
  'first-party modules must be checked TypeScript, not unchecked JS/MJS'
);

// Typecheck only proves the files it sees; every runtime/tool module must be in the program.
const program = spawnSync(process.execPath, ['check', '--listFilesOnly', '--no-pretty'], {
  cwd: root,
  encoding: 'utf8',
  timeout: 10000,
  maxBuffer: 4 * 1024 * 1024,
});
assert.equal(program.error, undefined);
assert.equal(program.status, 0, program.stdout + program.stderr);
const checked = new Set(
  program.stdout
    .trim()
    .split(/\r?\n/)
    .map((path): string => resolve(root, path))
);
for (const path of sources) {
  if (/\/(src|tools)\//.test(path) && path.endsWith('.ts')) {
    assert(checked.has(path), `${path} must belong to the strict root compiler program`);
  }
}
console.log('TypeScript source: no unchecked modules and full compiler coverage');

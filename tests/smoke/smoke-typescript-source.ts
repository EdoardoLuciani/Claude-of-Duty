import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { isRecord } from '../../src/core/guards.ts';

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
const pkg: unknown = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
assert(isRecord(pkg) && isRecord(pkg.imports));
assert.equal(pkg.imports['#worldgen/*'], './tools/worldgen/*.ts');
assert.equal(pkg.imports['#query-snapshot'], './src/physics/query-snapshot.ts');

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

const directory = mkdtempSync(join(tmpdir(), 'cod-typescript-source-'));
try {
  writeFileSync(
    join(directory, 'tsconfig.json'),
    JSON.stringify({
      extends: join(root, 'tsconfig.json'),
      compilerOptions: { typeRoots: [join(root, 'node_modules/@types')] },
      include: [join(root, 'src'), join(root, 'tools/**/*.ts'), 'fixture.ts'],
    })
  );
  const fixture = `
import type { Placement } from ${JSON.stringify(join(root, 'tools/worldgen/placement.ts'))};
import type { BuildingSpec } from ${JSON.stringify(join(root, 'tools/worldgen/buildings.ts'))};
import { packedReadback } from ${JSON.stringify(join(root, 'tools/lib/native-readback.ts'))};
const placement: Placement = {
  id: 'test', prototype: 'crate_a', position: [1, 2, 3],
  rotationDeg: [0, 0, 0], scale: [1, 1, 1], masks: [1, 1, 1],
};
const building: BuildingSpec = { id: 'test', x: 0, z: 0, w: 4, d: 4 };
const pixels = packedReadback(new Uint16Array(4), 1, 1);
type IsAny<T> = 0 extends (1 & T) ? true : false;
const pixelsAreAny: IsAny<typeof pixels> = false;
const typedPixels: Uint16Array = pixels;
`;
  const check = (source: string): ReturnType<typeof spawnSync> => {
    writeFileSync(join(directory, 'fixture.ts'), source);
    return spawnSync(process.execPath, ['check', '-p', directory, '--no-pretty'], {
      cwd: root,
      encoding: 'utf8',
      timeout: 10000,
    });
  };
  const valid = check(fixture);
  assert.equal(valid.error, undefined);
  assert.equal(valid.status, 0, String(valid.stdout) + String(valid.stderr));
} finally {
  rmSync(directory, { recursive: true, force: true });
}
console.log(
  'TypeScript source: full compiler coverage, direct aliases and checked authoring contracts'
);

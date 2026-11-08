import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { GLTFPACK_FLAGS, MODEL_COOKS } from '../../build/models.ts';
import { BUN } from '../../tools/lib/browser-harness.ts';

const root = fileURLToPath(new URL('../../', import.meta.url));
const directory = mkdtempSync(join(tmpdir(), 'cod-bun-tools-'));
try {
  const encoder = join(directory, 'gltfpack.mjs');
  const log = join(directory, 'args.json');
  const input = join(directory, MODEL_COOKS.p320.source);
  const output = join(directory, 'p320-compact.runtime.glb');
  const bytes = Buffer.from('native authoring fixture');
  writeFileSync(input, bytes);
  // Exercise the real Bun CLI and native subprocess contract without requiring
  // Blender or gltfpack. The fake encoder intentionally stays an external process.
  writeFileSync(
    encoder,
    `#!${process.execPath}
import { copyFileSync, writeFileSync } from 'node:fs';
const args = process.argv.slice(2);
if (args[0] === '-v') {
  console.log(process.env.FAKE_VERSION ?? 'gltfpack 1.3');
} else {
  writeFileSync(${JSON.stringify(log)}, JSON.stringify(args));
  if (process.env.FAKE_FAIL) process.exit(7);
  copyFileSync(args[1], args[3]);
}
`,
    { mode: 0o755 }
  );
  const env = { ...process.env, GLTFPACK: encoder };
  const args = ['build/models.ts', 'p320', directory];
  const cooked = spawnSync(BUN, args, { cwd: root, env, encoding: 'utf8' });
  assert.equal(cooked.status, 0, cooked.stdout + cooked.stderr);
  assert.match(cooked.stdout, /Cooked/);
  assert.deepEqual(readFileSync(input), bytes, 'cooking never overwrites the source');
  assert.deepEqual(readFileSync(output), bytes, 'Bun CLI publishes the native cook');
  const logged: unknown = JSON.parse(readFileSync(log, 'utf8'));
  assert(Array.isArray(logged));
  const flags: unknown[] = logged;
  assert.equal(flags[0], '-i');
  assert.equal(flags[1], input);
  assert.equal(flags[2], '-o');
  const scratchOutput = flags[3];
  assert(typeof scratchOutput === 'string');
  assert.deepEqual(flags.slice(4), [...GLTFPACK_FLAGS, ...MODEL_COOKS.p320.flags]);
  assert(!existsSync(dirname(scratchOutput)), 'successful cook removes its scratch directory');

  const failed = spawnSync(BUN, args, {
    cwd: root,
    env: { ...env, FAKE_FAIL: '1' },
    encoding: 'utf8',
  });
  assert.notEqual(failed.status, 0, 'native failure reaches the Bun CLI exit status');
  assert.deepEqual(readFileSync(output), bytes, 'failure preserves the previous runtime model');
  const failureLog: unknown = JSON.parse(readFileSync(log, 'utf8'));
  assert(Array.isArray(failureLog));
  const failureArgs: unknown[] = failureLog;
  const failedScratch = failureArgs[3];
  assert(typeof failedScratch === 'string');
  assert(!existsSync(dirname(failedScratch)), 'failed cook also removes its scratch directory');

  const wrongVersion = spawnSync(BUN, args, {
    cwd: root,
    env: { ...env, FAKE_VERSION: 'gltfpack unsupported' },
    encoding: 'utf8',
  });
  assert.notEqual(wrongVersion.status, 0);
  assert.match(wrongVersion.stderr, /pinned native gltfpack/);
  const unknown = spawnSync(BUN, ['build/models.ts', 'not-a-model'], {
    cwd: root,
    env,
    encoding: 'utf8',
  });
  assert.notEqual(unknown.status, 0);
  assert.match(unknown.stderr, /unknown model/);
  const invalid = spawnSync(BUN, ['build/bun.ts', 'not-a-command'], {
    cwd: root,
    encoding: 'utf8',
  });
  assert.equal(invalid.status, 2);
  assert.match(invalid.stderr, /usage: bun build\/bun\.ts/);
} finally {
  rmSync(directory, { recursive: true, force: true });
}
console.log('Bun tools: CLI dispatch, native cook flags, publication, failures and cleanup');

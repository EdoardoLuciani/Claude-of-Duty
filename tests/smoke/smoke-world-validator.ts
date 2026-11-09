import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import type { SpawnSyncReturns } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { gzipSync } from 'node:zlib';

import { isRecord } from '../../src/core/guards.ts';

const root = resolve(import.meta.dirname, '../..');
const world = join(root, 'public/models/world');
const baseline: unknown = JSON.parse(readFileSync(join(world, 'level.json'), 'utf8'));
assert(isRecord(baseline) && isRecord(baseline.assets));
const assets = baseline.assets;
const directory = mkdtempSync(join(tmpdir(), 'cod-world-validator-'));
try {
  for (const kind of ['visual', 'collision', 'nav']) {
    const name = assets[kind];
    assert(typeof name === 'string');
    symlinkSync(join(world, name), join(directory, name));
  }
  const run = (manifest: unknown): SpawnSyncReturns<string> => {
    const path = join(directory, 'level.json');
    writeFileSync(path, JSON.stringify(manifest));
    const result = spawnSync(
      process.execPath,
      [join(root, 'tools/validate-world-assets.ts'), `--manifest=${path}`],
      { cwd: root, encoding: 'utf8', timeout: 10000 }
    );
    assert.equal(result.error, undefined);
    return result;
  };
  const good = run(baseline);
  assert.equal(good.status, 0, good.stdout + good.stderr);
  assert.match(good.stdout, /\[world:validate\] ok/);

  const broken = run({
    ...baseline,
    transform: [1, 2],
    bounds: { min: [2, 0, 0], max: [1, 1, 1] },
    spawns: [
      { id: 'duplicate', position: [0, 0], forward: [0, 0, 1], yaw: 'invalid' },
      { id: 'duplicate', position: [0, 0, 0], forward: [0, 0, 1], yaw: 0 },
    ],
  });
  assert.equal(broken.status, 1);
  for (const message of [
    'manifest.transform must be an array of length 16',
    'manifest bounds are inverted on axis 0',
    'manifest.spawns[0].position must be an array of length 3',
    'manifest.spawns[0].yaw must be finite',
    'duplicate spawn id/tag "duplicate"',
  ])
    assert(broken.stderr.includes(message), message);

  for (const input of [null, []]) {
    const invalidRoot = run(input);
    assert.equal(invalidRoot.status, 1);
    assert.match(invalidRoot.stderr, /expected a manifest object/);
  }

  const withVisual = (json: unknown): SpawnSyncReturns<string> => {
    const text = Buffer.from(JSON.stringify(json));
    const padded = Buffer.alloc(Math.ceil(text.length / 4) * 4, 0x20);
    text.copy(padded);
    const glb = Buffer.alloc(20 + padded.length);
    glb.write('glTF', 0, 'ascii');
    glb.writeUInt32LE(2, 4);
    glb.writeUInt32LE(glb.length, 8);
    glb.writeUInt32LE(padded.length, 12);
    glb.writeUInt32LE(0x4e4f534a, 16);
    padded.copy(glb, 20);
    const compressed = gzipSync(glb);
    const hash = createHash('sha256').update(compressed).digest('hex').slice(0, 12);
    const name = `invalid-visual.${hash}.glb.gz`;
    writeFileSync(join(directory, name), compressed);
    return run({ ...baseline, assets: { ...assets, visual: name } });
  };
  const invalidGlbRoot = withVisual(null);
  assert.equal(invalidGlbRoot.status, 1);
  assert.match(invalidGlbRoot.stderr, /expected a glTF object/);

  const invalidGeometry = withVisual({
    nodes: [
      {
        mesh: 0,
        extras: { palette: 'missing', collision: false, owLodDist: -1 },
        extensions: { EXT_mesh_gpu_instancing: { attributes: { TRANSLATION: 0, SCALE: 1 } } },
      },
    ],
    meshes: [{ primitives: [{ indices: 2 }] }],
    accessors: [{ count: 2 }, { count: 3 }, { count: 5 }],
  });
  assert.equal(invalidGeometry.status, 1);
  assert.match(invalidGeometry.stderr, /unknown or missing palette/);
  assert.match(invalidGeometry.stderr, /invalid owLodDist/);
  assert.match(invalidGeometry.stderr, /not divisible by three/);
  assert.match(invalidGeometry.stderr, /inconsistent GPU instance accessor counts/);

  const invalidRecords = withVisual({
    nodes: [null, { mesh: 0 }],
    meshes: [{ primitives: [null] }],
  });
  assert.equal(invalidRecords.status, 1);
  assert.match(invalidRecords.stderr, /invalid glTF node 0/);
  assert.match(invalidRecords.stderr, /primitive 0 is invalid/);
  assert.doesNotMatch(invalidRecords.stderr, /TypeError/);
} finally {
  rmSync(directory, { recursive: true, force: true });
}
console.log(
  'world validator: valid products, aggregated diagnostics and malformed JSON/GLB rejection'
);

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync, mkdirSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { GLTFExporter } from 'three/examples/jsm/exporters/GLTFExporter.js';

import { VARIANTS, MATERIAL_SLOTS } from '../../src/ai/soldier.ts';
import { BUN } from '../../tools/lib/browser-harness.ts';

const fileReader = globalThis.FileReader;
const cook: typeof import('../../tools/blender/soldiers/cook.ts') =
  await import('../../tools/blender/soldiers/cook.ts');
const { exportSoldiers, loadCommittedSoldiers, soldierInputHash, soldierInputPaths } =
  await import('../../tools/blender/soldiers/export.ts');
assert.equal(globalThis.FileReader, fileReader, 'reader imports do not install an encoder adapter');
const directory = mkdtempSync(join(tmpdir(), 'cod-bun-authoring-'));
try {
  const vertices = MATERIAL_SLOTS.length * 3;
  const mesh = {
    position: MATERIAL_SLOTS.flatMap((_, i): number[] => [i, 0, 0, i, 0, 0.5, i + 0.5, 0, 0]),
    normal: Array.from({ length: vertices * 3 }, (_, i): number => (i % 3 === 1 ? 1 : 0)),
    uv: Array<number>(vertices * 2).fill(0),
    color: Array<number>(vertices * 3).fill(0.5),
    skinIndex: Array<number>(vertices * 4).fill(0),
    skinWeight: Array.from({ length: vertices * 4 }, (_, i): number => (i % 4 === 0 ? 1 : 0)),
    index: Array.from({ length: vertices }, (_, i): number => i),
    groups: MATERIAL_SLOTS.map(
      (_, materialIndex): { start: number; count: number; materialIndex: number } => ({
        start: materialIndex * 3,
        count: 3,
        materialIndex,
      })
    ),
  };
  const payload = {
    version: 1,
    name: 'vanguard',
    seed: 0x5eed1234,
    mesh,
    slots: [...MATERIAL_SLOTS],
    stats: { vertices, triangles: vertices / 3 },
    weapon: {
      muzzle: [0, 0, 1],
      foregrip: [0, 0, 0],
      magBottom: [0, -1, 0],
      ejection: [1, 0, 0],
      stockTop: [0, 1, 0],
    },
    variant: VARIANTS.vanguard,
  };
  cook.validateMesh(payload);
  assert.throws(
    (): void => cook.validateMesh({ ...payload, mesh: { ...mesh, position: 'invalid' } }),
    /position number array/
  );
  const invalid = structuredClone(payload);
  invalid.mesh.skinWeight[0] = 0.5;
  assert.throws((): void => cook.validateMesh(invalid), /weight sum/);
  const invalidGroup = structuredClone(payload);
  invalidGroup.mesh.groups[1].start++;
  assert.throws((): void => cook.validateMesh(invalidGroup), /contiguous groups/);
  const encoded = await cook.cookSoldier(payload);
  assert.equal(encoded.glb.readUInt32LE(0), 0x46546c67);
  assert.deepEqual(encoded.meta.weapon, payload.weapon);
  const parse = Object.getOwnPropertyDescriptor(GLTFExporter.prototype, 'parseAsync');
  assert(parse);
  const failure = new Error('encoder failure');
  GLTFExporter.prototype.parseAsync = async (): Promise<never> => {
    throw failure;
  };
  try {
    await assert.rejects(cook.cookSoldier(payload), (error: unknown): boolean => error === failure);
  } finally {
    Object.defineProperty(GLTFExporter.prototype, 'parseAsync', parse);
  }
  const blender = join(directory, 'blender');
  writeFileSync(
    blender,
    `#!${BUN}
import fs from 'node:fs';
import path from 'node:path';
if (process.argv.includes('--version')) { console.log('Blender 5.2.2'); process.exit(0); }
const arg = name => process.argv[process.argv.indexOf(name) + 1];
const name = arg('--variant'), output = arg('--output');
const data = ${JSON.stringify(payload)};
data.name = name; data.seed = Number(arg('--seed')); data.variant = ${JSON.stringify(VARIANTS)}[name];
fs.mkdirSync(output, { recursive: true });
fs.writeFileSync(path.join(output, name + '.mesh.json'), JSON.stringify(data));
fs.writeFileSync(path.join(output, name + '.blend'), 'test blend');
`,
    { mode: 0o755 }
  );
  const output = join(directory, 'soldiers');
  const manifest = await exportSoldiers({ output, blender });
  assert.equal(manifest.inputHash, soldierInputHash());
  assert.equal(Object.keys(manifest.files).length, Object.keys(VARIANTS).length * 3);
  assert(soldierInputPaths().some((file): boolean => file.endsWith('tools/lib/export-glb.ts')));
  const read = loadCommittedSoldiers(output);
  assert.equal(read.length, Object.keys(VARIANTS).length);
  assert.deepEqual(read[0].meta.stats, payload.stats);
  rmSync(join(output, 'vanguard.blend'));
  assert.equal(
    loadCommittedSoldiers(output).length,
    read.length,
    'reader does not need editable blends'
  );
  writeFileSync(
    join(output, 'vanguard.json'),
    read[0].json.toString('utf8').replaceAll('\n', '\r\n')
  );
  assert.deepEqual(
    loadCommittedSoldiers(output)[0].json,
    read[0].json,
    'CRLF metadata is canonicalized'
  );
  writeFileSync(join(output, 'manifest.json'), JSON.stringify({ ...manifest, inputHash: 'stale' }));
  assert.throws((): void => {
    loadCommittedSoldiers(output);
  }, /stale source input hash/);
  writeFileSync(join(output, 'manifest.json'), JSON.stringify(manifest));
  writeFileSync(join(output, 'vanguard.json'), '{}');
  assert.throws((): void => {
    loadCommittedSoldiers(output);
  }, /metadata hash/);
  await assert.rejects(
    exportSoldiers({ output, blender: join(directory, 'missing') }),
    /Blender failed/
  );
  assert.equal(
    existsSync(join(output, 'manifest.json')),
    false,
    'failed authoring invalidates the manifest'
  );
  const relative = spawnSync(BUN, ['tools/blender/soldiers/export.ts', '--output', 'relative'], {
    cwd: resolve(import.meta.dirname, '../..'),
    encoding: 'utf8',
  });
  assert.notEqual(relative.status, 0);
  assert.match(relative.stderr, /--output must be absolute/);
  const reference = join(directory, 'reference.json');
  mkdirSync(join(directory, 'empty-path'));
  const cli = spawnSync(BUN, ['tools/blender/soldiers/reference.ts', reference], {
    cwd: resolve(import.meta.dirname, '../..'),
    encoding: 'utf8',
    env: { ...process.env, PATH: join(directory, 'empty-path') },
  });
  assert.equal(cli.status, 0, cli.stderr);
  assert.match(readFileSync(reference, 'utf8'), /"worldMatrices"/);
} finally {
  rmSync(directory, { recursive: true, force: true });
}
console.log('Bun authoring: pure reader, validated encoding, publication and failure boundaries');

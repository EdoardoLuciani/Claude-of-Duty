import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join, relative, resolve } from 'node:path';

import { MODEL_COOKS, MODEL_COOK_RECIPE } from '../../build/models.ts';
import { VARIANTS } from '../../src/ai/soldier.ts';
import { SOLDIER_STEP, buildAssetStep, modelSteps } from '../../tools/build-assets.ts';

const directory = mkdtempSync(join(tmpdir(), 'cod-asset-output-cache-'));
try {
  const output = join(directory, 'assets/soldiers');
  mkdirSync(output, { recursive: true });
  const expected = [
    'manifest.json',
    ...Object.keys(VARIANTS).flatMap((name): string[] => [`${name}.glb`, `${name}.json`]),
  ].map((file): string => join(output, file));
  const products = SOLDIER_STEP.outputs.map((file): string => join(directory, file));
  assert.deepEqual(products.slice().sort(), expected.sort(), 'recipe checks every staging input');

  const complete = (): boolean => products.every((file): boolean => existsSync(file));
  for (const file of products) writeFileSync(file, 'generated product');
  assert(complete(), 'a complete family is eligible for cache reuse without editable blends');
  for (const file of products) {
    rmSync(file);
    assert(!complete(), `${file} must invalidate the output-presence gate`);
    writeFileSync(file, 'regenerated product');
    assert(complete(), 'restoring the missing product permits reuse again');
  }
} finally {
  rmSync(directory, { recursive: true, force: true });
}
// Exercise the real cache runner with isolated products and external fake commands.
const root = resolve(import.meta.dirname, '../..');
const fixture = mkdtempSync(join(tmpdir(), 'cod-model-stages-'));
const prefix = basename(fixture);
const local = (file: string): string => relative(root, join(fixture, file));
try {
  const authored = local('author.json');
  const calls = join(fixture, 'calls.txt');
  writeFileSync(join(root, authored), 'first author input');
  const steps = (arms = 'arms-v1'): ReturnType<typeof modelSteps> => {
    const [author, cook] = modelSteps('m4', [arms]);
    author.id = `${prefix}-author`;
    author.blender = false;
    author.inputs = [authored];
    author.outputs = author.outputs.map((file): string => local(basename(file)));
    author.commands = [
      [
        process.execPath,
        '-e',
        `
      const fs = require('node:fs');
      fs.appendFileSync(${JSON.stringify(calls)}, 'author\\n');
      const bytes = fs.readFileSync(${JSON.stringify(join(root, authored))});
      for (const file of ${JSON.stringify(author.outputs)})
        fs.writeFileSync(file, Buffer.concat([bytes, Buffer.from(${JSON.stringify(arms)})]));
    `,
      ],
    ];
    cook.id = `${prefix}-cook`;
    cook.inputs[0] = author.outputs[0];
    cook.outputs = [local(basename(cook.outputs[0]))];
    cook.commands = [
      [
        process.execPath,
        '-e',
        `
      const fs = require('node:fs');
      fs.appendFileSync(${JSON.stringify(calls)}, 'cook\\n');
      fs.copyFileSync(${JSON.stringify(cook.inputs[0])}, ${JSON.stringify(cook.outputs[0])});
    `,
      ],
    ];
    return [author, cook];
  };
  const run = async (pair = steps()): Promise<void> => {
    for (const step of pair) if (!(await buildAssetStep(step))) break;
  };
  const expectCalls = (expected: string[]): void => {
    assert.deepEqual(readFileSync(calls, 'utf8').trim().split('\n'), expected);
    writeFileSync(calls, '');
  };
  await run();
  expectCalls(['author', 'cook']);
  await run();
  expectCalls(['']);
  rmSync(join(root, steps()[1].outputs[0]));
  await run();
  expectCalls(['cook']);
  // Reload actual recipes in fresh processes after on-disk configuration edits.
  // Hashing the complete configuration file would incorrectly recook both models.
  mkdirSync(join(fixture, 'build'));
  mkdirSync(join(fixture, 'tools'));
  symlinkSync(join(root, 'node_modules'), join(fixture, 'node_modules'), 'dir');
  symlinkSync(join(root, 'tools/blender'), join(fixture, 'tools/blender'), 'dir');
  copyFileSync(join(root, 'tools/build-assets.ts'), join(fixture, 'tools/build-assets.ts'));
  for (const id of ['m4', 'p320'] as const) {
    const model = MODEL_COOKS[id];
    mkdirSync(join(fixture, model.directory), { recursive: true });
    writeFileSync(join(fixture, model.directory, model.source), 'fresh native bytes');
  }
  const config = (profile: string[], recipe = MODEL_COOK_RECIPE): void => {
    writeFileSync(
      join(fixture, 'build/models.ts'),
      `
      export * from ${JSON.stringify(join(root, 'build/models.ts'))};
      import { MODEL_COOKS } from ${JSON.stringify(join(root, 'build/models.ts'))};
      MODEL_COOKS.m4.flags.push(...${JSON.stringify(profile)});
      export const MODEL_COOK_RECIPE = ${JSON.stringify(recipe)};
    `
    );
  };
  writeFileSync(
    join(fixture, 'record.ts'),
    `
    import { appendFileSync } from 'node:fs';
    appendFileSync(${JSON.stringify(calls)}, process.argv[2] + '\\n');
  `
  );
  const reload = (): void => {
    const result = spawnSync(
      process.execPath,
      [
        '-e',
        `
      import { buildAssetStep, modelSteps } from './tools/build-assets.ts';
      for (const id of ['m4', 'p320']) {
        const [, cook] = modelSteps(id, []);
        cook.commands = [[process.execPath, 'record.ts', id]];
        // Presence is enough here: the subprocess records only cache misses.
        cook.outputs = [cook.inputs[0]];
        if (!await buildAssetStep(cook)) process.exit(1);
      }
    `,
      ],
      { cwd: fixture, encoding: 'utf8' }
    );
    assert.equal(result.status, 0, result.stdout + result.stderr);
  };
  config([]);
  reload();
  expectCalls(['m4', 'p320']);
  reload();
  expectCalls(['']);
  config(['-test-profile']);
  reload();
  expectCalls(['m4']);
  config(['-test-profile'], `${MODEL_COOK_RECIPE}-changed`);
  reload();
  expectCalls(['m4', 'p320']);
  writeFileSync(join(root, authored), 'changed author input');
  await run();
  expectCalls(['author', 'cook']);
  for (const output of steps()[0].outputs) {
    rmSync(join(root, output));
    await run();
    expectCalls(['author']); // Identical native bytes need no recook.
  }
  await run(steps('arms-v2'));
  expectCalls(['author', 'cook']);
  const pair = steps('arms-v2');
  writeFileSync(join(root, pair[1].inputs[0]), Buffer.from([0x80]));
  await run(pair);
  expectCalls(['cook']);
  writeFileSync(join(root, pair[1].inputs[0]), Buffer.from([0x81]));
  await run(pair);
  expectCalls(['cook']); // Both decode to the same UTF-8 replacement character.
  writeFileSync(join(root, authored), 'failing author input');
  pair[0].commands = [[process.execPath, '-e', 'process.exit(7)']];
  await run(pair);
  expectCalls(['']);
  assert(!existsSync(join(root, '.cache/assets', `${pair[0].id}.sha256`)));
  rmSync(join(root, pair[1].outputs[0]));
  pair[1].commands = [[process.execPath, '-e', 'process.exit(7)']];
  assert.equal(await buildAssetStep(pair[1]), false);
  assert(!existsSync(join(root, '.cache/assets', `${pair[1].id}.sha256`)));
  for (const id of ['srd762ti', 'suppressor9mm', 'suppressor338', 'suppressor12g'] as const) {
    const [author, cook] = modelSteps(id, []);
    assert(author.inputs.includes('tools/blender/can.py'), `${id} tracks shared can authoring`);
    assert(!cook.blender, `${id} cooking never requires Blender`);
  }
} finally {
  rmSync(fixture, { recursive: true, force: true });
  for (const stage of ['author', 'cook'])
    for (const extension of ['sha256', 'log'])
      rmSync(join(root, '.cache/assets', `${prefix}-${stage}.${extension}`), { force: true });
}
console.log(
  'asset cache: complete soldier outputs and independent native author/runtime cook freshness'
);

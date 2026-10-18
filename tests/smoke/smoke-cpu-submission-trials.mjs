import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { Color, Matrix3, Matrix4, Vector2, Vector3, Vector4 } from 'three';

import {
  cpuSubmissionTrial,
  pristineHashes,
  trialNames,
} from '../../tools/lib/cpu-submission-trials.mjs';

const root = new URL('../../', import.meta.url);
const sources = Object.fromEntries(
  Object.keys(pristineHashes).map((p) => [p, readFileSync(new URL(p, root), 'utf8')])
);
const load = async (path, source) => {
  const url = new URL(path, root);
  const text = source.replace(
    /from '([^']+)'/g,
    (_, relative) => `from '${new URL(relative, url).href}'`
  );
  return import(`data:text/javascript;base64,${Buffer.from(text).toString('base64')}`);
};
const uniforms = 'node_modules/three/src/renderers/common/Uniform.js';
const group = 'node_modules/three/src/renderers/common/UniformsGroup.js';
const bindings = 'node_modules/three/src/renderers/common/Bindings.js';
assert.deepEqual(cpuSubmissionTrial({ ...sources }, 'base'), sources);
assert.throws(() => cpuSubmissionTrial({ ...sources }, 'unknown'));
assert.throws(() => cpuSubmissionTrial({ ...sources, [group]: '' }, 'uniform-kind'));
for (const trial of trialNames) {
  const changed = cpuSubmissionTrial({ ...sources }, trial);
  assert.equal(Object.keys(changed).length, Object.keys(sources).length);
  if (trial !== 'base') assert.notDeepEqual(changed, sources);
}

// Exercise all supported uniform shapes, including padded matrices and int/uint
// writes. Reconstruct partial uploads to catch stale/misordered update ranges.
const policies = ['base', 'uniform-kind', 'index-loops', 'local-loops', 'loop-uniforms'];
const groups = [];
for (const trial of policies) {
  const changed = cpuSubmissionTrial({ ...sources }, trial);
  const types = await load(uniforms, changed[uniforms]);
  const { default: Group } = await load(group, changed[group]);
  const g = new Group('test');
  const values = [
    1,
    new Vector2(2, 3),
    new Vector3(4, 5, 6),
    new Vector4(7, 8, 9, 10),
    new Color(0.2, 0.3, 0.4),
    new Matrix3(),
    new Matrix4(),
    -100,
    4294967295,
  ];
  const names = [
    'Number',
    'Vector2',
    'Vector3',
    'Vector4',
    'Color',
    'Matrix3',
    'Matrix4',
    'Number',
    'Number',
  ];
  for (let i = 0; i < values.length; i++) {
    const uniform = new types[`${names[i]}Uniform`](`u${i}`, values[i]);
    uniform.getType = () => (i === 7 ? 'int' : i === 8 ? 'uint' : 'float');
    g.addUniform(uniform);
  }
  void g.buffer;
  groups.push(g);
}
const resident = groups.map((g) => new Uint8Array(g.buffer.byteLength));
for (let step = 0; step < 100; step++) {
  for (let i = 0; i < groups.length; i++) {
    const g = groups[i];
    if (step > 0 && step % 2 === 0) g.uniforms[0].value += 0.25;
    if (step % 3 === 0) g.uniforms[1].value.y += 0.5;
    if (step % 4 === 0) g.uniforms[2].value.x -= 1;
    if (step % 5 === 0) g.uniforms[3].value.w += 2;
    if (step % 6 === 0) g.uniforms[4].value.r += 0.1;
    if (step % 7 === 0) g.uniforms[5].value.elements[8] += 0.5;
    if (step % 8 === 0) g.uniforms[6].value.elements[12] -= 1;
    if (step % 9 === 0) {
      g.uniforms[7].value--;
      g.uniforms[8].value--;
    }
    const updated = g.update();
    const bytes = new Uint8Array(g.buffer.buffer);
    if (updated) {
      if (g.updateRanges.length === 0) resident[i].set(bytes);
      for (const { start, count } of g.updateRanges)
        resident[i].set(bytes.subarray(start * 4, (start + count) * 4), start * 4);
    }
    assert.deepEqual(resident[i], bytes);
    assert.deepEqual(resident[i], resident[0], `equivalent writes: ${policies[i]}`);
    g.clearUpdateRanges();
    assert.equal(g.update(), false);
    assert.equal(g.updateRanges.length, 0);
  }
}
for (const g of groups) {
  const clone = g.clone();
  assert.notEqual(clone.buffer, g.buffer);
  assert.notEqual(clone._values, g._values);
  assert.notEqual(clone.updateRanges, g.updateRanges);
  assert.equal(clone.update(), true);
}

// Initialization must remain per RenderObject, including delete/re-initialize.
for (const trial of ['base', 'init-field']) {
  const changed = cpuSubmissionTrial({ ...sources }, trial);
  const { default: Bindings } = await load(bindings, changed[bindings]);
  const manager = new Bindings({}, null, null, null, {}, null);
  let creates = 0;
  let destroys = 0;
  manager._createBindings = () => creates++;
  manager._destroyBindings = () => destroys++;
  const a = { _bindingsInitialized: false, getBindings: () => [] };
  const b = { _bindingsInitialized: false, getBindings: () => [] };
  for (let i = 0; i < 10; i++) {
    manager.getForRender(a);
    manager.getForRender(b);
  }
  assert.equal(creates, 2);
  manager.deleteForRender(a);
  assert.equal(destroys, 1);
  manager.getForRender(a);
  assert.equal(creates, 3);
  manager.getForRender(b);
  assert.equal(creates, 3);
}
// Group-epoch optimization must preserve native per-binding update decisions,
// including node/version switches, separate managers, and a failed update retry.
const traces = [];
for (const trial of ['base', 'group-epoch', 'hoist-scope', 'fused-bindings', 'local-loops']) {
  const changed = cpuSubmissionTrial({ ...sources }, trial);
  const { default: Bindings } = await load(bindings, changed[bindings]);
  const seen = [];
  const makeManager = () => {
    const versions = new WeakMap();
    return new Bindings(
      {},
      {
        updateGroup(binding) {
          const node = binding.groupNode;
          if (node.updateType === 'object') return true;
          let previous = versions.get(binding);
          if (!previous) versions.set(binding, (previous = new WeakMap()));
          if (previous.get(node) === node.version) return false;
          previous.set(node, node.version);
          return true;
        },
      },
      null,
      null,
      {},
      null
    );
  };
  const a = { updateType: 'render', version: 0 };
  const b = { updateType: 'frame', version: 0 };
  let fail = false;
  const items = [0, 1].map((id) => ({
    groupNode: a,
    isUniformBuffer: true,
    isBuffer: true,
    updateRanges: [],
    update() {
      seen.push(id);
      if (fail) {
        fail = false;
        throw new Error('expected failure');
      }
      return false;
    },
  }));
  const bindGroup = { bindings: items };
  const manager = makeManager();
  const update = () => manager._updateBindings([bindGroup]);
  update();
  update();
  a.version++;
  update();
  update();
  for (const binding of items) binding.groupNode = b;
  update();
  update();
  for (const binding of items) binding.groupNode = a;
  update();
  a.updateType = 'object';
  update();
  update();
  a.updateType = 'render';
  a.version++;
  update();
  update();
  makeManager()._updateBindings([bindGroup]);
  a.version++;
  fail = true;
  assert.throws(update, /expected failure/);
  update();
  update();
  traces.push(seen);
  assert.deepEqual(seen, traces[0], `group/update semantics: ${trial}`);
}
for (const trial of ['base', 'local-loops']) {
  const changed = cpuSubmissionTrial({ ...sources }, trial);
  const { default: Group } = await load(group, changed[group]);
  const g = new Group('array-reference');
  const visited = [];
  g.uniforms = [1, 2];
  g.updateByType = (uniform) => {
    visited.push(uniform);
    g.uniforms = [3, 4];
    return false;
  };
  g.update();
  assert.deepEqual(visited, [1, 2], 'retain the original array reference during iteration');
}
console.log(
  'CPU submission trials: source guards, uniform bytes/types/ranges, clone isolation, init lifetime, epoch switches/retry and array reference semantics passed'
);

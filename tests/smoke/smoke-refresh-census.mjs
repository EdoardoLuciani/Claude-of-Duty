import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { RenderObjectRefreshType as T } from 'three/src/constants.js';

import {
  instrumentRefreshSources,
  installRefreshCensus,
  refreshHashes,
  shadowRefreshSources,
} from '../../tools/lib/refresh-census.mjs';

const root = new URL('../../', import.meta.url);
const sources = Object.fromEntries(
  Object.keys(refreshHashes).map((p) => [p, readFileSync(new URL(p, root), 'utf8')])
);
const changed = instrumentRefreshSources({ ...sources });
assert.throws(() => instrumentRefreshSources({ ...sources, [Object.keys(sources)[0]]: '' }));
const observerPath = 'node_modules/three/src/materials/nodes/manager/NodeMaterialObserver.js';
const load = async (source, namespace = false) => {
  const file = new URL(observerPath, root);
  source = source.replace(/from '([^']+)'/g, (_, p) => `from '${new URL(p, file).href}'`);
  const module = await import(
    `data:text/javascript;base64,${Buffer.from(source).toString('base64')}`
  );
  return namespace ? module : module.default;
};
const Base = await load(sources[observerPath]);
const Instrumented = await load(changed[observerPath]);
const previous = globalThis.__REFRESH_CENSUS__;
try {
  for (const mode of ['material', 'context', 'none']) {
    const traces = [],
      causes = [];
    for (const Class of [Base, Instrumented]) {
      const trace = [];
      const material = {};
      Object.defineProperty(material, 'colorNode', {
        enumerable: true,
        get() {
          trace.push('colorNode');
          return mode === 'material' ? { isNode: true } : null;
        },
      });
      const context = Object.fromEntries([]);
      for (const key of ['modelViewMatrix', 'modelNormalViewMatrix', 'getAO', 'getShadow', 'getGI'])
        Object.defineProperty(context, key, {
          get() {
            trace.push(key);
            return mode === 'context' && key === 'getAO';
          },
        });
      globalThis.__REFRESH_CENSUS__ = {
        emit(kind, _owner, reason) {
          if (kind === 'cause') causes.push(reason);
        },
      };
      const observer = new Class({ material, context, scene: {}, object: {} });
      assert.equal(observer.hasNode, mode !== 'none');
      traces.push(trace);
    }
    assert.deepEqual(traces[0], traces[1], 'getter evaluation/short circuit changed');
    assert.deepEqual(causes, [
      mode === 'material' ? 'material:colorNode' : mode === 'context' ? 'context:getAO' : 'none',
    ]);
  }
  const cases = [
    { hasNode: true, first: true },
    { animation: true },
    { dynamic: true },
    { first: true },
    { velocity: true },
    {},
    { target: true },
    { equalsFalse: true },
    { target: true, equalsFalse: true },
    { static: true, sameEpoch: true },
    { static: true, target: true },
    { bundle: true },
  ];
  for (const config of cases) {
    const runs = [],
      decisions = [];
    for (const Class of [Base, Instrumented]) {
      const trace = [];
      globalThis.__REFRESH_CENSUS__ = {
        emit(kind, ...args) {
          if (kind === 'decision') decisions.push(args);
        },
      };
      const observer = new Class({ material: {}, context: {}, scene: {}, object: {} });
      observer.hasNode = !!config.hasNode;
      observer.hasAnimation = !!config.animation;
      observer.renderId = config.sameEpoch ? 7 : 0;
      for (const [method, value] of [
        ['hasDynamicInstancing', config.dynamic],
        ['firstInitialization', config.first],
        ['needsVelocity', config.velocity],
      ])
        observer[method] = () => {
          trace.push(method);
          return !!value;
        };
      const target = {},
        data = { outputTarget: config.target ? {} : target, version: 1 };
      observer.getRenderObjectData = () => {
        trace.push('getData');
        return data;
      };
      observer.getOutputTarget = () => {
        trace.push('getTarget');
        return target;
      };
      observer.getLights = () => {
        trace.push('getLights');
        return [];
      };
      observer.equals = () => {
        trace.push('equals');
        return !config.equalsFalse;
      };
      const ro = {
        object: { static: !!config.static },
        bundle: config.bundle ? { static: true, version: 1 } : null,
      };
      runs.push({ type: observer.needsRefresh(ro, { renderId: 7, renderer: {} }), trace });
    }
    assert.deepEqual(runs[0], runs[1], JSON.stringify(config));
    assert.equal(decisions.length, 1, 'exactly one decision per invocation');
    assert.equal(decisions[0][3], runs[1].type);
    if (config.target && config.equalsFalse) assert.equal(decisions[0][5], 7);
    if (config.hasNode) {
      assert.equal(decisions[0][4], 'hasNode');
      assert.deepEqual(runs[1].trace, []);
    }
    if (config.static && config.sameEpoch) assert.equal(runs[1].type, T.NONE);
  }
  for (const ao of [false, true]) {
    const variant = shadowRefreshSources({ ...sources }, { ao });
    const { default: Policy, _constantShadowNodes: constants } = await load(
      variant[observerPath],
      true
    );
    const constant = { isNode: true };
    constants.add(constant);
    for (const test of [
      { expected: !ao },
      { context: { modelViewMatrix: {} }, expected: true },
      { context: { getShadow() {} }, expected: true },
      { context: { getGI() {} }, expected: true },
      { material: { positionNode: { isNode: true } }, expected: true },
      { material: { colorNode: { isNode: true } }, expected: true },
      { material: { lights: true }, expected: true },
      { material: { isShadowPassMaterial: false }, expected: true },
    ]) {
      const p = new Policy({
        material: {
          isShadowPassMaterial: true,
          lights: false,
          colorNode: constant,
          ...test.material,
        },
        object: {},
        scene: {},
        context: { getAO() {}, ...test.context },
      });
      assert.equal(p.hasNode, test.expected, JSON.stringify(test));
    }
    for (const skinned of [false, true]) {
      const p = new Policy({
        material: { isShadowPassMaterial: true, colorNode: constant },
        object: { isSkinnedMesh: skinned },
        context: {},
        scene: {},
      });
      assert.equal(p.hasAnimation, skinned);
      if (skinned) assert.equal(p.needsRefresh({ object: {} }, { renderer: {} }), T.FULL);
    }
  }
  installRefreshCensus();
  const api = globalThis.__REFRESH_CENSUS__;
  const noop = () => {};
  const original = new Error('renderer failure');
  const renderer = {
    _renderScene() {
      throw original;
    },
    _renderObjectDirect: noop,
    _bindings: { updateForRender: noop, updateSharedForRender: noop, _update: noop },
    _nodes: { updateGroup: noop, updateForRender: noop },
    backend: { draw: noop, device: { queue: { writeBuffer: noop } } },
  };
  const method = renderer._renderScene;
  api.attach(renderer, {});
  api.frame(0);
  assert.throws(
    () => renderer._renderScene({}, {}),
    (error) => error === original
  );
  api.frame(-1);
  api.dispose();
  assert.equal(renderer._renderScene, method);
  assert.deepEqual(api.snapshot().errors, [], 'throw must pop every diagnostic stack');
  api.emit('observer', {}, null);
  assert.equal(api.snapshot().errors.length, 1, 'collector error is recorded, not thrown');
} finally {
  if (previous === undefined) delete globalThis.__REFRESH_CENSUS__;
  else globalThis.__REFRESH_CENSUS__ = previous;
}
console.log(
  'Refresh census: exact hashes, getters/short circuit, native return types, first-match witnesses, fallback flags and exception cleanup passed'
);

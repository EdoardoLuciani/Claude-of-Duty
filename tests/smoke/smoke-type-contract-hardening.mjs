import assert from 'node:assert/strict';

import { Texture, Vector3 } from 'three';
import { MeshPhysicalNodeMaterial } from 'three/webgpu';

import { parseWorkerMessage } from '../../src/ai/attachment-types.ts';
import { createConfig, DEFAULTS, QUALITY_PRESETS } from '../../src/core/config.ts';
import { applyDefinedPatch } from '../../src/core/patch.ts';
import { Registry } from '../../src/core/registry.ts';
import { Rng } from '../../src/core/rng.ts';
import { MaterialSystemNode } from '../../src/materials/index.ts';
import { LIBRARY, resolveName } from '../../src/materials/library.ts';
import { SkySystem } from '../../src/sky/index.ts';
import { UiSystem } from '../../src/ui/index.ts';

// JS/debug callers cannot erase required defaults with explicit undefined.
const overrides = { fov: undefined, sensitivity: undefined, quality: 'medium', invertY: true };
const config = createConfig(overrides);
assert.equal(config.fov, DEFAULTS.fov);
assert.equal(config.sensitivity, DEFAULTS.sensitivity);
assert.equal(config.invertY, true);
assert.equal(config.quality, 'medium');
assert.deepEqual(config.q, QUALITY_PRESETS.medium);
assert.notEqual(config.q, QUALITY_PRESETS.medium, 'runtime quality tuning must not mutate presets');
assert.equal(overrides.fov, undefined, 'applying defaults must not mutate caller options');
assert.deepEqual(createConfig({ quality: 'low', q: {} }).q, QUALITY_PRESETS.low);

const state = { count: 3, active: true, target: {} };
const patch = Object.assign(Object.create({ inherited: 1 }), {
  count: 0,
  active: false,
  target: null,
});
applyDefinedPatch(state, patch);
assert.deepEqual(state, { count: 0, active: false, target: null });
applyDefinedPatch(state, { count: undefined });
assert.equal(state.count, 0, 'undefined is omission, not replacement');

// Exercise the real weather setter without creating a GPU renderer/LUT graph.
const weather = {
  turbidity: 2,
  cloudCoverage: 0.3,
  cloudDensity: 1,
  cirrusCoverage: 0.1,
  cirrusOpacity: 0.5,
  windSpeed: 0.0042,
  windAngle: 1,
  horizonMurk: 0.2,
};
const sky = {
  weather: { ...weather },
  _fog: { scatter: 1, extinction: 1, heightScale: 1, shaftGain: 1 },
  _applyWeather() {},
  _applyFog() {},
};
SkySystem.prototype.setWeather.call(sky, {
  cloudCoverage: undefined,
  windSpeed: 0,
  fogHeight: 2,
  shaftGain: 0,
});
assert.deepEqual(sky.weather, { ...weather, windSpeed: 0 });
assert.equal(sky._fog.heightScale, 2);
assert.equal(sky._fog.shaftGain, 0);
assert(!Object.hasOwn(sky.weather, 'fogHeight'), 'fog controls are not weather state');
assert(!Object.hasOwn(sky.weather, 'shaftGain'), 'fog controls are not weather state');

// Construct real material graphs, borrowing a texture set in place of GPU baking.
const texture = new Texture();
const materials = new MaterialSystemNode();
materials.ctx = { config: { quality: 'high' } };
materials._shared = { detailNormal: texture, detailAlbedo: texture, macro: texture };
materials.getTextureSet = () => ({
  name: 'concrete',
  albedo: texture,
  normal: texture,
  orm: texture,
});
const materialWarnings = [];
const warn = console.warn;
console.warn = (...args) => materialWarnings.push(args);
try {
  const material = materials.get('concrete', { scale: undefined, normalStrength: 0, three: {} });
  assert.equal(material.userData.owParams.scale, LIBRARY.concrete.mat.scale);
  assert.equal(material.userData.owParams.normalStrength, 0);
  assert(!Object.hasOwn(material.userData.owParams, 'bake'));
  assert(!Object.hasOwn(material.userData.owParams, 'three'));
  assert.equal(materials.surfaceOf('constructor'), 'concrete');
  assert.equal(resolveName('metal'), 'metal_painted');
  assert.equal(resolveName('constructor'), 'constructor', 'prototype keys are not aliases');
  assert(!(material instanceof MeshPhysicalNodeMaterial));
  const coated = materials.get('concrete', { three: { physical: true, clearcoat: 0.5 } });
  assert(coated instanceof MeshPhysicalNodeMaterial);
  assert.equal(coated.clearcoat, 0.5);
  const glass = materials.get('glass', { three: { roughness: 0.25 } });
  assert(glass instanceof MeshPhysicalNodeMaterial);
  assert.equal(glass.ior, 1.52, 'standard-value overrides preserve the authored physical finish');
  assert.equal(glass.roughness, 0.25);
  assert.throws(
    () => materials.get('glass', { three: { physical: false } }),
    /requires its authored physical material/
  );
  assert.deepEqual(materialWarnings, [], 'supported options must not be silently ignored by Three');
} finally {
  console.warn = warn;
  materials.dispose();
  texture.dispose();
}

// Unavailable telemetry values are still undefined; zero-valued measurements survive parsing.
const absentStats = parseWorkerMessage({ type: 'result', id: 1, value: true, ms: 0, moves: 0 });
assert.equal(absentStats.repeatedStates, undefined);
assert.equal(absentStats.savedMoves, undefined);
assert.equal(absentStats.queueMs, undefined);
const zeroStats = parseWorkerMessage({
  type: 'result',
  id: 1,
  value: true,
  ms: 0,
  moves: 0,
  repeatedStates: 0,
  savedMoves: 0,
  queueMs: 0,
});
assert.equal(zeroStats.repeatedStates, 0);
assert.equal(zeroStats.savedMoves, 0);
assert.equal(zeroStats.queueMs, 0);
assert.equal(JSON.stringify(absentStats).includes('repeatedStates'), false);

// Compass markers stay reusable as an optional color becomes unavailable.
const objective = { position: new Vector3(1, 0, 0), label: 'A', color: '#fff' };
const ui = { _compassObjs: [], _objectives: [objective] };
const markers = UiSystem.prototype._buildCompassObjectives.call(ui, new Vector3());
const marker = markers[0];
assert.equal(marker.color, '#fff');
objective.color = undefined;
const nextMarkers = UiSystem.prototype._buildCompassObjectives.call(ui, new Vector3());
assert.equal(nextMarkers[0], marker);
assert.equal(marker.color, undefined);

// Keyed registration validates metadata and invalidates both ordering and hook caches.
const registry = new Registry();
const first = { constructor: { id: 'first' }, update() {} };
const second = { constructor: { id: 'second', deps: ['first'] }, update() {} };
assert.equal(registry.peek('constructor'), null);
assert.equal(registry.peek('__proto__'), null);
registry.add('first', first);
assert.deepEqual(registry.with('update'), [first]);
registry.add('second', second);
assert.deepEqual(registry.ordered, [first, second]);
assert.deepEqual(registry.with('update'), [first, second]);
assert.equal(registry.get('second'), second);
assert.throws(() => registry.add('wrong', { constructor: { id: 'other' } }), /does not match/);
assert.equal(registry.has('wrong'), false, 'failed registration is atomic');
assert.throws(() => registry.add('first', first), /duplicate/);
assert.throws(() => registry.get('missing'), /not registered/);
for (const id of ['__proto__', 'constructor']) {
  const system = { constructor: { id } };
  registry.add(id, system);
  assert.equal(registry.get(id), system);
}
const rng = new Rng(1);
assert.equal(rng.pick([]), undefined);
assert.equal(rng.pick([7]), 7);

console.log(
  'type contracts: defined patches, owned options, material defaults and keyed registration passed'
);

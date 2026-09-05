#!/usr/bin/env node
/** Independent scenes: do not tune these to the current world verdicts. */
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { Rng } from '../src/core/rng.js';
import { Assembler } from './worldgen/builder.js';
import { registerProps } from './worldgen/props.js';
import { registerDressingProps } from './worldgen/dressing.js';
import { analyzePropSupport } from './worldgen/prop-support.js';
import { contactPoints, geometryWinding, supportFootprint } from './worldgen/support-contact.js';

const material = new THREE.MeshBasicMaterial();
let checks = 0;
function scene(run, { actual = false, transform = false } = {}) {
  const A = new Assembler({ materials: { get: () => material }, rng: new Rng(123), trackSupports: true });
  if (transform) A.setTransform(0.73, 23, -17);
  A.skirts = false;
  if (actual) { registerProps(A, A.rng); registerDressingProps(A, A.rng); }
  else A.proto('crate_a', { geo: new THREE.BoxGeometry(1, 1, 1).translate(0, 0.5, 0), key: 'concrete' });
  const placements = [];
  function place(id, prototype, position, rotationDeg = [0, 0, 0], scale = [1, 1, 1], support) {
    placements.push({ id, prototype, position, rotationDeg, scale, support });
    A.place(prototype, new THREE.Matrix4().compose(
      new THREE.Vector3().fromArray(position),
      new THREE.Quaternion().setFromEuler(new THREE.Euler(...rotationDeg.map(THREE.MathUtils.degToRad))),
      new THREE.Vector3().fromArray(scale)
    ));
  }
  function floor(width = 10, depth = 10, x = 0, z = 0, role = 'floor') {
    const geo = new THREE.BoxGeometry(width, 0.1, depth);
    A.add('concrete', geo, new THREE.Matrix4().makeTranslation(x, -0.05, z), { support: role });
    geo.dispose();
  }
  function results() { return new Map(analyzePropSupport(A, placements).results.map((result) => [result.id, result])); }
  try { run({ A, place, floor, results }); checks++; } finally { A.dispose(); }
}

for (const transform of [false, true]) {
  scene(({ place, floor, results }) => {
    floor(); place('base', 'crate_a', [0, 0, 0]); place('top', 'crate_a', [0, 1, 0]);
    const r = results(); assert.equal(r.get('base').status, 'supported'); assert.equal(r.get('top').status, 'supported');
    assert.deepEqual(r.get('top').supporters, ['base']);
  }, { transform });
  scene(({ place, floor, results }) => {
    floor(); place('base', 'crate_a', [0, 0, 0]); place('float', 'crate_a', [0, 1.24, 0]);
    const r = results().get('float'); assert.equal(r.status, 'review-gap');
    assert.ok(Math.abs(r.nearestGap - 0.24) < 1e-6); assert.equal(r.nearestSupport, 'base');
    assert.equal(r.contacts, 0);
  }, { transform });
  scene(({ place, results }) => {
    place('a', 'crate_a', [0, 4, 0]); place('b', 'crate_a', [0, 4.1, 0]);
    for (const result of results().values()) assert.equal(result.status, 'unsupported', 'floating cycle cannot seed itself');
  }, { transform });
}

for (const [gap, expected] of [[0.02, 'supported'], [0.06, 'review-gap'], [0.15, 'review-gap'], [0.24, 'review-gap'], [0.5, 'unsupported']]) {
  scene(({ place, floor, results }) => {
    floor(); place('probe', 'crate_a', [0, gap, 0]); assert.equal(results().get('probe').status, expected);
  });
}
scene(({ place, floor, results }) => {
  floor(); place('base', 'crate_a', [0, 0.15, 0]); place('top', 'crate_a', [0, 1.15, 0]);
  const r = results(); assert.equal(r.get('base').status, 'review-gap');
  assert.equal(r.get('top').status, 'review-gap'); assert.equal(r.get('top').physical, 'contact');
  assert.deepEqual(r.get('top').localReasons, [], 'gap uncertainty is inherited, not a fake local gap');
});
scene(({ place, floor, results }) => {
  floor(); floor(10, 10, 0, 0, null); place('base', 'crate_a', [0, 0, 0]);
  assert.equal(results().get('base').status, 'supported', 'independent certain support wins over an unclassified overlap');
});

scene(({ place, floor, results }) => {
  floor(0.18, 2, -0.4); place('edge', 'crate_a', [0, 0, 0]); place('top', 'crate_a', [0, 1, 0]);
  const r = results(); assert.equal(r.get('edge').status, 'review-overhang');
  assert.equal(r.get('top').status, 'review-overhang'); assert.ok(r.get('top').stableFootprint);
});
scene(({ place, floor, results }) => {
  floor(10, 10, 0, 0, 'balcony'); place('base', 'crate_a', [0, 0, 0]); place('top', 'crate_a', [0, 1, 0]);
  for (const result of results().values()) assert.equal(result.status, 'review-balcony');
});
scene(({ place, floor, results }) => {
  floor(10, 10, 0, 0, 'balcony'); place('base', 'crate_a', [0, 0, 0], [0, 0, 0], [1, 1, 1], 'balcony');
  place('top', 'crate_a', [0, 1, 0]);
  for (const result of results().values()) assert.equal(result.status, 'supported');
});
scene(({ place, floor, results }) => {
  floor(10, 10, 0, 0, null); place('base', 'crate_a', [0, 0, 0]); place('top', 'crate_a', [0, 1, 0]);
  for (const result of results().values()) assert.equal(result.status, 'unclassified-seat');
});
scene(({ place, floor, results }) => {
  floor(); place('embedded', 'crate_a', [0, -0.2, 0]);
  assert.equal(results().get('embedded').status, 'review-penetration');
});
scene(({ place, floor, results }) => {
  floor(); place('tilted', 'crate_a', [0, 0.341506350946, 0], [30, 0, 30]);
  assert.notEqual(results().get('tilted').status, 'supported', 'one low corner is not stable support');
});
scene(({ place, floor, results }) => {
  floor(); place('scaled', 'crate_a', [0, 0, 0], [0, 43, 0], [-0.5, 2, 1.5]);
  assert.equal(results().get('scaled').status, 'supported', 'mirrored non-uniform scale');
});

scene(({ A, place, floor, results }) => {
  floor();
  const stool = A._protos.get('stool').geo; stool.computeBoundingBox();
  place('stool', 'stool', [0, -stool.boundingBox.min.y + 0.15, 0]);
  assert.equal(results().get('stool').status, 'review-gap');
}, { actual: true });
scene(({ A, place, floor, results }) => {
  floor();
  const table = A._protos.get('table').geo, stool = A._protos.get('stool').geo;
  table.computeBoundingBox(); stool.computeBoundingBox();
  place('table', 'table', [0, -table.boundingBox.min.y, 0]);
  place('stool', 'stool', [0, table.boundingBox.max.y - table.boundingBox.min.y - stool.boundingBox.min.y + 0.22, 0]);
  const r = results().get('stool'); assert.equal(r.status, 'review-gap');
  assert.equal(r.nearestSupport, 'table'); assert.ok(Math.abs(r.nearestGap - 0.22) < 0.01);
}, { actual: true });
scene(({ A, place, floor, results }) => {
  floor(); const g = A._protos.get('sandbag_a').geo; g.computeBoundingBox();
  place('base', 'sandbag_a', [0, -g.boundingBox.min.y, 0]);
  place('separated', 'sandbag_a', [0, -g.boundingBox.min.y + 0.34, 0.71]);
  const r = results().get('separated'); assert.notEqual(r.status, 'supported');
  assert.equal(r.contacts, 0); assert.ok(!r.supporters.includes('base'));
}, { actual: true });
scene(({ A, place, floor, results }) => {
  floor(); const g = A._protos.get('tyre_small').geo; g.computeBoundingBox();
  assert.equal(geometryWinding(g), -1, 'fixture really has reversed winding');
  const h = g.boundingBox.max.y - g.boundingBox.min.y;
  place('base', 'tyre_small', [0, -g.boundingBox.min.y, 0]);
  place('top', 'tyre_small', [0, h - g.boundingBox.min.y, 0]);
  for (const result of results().values()) assert.equal(result.status, 'supported', 'measured tyre contacts, no interlock shortcut');
}, { actual: true });
scene(({ A, place, floor, results }) => {
  floor(0.12, 0.12);
  const g = A._protos.get('tyre_small').geo; g.computeBoundingBox();
  place('tyre', 'tyre_small', [0, -g.boundingBox.min.y, 0]);
  assert.equal(results().get('tyre').status, 'unsupported', 'a post through a torus hole is not contact');
}, { actual: true });

// A chair-like mesh resting on different step heights must retain all feet;
// selecting only a global-minimum band used to lose the raised pair.
scene(({ A, place, floor, results }) => {
  floor(1, 2, -0.5);
  const step = new THREE.BoxGeometry(1, 0.2, 2); A.add('concrete', step, new THREE.Matrix4().makeTranslation(0.5, 0.1, 0), { support: 'stair' }); step.dispose();
  const parts = [];
  for (const x of [-0.3, 0.3]) for (const z of [-0.3, 0.3]) {
    const bottom = x < 0 ? 0 : 0.2;
    parts.push(new THREE.BoxGeometry(0.06, 1 - bottom, 0.06).translate(x, (1 + bottom) / 2, z));
  }
  parts.push(new THREE.BoxGeometry(0.8, 0.1, 0.8).translate(0, 1.05, 0));
  A.proto('chair', { geo: mergeGeometries(parts), key: 'concrete' }); parts.forEach((g) => g.dispose());
  place('chair', 'chair', [0, 0, 0]); assert.equal(results().get('chair').status, 'supported');
});

// Retessellating the same flat footprint must not change stability.
for (const segments of [1, 8]) {
  const geo = new THREE.BoxGeometry(1, 1, 1, segments, segments, segments);
  geo.computeBoundingBox(); const points = contactPoints(geo, new THREE.Matrix4(), geo.boundingBox);
  assert.ok(supportFootprint(points.filter((p) => p.y < -0.49), geo.boundingBox)); geo.dispose(); checks++;
}
material.dispose();
console.log(JSON.stringify({ ok: true, checks }));

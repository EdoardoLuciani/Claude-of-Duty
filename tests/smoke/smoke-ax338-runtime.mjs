// Native-to-decoded AX338 parity, independent of the browser decoder wiring.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import * as THREE from 'three';

import { AX338Animation, makeAX338Model } from '../../src/weapons/ax338.ts';
import { parseGLB } from '../../tools/lib/glb-fixture.mjs';

const native = makeAX338Model(
  await parseGLB(readFileSync(new URL('../../assets/weapons/ax338/ax338.glb', import.meta.url)))
);
const runtime = makeAX338Model(
  await parseGLB(
    readFileSync(new URL('../../assets/weapons/ax338/ax338.runtime.glb', import.meta.url))
  )
);
const a = new AX338Animation(native),
  b = new AX338Animation(runtime);
const controls = [];
native.root.traverse((node) => {
  if (!node.isMesh) {
    const other = runtime.root.getObjectByName(node.name);
    assert(other, `retained named control/socket: ${node.name}`);
    controls.push([node, other]);
  }
});
let positionError = 0,
  rotationError = 0,
  scaleError = 0,
  samples = 0;
for (const clip of native.animations) {
  assert.equal(runtime.animations.find((c) => c.name === clip.name).duration, clip.duration);
  // Include half-frame samples and the exact fractional clip endpoint.
  for (let frame = 0; frame <= Math.ceil(clip.duration * 240); frame++) {
    const time = Math.min(frame / 240, clip.duration);
    a._sample(clip.name, time);
    b._sample(clip.name, time);
    samples++;
    for (const [source, cooked] of controls) {
      positionError = Math.max(positionError, source.position.distanceTo(cooked.position));
      rotationError = Math.max(rotationError, source.quaternion.angleTo(cooked.quaternion));
      assert(Math.abs(cooked.quaternion.length() - 1) < 1e-12, 'unit sampled rotation');
      scaleError = Math.max(scaleError, source.scale.distanceTo(cooked.scale));
      assert.equal(
        source.scale.x > 0.5,
        cooked.scale.x > 0.5,
        `${clip.name}/${time}/${source.name}: STEP visibility`
      );
    }
  }
}
assert(positionError < 0.000001, `translation error ${positionError} m`);
assert(rotationError < 0.0001, `16-bit normalized rotation error ${rotationError} radians`);
assert(scaleError < 0.000001, `scale error ${scaleError}`);
// The cooked constant Idle still holds for the authored two-second loop.
a.idleTime = b.idleTime = 1.99;
a.update(0.02, null, 0, false);
b.update(0.02, null, 0, false);
for (const [source, cooked] of controls) {
  assert(source.position.distanceTo(cooked.position) < 0.000001);
  assert(source.quaternion.angleTo(cooked.quaternion) < 0.0001);
}
a.reset();
b.reset();
assert(
  !a.spare.visible && !b.spare.visible && a.magazine.visible && b.magazine.visible,
  'constant Idle reset/loop visibility'
);
native.root.updateMatrixWorld(true);
runtime.root.updateMatrixWorld(true);

// Bound sampled native-surface loss against actual decoded runtime triangles.
// A spatial grid is local to this test, not a runtime geometry representation.
const cellSize = 0.01,
  cells = new Map(),
  bounds = new THREE.Box3();
const cell = (p) => p.toArray().map((v) => Math.floor(v / cellSize));
const key = (x, y, z) => `${x},${y},${z}`;
runtime.root.traverse((mesh) => {
  if (!mesh.isMesh || mesh.name.startsWith('magazine_spare')) return;
  const index = mesh.geometry.index;
  for (let i = 0; i < index.count; i += 3) {
    const tri = new THREE.Triangle(
      ...[0, 1, 2].map((j) =>
        mesh
          .getVertexPosition(index.getX(i + j), new THREE.Vector3())
          .applyMatrix4(mesh.matrixWorld)
      )
    );
    bounds.setFromPoints([tri.a, tri.b, tri.c]);
    const lo = cell(bounds.min),
      hi = cell(bounds.max);
    for (let x = lo[0]; x <= hi[0]; x++)
      for (let y = lo[1]; y <= hi[1]; y++)
        for (let z = lo[2]; z <= hi[2]; z++) {
          const k = key(x, y, z);
          if (!cells.has(k)) cells.set(k, []);
          cells.get(k).push(tri);
        }
  }
});
const p = new THREE.Vector3(),
  closest = new THREE.Vector3();
let geometryError = 0,
  probes = 0;
native.root.traverse((mesh) => {
  if (!mesh.isMesh || mesh.name.startsWith('magazine_spare')) return;
  const position = mesh.geometry.attributes.position;
  for (let i = 0; i < position.count; i += 12) {
    mesh.getVertexPosition(i, p).applyMatrix4(mesh.matrixWorld);
    const c = cell(p);
    let distance = Infinity;
    for (let x = c[0] - 1; x <= c[0] + 1; x++)
      for (let y = c[1] - 1; y <= c[1] + 1; y++)
        for (let z = c[2] - 1; z <= c[2] + 1; z++) {
          for (const tri of cells.get(key(x, y, z)) ?? []) {
            tri.closestPointToPoint(p, closest);
            distance = Math.min(distance, closest.distanceTo(p));
          }
        }
    assert(distance < 0.00005, `${mesh.name}/${i}: sampled surface loss ${distance} m`);
    geometryError = Math.max(geometryError, distance);
    probes++;
  }
});
for (const model of [native, runtime]) {
  model.root.traverse((mesh) => {
    if (mesh.isMesh)
      assert(
        !mesh.isSkinnedMesh &&
          !mesh.geometry.attributes.skinIndex &&
          !mesh.geometry.attributes.skinWeight
      );
  });
  for (const name of ['receiver', 'handguard', 'stock', 'optic', 'bolt', 'trigger'])
    assert.equal(
      model.root.getObjectByName(`${name}_mesh`).parent,
      model.root.getObjectByName(name)
    );
  const glass = [...model.materials].find((m) => m.name.startsWith('10 |'));
  assert(
    glass.transparent && !glass.depthWrite && Math.abs(glass.opacity - 0.13) < 1e-6,
    'independent coated scope lenses'
  );
}
a.dispose();
b.dispose();
for (const duration of [0, 0.5]) {
  const gltf = await parseGLB(
    readFileSync(new URL('../../assets/weapons/ax338/ax338.glb', import.meta.url))
  );
  gltf.animations.find((clip) => clip.name === 'Idle').duration = duration;
  gltf.animations.find((clip) => clip.name === 'Fire').duration = 0.01;
  const model = makeAX338Model(gltf);
  assert.equal(
    model.animations.find((clip) => clip.name === 'Idle').duration,
    duration,
    'do not repair multi-key or nonzero Idle'
  );
  assert.equal(
    model.animations.find((clip) => clip.name === 'Fire').duration,
    0.01,
    'do not normalize moving clips'
  );
  new AX338Animation(model).dispose();
}
console.log(
  `AX338 runtime: ${samples} half-frame poses; max translation ${positionError} m / rotation ${rotationError} rad / scale ${scaleError}; ${probes} geometry probes, max surface loss ${geometryError * 1000} mm; named sockets and STEP visibility retained`
);

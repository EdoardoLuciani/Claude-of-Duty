import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { ShellSystem } from '../../src/fx/shells.ts';
import { FxSystem } from '../../src/fx/index.ts';
import { Rng } from '../../src/core/rng.ts';

const bytes = readFileSync(new URL('../../public/models/fx/spent12g.glb', import.meta.url));
const gltf = await new GLTFLoader().parseAsync(
  bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
  ''
);
const hull = gltf.scene.getObjectByName('spent12g');
assert(hull?.isMesh);
assert.equal(gltf.scene.children.length, 1);
const geometry = hull.geometry,
  pos = geometry.getAttribute('position'),
  pbr = geometry.getAttribute('_shellpbr'),
  color = geometry.getAttribute('color');
assert.equal(geometry.groups.length, 0, 'one primitive/draw, no material groups');
assert.equal(pbr.itemSize, 2);
assert.equal(pbr.count, pos.count);
assert.equal(color.count, pos.count);
let plastic = 0,
  brass = 0;
for (let i = 0; i < pos.count; i++) {
  const height = ((pos.getY(i) + 0.0225) * 0.07) / 0.045;
  const metal = pbr.getX(i),
    rough = pbr.getY(i);
  assert(metal === 0 || metal === 1, 'no interpolated material-boundary vertices');
  if (metal === 0) {
    plastic++;
    assert(height >= 0.012 - 1e-8);
    assert(rough > 0.59 && rough < 0.65);
    assert(color.getX(i) > 8 * color.getY(i), 'authored reload red family');
  } else {
    brass++;
    assert(height <= 0.012 + 1e-8, 'short head only');
    assert(rough > 0.33 && rough < 0.39);
    assert(color.getX(i) > color.getY(i) && color.getY(i) > color.getZ(i));
  }
}
assert(plastic && brass);
geometry.computeBoundingBox();
assert(Math.abs(geometry.boundingBox.max.y - geometry.boundingBox.min.y - 0.045) < 1e-8);
assert(Math.abs(geometry.boundingBox.max.x - 0.00495) < 1e-8);
hull.updateMatrixWorld(true);
const mouth = new THREE.Raycaster(
  new THREE.Vector3(0, 0.05, 0),
  new THREE.Vector3(0, -1, 0)
).intersectObject(hull)[0];
assert(
  mouth && mouth.point.y < 0,
  'open spent mouth: axial ray reaches recessed floor, no bullet/crimp/cap'
);

const added = [],
  removed = [];
const physics = {
  addRigidBody(o) {
    added.push(o);
    return {};
  },
  removeRigidBody(body) {
    removed.push(body);
  },
};
const fx = { rng: new Rng(410), gravity: -9.81, physics, audioPing() {}, emitLit() {} };
const pool = new ShellSystem(fx, geometry),
  identities = [...pool.slots],
  proxies = pool.slots.map((s) => s.proxy);
const bridge = { ctx: { time: { elapsed: 0 } }, shells: pool };
const spawn = (opts) => {
  FxSystem.prototype.spawnShell.call(
    bridge,
    new THREE.Vector3(1, 2, 3),
    new THREE.Vector3(3, 2, 1),
    opts
  );
  return pool.slots[(pool.cursor + 13) % 14];
};
const matrix = new THREE.Matrix4(),
  scale = new THREE.Vector3();
const visibleAt = (mesh, index) => {
  mesh.getMatrixAt(index, matrix);
  scale.setFromMatrixScale(matrix);
  return scale.length() > 0.001;
};
assert.equal(pool.slots.length, 14);
assert.equal(pool.material.name, 'fx-brass');
assert.equal(pool.material.metalness, 1);
assert.deepEqual(pool.material.color.toArray(), [0.78, 0.62, 0.31]);
assert(
  pool.material.roughnessMap === pool.textures.orm &&
    pool.material.normalMap === pool.textures.normal
);
assert.equal(pool.geometry.type, 'LatheGeometry');
assert.equal(pool.geometry.parameters.segments, 16);
assert.equal(pool.hullMesh.geometry, geometry);
assert.equal(pool.hullMaterial.vertexColors, true);
assert(
  pool.hullMaterial.metalnessNode && pool.hullMaterial.roughnessNode,
  'actual material uses loaded PBR attributes'
);
const hullSlot = spawn({ fxClass: 'shotgun', caseLen: 0.07, caseRadius: 0.01105, spin: 40 });
assert(hullSlot.shotgun);
assert.equal(hullSlot.lengthScale, 0.07 / 0.045);
assert.equal(hullSlot.radiusScale, 0.01105 / 0.00495);
assert.deepEqual(added[0].halfExtents, {
  x: 0.0047 * hullSlot.radiusScale,
  y: 0.0225 * hullSlot.lengthScale,
  z: 0.0047 * hullSlot.radiusScale,
});
assert.equal(added[0].lifetime, 10);
assert.equal(added[0].restitution, 0.36);
assert.equal(added[0].friction, 0.42);
pool.update(0);
assert(visibleAt(pool.hullMesh, 0));
assert(!visibleAt(pool.mesh, 0));
assert.equal(pool.mesh.visible, false);
spawn({ weapon: { class: 'shotgun' } });
spawn({ weapon: 'shotgun' });
for (const opts of [
  { weapon: { id: 'pistol', class: 'pistol' }, caseLen: 0.019 },
  { fxClass: 'rifle', weapon: 'shotgun' },
  { caseLen: 0.07, caseRadius: 0.01105 },
  {},
])
  assert.equal(
    spawn(opts).shotgun,
    false,
    'legacy/default and nonshotgun stay brass, dimensions never select a variant'
  );
pool.update(0);
assert(pool.mesh.visible && pool.hullMesh.visible);
for (let i = pool.cursor; i < 14; i++) spawn({ fxClass: 'rifle' });
assert.equal(pool.cursor, 0);
spawn({ fxClass: 'rifle' });
assert.equal(removed.length, 1);
assert(
  !visibleAt(pool.hullMesh, 0) && !visibleAt(pool.mesh, 0),
  'recycling immediately hides stale variant'
);
pool.update(0);
assert(visibleAt(pool.mesh, 0));
assert(!visibleAt(pool.hullMesh, 0));
assert.deepEqual(pool.slots, identities);
assert.deepEqual(
  pool.slots.map((s) => s.proxy),
  proxies
);
for (let i = 0; i < 14; i++)
  assert.notEqual(
    visibleAt(pool.mesh, i),
    visibleAt(pool.hullMesh, i),
    'exactly one rendered instance per live slot'
  );
pool.update(8.65);
assert(Math.abs(pool.slots[0].fade - 0.5) < 1e-8);
pool.update(0.36);
assert.equal(removed.length, 15);
assert(pool.slots.every((s) => !s.alive && !s.body));
assert(!pool.mesh.visible && !pool.hullMesh.visible);
spawn({ fxClass: 'shotgun' });
pool.update(0);
const disposed = [];
for (const resource of [
  pool.geometry,
  geometry,
  pool.material,
  pool.hullMaterial,
  pool.textures.normal,
  pool.textures.orm,
  pool.mesh,
  pool.hullMesh,
])
  resource.addEventListener('dispose', () => disposed.push(resource));
pool.dispose();
assert.equal(removed.length, 16);
assert.equal(disposed.length, 8);
assert(pool.slots.every((s) => !s.alive && !s.body));
hull.material.dispose();
console.log(
  'Shells: actual offline GLB/open 70mm 12g/PBR routing, unchanged all-brass legacy, shared 14-slot budget, dimensions/physics, immediate recycling, fade/expiry/reuse/disposal passed'
);

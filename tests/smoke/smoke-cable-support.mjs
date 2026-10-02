import assert from 'node:assert/strict';
import * as THREE from 'three';
import { Rng } from '../../src/core/rng.js';
import { Assembler } from '../../tools/worldgen/builder.js';
import { buildWorld } from '../../tools/worldgen/build.js';
import { SET_PIECES } from '../../tools/worldgen/layout.js';

// Match the exporter stream, including authored facade openings and ruin cuts.
const root = new Rng(0x5eed1234);
root.fork(); root.fork();
const rng = root.fork();
const materials = new Set();
const A = new Assembler({ rng, materials: { get() {
  const material = new THREE.MeshBasicMaterial({ side: THREE.DoubleSide });
  materials.add(material);
  return material;
} } });
const scene = new THREE.Group();
buildWorld(A, rng);
A.finalize(scene);
scene.updateMatrixWorld(true);
// Exclude the mount/cable batch itself: touching another floating mount cannot
// satisfy the test. Require real facade, slab or parapet masonry behind it.
const masonry = scene.children.filter(mesh => mesh.name.startsWith('world_') &&
  /plaster|concrete|roof_screed/.test(mesh.name) && mesh.name !== 'world_concrete_dark');
const ray = new THREE.Raycaster();
let mounts = 0;
try {
  for (const [span, cable] of SET_PIECES.cables.entries()) {
    for (const side of [0, 1]) {
      const [x, y, z] = cable.slice(side * 3, side * 3 + 3);
      const sign = Math.sign(x);
      for (const lower of [false, true]) {
        const mountY = y + .06 - (lower ? (side === 0 ? .22 : .18) : 0);
        const mountZ = z + (lower ? (side === 0 ? .18 : .20) : 0);
        for (const dy of [-.03, 0, .03]) {
          ray.set(new THREE.Vector3(x - sign * .4, mountY + dy, mountZ), new THREE.Vector3(sign, 0, 0));
          const hit = ray.intersectObjects(masonry, false)[0];
          assert(hit && hit.distance - .4 <= .11,
            `span ${span}/${side}/${lower ? 'lower' : 'main'}: mount must overlap solid masonry by at least 1 cm, not float at a setback, above a roof or across an opening`);
        }
        mounts++;
      }
    }
  }
  assert.equal(mounts, 24, 'both ends of every main and paired lower cable are checked');
} finally {
  A.dispose();
  for (const material of materials) material.dispose();
}
console.log(`Cable supports: ${mounts} mounts reach actual authored masonry at three heights; mount geometry excluded from support rays`);

// Physical navigation regression fixtures. Nothing in src/ imports this directory.
import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { PhysicsSystem } from '../../src/physics/index.js';
// Measured #306 physical outcomes for anchors 0–7, not merely query results.
export const RECORDED = [
  [20, [7.772, .077, 2.833], ['stalled', 'stalled', 'invalid', 'arrived', 'invalid', 'arrived', 'arrived', 'invalid']],
  [45, [7.660, .087, 2.852], ['arrived', 'arrived', 'invalid', 'arrived', 'invalid', 'arrived', 'arrived', 'invalid']],
  [38, [-1.120, .083, 30.254], ['arrived', 'execution-failure', 'invalid', 'arrived', 'invalid', 'arrived', 'arrived', 'invalid']],
  [13, [3.557, 1.183, .803], ['unreachable', 'unreachable', 'invalid', 'unreachable', 'invalid', 'unreachable', 'unreachable', 'invalid']],
  [12, [-12.688, .387, -2.254], ['arrived', 'arrived', 'invalid', 'arrived', 'invalid', 'arrived', 'arrived', 'invalid']],
];
export const vec = (p) => new THREE.Vector3(...p);
export function physicsFor(scene) {
  const physics = new PhysicsSystem();
  scene.updateMatrixWorld(true);
  scene.traverse((o) => { if (o.isMesh) physics.addStatic(o, o.userData.surface ?? 'concrete'); });
  physics.rebuildStatic();
  return physics;
}
export async function loadMap() {
  const dir = new URL('../../public/models/world/', import.meta.url);
  const meta = JSON.parse(readFileSync(new URL('level.json', dir)));
  const bytes = gunzipSync(readFileSync(new URL(meta.assets.collision, dir)));
  const gltf = await new GLTFLoader().parseAsync(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), '');
  const physics = physicsFor(gltf.scene);
  const bounds = new THREE.Box3(vec(meta.bounds.min), vec(meta.bounds.max)).expandByScalar(2);
  const surfaceRaw = gunzipSync(readFileSync(new URL(meta.assets.nav, dir)));
  const cases = RECORDED.flatMap(([id, p, outcomes]) => meta.spawns.map((s, i) => ({
    name: `enemy-${id}/anchor-${i}`, from: vec(p), to: vec(s.position), recorded: id, expectedOutcome: outcomes[i],
  })));
  // Real openings, not hand-picked empty-room substitutes.
  const transform = new THREE.Matrix4().fromArray(meta.transform);
  for (const b of meta.buildings) {
    for (const [i, o] of b.traversable.entries()) {
      if (i !== 0) continue;
      const from = vec(o.from).applyMatrix4(transform);
      const to = vec(o.to).applyMatrix4(transform);
      from.y = physics.groundHeight(from.x, from.z, from.y + 0.5);
      to.y = physics.groundHeight(to.x, to.z, to.y + 0.5);
      cases.push({ name: `${b.spec.id}/entrance`, from, to });
    }
    // Mirror the authored first-flight dimensions, not a visual approximation.
    const spec = b.spec;
    for (const fl of spec.stairFlights ?? []) {
      if (fl.floor !== 0) continue;
      const thickness = spec.t ?? 0.34;
      const iw = spec.w - thickness * 2, depth = spec.d - thickness * 2;
      const base = spec.interiorFloors ? 0.16 : Math.max(0.13, spec.plinthH ?? 0.42);
      const climb = (b.floorY[1] ?? b.roofY) - base;
      const run = Math.max(6, Math.round(climb / 0.19)) * (fl.run ?? 0.275);
      const x = spec.x - iw / 2 + fl.x * iw, z = spec.z - depth / 2 + fl.z * depth;
      const dx = Math.sin(fl.ry ?? 0), dz = Math.cos(fl.ry ?? 0);
      const from = vec([x - dx * 0.8, base, z - dz * 0.8]).applyMatrix4(transform);
      const to = vec([x + dx * (run + 0.65), base + climb, z + dz * (run + 0.65)]).applyMatrix4(transform);
      cases.push({ name: `${spec.id}/stairs-up`, from, to });
      cases.push({ name: `${spec.id}/stairs-down`, from: to.clone(), to: from.clone() });
    }
  }
  return { name: 'map', physics, bounds, cases, meta, surfaceRaw };
}
export const OBSTRUCTED_MAP_GOALS = ['W2/entrance', 'W4/stairs-up', 'W4/stairs-down', 'E4/stairs-up', 'E4/stairs-down'];
export function addClearStairCases(fixture) {
  const original = fixture.cases.find(c => c.name === 'W4/stairs-up');
  const axis = original.to.clone().sub(original.from); axis.y = 0; axis.normalize();
  const from = original.from.clone().addScaledVector(axis, .5), to = original.to.clone().addScaledVector(axis, -.3);
  fixture.cases.push({ name: 'W4/clear-stairs-up', from, to }, { name: 'W4/clear-stairs-down', from: to, to: from });
}
function box(scene, x, y, z, w, h, d) {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), new THREE.MeshBasicMaterial());
  mesh.position.set(x, y, z);
  scene.add(mesh);
}
export function synthetic() {
  const scene = new THREE.Scene();
  // Ground and a roof/upper floor sharing X/Z, deliberately disconnected.
  box(scene, 0, -0.2, 0, 18, 0.4, 12);
  box(scene, -4, 3, 0, 6, 0.3, 8);
  box(scene, -4, 0.45, 3, 1.2, 0.9, 1.2); // isolated prop top
  // Stair flight with real treads and a top platform, separate from the roof.
  for (let i = 0; i < 16; i++) box(scene, 4, (i + 1) * 0.19 / 2, -3 + i * 0.275, 1.2, (i + 1) * 0.19, 0.275);
  box(scene, 4, 2.94, 2.25, 3, 0.2, 2);
  // Right-angle route around a wall; a crouch-only tunnel on another island.
  box(scene, 0, 1.5, 1.5, 0.3, 3, 5);
  box(scene, 15, -0.2, 0, 8, 0.4, 6);
  box(scene, 15, 1.5, 0, 2, 0.3, 6);
  const cases = [
    ['ground-under-roof', [-6, 0, -2], [-2, 0, -2], true],
    ['upper-floor', [-6, 3.15, -2], [-2, 3.15, -2], true],
    ['wrong-storey', [-4, 0, 0], [-4, 3.15, 0], false],
    ['prop-top', [-4, 0, 1.5], [-4, 0.9, 3], false],
    ['stairs-up', [4, 0, -4.2], [4, 3.04, 2.3], true],
    ['stairs-down', [4, 3.04, 2.3], [4, 0, -4.2], true],
    ['corner', [-1.4, 0, 2.8], [1.4, 0, 2.8], true],
    ['disconnected', [7, 0, 0], [12, 0, 0], false],
    ['crouch-tunnel', [12, 0, 0], [18, 0, 0], false], // standing-only candidate profile
  ].map(([name, from, to, reachable]) => ({ name, from: vec(from), to: vec(to), reachable }));
  const bounds = new THREE.Box3(vec([-10, -1, -7]), vec([20, 7, 7]));
  const physics = physicsFor(scene);
  return { name: 'synthetic', physics, bounds, cases };
}

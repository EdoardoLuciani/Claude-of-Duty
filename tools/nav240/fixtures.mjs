// Physical navigation regression fixtures. Nothing in src/ imports this directory.
import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { PhysicsSystem } from '../../src/physics/index.js';
// Measured physical outcomes for anchors 0–7, not merely query results.
export const RECORDED = [
  [20, [7.772, .077, 2.833], ['arrived', 'arrived', 'invalid', 'arrived', 'invalid', 'arrived', 'arrived', 'invalid']],
  [45, [7.660, .087, 2.852], ['arrived', 'arrived', 'invalid', 'arrived', 'invalid', 'arrived', 'arrived', 'invalid']],
  [38, [-1.120, .083, 30.254], ['arrived', 'arrived', 'invalid', 'arrived', 'invalid', 'arrived', 'arrived', 'invalid']],
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
export const OBSTRUCTED_MAP_GOALS = ['W2/entrance', 'W4/stairs-up', 'W4/stairs-down'];
export function addClearStairCases(fixture) {
  const original = fixture.cases.find(c => c.name === 'W4/stairs-up');
  const axis = original.to.clone().sub(original.from); axis.y = 0; axis.normalize();
  const from = original.from.clone().addScaledVector(axis, .5), to = original.to.clone().addScaledVector(axis, -.3);
  fixture.cases.push({ name: 'W4/clear-stairs-up', from, to }, { name: 'W4/clear-stairs-down', from: to, to: from });
}
// September 26 capture: exact world-space upstairs objectives plus the occupied
// W2 setback terrace. Testing only the stair landing missed its facade barrier.
export function addFollowupCases(fixture) {
  for (const [name, from, to] of [
    ['capture/7-W2', [-21.916, .372, -31.429], [-6.602, 3.484, 10.324]],
    ['capture/9-W2', [-10.564, .1, -14.756], [-7.589, 3.473, 6.279]],
    ['capture/7-W5', [-9.431, -.118, 24.247], [2.301, 3.473, 31.815]],
  ]) fixture.cases.push({ name, from: vec(from), to: vec(to) });
  const stairs = fixture.cases.find(c => c.name === 'W2/stairs-up');
  const terrace = vec([-4.057, 3.455, 7.614]);
  fixture.cases.push(
    { name: 'W2/apartment-to-terrace', from: stairs.to.clone(), to: terrace },
    { name: 'W2/terrace-to-apartment', from: terrace.clone(), to: stairs.to.clone() },
    { name: 'W2/street-to-terrace', from: stairs.from.clone(), to: terrace.clone() },
  );
}
// All authored walking flights, including exterior chains and upper storeys.
// Short landing offsets avoid placing a fixture inside a back wall/partition.
export function addAccessCases(fixture) {
  const transform = new THREE.Matrix4().fromArray(fixture.meta.transform);
  const add = (name, from, to) => fixture.cases.push(
    { name: `access/${name}/up`, from, to },
    { name: `access/${name}/down`, from: to.clone(), to: from.clone() });
  for (const b of fixture.meta.buildings) {
    const s = b.spec;
    if (!s.enterable) continue;
    const entrance = fixture.cases.find(c => c.name === `${s.id}/entrance`);
    const street = entrance?.from.clone();
    if (street) {
      const outward = entrance.from.clone().sub(entrance.to); outward.y = 0;
      street.addScaledVector(outward.normalize(), .8);
      street.y = fixture.physics.groundHeight(street.x, street.z, entrance.from.y + .42) + .008;
    }
    let last = null;
    for (const fl of s.stairFlights ?? []) {
      const t = s.t ?? .34, w = s.w - 2 * t, d = s.d - 2 * t;
      const base = b.floorY[fl.floor] + (fl.floor === 0 ? (s.interiorFloors ? .16 : Math.max(.13, s.plinthH ?? .42)) : 0);
      const top = b.floorY[fl.floor + 1] ?? b.roofY;
      const run = Math.max(6, Math.round((top - base) / .19)) * (fl.run ?? .275);
      const x = s.x - w / 2 + fl.x * w, z = s.z - d / 2 + fl.z * d;
      const dx = Math.sin(fl.ry ?? 0), dz = Math.cos(fl.ry ?? 0);
      const from = vec([x - dx * .3, base + .008, z - dz * .3]).applyMatrix4(transform);
      last = vec([x + dx * (run + .35), top + .008, z + dz * (run + .35)]).applyMatrix4(transform);
      add(`${s.id}/flight-${fl.floor}`, from, last);
    }
    // W1/E2's intermediate rooms are intentionally unauthored/closed; their
    // exterior flights continue to the roof. W3/E3 open into the upper room.
    const fl = s.exteriorStairs?.at(-1);
    if (fl) {
      const side = fl.side, panel = new THREE.Matrix4().makeRotationY([0, -Math.PI / 2, Math.PI, Math.PI / 2][side]);
      panel.setPosition(s.x + (side === 1 ? s.w / 2 : side === 3 ? -s.w / 2 : 0), 0,
        s.z + (side === 2 ? s.d / 2 : side === 0 ? -s.d / 2 : 0));
      last = vec([fl.doorX, (b.floorY[fl.toFloor ?? 1] ?? b.roofY) + .008, .9]).applyMatrix4(panel).applyMatrix4(transform);
    }
    if (last && street) add(`${s.id}/street`, street, last);
  }
  // Real wave-1 spawns whose complete cross-map E4 routes exceed 12k nodes.
  const e4 = fixture.cases.find(c => c.name === 'access/E4/street/up').to;
  add('E4/cross-map-4', vec([13.825371742248535, .22342976927757263, 30.24120330810547]), e4.clone());
  add('E4/cross-map-6', vec([17.409814834594727, .10816293954849243, 26.929912567138672]), e4.clone());
  // Actual occupied upper-floor evidence, not just the top stair treads.
  add('W3/captured-room', fixture.cases.find(c => c.name === 'W3/entrance').from.clone(), vec([-15.147, 3.456, -6.893]));
  // 19:35:55 capture, t=279.959: W4's landing connected while this room did not.
  const w4 = fixture.cases.find(c => c.name === 'access/W4/street/up');
  const room = vec([-28.606, 3.456, -16.75]);
  add('W4/captured-room', w4.from.clone(), room);
  add('W4/landing-to-room', w4.to.clone(), room.clone());
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

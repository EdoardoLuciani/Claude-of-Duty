import assert from 'node:assert/strict';
import * as THREE from 'three';
import { ACTIONS } from '../src/core/input.js';
import { setCaseScale } from '../src/fx/shells.js';
import { WEAPON_DEFS, WEAPON_IDS, buildRecoilPattern } from '../src/weapons/defs.js';
import { Rng } from '../src/core/rng.js';
import { WeaponSystem } from '../src/weapons/index.js';

assert.deepEqual(WEAPON_IDS, ['rifle', 'smg', 'pistol', 'lmg']);
assert(WEAPON_IDS.every((id) => WEAPON_DEFS[id]));
// The LMG is a market purchase that replaces the rifle — there is no 4th slot.
assert(ACTIONS.swapWeapon.includes('Digit3') && !ACTIONS.swapWeapon.includes('Digit4'));
// The LMG stays in the def table so the market can sell it against the M4.
assert.equal(WEAPON_DEFS.lmg.label, 'EVOLYS-7.62');
assert.equal(WEAPON_DEFS.rifle.label, 'M4A1');

const lmg = WEAPON_DEFS.lmg;
assert.equal(lmg.magSize, 100);
assert.equal(lmg.reserve, 150);
const recoil = buildRecoilPattern(lmg, Rng);
assert.equal(recoil.length, lmg.recoil.patternLength * 2);
assert(recoil.every(Number.isFinite));
assert(recoil.every((n, i) => i % 2 || n > 0));

const scale = setCaseScale({}, 0.051, 0.01195 / 2);
assert(Math.abs(scale.lengthScale - 0.051 / 0.045) < 1e-9);
assert(Math.abs(scale.radiusScale - (0.01195 / 2) / 0.00495) < 1e-9);
assert.notEqual(scale.lengthScale, scale.radiusScale);

// ---- WeaponSystem loadout swap (the real API, not the market fake) -------
// The market smoke (tools/smoke-market.mjs) stubs `weapons`, so these checks
// drive the real WeaponSystem.equipPrimary / owns / weaponIds / refillAmmo /
// resetForNewGame path: regressions in the loadout swap (clip leftover, fresh
// ammo, ownership reset, refill scoped to owned guns) must fail CI. The rig
// itself needs a browser, so only the clip/active-mesh surface WeaponSystem
// talks to is stubbed.
const vm = {
  anchor: { visible: true },
  clip: null,
  clipName: null,
  clipT: 0,
  boltHold: 0,
  adsT: 0,
  adsTarget: 0,
  active: 'rifle',
  setActive(id) { this.active = id; return id; },
  play(name) { this.clip = { name, duration: 1 }; this.clipName = name; this.clipT = 0; return 1; },
  stopClip() { this.clip = null; this.clipName = null; this.clipT = 0; },
  endGrenade() {},
  muzzleWorld() { return { x: 0, y: 0, z: 0 }; },
  addRecoil() {},
};

const wp = new WeaponSystem();
wp.ctx = {
  time: { elapsed: 0, scale: 1 },
  camera: { quaternion: new THREE.Quaternion(), updateMatrixWorld() {} },
};
wp.rng = new Rng(0x1234abcd);
wp.sim = { spawn() {}, clear() {} };
wp.stats = { tris: 0, drawCalls: 0, live: 0, fired: 0 };
wp.viewmodel = vm;
// Same state construction as WeaponSystem.init(), minus the GLB load.
for (const id of WEAPON_IDS) {
  const def = { ...WEAPON_DEFS[id] };
  def.cycleTime = 60 / def.rpm;
  wp.states.set(id, {
    def,
    pattern: buildRecoilPattern(def, Rng),
    mag: def.magSize,
    chambered: true,
    reserve: def.reserve,
    mode: def.modes[0],
    modeIndex: 0,
  });
}

// Spawn loadout: rifle/smg/pistol owned, no 4th slot, rifle active.
assert.deepEqual(wp.weaponIds, ['rifle', 'smg', 'pistol']);
assert(wp.owns('rifle') && wp.owns('smg') && wp.owns('pistol') && !wp.owns('lmg'));
assert.equal(wp.activeId, 'rifle');

// Buying the LMG replaces the rifle, equips it immediately, fresh ammo.
assert.equal(wp.equipPrimary('lmg'), true);
assert(wp.owns('lmg') && !wp.owns('rifle'));
assert.deepEqual(wp.weaponIds, ['smg', 'pistol', 'lmg']);
assert.equal(wp.activeId, 'lmg');
assert.equal(wp.state.mag, WEAPON_DEFS.lmg.magSize);
assert.equal(wp.state.reserve, WEAPON_DEFS.lmg.reserve);
assert.equal(wp.state.chambered, true);
assert.equal(wp.equipPrimary('lmg'), false, 'cannot buy a weapon already equipped');

// Mid-reload purchase: the leftover reload clip must not keep the gun blocked.
wp.state.mag = 10; // below magSize so reload() starts a clip
assert.equal(wp.reload(), true);
assert.equal(wp.reloading, true);
assert.equal(wp.equipPrimary('rifle'), true, 'swap back to the M4');
assert.equal(wp.reloading, false, 'equipPrimary stops the in-flight reload clip');
assert.equal(wp.tryFire(), true, 'bought gun fires immediately — not clip-blocked');
assert.equal(wp.state.mag, WEAPON_DEFS.rifle.magSize - 1);

// Ammo refill and the aggregate fraction only count owned weapons.
wp.state.reserve = 10;
assert(wp.ammoFraction() < 1);
wp.refillAmmo();
assert.equal(wp.state.reserve, WEAPON_DEFS.rifle.reserve);
assert.equal(wp.ammoFraction(), 1);

// game:restart resets ownership, the active weapon and every state.
wp.equipPrimary('lmg');
wp.state.mag = 5;
wp.state.reserve = 0;
wp.resetForNewGame();
assert.deepEqual(wp.weaponIds, ['rifle', 'smg', 'pistol']);
assert.equal(wp.activeId, 'rifle');
assert.equal(wp.state.mag, WEAPON_DEFS.rifle.magSize);
assert.equal(wp.state.reserve, WEAPON_DEFS.rifle.reserve);
assert.equal(wp.reloading, false);

// ---------------------------------------------------------------------------
// Hand pose regression checks (issue #62): the viewmodel's build-time contact
// solve must keep the hands ON the guns — index tip on the trigger blade, the
// support hand's fingertips on the handguard/truss envelope, and the thumbs
// outside the grip volumes. These are the numbers that made the M4/LMG reads
// as "empty trigger guard, hand floating beside the gun"; if the grips or the
// poses drift, the fingers stop touching. The Viewmodel is pure THREE (no
// browser), so it is exercised here with stubbed materials, exactly like the
// preview harness does.
// ---------------------------------------------------------------------------
import { Viewmodel } from '../src/weapons/viewmodel.js';
import { buildRifle } from '../src/weapons/models/rifle.js';
import { buildLmg } from '../src/weapons/models/lmg.js';

const vmCtx = {
  scene: new THREE.Scene(),
  camera: new THREE.PerspectiveCamera(60, 16 / 9, 0.004, 60),
  viewScene: new THREE.Scene(),
  viewCamera: new THREE.PerspectiveCamera(60, 16 / 9, 0.004, 60),
  canvas: null,
  config: { quality: 'ultra', q: {} },
  events: {
    handlers: new Map(),
    on(t, f) { (this.handlers.get(t) ?? this.handlers.set(t, new Set()).get(t)).add(f); return () => this.handlers.get(t)?.delete(f); },
    emit(t, p) { for (const f of this.handlers.get(t) ?? []) f(p); },
  },
  time: { elapsed: 0, dt: 1 / 60, frame: 0 },
  rng: new Rng(0xbeef1234),
  get: () => null,
  peek: () => null,
  has: () => false,
};
const vmMats = {
  lib: null, // no mask baking in Node — the geometry paths still run
  get: () => new THREE.MeshStandardMaterial(),
  reticle: () => new THREE.MeshBasicMaterial(),
  reticleOutline: () => new THREE.MeshBasicMaterial(),
};
const vm2 = new Viewmodel(vmCtx, vmMats);
for (const id of ['rifle', 'lmg']) {
  const def = { ...WEAPON_DEFS[id] };
  def.cycleTime = 60 / def.rpm;
  vm2.addWeapon(id === 'rifle' ? buildRifle() : buildLmg(), def);
}

const _inv = new THREE.Matrix4();
const _p = new THREE.Vector3();

function measureHands(id) {
  vm2.setActive(id);
  vm2.update(1 / 60, { ads: 0, sprint: 0, lowReady: false, speed: 0, crouch: false, airborne: false, trigger: 0, empty: false });
  vm2.rig.updateMatrixWorld(true);
  _inv.copy(vm2.rig.matrixWorld).invert();
  const w = vm2.active;
  const toLocal = (v) => _p.copy(v).applyMatrix4(_inv);
  const out = {};
  for (const arm of [vm2.armR, vm2.armL]) {
    arm.hand.updateMatrixWorld(true);
    const tips = [];
    for (let i = 0; i < 4; i++) {
      const f = arm.fingers[i];
      const tl = new THREE.Vector3(0, -arm._segRadius[i][3] * 1.05, -arm._segLength[i][2] * 0.5);
      f.joints[2].updateMatrixWorld(true);
      tips.push(toLocal(new THREE.Vector3(tl.x, tl.y, tl.z).applyMatrix4(f.joints[2].matrixWorld)).clone());
    }
    arm.thumb.joints[1].updateMatrixWorld(true);
    const tL = new THREE.Vector3(0, -0.0078 * 1.05, -0.032 * 0.55);
    const thumb = toLocal(new THREE.Vector3(tL.x, tL.y, tL.z).applyMatrix4(arm.thumb.joints[1].matrixWorld)).clone();
    if (arm === vm2.armR) { out.rtips = tips; out.rthumb = thumb; } else { out.ltips = tips; out.lthumb = thumb; }
  }
  out.pivot = w.model.nodes.triggerPivot.pos;
  out.hg = w.model.nodes.handguard;
  return out;
}

/* ---- point-to-triangle distance over the real grip meshes -----------------
 * The weapon's polymer + rubber meshes build from the grip assemblies (the
 * LMG's extruded slab + rubber pad, the rifle's addPistolGrip core/panel/
 * ridges), so the nearest surface to a firing fingertip IS the grip. A
 * closest-vertex search is not enough: the extruded profile has few vertices
 * along its sides, and the trigger blade / mag meshes sit within a few mm of
 * the hand — both would mask a finger hanging in the air. These helpers walk
 * the actual triangles allocation-free.
 */
const _vA = new THREE.Vector3();
const _vB = new THREE.Vector3();
const _vC = new THREE.Vector3();
const _vE0 = new THREE.Vector3();
const _vE1 = new THREE.Vector3();
const _vN = new THREE.Vector3();
const _vP = new THREE.Vector3();
const _vQ = new THREE.Vector3();
const _vS = new THREE.Vector3();

function segPointDist(p, a, b) {
  _vE0.subVectors(b, a);
  const l2 = _vE0.lengthSq();
  const t = l2 > 1e-14 ? Math.max(0, Math.min(1, _vS.copy(p).sub(a).dot(_vE0) / l2)) : 0;
  _vS.copy(a).addScaledVector(_vE0, t);
  return p.distanceTo(_vS);
}

function triPointDist(p, a, b, c) {
  _vE0.subVectors(b, a);
  _vE1.subVectors(c, a);
  _vN.crossVectors(_vE0, _vE1);
  const n2 = _vN.lengthSq();
  if (n2 < 1e-14) {
    return Math.min(segPointDist(p, a, b), segPointDist(p, b, c), segPointDist(p, c, a));
  }
  const n = Math.sqrt(n2);
  _vN.multiplyScalar(1 / n);
  _vP.copy(p).sub(a);
  const d = _vP.dot(_vN); // signed plane distance
  _vQ.copy(p).addScaledVector(_vN, -d); // projection onto the triangle plane
  _vP.copy(_vQ).sub(a);
  // Barycentric weights of the projection (u for b, v for c), as area ratios.
  const u = _vS.copy(_vP).cross(_vE1).dot(_vN) / n;
  const v = _vS.copy(_vE0).cross(_vP).dot(_vN) / n;
  const w = 1 - u - v;
  if (u >= -1e-4 && v >= -1e-4 && w >= -1e-4) return Math.abs(d);
  return Math.min(segPointDist(p, a, b), segPointDist(p, b, c), segPointDist(p, c, a));
}

/** Nearest distance from a rig-space point to a set of weapon meshes. */
function surfaceDist(pt, meshes) {
  let best = Infinity;
  for (const mesh of meshes) {
    const pos = mesh.geometry.getAttribute('position');
    const idx = mesh.geometry.getIndex();
    const n = idx ? idx.count : pos.count;
    for (let i = 0; i < n; i += 3) {
      const ia = idx ? idx.array[i] : i;
      const ib = idx ? idx.array[i + 1] : i + 1;
      const ic = idx ? idx.array[i + 2] : i + 2;
      _vA.fromBufferAttribute(pos, ia);
      _vB.fromBufferAttribute(pos, ib);
      _vC.fromBufferAttribute(pos, ic);
      const d = triPointDist(pt, _vA, _vB, _vC);
      if (d < best) {
        best = d;
        if (best < 1e-6) return 0;
      }
    }
  }
  return best;
}

// Rifle: index tip rests on the trigger blade (pad ~16 mm below the pivot,
// blade is a 7.2 mm plate at the pivot's x/z); support fingertips sit on the
// 27.1 mm handguard cylinder, inside its z-range, all relative to the
// handguard's own axis (hg.axis — never a hardcoded bore height).
{
  const m = measureHands('rifle');
  const w = vm2.active;
  const t = m.rtips[0];
  assert(Math.abs(t.x) < 0.012, `rifle index tip near the trigger blade, got x=${t.x.toFixed(3)}`);
  assert(Math.abs(t.y - (m.pivot[1] - 0.016)) < 0.012, `rifle index tip at trigger pad height, got y=${t.y.toFixed(3)}`);
  assert(Math.abs(t.z - m.pivot[2]) < 0.012, `rifle index tip at the blade's z, got z=${t.z.toFixed(3)}`);
  for (const tip of m.ltips) {
    const d = Math.hypot(tip.x - m.hg.axis[0], tip.y - m.hg.axis[1]); // handguard cylinder
    assert(d < m.hg.r + 0.005, `rifle support fingertip on the handguard, got ${d.toFixed(3)} vs r ${m.hg.r}`);
    const z0 = Math.max(m.hg.z0, m.hg.z1);
    const z1 = Math.min(m.hg.z0, m.hg.z1);
    assert(tip.z <= z0 + 0.008 && tip.z >= z1 - 0.008, `rifle support fingertip inside the handguard z-range [${z1.toFixed(3)}, ${z0.toFixed(3)}], got z=${tip.z.toFixed(3)}`);
  }
  assert(m.rthumb.x < -0.016, `rifle thumb wraps the LEFT flank, got x=${m.rthumb.x.toFixed(3)}`);
  // The three lower firing fingers must rest ON the grip surface — this is
  // the check that caught the LMG pinky hanging ~18 mm behind the backstrap.
  const gripMeshes = w.meshes.filter((mesh) => /-body-(polymer|rubber)/.test(mesh.name));
  for (let i = 1; i < 4; i++) {
    const d = surfaceDist(m.rtips[i], gripMeshes);
    assert(d < 0.005, `rifle firing finger ${i} rests on the grip, got ${d.toFixed(3)} m off`);
  }
}

// LMG: same trigger rule; support fingertips sit on the truss envelope
// (r 0.017 cylinder on the bore axis); thumb clear of the box side.
{
  const m = measureHands('lmg');
  const w = vm2.active;
  const t = m.rtips[0];
  assert(Math.abs(t.x) < 0.012, `lmg index tip near the trigger blade, got x=${t.x.toFixed(3)}`);
  assert(Math.abs(t.y - (m.pivot[1] - 0.016)) < 0.012, `lmg index tip at trigger pad height, got y=${t.y.toFixed(3)}`);
  assert(Math.abs(t.z - m.pivot[2]) < 0.012, `lmg index tip at the blade's z, got z=${t.z.toFixed(3)}`);
  for (const tip of m.ltips) {
    const d = Math.hypot(tip.x - m.hg.axis[0], tip.y - m.hg.axis[1]);
    assert(d < m.hg.r + 0.005, `lmg support fingertip on the truss, got ${d.toFixed(3)} vs r ${m.hg.r}`);
    const z0 = Math.max(m.hg.z0, m.hg.z1);
    const z1 = Math.min(m.hg.z0, m.hg.z1);
    assert(tip.z <= z0 + 0.008 && tip.z >= z1 - 0.008, `lmg support fingertip inside the truss z-range [${z1.toFixed(3)}, ${z0.toFixed(3)}], got z=${tip.z.toFixed(3)}`);
  }
  assert(m.rthumb.x < -0.015, `lmg thumb rides the left flank, got x=${m.rthumb.x.toFixed(3)}`);
  const gripMeshes = w.meshes.filter((mesh) => /-body-(polymer|rubber)/.test(mesh.name));
  for (let i = 1; i < 4; i++) {
    const d = surfaceDist(m.rtips[i], gripMeshes);
    assert(d < 0.005, `lmg firing finger ${i} rests on the grip, got ${d.toFixed(3)} m off`);
  }
}

// ---- grenade / radio round-trip: the firing grip must survive ------------
// The grenade and radio holds switch the right hand to `wrap`; endGrenade /
// endRadio / the post-throw draw must put the per-weapon firing pose back.
// Regression: before the fix the M4/LMG stayed in the closed fist (the
// original over-curl) until the next weapon swap.
{
  const step = () =>
    vm2.update(1 / 60, { ads: 0, sprint: 0, lowReady: false, speed: 0, crouch: false, airborne: false, trigger: 0, empty: false });
  vm2.setActive('lmg');
  step();
  assert.equal(vm2.armR.pose, 'gripLmg', 'LMG firing hand starts on gripLmg');
  vm2.holdGrenade();
  step();
  assert.equal(vm2.armR.pose, 'wrap', 'grenade hold wraps the hand');
  vm2.endGrenade();
  step();
  assert.equal(vm2.armR.pose, 'gripLmg', 'endGrenade restores the firing grip');
  vm2.holdRadio();
  step();
  assert.equal(vm2.armR.pose, 'wrap', 'radio hold wraps the hand');
  vm2.endRadio();
  step();
  assert.equal(vm2.armR.pose, 'gripLmg', 'endRadio restores the firing grip');
  // A full throw: the release beat and the draw clip after it must also leave
  // the firing hand back on the grip.
  vm2.holdGrenade();
  vm2.throwGrenade('long');
  vm2.onClipEvent = () => {};
  for (let i = 0; i < 120; i++) step();
  assert.equal(vm2._grenadeState, 0, 'the throw completes');
  assert.equal(vm2.armR.pose, 'gripLmg', 'the post-throw draw restores the firing grip');
}
vm2.dispose?.();

console.log('LMG smoke checks passed');

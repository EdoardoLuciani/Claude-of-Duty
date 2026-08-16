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
// Hand-pose regression (issue #62): index on the trigger, support hand on the
// handguard/truss (not the LMG belt box), firing fingers on the grip, radio
// sitting in the palm (not behind the glove), and the firing pose surviving
// grenade/radio. The Viewmodel is pure THREE, so it runs here with stubbed
// materials — same pattern as the weapons preview harness.
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
    on(t, f) {
      (this.handlers.get(t) ?? this.handlers.set(t, new Set()).get(t)).add(f);
      return () => this.handlers.get(t)?.delete(f);
    },
    emit(t, p) {
      for (const f of this.handlers.get(t) ?? []) f(p);
    },
  },
  time: { elapsed: 0, dt: 1 / 60, frame: 0 },
  rng: new Rng(0xbeef1234),
  get: () => null,
  peek: () => null,
  has: () => false,
};
const vmMats = {
  lib: null,
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
const _vA = new THREE.Vector3();
const _vB = new THREE.Vector3();
const _vC = new THREE.Vector3();
const _vE0 = new THREE.Vector3();
const _vE1 = new THREE.Vector3();
const _vN = new THREE.Vector3();
const _vS = new THREE.Vector3();

function tipOf(arm, i) {
  const f = arm.fingers[i];
  const tl = new THREE.Vector3(0, -arm._segRadius[i][3] * 1.05, -arm._segLength[i][2] * 0.5);
  f.joints[2].updateMatrixWorld(true);
  return _p.copy(tl).applyMatrix4(f.joints[2].matrixWorld).applyMatrix4(_inv).clone();
}
function thumbOf(arm) {
  arm.thumb.joints[1].updateMatrixWorld(true);
  const tL = new THREE.Vector3(0, -0.0078 * arm.scale * 1.05, -0.032 * arm.scale * 0.55);
  return _p.copy(tL).applyMatrix4(arm.thumb.joints[1].matrixWorld).applyMatrix4(_inv).clone();
}
function measureHands(id) {
  vm2.setActive(id);
  vm2.update(1 / 60, {
    ads: 0, sprint: 0, lowReady: false, speed: 0, crouch: false, airborne: false, trigger: 0, empty: false,
  });
  vm2.rig.updateMatrixWorld(true);
  _inv.copy(vm2.rig.matrixWorld).invert();
  const rtips = [0, 1, 2, 3].map((i) => tipOf(vm2.armR, i));
  const ltips = [0, 1, 2, 3].map((i) => tipOf(vm2.armL, i));
  return {
    w: vm2.active,
    rtips,
    ltips,
    rthumb: thumbOf(vm2.armR),
    lthumb: thumbOf(vm2.armL),
    pivot: vm2.active.model.nodes.triggerPivot.pos,
    hg: vm2.active.model.nodes.handguard,
  };
}

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
  if (n2 < 1e-14) return Math.min(segPointDist(p, a, b), segPointDist(p, b, c), segPointDist(p, c, a));
  const n = Math.sqrt(n2);
  _vN.multiplyScalar(1 / n);
  const d = _vS.copy(p).sub(a).dot(_vN);
  const q = p.clone().addScaledVector(_vN, -d);
  const u = _vS.copy(q).sub(a).cross(_vE1).dot(_vN) / n;
  const v = _vS.copy(_vE0).cross(_vS.copy(q).sub(a)).dot(_vN) / n;
  const ww = 1 - u - v;
  if (u >= -1e-4 && v >= -1e-4 && ww >= -1e-4) return Math.abs(d);
  return Math.min(segPointDist(p, a, b), segPointDist(p, b, c), segPointDist(p, c, a));
}
/** Nearest triangle inside `bounds` (weapon-local AABB) of the given meshes. */
function surfaceDistIn(pt, meshes, bounds) {
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
      const cx = (_vA.x + _vB.x + _vC.x) / 3;
      const cy = (_vA.y + _vB.y + _vC.y) / 3;
      const cz = (_vA.z + _vB.z + _vC.z) / 3;
      if (cx < bounds.x0 || cx > bounds.x1 || cy < bounds.y0 || cy > bounds.y1 || cz < bounds.z0 || cz > bounds.z1) {
        continue;
      }
      const d = triPointDist(pt, _vA, _vB, _vC);
      if (d < best) best = d;
    }
  }
  return best;
}

const RIFLE_GRIP = { x0: -0.03, x1: 0.03, y0: -0.09, y1: 0.08, z0: -0.04, z1: 0.07 };
const LMG_GRIP = { x0: -0.03, x1: 0.03, y0: -0.08, y1: 0.07, z0: -0.04, z1: 0.09 };

{
  const m = measureHands('rifle');
  const t = m.rtips[0];
  assert(Math.abs(t.x) < 0.014, `rifle index near the trigger blade, got x=${t.x.toFixed(3)}`);
  assert(Math.abs(t.y - (m.pivot[1] - 0.016)) < 0.014, `rifle index at trigger-pad height, got y=${t.y.toFixed(3)}`);
  assert(Math.abs(t.z - m.pivot[2]) < 0.014, `rifle index at the blade z, got z=${t.z.toFixed(3)}`);
  for (const tip of m.ltips) {
    const d = Math.hypot(tip.x - m.hg.axis[0], tip.y - m.hg.axis[1]);
    assert(d < m.hg.r + 0.006, `rifle support fingertip on the handguard, got ${d.toFixed(3)} vs r ${m.hg.r}`);
    const z0 = Math.max(m.hg.z0, m.hg.z1);
    const z1 = Math.min(m.hg.z0, m.hg.z1);
    assert(tip.z <= z0 + 0.01 && tip.z >= z1 - 0.01, `rifle support fingertip in handguard z-range, got z=${tip.z.toFixed(3)}`);
  }
  {
    const d = Math.hypot(m.lthumb.x - m.hg.axis[0], m.lthumb.y - m.hg.axis[1]);
    assert(d < m.hg.r + 0.006, `rifle support thumb on the handguard, got ${d.toFixed(3)} vs r ${m.hg.r}`);
  }
  assert(m.rthumb.x < -0.012, `rifle thumb wraps the left flank, got x=${m.rthumb.x.toFixed(3)}`);
  const gripMeshes = m.w.meshes.filter((mesh) => /-body-(polymer|rubber)$/.test(mesh.name));
  for (let i = 1; i < 4; i++) {
    const d = surfaceDistIn(m.rtips[i], gripMeshes, RIFLE_GRIP);
    assert(d < 0.006, `rifle firing finger ${i} on the grip, got ${d.toFixed(3)} m off`);
  }
}

{
  const m = measureHands('lmg');
  const t = m.rtips[0];
  assert(Math.abs(t.x) < 0.014, `lmg index near the trigger blade, got x=${t.x.toFixed(3)}`);
  assert(Math.abs(t.y - (m.pivot[1] - 0.016)) < 0.014, `lmg index at trigger-pad height, got y=${t.y.toFixed(3)}`);
  assert(Math.abs(t.z - m.pivot[2]) < 0.014, `lmg index at the blade z, got z=${t.z.toFixed(3)}`);
  // Support hand lives on the truss, FORWARD of the belt box (box front ≈ -0.168).
  for (const tip of m.ltips) {
    assert(tip.z < -0.18, `lmg support fingertip forward of the belt box, got z=${tip.z.toFixed(3)}`);
    const z0 = Math.max(m.hg.z0, m.hg.z1);
    const z1 = Math.min(m.hg.z0, m.hg.z1);
    assert(tip.z <= z0 + 0.012 && tip.z >= z1 - 0.012, `lmg support fingertip in truss z-range, got z=${tip.z.toFixed(3)}`);
  }
  {
    const d = Math.hypot(m.lthumb.x - m.hg.axis[0], m.lthumb.y - m.hg.axis[1]);
    assert(d < m.hg.r + 0.01, `lmg support thumb near the truss, got ${d.toFixed(3)} vs r ${m.hg.r}`);
  }
  assert(m.rthumb.x < -0.012, `lmg thumb rides the left flank, got x=${m.rthumb.x.toFixed(3)}`);
  const gripMeshes = m.w.meshes.filter((mesh) => /-body-(polymer|rubber)$/.test(mesh.name));
  for (let i = 1; i < 4; i++) {
    const d = surfaceDistIn(m.rtips[i], gripMeshes, LMG_GRIP);
    assert(d < 0.006, `lmg firing finger ${i} on the grip, got ${d.toFixed(3)} m off`);
  }
}

// Grenade / radio must not leave the firing hand in wrap.
{
  const step = () =>
    vm2.update(1 / 60, {
      ads: 0, sprint: 0, lowReady: false, speed: 0, crouch: false, airborne: false, trigger: 0, empty: false,
    });
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
  assert.equal(vm2.armR.pose, 'radio', 'radio hold uses the radio pose');
  assert.equal(vm2.radio.visible, true, 'radio mesh is drawn');
  // Palm-side of the hand (hand-local -Y). Behind-the-glove was +Y / +Z.
  assert(vm2.radio.position.y < 0, `radio sits in the palm, got y=${vm2.radio.position.y}`);
  // Fingers must not punch through the 52×98×34 mm brick — that was the
  // leftover peek-through after the radio was brought in front of the glove.
  {
    vm2.rig.updateMatrixWorld(true);
    const rInv = new THREE.Matrix4().copy(vm2.radio.matrixWorld).invert();
    const q = new THREE.Vector3();
    const BODY = { x: 0.024, y0: 0.010, y1: 0.102, z: 0.015 };
    const names = ['index', 'middle', 'ring', 'pinky'];
    for (let i = 0; i < 4; i++) {
      const f = vm2.armR.fingers[i];
      const rr = vm2.armR._segRadius[i];
      const ll = vm2.armR._segLength[i];
      const samples = [
        [f.joints[0], 0, 0, -ll[0] * 0.5, 'prox'],
        [f.joints[1], 0, 0, -ll[1] * 0.5, 'mid'],
        [f.joints[2], 0, -rr[3] * 1.05, -ll[2] * 0.5, 'pad'],
      ];
      for (const [joint, lx, ly, lz, part] of samples) {
        q.set(lx, ly, lz).applyMatrix4(joint.matrixWorld).applyMatrix4(rInv);
        const inBody = Math.abs(q.x) < BODY.x && q.y > BODY.y0 && q.y < BODY.y1 && Math.abs(q.z) < BODY.z;
        assert(
          !inBody,
          `radio ${names[i]} ${part} must stay outside the body, got (${q.x.toFixed(3)}, ${q.y.toFixed(3)}, ${q.z.toFixed(3)})`
        );
      }
    }
  }
  vm2.endRadio();
  step();
  assert.equal(vm2.armR.pose, 'gripLmg', 'endRadio restores the firing grip');
  vm2.holdGrenade();
  vm2.throwGrenade('long');
  vm2.onClipEvent = () => {};
  for (let i = 0; i < 120; i++) step();
  assert.equal(vm2._grenadeState, 0, 'the throw completes');
  assert.equal(vm2.armR.pose, 'gripLmg', 'the post-throw draw restores the firing grip');
}
vm2.dispose?.();

console.log('LMG smoke checks passed');

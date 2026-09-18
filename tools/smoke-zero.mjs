// Weapon zero contract: the fired direction must CROSS the sight line at the
// weapon's `zeroRange` (see `tryFire`), not run parallel below it — the MCX
// VIRTUS was 68 cm low at 100 m. Each shot is taken from the real WeaponSystem
// in full ADS, then flown through the real ProjectileSim.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { makeMCXModel, MCX_URL } from '../src/weapons/mcx.js';
import { WEAPON_DEFS, WEAPON_IDS, buildRecoilPattern } from '../src/weapons/defs.js';
import { ProjectileSim, dropAt } from '../src/weapons/ballistics.js';
import { Viewmodel } from '../src/weapons/viewmodel.js';
import { WeaponSystem } from '../src/weapons/index.js';
import { buildRifle } from '../src/weapons/models/rifle.js';
import { buildSmg } from '../src/weapons/models/smg.js';
import { buildLmg } from '../src/weapons/models/lmg.js';
import { buildSniper } from '../src/weapons/models/sniper.js';
import { buildShotgun } from '../src/weapons/models/shotgun.js';
import { buildPistol } from '../src/weapons/models/pistol.js';
import { FIXED_DT } from '../src/core/config.js';
import { Rng } from '../src/core/rng.js';

const bytes = readFileSync(new URL(MCX_URL));
const loader = new GLTFLoader().register(() => ({
  name: 'SMOKE_TEXTURE', loadTexture: () => Promise.resolve(new THREE.Texture()),
}));
const gltf = await loader.parseAsync(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), '');
const MODELS = {
  mcx: makeMCXModel(gltf),
  rifle: buildRifle(), smg: buildSmg(), lmg: buildLmg(),
  sniper: buildSniper(), shotgun: buildShotgun(), pistol: buildPistol(),
};

/** Fire one round in full ADS and return the payload the sim would receive. */
function firedShot(id) {
  const camera = new THREE.PerspectiveCamera(80, 16 / 9, 0.004, 60);
  const ctx = {
    viewScene: new THREE.Scene(), camera, viewCamera: camera, rng: new Rng(0x5eed),
    time: { elapsed: 0, scale: 1 }, events: { emit() {} },
  };
  const vm = new Viewmodel(ctx, {
    get: () => new THREE.MeshStandardMaterial(),
    reticle: () => new THREE.MeshBasicMaterial(),
    reticleOutline: () => new THREE.MeshBasicMaterial(),
  });
  const def = { ...WEAPON_DEFS[id], cycleTime: 60 / WEAPON_DEFS[id].rpm };
  vm.addWeapon(MODELS[id], def);
  const wp = new WeaponSystem();
  wp.ctx = ctx;
  wp.rng = ctx.rng;
  wp.viewmodel = vm;
  const shots = [];
  wp.sim = { spawn: o => shots.push({ origin: o.origin.clone(), dir: o.dir.clone(), speed: o.speed, dragK: o.dragK }), clear() {} };
  wp.stats = { tris: 0, drawCalls: 0, live: 0, fired: 0 };
  for (const wid of WEAPON_IDS) {
    const d = { ...WEAPON_DEFS[wid], cycleTime: 60 / WEAPON_DEFS[wid].rpm };
    wp.states.set(wid, { def: d, pattern: buildRecoilPattern(d, Rng), mag: d.magSize, chambered: true, reserve: d.reserve, mode: d.modes[0], modeIndex: 0 });
  }
  vm.onClipEvent = (name, clip) => wp._onClipEvent(name, clip);
  // Full ADS from the settled pose, then the specific weapon (debugPose pins
  // the rifle). Spread is zeroed: this measures the systematic term.
  wp.debugPose('ads');
  wp.setWeaponImmediate(id);
  wp._spread = 0;
  for (let i = 0; i < 8; i++) {
    ctx.time.elapsed += FIXED_DT;
    wp._fireTimer = 0;
    wp.lateUpdate(FIXED_DT, ctx);
  }
  assert.equal(wp.adsProgress, 1, `${id}: ADS must be fully engaged`);
  assert(wp.tryFire(), `${id}: fires`);
  vm.dispose();
  return shots.at(-1);
}

/**
 * Height (m) of a captured round where it crosses the plane `range` metres
 * downrange, flown by the real ProjectileSim. The harness camera never moves,
 * so the aim ray runs through it along -Z at x = y = 0.
 */
function crossing(shot, range) {
  const sim = new ProjectileSim({ peek: () => null, events: { emit() {} } });
  sim.spawn({ origin: shot.origin, dir: shot.dir, speed: shot.speed, dragK: shot.dragK, maxRange: 5000 });
  const p = sim.live[0];
  while (p.alive && -p.pos.z < range) sim.fixedUpdate(FIXED_DT);
  assert(-p.pos.z >= range, 'round reaches the zero plane');
  const f = (-range - p.prev.z) / (p.pos.z - p.prev.z);
  return p.prev.y + (p.pos.y - p.prev.y) * f;
}

// Every def declares its zero, not just the mounted ones: `zeroRange` is
// required data (a missing one would NaN the departure direction).
for (const id of Object.keys(WEAPON_DEFS)) {
  assert(WEAPON_DEFS[id].zeroRange > 0, `${id}: declared zero`);
}
for (const id of WEAPON_IDS) {
  const def = WEAPON_DEFS[id];
  assert(dropAt(def, def.zeroRange) > 0, `${id}: the zero rise comes from real drop`);
  const shot = firedShot(id);
  // 10 mm: the pre-fix bore-parallel shot was off by the whole sight height
  // (24-91 mm across the lineup).
  const atZero = crossing(shot, def.zeroRange);
  assert(Math.abs(atZero) < 0.01, `${id}: crosses the sight line at ${def.zeroRange} m (${(atZero * 100).toFixed(1)} cm)`);
  // Past the zero the round must fall away: the zero is not a ray-cast.
  const past = crossing(shot, Math.min(def.zeroRange * 2, def.maxRange));
  assert(past <= -0.01, `${id}: drops past the zero (${(past * 100).toFixed(1)} cm at ${Math.min(def.zeroRange * 2, def.maxRange)} m)`);
}
console.log('Weapon zero checks passed: all seven rounds cross the sight line at their declared zero and drop past it');

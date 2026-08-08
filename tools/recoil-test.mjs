#!/usr/bin/env node
/**
 * Headless regression test for the recoil hold model.
 *
 * Exercises the REAL CameraRig pipeline (update + applyTo) with a movement
 * stub: real weapon defs, real deterministic pattern, real ±88° pitch clamp.
 *
 *   node tools/recoil-test.mjs
 *
 * Asserts, per the agreed model:
 *   - the sightline accumulates every shot and climbs until the camera's
 *     physical top (CAMERA.pitchLimit, 88°), then stops — and ONLY there
 *   - the camera is never "locked": the mouse moves the view 1:1 wherever
 *     the clamp allows; countering works exactly as designed
 *   - the documented extreme: ~4+ un-countered mags exceed the mouse's
 *     countering range, so the horizon becomes the floor until respawn
 *   - yaw is free (wraps), roll decays, respawn resets, transients
 *     (landing/kick channel) never touch the sightline
 */
import * as THREE from 'three';
import { CameraRig } from '../src/player/camera.js';
import { CAMERA } from '../src/player/tuning.js';
import { WEAPON_DEFS, buildRecoilPattern } from '../src/weapons/defs.js';
import { Rng } from '../src/core/rng.js';

const LIMIT = CAMERA.pitchLimit; // ±88° — the only ceiling
const DEG = Math.PI / 180;
const deg = (a) => (a * 180 / Math.PI).toFixed(1) + '°';
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const near = (v, target, eps = 0.5) => Math.abs(v - target) <= eps * DEG;

let pass = 0, fail = 0;
const check = (name, ok, detail = '') => {
  if (ok) { pass++; console.log(`  ✅ ${name}`); }
  else { fail++; console.log(`  ❌ ${name} ${detail}`); }
};

// ---- fixtures -------------------------------------------------------------
const def = WEAPON_DEFS.rifle;
const pat = buildRecoilPattern(def, Rng);

function makeCtx() {
  return { config: { fov: 90, adsFovScale: 0.74 }, time: { alpha: 0 }, camera: new THREE.PerspectiveCamera() };
}
function makeRig() {
  const rig = new CameraRig(makeCtx());
  rig.reset(1.66);
  return rig;
}
/** Movement stub with everything CameraRig.update reads. */
function makeM(over = {}) {
  return {
    eyeHeight: 1.66, sliding: false, slideProgress: 0, stance: 'stand',
    cmd: { moveX: 0, moveY: 0 }, grounded: true, yawRate: 0, velocity: { y: 0 },
    horizontalSpeed: 0, tacticalSprint: false, sprinting: false, airborne: false,
    leanAmount: 0, leanOffsetX: 0, leanOffsetZ: 0, pitch: 0, yaw: 0,
    stepPhase: 0, adsAmount: 0,
    mantleMotion: { active: false, camY: 0, camForward: 0, camPitch: 0, camRoll: 0 },
    sampleRender: () => ({ x: 0, y: 0, z: 0 }),
    ...over,
  };
}
const health = { fraction: 1, suppression: 0 };
const step = (rig, m = makeM(), n = 1, dt = 1 / 60) => {
  for (let i = 0; i < n; i++) rig.update(dt, m, health);
};
/** Fire one shot with the real pattern (index saturates at the pattern end). */
function fire(rig, shotIndex) {
  const idx = Math.min(shotIndex, def.recoil.patternLength - 1);
  rig.addRecoil(pat[idx * 2], pat[idx * 2 + 1], def.recoil.roll * 0.24, def.recoil.punch);
}
/** Fire a full mag (30 rounds) without touching the mouse. */
function fireMag(rig, mag) {
  for (let i = 0; i < def.magSize; i++) fire(rig, (mag - 1) * def.magSize + i);
}
/** Read the assembled camera pitch for a given mouse pitch. */
function viewPitch(rig, mousePitchDeg) {
  const m = makeM({ pitch: mousePitchDeg * DEG });
  step(rig, m, 2);
  return rig.rotation.x; // clamped total, exactly what the engine camera gets
}

console.log('recoil hold model — regression test\n');

// ==========================================================================
console.log('1. Climb & ceiling: the weapon keeps climbing and stops at the top');
// ==========================================================================
{
  const rig = makeRig();
  let prev = 0;
  for (let mag = 1; mag <= 6; mag++) {
    fireMag(rig, mag);
    const v = viewPitch(rig, 0); // mouse at 0, read the composed camera
    const climbed = v > prev;    // every mag added climb — until the top
    if (v < LIMIT - 1 * DEG) check(`mag ${mag}: climbed to ${deg(v)} (was ${deg(prev)})`, climbed);
    else check(`mag ${mag}: pinned at ceiling ${deg(v)} — no more climb (correct, it is straight up)`, near(v, LIMIT, 1));
    prev = v;
  }
  // keep firing forever: view must never move past the ceiling, never jitter
  const before = rig.rotation.x;
  for (let i = 0; i < 90; i++) fire(rig, 1000 + i);
  step(rig, makeM(), 2);
  check('90 more rounds at the ceiling: view unchanged', near(rig.rotation.x, before, 0.01), `(${deg(rig.rotation.x)})`);
  check('recoil accumulator still grows (no artificial cap)', rig.recoilPitch > LIMIT, `(${deg(rig.recoilPitch)})`);
}

// ==========================================================================
console.log('\n2. No lock after a few shots: mouse sweeps the full range');
// ==========================================================================
{
  const rig = makeRig();
  fireMag(rig, 1); // 26.4° of hold
  const held = rig.recoilPitch;
  console.log(`  (1 un-countered mag → ${deg(held)} of hold)`);
  let responsive = true;
  let last = null;
  for (let mouse = -88; mouse <= 88; mouse += 8) {
    const v = viewPitch(rig, mouse);
    const expected = clamp(mouse * DEG + held, -LIMIT, LIMIT);
    if (!near(v, expected, 1.2)) responsive = false;
    // strictly follows the mouse — except the legitimate plateau at the
    // ceiling, where consecutive samples are allowed to be equal
    if (last !== null && v < last - 0.05 * DEG) responsive = false;
    last = v;
  }
  check('mouse sweeps −88°..+88°: camera follows 1:1 wherever the clamp allows', responsive);
  check('down-look still reaches well below the horizon', viewPitch(rig, -88) < -60 * DEG, `(${deg(viewPitch(rig, -88))})`);
}

// ==========================================================================
console.log('\n3. Camera freedom after shooting a LOT (6 un-countered mags)');
// ==========================================================================
{
  const rig = makeRig();
  for (let mag = 1; mag <= 6; mag++) fireMag(rig, mag);
  const held = rig.recoilPitch;
  console.log(`  (6 mags, no countering → accumulator ${deg(held)}, documented extreme)`);
  // the mouse must still move the camera 1:1 over the whole remaining range
  let responsive = true;
  let last = null;
  for (let mouse = -88; mouse <= 88; mouse += 8) {
    const v = viewPitch(rig, mouse);
    const expected = clamp(mouse * DEG + held, -LIMIT, LIMIT);
    if (!near(v, expected, 1.2)) responsive = false;
    if (last !== null && v < last - 0.01 * DEG) responsive = false;
    last = v;
  }
  check('mouse moves the camera across every remaining degree (never hard-locked)', responsive);
  const floor = viewPitch(rig, -88);
  console.log(`  trade: at max hold the camera sits at ${deg(floor)} with the mouse fully down (horizon unreachable — the agreed consequence)`);
  check('documented trade holds: floor above horizon after 6 un-countered mags', floor > 0);
  // countering still works within the range: in the responsive region
  // (below the ceiling) a 30° mouse pull moves the camera exactly 30°
  const a = viewPitch(rig, -88), b = viewPitch(rig, -58); // pull up 30°
  check('pull up 30° in the responsive range → camera rises 30° (1:1)', near(b - a, 30 * DEG, 1.5), `(${deg(b - a)})`);
}

// ==========================================================================
console.log('\n4. The agreed model: shoot → counter → next shot climbs from there');
// ==========================================================================
{
  const rig = makeRig();
  fire(rig, 0); fire(rig, 1); fire(rig, 2);
  const expected3 = pat[0] + pat[2] + pat[4]; // the three real pattern pitches
  const v0 = viewPitch(rig, 0);
  check('3 shots: camera exactly at the pattern sum with mouse at 0', near(v0, expected3, 0.3), `(${deg(v0)} vs ${deg(expected3)})`);
  const v1 = viewPitch(rig, -10); // pull down 10°
  check('pull down 10° → camera drops 10° (1:1)', near(v0 - v1, 10 * DEG, 0.5), `(${deg(v0 - v1)})`);
  fire(rig, 3);
  const v2 = viewPitch(rig, -10);
  check('next shot climbs from where the camera is (+0.76°)', near(v2 - v1, pat[3 * 2], 0.3), `(${deg(v2 - v1)})`);
  // perfect counterer: 30 rounds, drag down 0.76°/round → camera hovers at 0
  const rig2 = makeRig();
  let held = 0;
  for (let i = 0; i < 30; i++) {
    fire(rig2, i);
    held += pat[Math.min(i, 29) * 2];
  }
  const m = makeM({ pitch: -held });
  step(rig2, m, 2);
  check('perfect counterer after a full mag: camera back at 0', near(rig2.rotation.x, 0, 0.5), `(${deg(rig2.rotation.x)})`);
  // and the mouse has plenty of range left for normal play
  check('counterer still has 60°+ of down-look left', viewPitch(rig2, -88) < -60 * DEG, `(${deg(viewPitch(rig2, -88))})`);
}

// ==========================================================================
console.log('\n5. Yaw freedom, roll decay, respawn reset, transients');
// ==========================================================================
{
  const rig = makeRig();
  fireMag(rig, 2); // yaw accumulates too (rifle pattern drifts left)
  const yawHeld = rig.recoilYaw;
  check('yaw accumulates (learnable drift)', Math.abs(yawHeld) > 0.5 * DEG, `(${deg(yawHeld)})`);
  // yaw never locks anything: mouse yaw is a separate term, unbounded
  const m = makeM({ yaw: 2.0 });
  step(rig, m, 2);
  check('camera yaw = mouse yaw + held (free to turn anywhere)', near(rig.rotation.y, 2.0 + yawHeld, 1.5), `(${deg(rig.rotation.y)})`);

  // roll decays back to level after firing stops
  const pitchBefore = rig.recoilPitch;
  const rollAfter = rig.recoilRoll;
  step(rig, makeM(), 120); // 2 s idle
  check('roll decays to level within 2 s of idle', Math.abs(rig.recoilRoll) < 0.5 * DEG, `(${deg(rollAfter)} → ${deg(rig.recoilRoll)})`);
  check('pitch/yaw hold through the same idle (no auto-recovery)', near(rig.recoilPitch, pitchBefore, 0.1) && near(rig.recoilYaw, yawHeld, 0.1), `(${deg(rig.recoilPitch)})`);

  // respawn clears everything
  rig.reset(1.66);
  check('respawn resets the sightline', rig.recoilPitch === 0 && rig.recoilYaw === 0 && rig.recoilRoll === 0);

  // transients never touch the sightline
  rig.kickPitch.kick(3 * DEG);
  rig.onLand(8);
  const sightline = rig.recoilPitch;
  step(rig, makeM(), 120);
  check('landing + kick: sightline untouched, kick channel returned', rig.recoilPitch === sightline && Math.abs(rig.kickPitch.value) < 0.1 * DEG, `(kick ${deg(rig.kickPitch.value)})`);
}

// ==========================================================================
console.log('\n6. Endurance: 210 rounds (full reserve) fired straight, no countering');
// ==========================================================================
{
  const rig = makeRig();
  for (let i = 0; i < 210; i++) fire(rig, i);
  const v = viewPitch(rig, 0);
  check('view pinned at the ceiling (straight up), never beyond', near(v, LIMIT, 1), `(${deg(v)})`);
  check('no NaN / no jitter after 210 rounds', Number.isFinite(v) && Number.isFinite(rig.rotation.y) && Number.isFinite(rig.rotation.z));
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);

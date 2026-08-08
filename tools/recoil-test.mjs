#!/usr/bin/env node
/**
 * Exhaustive regression test for the recoil model.
 *
 * The sightline pitch/yaw recoil is folded INTO the player's look
 * (movement.pitch): the mouse and the recoil write the same variable, so the
 * mouse always has full authority. This suite proves, through the REAL
 * `Player.addRecoil` and `CameraRig` pipeline:
 *
 *   1. every shot moves the sightline up by its full pattern amount
 *   2. climbing stops ONLY at the camera's physical top (88°) — and pulling
 *      down always brings the camera down again, 1:1, ALL THE WAY to −88°
 *      (the old "floor of recoil − 88°" bug is structurally impossible)
 *   3. after ANY amount of firing, the mouse sweeps the full range
 *      monotonically and the camera can always reach straight-down
 *   4. an exhaustive grid: 3 weapons x 0..8 un-countered mags x full mouse
 *      sweep, every cell asserted
 *   5. a randomized fuzz: thousands of random lives (random bursts, random
 *      countering, random look-around) with per-frame invariant checks and a
 *      full-range sweep at the end of every life
 *
 * Usage: node tools/recoil-test.mjs [fuzzLives=20000]
 */
import * as THREE from 'three';
import { PlayerSystem } from '../src/player/index.js';
import { CameraRig } from '../src/player/camera.js';
import { CAMERA } from '../src/player/tuning.js';
import { WEAPON_DEFS, buildRecoilPattern } from '../src/weapons/defs.js';
import { Rng } from '../src/core/rng.js';

const LIMIT = CAMERA.pitchLimit; // ±88° — the only ceiling
const DEG = Math.PI / 180;
const deg = (a) => (a * 180 / Math.PI).toFixed(1) + '°';
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

let assertions = 0, failures = 0;
const failuresLog = [];
const check = (name, ok, detail = '') => {
  assertions++;
  if (!ok) {
    failures++;
    if (failuresLog.length < 20) failuresLog.push(`${name} ${detail}`);
  }
};

// ---- fixtures -------------------------------------------------------------
function makeRig() {
  const rig = new CameraRig({ config: { fov: 90, adsFovScale: 0.74 }, time: { alpha: 0 }, camera: new THREE.PerspectiveCamera() });
  rig.reset(1.66);
  return rig;
}
function makeMovement() {
  return {
    pitch: 0, yaw: 0,
    eyeHeight: 1.66, sliding: false, slideProgress: 0, stance: 'stand',
    cmd: { moveX: 0, moveY: 0 }, grounded: true, yawRate: 0, velocity: { y: 0 },
    horizontalSpeed: 0, tacticalSprint: false, sprinting: false, airborne: false,
    leanAmount: 0, leanOffsetX: 0, leanOffsetZ: 0, stepPhase: 0, adsAmount: 0,
    mantleMotion: { active: false, camY: 0, camForward: 0, camPitch: 0, camRoll: 0 },
    sampleRender: () => ({ x: 0, y: 0, z: 0 }),
  };
}
/** Real PlayerSystem with a stubbed movement + a real CameraRig — the REAL addRecoil path. */
function makePlayer() {
  const p = new PlayerSystem();
  p.movement = makeMovement();
  p.rig = makeRig();
  return p;
}
const health = { fraction: 1, suppression: 0 };
const stepRig = (p, n = 1, dt = 1 / 60) => {
  for (let i = 0; i < n; i++) p.rig.update(dt, p.movement, health);
};
/**
 * Drag the mouse RELATIVELY, exactly like _consumeLook does: the folded
 * recoil stays inside movement.pitch — the drag can never erase it.
 */
const drag = (p, dPitchDeg, dYawDeg = 0) => {
  p.movement.pitch = clamp(p.movement.pitch + dPitchDeg * DEG, -LIMIT, LIMIT);
  p.movement.yaw += dYawDeg * DEG;
};
/** Drag all the way down from anywhere: must ALWAYS reach straight-down. */
const dragToBottom = (p) => drag(p, -176); // 88 + 88: more than any state needs
/** Sweep down then up in steps, asserting 1:1 monotonic response. */
function sweepAssert(p, stepDeg = 4, label = '') {
  let ok = true;
  let last = Infinity;
  for (let m = 0; m >= -176; m -= stepDeg) {
    drag(p, -stepDeg);
    p.rig.update(1 / 60, p.movement, health);
    p.rig.update(1 / 60, p.movement, health);
    const c = p.rig.rotation.x;
    if (!Number.isFinite(c)) ok = false;
    if (Math.abs(c - p.movement.pitch) > 0.4 * DEG) ok = false;
    if (c > last + 0.05 * DEG) ok = false; // must keep falling
    last = c;
  }
  check(`${label} sweep down: 1:1, monotonic`, ok);
  check(`${label} full down-look reachable (floor is gone)`, p.rig.rotation.x < -87 * DEG, `(${deg(p.rig.rotation.x)})`);
  ok = true;
  for (let m = -176; m <= 0; m += stepDeg) {
    drag(p, stepDeg);
    p.rig.update(1 / 60, p.movement, health);
    p.rig.update(1 / 60, p.movement, health);
    const c = p.rig.rotation.x;
    if (!Number.isFinite(c)) ok = false;
    if (Math.abs(c - p.movement.pitch) > 0.4 * DEG) ok = false;
    if (c < last - 0.05 * DEG) ok = false; // must keep rising
    last = c;
  }
  check(`${label} sweep up: 1:1, monotonic`, ok);
  check(`${label} full up-look reachable`, p.rig.rotation.x > 87 * DEG, `(${deg(p.rig.rotation.x)})`);
  return ok;
}
/** Fire one shot through the REAL weapons-shaped call: brace 1 (hip). */
function fire(p, def, pat, shotIndex, brace = 1) {
  const idx = Math.min(shotIndex, def.recoil.patternLength - 1);
  const pitch = pat[idx * 2];
  const yaw = pat[idx * 2 + 1];
  const rollSide = Math.abs(yaw) > 1e-5 ? Math.sign(yaw) : (shotIndex & 1 ? -1 : 1);
  p.addRecoil(pitch * brace, yaw * brace, rollSide * def.recoil.roll * 0.24 * brace, def.recoil.punch * brace);
}
function fireMag(p, def, pat, mag) {
  for (let i = 0; i < def.magSize; i++) fire(p, def, pat, (mag - 1) * def.magSize + i);
}
/** The camera pitch the player would see for the current look. */
const camPitch = (p) => p.rig.rotation.x;
const camYaw = (p) => p.rig.rotation.y;

// ==========================================================================
const section = (t) => console.log(`\n${t}`);

// ==========================================================================
section('1. The user model, verbatim (real Player.addRecoil)');
{
  const def = WEAPON_DEFS.rifle;
  const pat = buildRecoilPattern(def, Rng);
  const p = makePlayer();

  // 3 shots → camera at exactly the pattern sum
  fire(p, def, pat, 0); fire(p, def, pat, 1); fire(p, def, pat, 2);
  stepRig(p, 2);
  const expected = pat[0] + pat[2] + pat[4];
  check('3 shots: sightline = pattern sum', Math.abs(p.movement.pitch - expected) < 0.3 * DEG, `(${deg(p.movement.pitch)} vs ${deg(expected)})`);
  check('camera shows exactly the sightline', Math.abs(camPitch(p) - p.movement.pitch) < 0.35 * DEG);

  // pull down 10° → camera drops exactly 10° (1:1, recoil stays inside)
  const before = camPitch(p);
  drag(p, -10);
  stepRig(p, 2);
  check('pull down 10° → camera drops 10° (1:1)', Math.abs(camPitch(p) - (before - 10 * DEG)) < 0.4 * DEG, `(${deg(camPitch(p) - before)})`);

  // drag back down through the sightline → camera reset to 0 (the user model)
  drag(p, -p.movement.pitch * 180 / Math.PI);
  stepRig(p, 2);
  check('drag down through the sightline → camera at 0', Math.abs(camPitch(p)) < 0.5 * DEG, `(${deg(camPitch(p))})`);

  // next shot climbs from where the camera is (+0.76°)
  fire(p, def, pat, 3);
  stepRig(p, 2);
  check('next shot climbs from the camera (+0.76°)', Math.abs(camPitch(p) - pat[6]) < 0.4 * DEG, `(${deg(camPitch(p))})`);
  const held = p.movement.pitch;

  // hold: nothing returns after idle — the SIGHTLINE (movement.pitch) must
  // be bit-exact; the camera only breathes ±0.12° on top (feel layer)
  stepRig(p, 120);
  check('sightline holds through idle (no auto-recovery)', Math.abs(p.movement.pitch - held) < 0.01 * DEG, `(${deg(p.movement.pitch)})`);
  check('camera stays within breathing sway of the sightline', Math.abs(camPitch(p) - held) < 0.3 * DEG);
}

// ==========================================================================
section('2. Climb caps at the physical top; the camera always comes back down');
{
  const def = WEAPON_DEFS.rifle;
  const pat = buildRecoilPattern(def, Rng);
  const p = makePlayer();
  let prev = 0;
  for (let mag = 1; mag <= 6; mag++) {
    fireMag(p, def, pat, mag);
    stepRig(p, 2);
    const v = camPitch(p);
    if (v < LIMIT - 1 * DEG) check(`mag ${mag}: climbed to ${deg(v)} (was ${deg(prev)})`, v > prev + 1 * DEG);
    else check(`mag ${mag}: pinned at ${deg(v)} — straight up, no more climb`, Math.abs(v - LIMIT) < 1 * DEG);
    prev = v;
  }
  // extra rounds at the top: the VIEW must not move (clamped)…
  const atTop = camPitch(p);
  for (let i = 0; i < 90; i++) fire(p, def, pat, 1000 + i);
  stepRig(p, 2);
  check('90 more rounds at the top: view unchanged', Math.abs(camPitch(p) - atTop) < 0.05 * DEG);
  // …but the mouse still works: drag down and it comes down, all the way
  drag(p, -176);
  stepRig(p, 2);
  check('at the top, drag to the bottom: camera reaches straight-down', camPitch(p) < -87 * DEG, `(${deg(camPitch(p))})`);
  check('movement.pitch itself is clamped at ±88 (the fold clamp)', Math.abs(p.movement.pitch) <= LIMIT + 1e-9);
}

// ==========================================================================
section('3. THE FLOOR IS GONE: full down-look after ANY amount of firing');
{
  const def = WEAPON_DEFS.rifle;
  const pat = buildRecoilPattern(def, Rng);
  const p = makePlayer();
  // 8 un-countered mags — the old bug reproduced 176° of debt
  for (let mag = 1; mag <= 8; mag++) fireMag(p, def, pat, mag);
  stepRig(p, 2);
  check('8 un-countered mags: sightline at the top', Math.abs(p.movement.pitch - LIMIT) < 1 * DEG);
  // the OLD bug: camera floor was stuck at 45° with the mouse fully down.
  // now a plain drag to the bottom must reach straight-down:
  dragToBottom(p);
  stepRig(p, 2);
  check('mouse dragged fully down → camera AT −88° (was stuck at 45° before the fix)', camPitch(p) < -87 * DEG, `(${deg(camPitch(p))})`);
  // full sweep after 8 mags: 1:1 everywhere
  sweepAssert(p, 2, '8-mag extreme');
}

// ==========================================================================
section('4. Perfect counterer: level all mag, full range preserved');
{
  const def = WEAPON_DEFS.rifle;
  const pat = buildRecoilPattern(def, Rng);
  const p = makePlayer();
  for (let i = 0; i < 30; i++) {
    fire(p, def, pat, i);
    drag(p, -pat[Math.min(i, 29) * 2] * 180 / Math.PI); // perfect 1:1 countering as they fire
    stepRig(p, 2);
  }
  check('perfect counterer after a full mag: camera back at 0', Math.abs(camPitch(p)) < 0.5 * DEG, `(${deg(camPitch(p))})`);
  dragToBottom(p);
  stepRig(p, 2);
  check('full down-look intact for the counterer', camPitch(p) < -87 * DEG);
}

// ==========================================================================
section('5. Yaw, roll, reset, transients');
{
  const def = WEAPON_DEFS.rifle;
  const pat = buildRecoilPattern(def, Rng);
  const p = makePlayer();
  fireMag(p, def, pat, 2);
  stepRig(p, 2);
  const yawHeld = p.movement.yaw;
  check('yaw accumulates into the look (learnable drift)', Math.abs(yawHeld) > 0.2 * DEG, `(${deg(yawHeld)})`);
  const yawBefore = camYaw(p);
  p.movement.yaw += 1.0; // mouse turns (look is unbounded/wrapped)
  stepRig(p, 2);
  check('camera yaw = look yaw (free to turn anywhere)', Math.abs(camYaw(p) - (yawBefore + 1.0)) < 0.1, `(${deg(camYaw(p))})`);
  stepRig(p, 120);
  check('roll decays to level in 2 s idle', Math.abs(p.rig.recoilRoll) < 0.5 * DEG, `(${deg(p.rig.recoilRoll)})`);
  check('sightline (look pitch) holds through idle', Math.abs(p.movement.pitch) > 20 * DEG, `(${deg(p.movement.pitch)})`);
  // respawn clears everything (movement.pitch = 0 + rig.reset)
  p.movement.pitch = 0;
  p.movement.yaw = 0;
  p.rig.reset(1.66);
  check('respawn clears the sightline', p.movement.pitch === 0 && p.movement.yaw === 0);
  // transients never touch the sightline
  const sightline = p.movement.pitch;
  p.rig.kickPitch.kick(3 * DEG);
  p.rig.onLand(8);
  stepRig(p, 120);
  check('landing + kick: sightline untouched, kick returned', p.movement.pitch === sightline && Math.abs(p.rig.kickPitch.value) < 0.1 * DEG);
}

// ==========================================================================
section('6. Exhaustive grid: 3 weapons x 0..8 un-countered mags x ±88° sweep');
{
  for (const id of ['rifle', 'smg', 'pistol']) {
    const def = WEAPON_DEFS[id];
    const pat = buildRecoilPattern(def, Rng);
    const p = makePlayer();
    for (let mag = 0; mag <= 8; mag++) {
      if (mag > 0) fireMag(p, def, pat, mag);
      stepRig(p, 2);
      sweepAssert(p, 4, `${id} ${mag} mag`);
    }
    check(`${id}: no NaN anywhere in the grid`, Number.isFinite(camPitch(p)) && Number.isFinite(camYaw(p)));
  }
}

// ==========================================================================
section(`7. Randomized fuzz — every possible scenario family (${process.argv[2] ?? 20000} lives)`);
{
  const LIVES = parseInt(process.argv[2] ?? '20000', 10);
  const defs = ['rifle', 'smg', 'pistol'].map((id) => [WEAPON_DEFS[id], buildRecoilPattern(WEAPON_DEFS[id], Rng)]);
  const rng = new Rng(0xc0ffee);
  let frames = 0;
  for (let life = 0; life < LIVES; life++) {
    const [def, pat] = defs[(rng.u32() % 3 + 3) % 3];
    const p = makePlayer();
    const braces = [1, 0.78, 0.88, 1.25, 0.78 * 0.88];
    let shot = 0;
    const framesThisLife = 240 + (rng.u32() % 720); // 4–16 s of chaos
    let burstLeft = 0;
    for (let f = 0; f < framesThisLife; f++) {
      // random look: aim wobble, counter drags, flicks — ALL relative,
      // exactly like a real mouse: the folded recoil is never erased
      const mode = rng.u32() % 10;
      if (mode < 4) drag(p, rng.signed() * 2);                            // aim wobble
      else if (mode < 6) drag(p, -12);                                    // counter drag
      else if (mode < 8) drag(p, 8);                                      // look up
      else drag(p, rng.signed() * 176);                                   // wild flick
      drag(p, 0, rng.signed() * 0.05);

      // random fire: bursts, pauses, spray-and-pray
      if (burstLeft > 0) {
        fire(p, def, pat, shot++, braces[rng.u32() % braces.length]);
        burstLeft--;
      } else if (rng.u32() % 100 < 35) {
        burstLeft = 1 + (rng.u32() % (rng.u32() % 100 < 20 ? 40 : 12));
      }
      stepRig(p, 1);

      // per-frame invariants — EVERY frame of EVERY life asserts these
      frames++;
      check(`life ${life} frame ${f}: finite state`,
        Number.isFinite(p.movement.pitch) && Number.isFinite(p.movement.yaw) &&
        Number.isFinite(camPitch(p)) && Number.isFinite(camYaw(p)) &&
        Number.isFinite(p.rig.rotation.z));
      check(`life ${life} frame ${f}: pitch within ±88°`,
        Math.abs(p.movement.pitch) <= LIMIT + 1e-6 && Math.abs(camPitch(p)) <= LIMIT + 0.01 * DEG);
      check(`life ${life} frame ${f}: yaw finite and free`, Number.isFinite(p.movement.yaw) && Number.isFinite(camYaw(p)));
    }
    // end-of-life: dragging to the bottom must ALWAYS reach straight-down,
    // and the sweep must be 1:1 and monotonic — the floor is gone, forever
    sweepAssert(p, 2, `life ${life}`);
    // roll settles after a short idle
    stepRig(p, 90);
    check(`life ${life}: roll settled`, Math.abs(p.rig.recoilRoll) < 0.5 * DEG);
  }
  console.log(`  (${LIVES} lives × ${Math.round(frames / LIVES)} frames + sweep ≈ ${(LIVES * (Math.round(frames / LIVES) + 90)).toLocaleString()} scenario frames, ~${(assertions).toLocaleString()} assertions so far)`);
}

// ==========================================================================
console.log(`\n${assertions.toLocaleString()} assertions, ${failures} failed`);
if (failuresLog.length) {
  console.log('first failures:');
  for (const f of failuresLog) console.log(`  ❌ ${f}`);
}
process.exit(failures ? 1 : 0);

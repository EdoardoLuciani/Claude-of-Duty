/**
 * Per-shot firing vibration: one trigger per successful round, no dry-fire,
 * one trigger per shotgun shell, bounded overlap, ADS/intensity, and aim
 * isolation from the cosmetic overlay.
 *
 *   node tools/smoke-fire-vibe.mjs
 */
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { CameraRig } from '../src/player/camera.js';
import { CAMERA } from '../src/player/tuning.js';
import { WeaponSystem } from '../src/weapons/index.js';
import { WEAPON_DEFS, WEAPON_IDS, buildRecoilPattern } from '../src/weapons/defs.js';
import { Rng } from '../src/core/rng.js';

let failures = 0;
const check = (name, cond) => {
  if (cond) console.log(`  ok  ${name}`);
  else {
    failures++;
    console.error(`FAIL  ${name}`);
  }
};

function makeMove() {
  return {
    adsAmount: 0,
    eyeHeight: 1.66,
    sliding: false,
    slideProgress: 0,
    stance: 'stand',
    yaw: 0,
    pitch: 0,
    yawRate: 0,
    cmd: { moveX: 0 },
    grounded: true,
    velocity: { x: 0, y: 0, z: 0 },
    horizontalSpeed: 0,
    tacticalSprint: false,
    sprinting: false,
    mantleMotion: { active: false },
    leanOffsetX: 0,
    leanOffsetZ: 0,
    leanAmount: 0,
    stepPhase: 0,
    sampleRender() { return { x: 0, y: 0, z: 0 }; },
  };
}

function makeRig(firingShake = 1) {
  const camera = new THREE.PerspectiveCamera(80, 16 / 9, 0.05, 1200);
  camera.rotation.order = 'YXZ';
  const viewCamera = new THREE.PerspectiveCamera(60, 16 / 9, 0.005, 12);
  const ctx = {
    camera,
    viewCamera,
    config: { fov: 80, firingShake, adsFovScale: 0.62 },
    peek: () => null,
    time: { alpha: 1 },
  };
  const rig = new CameraRig(ctx);
  rig.update(1 / 60, makeMove(), { fraction: 1, low: false });
  rig.applyTo(camera);
  return { rig, camera, viewCamera, ctx, move: makeMove() };
}

function step(rig, dt, move = makeMove(), ads = 0) {
  move.adsAmount = ads;
  rig.update(dt, move, { fraction: 1, low: false });
}

// ---- envelope / overlap / decay ------------------------------------------
{
  const { rig } = makeRig();
  rig.addFireVibe(1, 0.06, 0.42);
  check('trigger sets envelope to 1', rig.fireVibe === 1);
  rig.addFireVibe(1, 0.06, 0.42);
  check('overlap refreshes, does not stack', rig.fireVibe === 1);

  const left = {};
  for (const fps of [30, 60, 120]) {
    const { rig: r } = makeRig();
    r.addFireVibe(1, 0.06, 0.42);
    let t = 0;
    const dt = 1 / fps;
    while (t < 0.03 - 1e-9) {
      step(r, dt);
      t += dt;
    }
    left[fps] = r.fireVibe;
  }
  check('30 fps half-decay ~0.5', Math.abs(left[30] - 0.5) < 0.08);
  check('60 fps half-decay ~0.5', Math.abs(left[60] - 0.5) < 0.08);
  check('120 fps half-decay ~0.5', Math.abs(left[120] - 0.5) < 0.08);
  check(
    'frame-rate decay agrees',
    Math.abs(left[30] - left[60]) < 0.08 && Math.abs(left[60] - left[120]) < 0.08,
  );

  const { rig: done } = makeRig();
  done.addFireVibe(1, 0.06, 0.42);
  step(done, 0.08);
  check('envelope settles after duration', done.fireVibe === 0);

  const { rig: paused } = makeRig();
  paused.addFireVibe(1, 0.06, 0.42);
  step(paused, 0);
  check('dt=0 freezes envelope', paused.fireVibe === 1);

  const { rig: reset } = makeRig();
  reset.addFireVibe(1, 0.06, 0.42);
  reset.reset(1.66);
  check('reset clears envelope', reset.fireVibe === 0);
}

// ---- cosmetic overlay vs gameplay pose -----------------------------------
{
  const { rig, camera } = makeRig();
  rig.applyTo(camera);
  const aimX = camera.rotation.x;
  const aimY = camera.rotation.y;
  const aimZ = camera.rotation.z;
  const fwd = rig.forward.clone();
  rig.addFireVibe(1, 0.06, 0.42);
  rig.fireVibeTime = 0.25;
  rig.applyFireVibe(camera, null, null, 0, 0.62);
  check('overlay moves the camera', Math.abs(camera.rotation.x - aimX) + Math.abs(camera.rotation.z - aimZ) > 1e-6);
  check('gameplay rotation is unchanged', rig.rotation.x === aimX && rig.rotation.y === aimY && rig.rotation.z === aimZ);
  check('forward stays the gameplay vector', rig.forward.equals(fwd));
  rig.applyFireVibe(camera, null, null, 0, 0.62);
  const onceX = camera.rotation.x;
  rig.applyFireVibe(camera, null, null, 0, 0.62);
  check('overlay is idempotent', Math.abs(camera.rotation.x - onceX) < 1e-12);

  rig.applyTo(camera);
  check('applyTo restores gameplay pose', Math.abs(camera.rotation.x - aimX) < 1e-12);

  const { rig: off, camera: camOff } = makeRig(0);
  off.applyTo(camOff);
  const offX = camOff.rotation.x;
  off.addFireVibe(1, 0.06, 0.42);
  off.fireVibeTime = 0.25;
  off.applyFireVibe(camOff, null, null, 0, 0.62);
  check('intensity 0 does not move the camera', Math.abs(camOff.rotation.x - offX) < 1e-12);
  check('intensity 0 still records the trigger', off.fireVibe === 1);
}

// ---- ADS / magnified attenuation -----------------------------------------
{
  const hip = makeRig();
  hip.rig.addFireVibe(1, 0.06, 0.42);
  hip.rig.fireVibeTime = 0.25;
  hip.rig._sampleFireVibe(0, 0.62);
  const hipMag = Math.abs(hip.rig.fireVibePitch) + Math.abs(hip.rig.fireVibeRoll);

  const ads = makeRig();
  ads.rig.addFireVibe(1, 0.06, 0.42);
  ads.rig.fireVibeTime = 0.25;
  ads.rig._sampleFireVibe(1, 0.62);
  const adsMag = Math.abs(ads.rig.fireVibePitch) + Math.abs(ads.rig.fireVibeRoll);

  const scope = makeRig();
  scope.rig.addFireVibe(1, 0.07, 0.2);
  scope.rig.fireVibeTime = 0.25;
  scope.rig._sampleFireVibe(1, 0.25);
  const scopeMag = Math.abs(scope.rig.fireVibePitch) + Math.abs(scope.rig.fireVibeRoll);

  check('ADS is quieter than hip', adsMag < hipMag * 0.7 && adsMag > 0);
  check('magnified optic is quieter than irons ADS', scopeMag < adsMag);
}

// ---- weapon defs present, durations in range -----------------------------
{
  for (const id of WEAPON_IDS) {
    const v = WEAPON_DEFS[id].fireVibe;
    check(`${id} has fireVibe`, !!v && v.amp > 0 && v.duration > 0);
    check(`${id} duration 40–80 ms`, v.duration >= 0.04 && v.duration <= 0.08);
  }
  check('shared envelope exists', CAMERA.fireVibe.duration > 0 && CAMERA.fireVibe.pitch > 0);
  check('shotgun thump is heavier than the rifle', WEAPON_DEFS.shotgun.fireVibe.amp > WEAPON_DEFS.rifle.fireVibe.amp);
  check('sniper ADS scale is restrained', WEAPON_DEFS.sniper.fireVibe.adsScale < WEAPON_DEFS.rifle.fireVibe.adsScale);
}

// ---- WeaponSystem: one trigger per shot, no dry fire, one per shell ------
function makeWeapons() {
  const calls = [];
  const spawned = [];
  const vm = {
    anchor: { visible: true, position: new THREE.Vector3(), quaternion: new THREE.Quaternion(), updateMatrixWorld() {} },
    clip: null,
    clipName: null,
    clipT: 0,
    boltHold: 0,
    adsT: 0,
    adsTarget: 0,
    active: 'rifle',
    trackCamera: true,
    setActive(id) { this.active = id; return id; },
    play(name) { this.clip = { name, duration: 1 }; this.clipName = name; this.clipT = 0; return 1; },
    stopClip() { this.clip = null; this.clipName = null; this.clipT = 0; },
    endGrenade() {},
    endRadio() {},
    syncToCamera() {},
    muzzleWorld(out) { return out?.set(0, 1.6, 0) ?? { x: 0, y: 1.6, z: 0 }; },
    addRecoil() {},
  };
  const player = {
    dead: false,
    addRecoil() {},
    addFireVibe(amp, duration, adsScale) { calls.push({ amp, duration, adsScale }); },
    applyFireVibe() {},
    clearFireVibe() { calls.push('clear'); },
  };
  const camera = new THREE.PerspectiveCamera(80, 16 / 9, 0.05, 1200);
  camera.position.set(0, 1.66, 0);
  camera.rotation.order = 'YXZ';
  const wp = new WeaponSystem();
  wp.ctx = {
    time: { elapsed: 0, scale: 1 },
    camera,
    events: { emit() {} },
  };
  wp.rng = new Rng(0x288f1e);
  wp.sim = { spawn(o) { spawned.push({ origin: o.origin.clone?.() ?? o.origin, dir: o.dir.clone?.() ?? o.dir }); }, clear() {} };
  wp.stats = { tris: 0, drawCalls: 0, live: 0, fired: 0 };
  wp.viewmodel = vm;
  wp.player = player;
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
  return { wp, calls, spawned, player, vm };
}

{
  const { wp, calls, spawned } = makeWeapons();
  assert.equal(wp.tryFire(), true);
  check('rifle shot triggers once', calls.length === 1);
  check('rifle uses M4A1 amp', calls[0].amp === WEAPON_DEFS.rifle.fireVibe.amp);

  wp.state.chambered = false;
  wp.state.mag = 0;
  wp._fireTimer = 0;
  const n = calls.length;
  check('dry fire does not shoot', wp.tryFire() === false);
  check('dry fire does not trigger vibe', calls.length === n);

  wp.owned.add('shotgun');
  wp.setWeaponImmediate('shotgun');
  wp._fireTimer = 0;
  wp.state.chambered = true;
  calls.length = 0;
  spawned.length = 0;
  assert.equal(wp.tryFire(), true);
  check('shotgun spawns eight pellets', spawned.length === 8);
  check('shotgun triggers vibe once', calls.filter((c) => typeof c === 'object').length === 1);
}

{
  const { wp, calls } = makeWeapons();
  wp.owned.add('shotgun');
  wp.setWeaponImmediate('shotgun');
  check('swap cleared leftover vibe', calls.includes('clear'));
  calls.length = 0;
  wp._fireTimer = 0;
  wp.state.chambered = true;
  assert.equal(wp.tryFire(), true);
  check('one vibe per shell after swap', calls.filter((c) => typeof c === 'object').length === 1);
}

// ---- enabled vs disabled: same projectile origin/dir ---------------------
{
  const shots = (shake) => {
    const { wp } = makeWeapons();
    wp.ctx.config = { firingShake: shake };
    wp.rng = new Rng(0x288f1e);
    const got = [];
    wp.sim.spawn = (o) => got.push({
      ox: o.origin.x, oy: o.origin.y, oz: o.origin.z,
      dx: o.dir.x, dy: o.dir.y, dz: o.dir.z,
    });
    wp._spread = 0;
    for (let i = 0; i < 5; i++) {
      wp._fireTimer = 0;
      wp.state.chambered = true;
      wp.tryFire();
    }
    return got;
  };
  const on = shots(1);
  const off = shots(0);
  check('same shot count on/off', on.length === off.length && on.length === 5);
  let same = true;
  for (let i = 0; i < on.length; i++) {
    for (const k of Object.keys(on[i])) {
      if (Math.abs(on[i][k] - off[i][k]) > 1e-12) same = false;
    }
  }
  check('origins and directions identical with vibe on vs off', same);
}

if (failures) {
  console.error(`smoke-fire-vibe: ${failures} failed`);
  process.exit(1);
}
console.log('smoke-fire-vibe: ok');

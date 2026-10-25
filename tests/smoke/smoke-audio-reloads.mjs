import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import * as THREE from 'three';

import { AudioSystem } from '../../src/audio/index.ts';
import { RELOAD_CUES, RELOAD_URLS, reloadKind } from '../../src/audio/reloads.ts';
import { WeaponSampleBank } from '../../src/audio/samples.ts';
import { Rng } from '../../src/core/rng.ts';
import { makeAX338Model, AX338_URL } from '../../src/weapons/ax338.ts';
import { WEAPON_IDS } from '../../src/weapons/defs.ts';
import { makeEvolysModel, EVOLYS_URL } from '../../src/weapons/evolys.ts';
import { WeaponSystem } from '../../src/weapons/index.ts';
import { makeM4Model, M4_URL } from '../../src/weapons/m4.ts';
import { makeM590Model, M590_URL } from '../../src/weapons/m590.ts';
import { makeMCXModel, MCX_URL } from '../../src/weapons/mcx.ts';
import { makeMPXModel, MPX_URL } from '../../src/weapons/mpx.ts';
import { makeP320Model, P320_URL } from '../../src/weapons/p320.ts';
import { Viewmodel } from '../../src/weapons/viewmodel.ts';
import { parseGLB } from '../../tools/lib/glb-fixture.mjs';
import { audioFixture } from '../lib/audio-banks.mjs';

const { actx, sources } = audioFixture(0);
const bank = new WeaponSampleBank(actx),
  rng = new Rng(337);
for (const [kind, urls] of Object.entries(RELOAD_URLS))
  bank.reloadBuffers[kind] = urls.map((url, index) => ({ kind, index, duration: 0.18 }));
const mapped = Object.entries(RELOAD_CUES).flatMap(([id, cues]) =>
  Object.keys(cues).map((phase) => [id, phase])
);
for (const [id, phase] of [...mapped, ['rifle', 'start'], ['rifle', 'end']]) {
  let previous = -1;
  const seen = new Set();
  for (let n = 0; n < 40; n++) {
    const voice = bank.reload(id, phase, rng, { when: 3 });
    const src = sources.at(-1);
    assert.notEqual(src.buffer.index, previous, 'no immediate repeat');
    seen.add(src.buffer.index);
    previous = src.buffer.index;
    assert.equal(src.playbackRate.value, 1, 'no timing/pitch drift');
    assert.equal(src.when, 3);
    assert.equal(voice.end, 3 + 0.18 + 0.02);
  }
  assert.equal(seen.size, RELOAD_URLS[reloadKind(id, phase)].length);
}
bank.reload('lmg', 'magin', rng);
assert.equal(sources.at(-1).buffer.kind, 'pouch-in', 'feed handling uses approved recorded donors');
bank.reload('rifle', 'end', rng);
assert.equal(sources.at(-1).buffer.kind, 'gear', 'recorded hand settle, never a rack');
assert.throws(
  () => bank.reload('unknown', 'magin', rng),
  /no recorded reload cue/,
  'no synthetic catch-all'
);
assert.throws(
  () => new WeaponSampleBank(actx).reload('rifle', 'magin', rng),
  /reload recordings are not loaded/
);

// Real GLBs, native event clips, common weapon callbacks and audio routing.
const trace = [],
  spatial = [],
  shells = [];
const audio = new AudioSystem();
Object.assign(audio, { running: true, actx, samples: bank, rng });
assert.throws(
  () => audio._build('reload', 4, 0, { reloadWeapon: 'unknown', phase: 'magin' }),
  /no recorded reload cue/,
  'voice builder cannot synthesize an unsupported reload'
);
audio._playDry = (kind, options, bus) => {
  assert.equal(kind, 'reload');
  assert.equal(bus, 'foley');
  assert(reloadKind(options.reloadWeapon, options.phase), 'every actual cue must have a recording');
  audio._build(kind, 4, 0, options);
  assert.equal(sources.at(-1).buffer.kind, reloadKind(options.reloadWeapon, options.phase));
};
audio._playAt = (...args) => spatial.push(args);
const ctx = {
  viewScene: new THREE.Scene(),
  scene: new THREE.Scene(),
  camera: new THREE.PerspectiveCamera(80, 16 / 9, 0.004, 100),
  viewCamera: new THREE.PerspectiveCamera(60, 16 / 9, 0.004, 100),
  rng,
  time: { elapsed: 0, scale: 1 },
  get: () => ({ screenSize: { height: 720 } }),
  peek: () => null,
  events: {
    emit(name, payload) {
      if (name === 'weapon:reload') {
        trace.push({ phase: payload.phase, retained: payload.retained, time: vm.clipT });
        audio._onReload(payload);
      }
      if (name === 'weapon:shell') shells.push({ time: vm.clipT });
    },
  },
};
const vm = new Viewmodel(ctx, {
  get: () => new THREE.MeshStandardMaterial(),
  reticle: () => new THREE.MeshBasicMaterial(),
  reticleOutline: () => new THREE.MeshBasicMaterial(),
});
const wp = new WeaponSystem();
Object.assign(wp, {
  ctx,
  viewmodel: vm,
  rng,
  sim: { spawn() {}, clear() {} },
  stats: { tris: 0, fired: 0, live: 0, drawCalls: 0 },
});
for (const id of WEAPON_IDS) {
  wp.states.set(id, wp._makeState(id));
  wp.owned.add(id);
}
for (const [id, url, make] of [
  ['rifle', M4_URL, makeM4Model],
  ['mcx', MCX_URL, makeMCXModel],
  ['smg', MPX_URL, makeMPXModel],
  ['pistol', P320_URL, makeP320Model],
  ['lmg', EVOLYS_URL, makeEvolysModel],
  ['sniper', AX338_URL, makeAX338Model],
  ['shotgun', M590_URL, makeM590Model],
])
  vm.addWeapon(make(await parseGLB(readFileSync(new URL(url)))), wp.states.get(id).def);
vm.onClipEvent = (event, clip) => wp._onClipEvent(event, clip);
function step(seconds) {
  for (let i = 0; i < Math.ceil(seconds * 240); i++) {
    ctx.time.elapsed += 1 / 240;
    wp._state.empty = !wp.ammo.total;
    wp._state.magazineLoaded = wp.state.mag > 0;
    wp.lateUpdate(1 / 240, ctx);
  }
}
function setup(id, empty) {
  wp.setWeaponImmediate(id);
  vm.stopClip();
  wp._tubeLoop = false;
  wp._fireTimer = 0;
  Object.assign(wp.state, {
    mag: empty ? 0 : 2,
    chambered: !empty,
    reserve: id === 'shotgun' ? 1 : 100,
  });
  trace.length = shells.length = 0;
}
for (const id of WEAPON_IDS) {
  for (const empty of [false, true]) {
    setup(id, empty);
    assert(wp.reload());
    const clip = vm.clip;
    step(clip.duration + 0.05);
    const action = empty
      ? id === 'pistol'
        ? ['slide']
        : id === 'shotgun'
          ? ['boltopen', 'boltclose']
          : id === 'rifle' || id === 'lmg' || id === 'sniper'
            ? ['charge', 'boltclose']
            : ['boltclose']
      : [];
    assert.deepEqual(
      trace.map((e) => e.phase),
      id === 'shotgun'
        ? [
            'start',
            ...(empty ? ['boltopen'] : []),
            'shellin',
            ...(empty ? ['boltclose'] : []),
            'end',
          ]
        : ['start', 'magout', 'magin', ...action, 'end'],
      `${id}/${clip.name}: exact audio beats`
    );
    for (const row of trace) {
      const event = clip.events.find(
        (e) =>
          e.name ===
          (row.phase === 'boltopen' && id === 'shotgun'
            ? 'pump'
            : ({ slide: 'boltrelease', boltclose: 'boltrelease' }[row.phase] ?? row.phase))
      );
      assert(
        event && Math.abs(row.time - event.t) < 1 / 240 + 1e-8,
        'native timing, not reload-end scheduling'
      );
    }
    assert.equal(shells.length, 0, 'reload cannot invent a spent casing');
    assert.equal(wp.state.chambered, true);
    if (id !== 'shotgun') assert.equal(wp.state.mag, wp.state.def.magSize - Number(empty));
    const magout = trace.find((e) => e.phase === 'magout');
    if (magout) assert.equal(magout.retained, !empty && (id === 'pistol' || id === 'smg'));
    setup(id, true);
    assert(wp.reload());
    step(0.25);
    vm.stopClip();
    trace.length = 0;
    step(5);
    assert.equal(trace.length, 0, 'cancelled clip has no later mechanical beats');
  }
}
for (const [id, expected] of [
  ['shotgun', ['pump', 'boltclose']],
  ['sniper', ['boltopen', 'boltclose']],
]) {
  setup(id, false);
  assert(wp.tryFire());
  step(1.3);
  assert.deepEqual(
    trace.map((e) => e.phase),
    expected,
    'post-shot manual action is audible'
  );
  assert.equal(shells.length, 1, 'one spent casing');
  assert(Math.abs(shells[0].time - (id === 'shotgun' ? 0.144 : 0.242)) < 1 / 240);
}
setup('shotgun', false);
assert(wp.tryFire());
step(0.2);
vm.stopClip();
step(1);
assert.deepEqual(
  trace.map((e) => e.phase),
  ['pump'],
  'cancelled pump cannot play a future forward contact'
);
setup('shotgun', false);
wp.state.reserve = 0;
wp._onClipEvent('shellin', 'reloadTac');
assert.equal(trace.length, 0, 'no shell-in audio without a committed shell');
audio._onReload({ weapon: 'rifle', phase: 'magin', position: { x: 2, y: 1, z: 3 } });
assert.deepEqual(spatial[0].slice(0, 4), ['reload', 2, 1, 3], 'positioned payload stays spatial');
assert.equal(spatial[0][4].reloadWeapon, 'rifle');
vm.dispose();
bank.dispose();
assert.deepEqual(bank.reloadBuffers, {});
console.log(
  'Seven native weapon timelines, routing, cancellation, pump/bolt and casing invariants passed'
);

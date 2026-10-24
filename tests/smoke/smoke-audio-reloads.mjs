import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

import * as THREE from 'three';

import { AudioSystem } from '../../src/audio/index.ts';
import { RELOAD_URLS, reloadKind } from '../../src/audio/reloads.ts';
import { WeaponSampleBank } from '../../src/audio/samples.ts';
import provenance from '../../src/audio/samples/reloads/provenance.json' with { type: 'json' };
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

let bytes = 0,
  seconds = 0;
for (const urls of Object.values(RELOAD_URLS)) {
  assert(urls.length >= 2, 'recorded variations');
  for (const url of urls) {
    const data = readFileSync(new URL(url));
    const name = new URL(url).pathname.split('/').at(-1).replace('.opus', '');
    const info = provenance.files[name];
    assert.equal(createHash('sha256').update(data).digest('hex'), info.sha256);
    assert(info.duration <= 0.24 && info.decodedPeak < 0.5, 'short, headroom-safe crops');
    const head = data.indexOf('OpusHead');
    assert(head >= 0);
    assert.equal(data[head + 9], 1, 'mono source');
    assert.equal(data.readInt16LE(head + 16), 0, 'no header gain');
    bytes += data.length;
    seconds += info.duration;
  }
}
assert.equal(Object.keys(provenance.files).length, 20);
assert(bytes < 80_000 && seconds * 48000 * 4 < 800_000, 'bounded delivery/decoded storage');
const sources = [];
const actx = {
  currentTime: 0,
  createGain: () => ({ gain: { value: 0 }, connect() {} }),
  createBufferSource() {
    const src = {
      playbackRate: { value: 1 },
      connect() {},
      start(when) {
        this.when = when;
      },
    };
    sources.push(src);
    return src;
  },
};
const bank = new WeaponSampleBank(actx),
  rng = new Rng(337);
for (const [kind, urls] of Object.entries(RELOAD_URLS))
  bank.reloadBuffers[kind] = urls.map((url, index) => ({ kind, index, duration: 0.18 }));
for (const [id, phase] of [
  ['rifle', 'magout'],
  ['mcx', 'magin'],
  ['rifle', 'charge'],
  ['mcx', 'boltclose'],
  ['pistol', 'magout'],
  ['pistol', 'magin'],
  ['pistol', 'slide'],
]) {
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
assert.equal(bank.reload('lmg', 'magin', rng), null, 'unmigrated feed handling stays synthesized');
assert.equal(bank.reload('rifle', 'end', rng), null, 'end never selects a rack');
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
audio._playDry = (kind, options, bus) => {
  assert.equal(kind, 'reload');
  assert.equal(bus, 'foley');
  if (reloadKind(options.reloadWeapon, options.phase)) {
    audio._build(kind, 4, 0, options);
    assert.equal(sources.at(-1).buffer.kind, reloadKind(options.reloadWeapon, options.phase));
  }
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
          ? ['pump']
          : id === 'rifle' || id === 'lmg' || id === 'sniper'
            ? ['charge', 'boltclose']
            : ['boltclose']
      : [];
    assert.deepEqual(
      trace.map((e) => e.phase),
      id === 'shotgun'
        ? ['start', 'shellin', ...action, 'end']
        : ['start', 'magout', 'magin', ...action, 'end'],
      `${id}/${clip.name}: exact audio beats`
    );
    for (const row of trace) {
      const event = clip.events.find(
        (e) =>
          e.name === ({ slide: 'boltrelease', boltclose: 'boltrelease' }[row.phase] ?? row.phase)
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
  ['shotgun', ['pump']],
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
audio._onReload({ weapon: 'rifle', phase: 'magin', position: { x: 2, y: 1, z: 3 } });
assert.deepEqual(spatial[0].slice(0, 4), ['reload', 2, 1, 3], 'positioned payload stays spatial');
assert.equal(spatial[0][4].reloadWeapon, 'rifle');
vm.dispose();
bank.dispose();
assert.deepEqual(bank.reloadBuffers, {});
console.log(
  `Reloads: 20 assets/${bytes} bytes/${Math.round(seconds * 48000 * 4)} decoded bytes; seven native weapon timelines, routing, cancellation, pump/bolt and casing invariants passed`
);

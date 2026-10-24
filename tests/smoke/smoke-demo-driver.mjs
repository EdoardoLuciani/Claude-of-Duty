import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';

import * as THREE from 'three';

import { INFANTRY } from '../../src/ai/capabilities.ts';
import { SurfaceNav } from '../../src/ai/nav.ts';
import { EventBus } from '../../src/core/registry.ts';

const probes = [];
let floor = 2,
  attached = true;
const nav = Object.assign(Object.create(SurfaceNav.prototype), {
  physics: {
    groundHeight(x, z, y) {
      probes.push({ x, z, y });
      return floor;
    },
  },
  _sample: new THREE.Vector3(),
  project(point, out) {
    out.copy(point);
    return attached ? 1 : 0;
  },
});
const spawned = [];
const ai = {
  grid: nav,
  agents: [],
  createSquad: () => ({ add() {} }),
  spawn(variant, position, yaw) {
    const actor = { variant, position, yaw };
    spawned.push(actor);
    return actor;
  },
  groundAt() {
    assert.fail('failed surface sampling must not use a ground-only fallback');
  },
};
const systems = { ai, player: { feetPosition: new THREE.Vector3(0, 2, 0) } };
const window = {
  __ENGINE__: {
    ctx: { config: {}, peek: (id) => systems[id] },
    camera: { position: new THREE.Vector3(0, 3.66, 0), quaternion: new THREE.Quaternion() },
    events: new EventBus(),
    time: { frame: 0 },
  },
};
const document = {
  createElement: () => ({ style: {}, querySelector: () => ({ style: {} }) }),
  body: { appendChild() {} },
};
const driver = readFileSync(new URL('../../tools/demo-driver.js', import.meta.url), 'utf8');
assert.equal(runInNewContext(driver, { window, document }).installed, true);
assert.equal(window.__DEMO__.wave(3, 14, 22), 3, 'the injected driver accepts the current nav API');
assert.equal(spawned.length, 3);
assert(probes.every((p) => p.y === systems.player.feetPosition.y + INFANTRY.stepHeight));
assert(spawned.every((a) => Math.abs(a.position.y - (floor + 0.008)) < 1e-12));

attached = false;
assert.equal(window.__DEMO__.wave(2), 0, 'rejected attachments cannot become spawn points');
attached = true;
for (const invalidFloor of [NaN, 0, 5]) {
  floor = invalidFloor;
  assert.equal(window.__DEMO__.wave(2), 0, 'missing/wrong-floor surfaces cannot spawn enemies');
}
ai.grid = null;
assert.equal(window.__DEMO__.wave(2), 0, 'missing navigation has no fallback');
ai.grid = nav;
systems.player = null;
assert.equal(window.__DEMO__.wave(2), 0, 'missing player feet has no guessed height');
assert.equal(spawned.length, 3);
console.log(
  'demo driver: native surface sampling, feet height and failed/missing attachment guards passed'
);

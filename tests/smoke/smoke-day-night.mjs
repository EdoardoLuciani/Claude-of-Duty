import assert from 'node:assert/strict';
import * as THREE from 'three';
import { CLOCK } from '../../src/sky/tuning.js';
import { MOON_ILLUMINANCE_NIGHT } from '../../src/sky/atmosphere.js';
import { SkySystem } from '../../src/sky/index.js';
import { WorldSystem } from '../../src/world/index.js';
import { OUTAGE, tickStreetlightOutage } from '../../src/world/lighting.js';
import { RenderSystem } from '../../src/render/index.js';
import { PlayerSystem } from '../../src/player/index.js';
import { FLASHLIGHT } from '../../src/player/tuning.js';

assert.equal(MOON_ILLUMINANCE_NIGHT, 0.03);
assert.equal(CLOCK.startHour, 16.5);
assert.equal(CLOCK.hoursPerSecond * 600, 9);
const state = { triggered: false, elapsed: 0 };
assert.equal(tickStreetlightOutage(state, 1, 20.99), 1);
assert.equal(state.triggered, false);
assert.equal(tickStreetlightOutage(state, 1 / 60, 21), 1);
assert.equal(state.elapsed, 0);
assert.equal(tickStreetlightOutage(state, 0.4, 21), 0, 'flicker drops power');
assert.equal(tickStreetlightOutage(state, 0.35, 21), 1, 'flicker restores power');
state.elapsed = OUTAGE.flickerSeconds;
assert.equal(tickStreetlightOutage(state, 0, 21), 0);
assert.equal(tickStreetlightOutage(state, 0, 21), 0, 'pause does not age outage');
assert.equal(tickStreetlightOutage(state, 179.99, 23), 0);
assert.equal(tickStreetlightOutage(state, 0.02, 23), 1, 'three full dark minutes then restore');
assert.equal(tickStreetlightOutage(state, 1600, 21), 1, 'next night does not retrigger');

// Clock update uses scaled dt, wraps midnight, and stops on death.
const player = { dead: false };
const ctx = { camera: new THREE.PerspectiveCamera(), time: { elapsed: 0 }, peek: () => player };
const sky = Object.assign(Object.create(SkySystem.prototype), {
  hour: CLOCK.startHour, timeRate: CLOCK.hoursPerSecond,
  shared: { uCloudParams: { value: new THREE.Vector4() }, uStarParams: { value: new THREE.Vector4() },
    uFogDrift: { value: new THREE.Vector3() } },
  cloudShadowAt: () => 1, _cloudOcclusion: 1, _envAge: 0,
  _applyLightIntensities() {}, _updateCelestial() {},
});
sky.update(0, ctx);
assert.equal(sky.hour, 16.5, 'pause/shop scaled dt freezes clock');
sky.update(600, ctx);
assert.ok(Math.abs(sky.hour - 1.5) < 1e-10);
sky.update(100, ctx);
assert.ok(Math.abs(sky.hour - 3) < 1e-10, 'clock continues toward dawn');
player.dead = true;
sky.update(100, ctx);
assert.equal(sky.hour, 3);
player.dead = false;
sky.timeRate = 0;
sky.update(100, ctx);
assert.equal(sky.hour, 3, 'capture default zero rate holds explicit time');

// Zero owned directional light is authoritative: no daytime fallback.
const moon = new THREE.DirectionalLight(0xffffff, 0);
const render = Object.assign(Object.create(RenderSystem.prototype), {
  sun: new THREE.DirectionalLight(0xffffff, 4.3), _dirLights: [moon], _nDirLights: 1,
  sunDir: new THREE.Vector3(), sunDirView: new THREE.Vector3(),
  _dirFromLight(_light, out) { out.set(0, 1, 0); },
});
render._syncSun(ctx.camera);
assert.equal(render.activeSun, moon);
assert.equal(render.sun.visible, false);

// Power changes affect lamps and their emissive lenses, never interior bulbs.
const lamp = new THREE.PointLight();
lamp.userData.owDayIntensity = 0;
lamp.userData.owNightIntensity = 14;
const bulb = new THREE.PointLight();
bulb.userData.owDayIntensity = 1;
bulb.userData.owNightIntensity = 22;
const world = Object.assign(Object.create(WorldSystem.prototype), {
  ctx: { peek: () => ({ sunAltitude: -1 }) }, lamps: [lamp], bulbs: [bulb],
  lampLens: { emissiveIntensity: 0 }, _lampMix: -1, _lampPower: -1,
});
world.setStreetlightPower(1);
assert.equal(lamp.intensity, 14);
assert.equal(bulb.intensity, 22);
world.setStreetlightPower(0);
assert.equal(lamp.intensity, 0);
assert.equal(world.lampLens.emissiveIntensity, 0);
assert.equal(bulb.intensity, 22);
assert.equal(lamp.visible, true, 'power cut does not remove a shader light slot');
world.setStreetlightPower(1);
assert.equal(lamp.intensity, 14);

// Toggle keeps the spot/shadow slot, follows camera, and refuses a dead player.
const p = Object.assign(Object.create(PlayerSystem.prototype), {
  ctx, health: { dead: false }, flashlightOn: false,
  flashlight: new THREE.SpotLight(FLASHLIGHT.color, 0),
});
p.flashlight.castShadow = true;
p.setFlashlightEnabled(true);
assert.equal(p.flashlight.intensity, FLASHLIGHT.intensity);
ctx.camera.position.set(3, 2, 1);
p.lateUpdate();
assert.deepEqual(p.flashlight.position.toArray(), [3, 2, 1]);
assert.deepEqual(p.flashlight.target.position.toArray(), [3, 2, 0]);
assert.equal(p.flashlight.shadow.needsUpdate, true);
p.setFlashlightEnabled(false);
assert.equal(p.flashlight.intensity, 0);
assert.equal(p.flashlight.visible, true);
assert.equal(p.flashlight.castShadow, true);
assert.equal(p.flashlight.shadow.needsUpdate, false);
p.health.dead = true;
p.setFlashlightEnabled(true);
assert.equal(p.flashlightOn, false);

console.log('day/night, outage, dark-sky authority and flashlight smoke passed');

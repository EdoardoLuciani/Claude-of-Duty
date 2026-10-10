import assert from 'node:assert/strict';
import * as THREE from 'three';
import { CLOCK } from '../../src/sky/tuning.ts';
import { MOON_ILLUMINANCE_NIGHT } from '../../src/sky/atmosphere.js';
import { SkySystem } from '../../src/sky/index.js';
import { WorldSystem } from '../../src/world/index.js';
import { OUTAGE, tickStreetlightOutage } from '../../src/world/lighting.js';
import { RenderSystem } from '../../src/render/index-webgpu.js';
import { PlayerSystem } from '../../src/player/index.js';
import { FLASHLIGHT } from '../../src/player/tuning.ts';
import { FxSystem } from '../../src/fx/index.js';
import { MaterialSystemNode } from '../../src/materials/index.js';

assert.equal(MOON_ILLUMINANCE_NIGHT, 0.03);
assert.equal(CLOCK.startHour, 16.5);
assert.equal(CLOCK.hoursPerSecond * 600, 9);
const state = { elapsed: -1 };
assert.equal(tickStreetlightOutage(state, 1, 20.99), 1);
assert.equal(state.elapsed, -1);
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
const moon = new THREE.DirectionalLight(0xaabbff, 0), sun = new THREE.DirectionalLight(0xffeeaa, 3);
const keyProxy = new THREE.DirectionalLight(), secondaryProxy = new THREE.DirectionalLight();
const skyLights = Object.assign(new SkySystem(), {
  keyLight: moon, sunLight: sun, moonLight: moon, _cloudOcclusion: 1,
});
skyLights.shared = { uKeyDir: { value: skyLights.keyDirection }, uKeyIrr: { value: new THREE.Vector3() } };
let shadowSetups = 0;
const render = Object.assign(Object.create(RenderSystem.prototype), {
  sun: new THREE.DirectionalLight(0xffffff, 4.3), _skyKey: keyProxy, _skySecondary: secondaryProxy,
  indirect: { sunDir: { value: new THREE.Vector3() } },
  _setupShadows(light) { assert.equal(light, keyProxy); shadowSetups++; },
});
render.activeSun = render.sun;
for (const key of [moon, sun, moon]) {
  key.position.set(key === moon ? -3 : 4, 8, 2);
  skyLights._baseSunIntensity = key === moon ? 0 : 3;
  moon.intensity = key === moon ? .03 : 0;
  skyLights._applyLightIntensities();
  assert.equal(skyLights.keyLight, key);
  assert(skyLights.keyDirection.distanceTo(key.position.clone().sub(key.target.position).normalize()) < 1e-12);
  render._syncSun({ peek: () => skyLights });
  assert.equal(render.activeSun, keyProxy, 'handoffs retain the shader light identity');
  assert.equal(render.sunDir, skyLights.keyDirection);
  assert.equal(render.indirect.sunDir.value, skyLights.keyDirection);
  assert.equal(skyLights.shared.uKeyDir.value, skyLights.keyDirection);
  assert.equal(keyProxy.intensity, key.intensity);
  assert.deepEqual(keyProxy.color, key.color);
  assert.deepEqual(keyProxy.position, key.position);
  assert.equal(secondaryProxy.intensity, key === moon ? sun.intensity : moon.intensity);
  assert.equal(render.sun.visible, false, 'zero owned key never revives fallback daylight');
  assert.equal(sun.visible || moon.visible, false, 'source lights do not contribute twice');
}
assert.equal(shadowSetups, 1);
const materials = Object.assign(new MaterialSystemNode(), {
  _shared: { keyDir: { value: null }, keyColor: { value: new THREE.Vector3() } },
});
materials.update(0, { peek: id => id === 'sky' ? skyLights : render });
assert.equal(materials._shared.keyDir.value, skyLights.keyDirection);
// The key uses the placed light (including its near-horizon clamp), not the
// distinct astronomical sun/moon directions used by sky discs and atmosphere.
skyLights._tmp = new THREE.Vector3();
skyLights._placeLight(moon, new THREE.Vector3(1, -.1, 0).normalize(), .026);
skyLights._applyLightIntensities();
assert(skyLights.keyDirection.y > 0);
assert.equal(materials._shared.keyDir.value, skyLights.shared.uKeyDir.value);
moon.intensity = 0;
skyLights._applyLightIntensities();
render._syncSun({ peek: () => skyLights });
assert.equal(render.activeSun.intensity, 0, 'zero owned key stays dark');
assert.equal(render.sun.visible, false);
skyLights.keyLight = moon; sun.intensity = 3;

// FX runs before render synchronization: emitted data must use this tick's
// authored key, not yesterday's proxy value. Preview stubs retain a fallback.
const fx = Object.assign(Object.create(FxSystem.prototype), {
  render, layers: [], _sunView: new THREE.Vector3(), _sunCol: new THREE.Vector3(),
  _ambTop: new THREE.Vector3(), _ambBot: new THREE.Vector3(),
  _upView: new THREE.Vector3(), _fog: new THREE.Vector4(),
});
const fxCtx = { camera: ctx.camera, scene: new THREE.Scene(), peek: () => skyLights };
keyProxy.intensity = 4.3;
fx._syncLighting(fxCtx);
assert.equal(fx._sunFactor, 0, 'dark authored key wins over stale bright proxy');
skyLights.keyLight = sun;
fx._syncLighting(fxCtx);
assert.equal(fx._sunFactor, sun.intensity / 4.3);
assert.equal(fx._sunCol.x, sun.color.r * sun.intensity);
fx._syncLighting({ ...fxCtx, peek: () => null });
assert.equal(fx._sunFactor, 1, 'isolated FX preview can use its render stub');

// Native applies the legacy renderer practical gain (.55) in the world owner.
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
assert.equal(lamp.intensity, 14 * .55);
assert.equal(bulb.intensity, 22 * .55);
world.setStreetlightPower(0);
assert.equal(lamp.intensity, 0);
assert.equal(world.lampLens.emissiveIntensity, 0);
assert.equal(bulb.intensity, 22 * .55);
assert.equal(lamp.visible, true, 'power cut does not remove a shader light slot');
world.setStreetlightPower(1);
assert.equal(lamp.intensity, 14 * .55);

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

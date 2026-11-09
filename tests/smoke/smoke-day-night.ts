import assert from 'node:assert/strict';

import * as THREE from 'three';
import { uniform } from 'three/tsl';
import { MeshStandardNodeMaterial } from 'three/webgpu';

import type { Agent } from '../../src/ai/agent.ts';
import { AiSystem } from '../../src/ai/index.ts';
import { FxSystem } from '../../src/fx/index.ts';
import { MaterialSystemNode } from '../../src/materials/index.ts';
import { Health } from '../../src/player/health.ts';
import { PlayerSystem } from '../../src/player/index.ts';
import { FLASHLIGHT } from '../../src/player/tuning.ts';
import { RenderSystem } from '../../src/render/index-webgpu.ts';
import { IndirectFill } from '../../src/render/indirect-webgpu.ts';
import { MOON_ILLUMINANCE_NIGHT } from '../../src/sky/atmosphere.ts';
import { Celestial } from '../../src/sky/celestial.ts';
import { SkySystem } from '../../src/sky/index.ts';
import { CLOCK } from '../../src/sky/tuning.ts';
import { WorldSystem } from '../../src/world/index.ts';
import { OUTAGE, tickStreetlightOutage } from '../../src/world/lighting.ts';
import { createTestContext } from '../lib/context.ts';
import * as complete from '../lib/fixture-targets.ts';
import { fixture } from '../lib/fixture.ts';
import { captureMethod } from '../lib/render-fixture.ts';

function skySharedTarget(): SkySystem['shared'] {
  return {
    get uMieScale(): never {
      return complete.unavailable('uMieScale');
    },
    get uViewPos(): never {
      return complete.unavailable('uViewPos');
    },
    get uSunDir(): never {
      return complete.unavailable('uSunDir');
    },
    get uMoonDir(): never {
      return complete.unavailable('uMoonDir');
    },
    get uSunIrradiance(): never {
      return complete.unavailable('uSunIrradiance');
    },
    get uMoonIrradiance(): never {
      return complete.unavailable('uMoonIrradiance');
    },
    get uSunDiscRadiance(): never {
      return complete.unavailable('uSunDiscRadiance');
    },
    get uMoonDiscRadiance(): never {
      return complete.unavailable('uMoonDiscRadiance');
    },
    get uSunAltitude(): never {
      return complete.unavailable('uSunAltitude');
    },
    get uMoonAltitude(): never {
      return complete.unavailable('uMoonAltitude');
    },
    get uMoonRelAz(): never {
      return complete.unavailable('uMoonRelAz');
    },
    get uDisc(): never {
      return complete.unavailable('uDisc');
    },
    get uGroundAlbedo(): never {
      return complete.unavailable('uGroundAlbedo');
    },
    get uHorizonMurk(): never {
      return complete.unavailable('uHorizonMurk');
    },
    get uSkyRolloff(): never {
      return complete.unavailable('uSkyRolloff');
    },
    get uStarParams(): never {
      return complete.unavailable('uStarParams');
    },
    get uCelestial(): never {
      return complete.unavailable('uCelestial');
    },
    get uCloudParams(): never {
      return complete.unavailable('uCloudParams');
    },
    get uCloudParams2(): never {
      return complete.unavailable('uCloudParams2');
    },
    get uFog(): never {
      return complete.unavailable('uFog');
    },
    get uFog2(): never {
      return complete.unavailable('uFog2');
    },
    get uFogExt(): never {
      return complete.unavailable('uFogExt');
    },
    get uPhase(): never {
      return complete.unavailable('uPhase');
    },
    get uKeyDir(): never {
      return complete.unavailable('uKeyDir');
    },
    get uKeyIrr(): never {
      return complete.unavailable('uKeyIrr');
    },
    get uFogDrift(): never {
      return complete.unavailable('uFogDrift');
    },
  };
}

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
const playerHealth = fixture<Health>({ dead: false }, complete.testHealth());
const player = fixture<PlayerSystem>(
  {
    get dead(): boolean {
      return playerHealth.dead;
    },
  },
  complete.testPlayer()
);
const ctx = createTestContext({ providers: { player } });
const sky = fixture<SkySystem>(
  {
    update: captureMethod(SkySystem.prototype, 'update'),
    _skyDirty: false,
    _envDirty: false,
    hour: CLOCK.startHour,
    timeRate: CLOCK.hoursPerSecond,
    shared: fixture<SkySystem['shared']>(
      {
        uCloudParams: uniform(new THREE.Vector4()),
        uStarParams: uniform(new THREE.Vector4()),
        uFogDrift: uniform(new THREE.Vector3()),
      },
      skySharedTarget()
    ),
    cloudShadowAt: (): number => 1,
    _cloudOcclusion: 1,
    _envAge: 0,
    _applyLightIntensities(): void {},
    _updateCelestial(): void {},
  },
  new complete.SkySystem()
);
sky.update(0, ctx);
assert.equal(sky.hour, 16.5, 'pause/shop scaled dt freezes clock');
sky.update(600, ctx);
assert.ok(Math.abs(sky.hour - 1.5) < 1e-10);
sky.update(100, ctx);
assert.ok(Math.abs(sky.hour - 3) < 1e-10, 'clock continues toward dawn');
playerHealth.dead = true;
sky.update(100, ctx);
assert.equal(sky.hour, 3);
playerHealth.dead = false;
sky.timeRate = 0;
sky.update(100, ctx);
assert.equal(sky.hour, 3, 'capture default zero rate holds explicit time');

// Zero owned directional light is authoritative: no daytime fallback.
const moon = new THREE.DirectionalLight(0xaabbff, 0),
  sun = new THREE.DirectionalLight(0xffeeaa, 3);
const keyProxy = new THREE.DirectionalLight(),
  secondaryProxy = new THREE.DirectionalLight();
const skyLights = new SkySystem();
skyLights.keyLight = moon;
skyLights.sunLight = sun;
skyLights.moonLight = moon;
skyLights._cloudOcclusion = 1;
skyLights.shared = fixture<SkySystem['shared']>(
  {
    uKeyDir: uniform(skyLights.keyDirection),
    uKeyIrr: uniform(new THREE.Vector3()),
  },
  skySharedTarget()
);
const providers = { sky: skyLights };
const lightingCtx = createTestContext({ providers });
let shadowSetups = 0;
const render = fixture<RenderSystem>(
  {
    _syncSun: captureMethod(RenderSystem.prototype, '_syncSun'),
    _lightsReady: false,
    _skyKey: keyProxy,
    _skySecondary: secondaryProxy,
    indirect: new IndirectFill(lightingCtx),
    _setupShadows(light): void {
      assert.equal(light, keyProxy);
      shadowSetups++;
    },
  },
  new complete.RenderSystem()
);
render.activeSun = keyProxy;
for (const key of [moon, sun, moon]) {
  key.position.set(key === moon ? -3 : 4, 8, 2);
  skyLights._baseSunIntensity = key === moon ? 0 : 3;
  moon.intensity = key === moon ? 0.03 : 0;
  skyLights._applyLightIntensities();
  assert.equal(skyLights.keyLight, key);
  assert(
    skyLights.keyDirection.distanceTo(key.position.clone().sub(key.target.position).normalize()) <
      1e-12
  );
  render._syncSun(lightingCtx);
  assert.equal(render.activeSun, keyProxy, 'handoffs retain the shader light identity');
  assert.equal(render.sunDir, skyLights.keyDirection);
  assert.equal(render.indirect.sunDir.value, skyLights.keyDirection);
  assert.equal(skyLights.shared.uKeyDir.value, skyLights.keyDirection);
  assert.equal(keyProxy.intensity, key.intensity);
  assert.deepEqual(keyProxy.color, key.color);
  assert.deepEqual(keyProxy.position, key.position);
  assert.equal(secondaryProxy.intensity, key === moon ? sun.intensity : moon.intensity);
  assert.equal('sun' in render, false, 'renderer has no fallback daylight');
  assert.equal(sun.visible || moon.visible, false, 'source lights do not contribute twice');
}
assert.equal(shadowSetups, 1);

// At 01:30 an elevated, off-screen soldier can cast a visible moon shadow.
// The same rendered-key sweep protects emergency rollback visibility.
{
  const celestial = new Celestial().setHour(1.5);
  skyLights.celestial = celestial;
  skyLights._tmp = new THREE.Vector3();
  skyLights._placeLight(moon, celestial.moon, 0.026);
  skyLights._baseSunIntensity = 0;
  moon.intensity = 0.03;
  skyLights._applyLightIntensities();
  assert.equal(skyLights.keyLight, moon);
  const key = skyLights.keyDirection.clone();
  const mesh = new THREE.SkinnedMesh(new THREE.BoxGeometry(1, 2, 1), new THREE.MeshBasicMaterial());
  mesh.geometry.computeBoundingSphere();
  mesh.position.set(0, 20, 0);
  mesh.updateMatrixWorld(true);
  const shadow = mesh.position.clone().addScaledVector(key, -20 / key.y);
  const camera = new THREE.PerspectiveCamera(40, 1, 0.1, 100);
  camera.position.copy(shadow).add(new THREE.Vector3(0, 2, 6));
  camera.lookAt(shadow);
  camera.updateMatrixWorld(true);
  const a = fixture<Agent>(
    { mesh, position: mesh.position, radius: 0.34, height: 2, alive: true },
    complete.makeAgent()
  );
  const ai = fixture<AiSystem>(
    {
      _sky: null,
      _sunDirection: captureMethod(AiSystem.prototype, '_sunDirection'),
      _updateRelevance: captureMethod(AiSystem.prototype, '_updateRelevance'),
      canRollback: captureMethod(AiSystem.prototype, 'canRollback'),
      agents: [a],
      ctx: createTestContext({ camera, providers }),
      phys: fixture<NonNullable<AiSystem['_phys']>>(
        {
          staticWorld: fixture<NonNullable<AiSystem['_phys']>['staticWorld']>(
            { dirty: false },
            new complete.StaticWorld()
          ),
        },
        new complete.PhysicsSystem()
      ),
      _frustum: new THREE.Frustum(),
      _mvp: new THREE.Matrix4(),
      _sphere: new THREE.Sphere(),
      _sweep: new THREE.Sphere(),
      _sun: new THREE.Vector3(),
      _lodStats: { irrelevant: 0 },
      stats: complete.makeAi().stats,
    },
    complete.makeAi()
  );
  const originalSun = celestial.sun.clone();
  skyLights.keyDirection.copy(originalSun); // negative control: former astronomical direction
  ai._updateRelevance(ai.ctx);
  assert.equal(mesh.castShadow, false, 'sun-only culling loses this moonlit caster');
  skyLights.keyDirection.copy(key);
  ai._updateRelevance(ai.ctx);
  assert.equal(mesh.castShadow, true, 'moon-projected receiver is in the frustum');
  assert.equal(a.lodIrrelevant, false);
  assert.equal(
    ai.canRollback(a, new THREE.Vector3(100, 20, 100)),
    false,
    'visible moon shadow forbids rollback'
  );
  assert.ok(celestial.sun.equals(originalSun), 'AI must not mutate borrowed sky vectors');
  mesh.geometry.dispose();
  mesh.material.dispose();
}

const materials = new MaterialSystemNode();
materials._shared = fixture<NonNullable<MaterialSystemNode['_shared']>>(
  {
    keyDir: uniform(new THREE.Vector3()),
    keyColor: uniform(new THREE.Vector3()),
  },
  {
    get detailNormal(): never {
      return complete.unavailable('detailNormal');
    },
    get detailAlbedo(): never {
      return complete.unavailable('detailAlbedo');
    },
    get macro(): never {
      return complete.unavailable('macro');
    },
    get keyDir(): never {
      return complete.unavailable('keyDir');
    },
    get keyColor(): never {
      return complete.unavailable('keyColor');
    },
  }
);
materials.update(0, lightingCtx);
assert.equal(materials._shared.keyDir.value, skyLights.keyDirection);
// The key uses the placed light (including its near-horizon clamp), not the
// distinct astronomical sun/moon directions used by sky discs and atmosphere.
skyLights._tmp = new THREE.Vector3();
skyLights._placeLight(moon, new THREE.Vector3(1, -0.1, 0).normalize(), 0.026);
skyLights._applyLightIntensities();
assert(skyLights.keyDirection.y > 0);
assert.equal(materials._shared.keyDir.value, skyLights.shared.uKeyDir.value);
moon.intensity = 0;
skyLights._applyLightIntensities();
render._syncSun(lightingCtx);
assert.equal(render.activeSun.intensity, 0, 'zero owned key stays dark');
assert.equal('sun' in render, false);
skyLights.keyLight = moon;
sun.intensity = 3;

// FX runs before render synchronization: emitted data must use this tick's
// authored key, not yesterday's proxy value. Preview stubs retain a fallback.
const fx = fixture<FxSystem>(
  {
    _syncLighting: captureMethod(FxSystem.prototype, '_syncLighting'),
    _viewAttached: false,
    render,
    layers: [],
    _sunView: new THREE.Vector3(),
    _sunCol: new THREE.Vector3(),
    _ambTop: new THREE.Vector3(),
    _ambBot: new THREE.Vector3(),
    _upView: new THREE.Vector3(),
    _fog: new THREE.Vector4(),
  },
  new complete.FxSystem()
);
const fxCtx = createTestContext({ camera: ctx.camera, providers });
keyProxy.intensity = 4.3;
fx._syncLighting(fxCtx);
assert.equal(fx._sunFactor, 0, 'dark authored key wins over stale bright proxy');
skyLights.keyLight = sun;
fx._syncLighting(fxCtx);
assert.equal(fx._sunFactor, sun.intensity / 4.3);
assert.equal(fx._sunCol.x, sun.color.r * sun.intensity);
fx._syncLighting(createTestContext({ camera: fxCtx.camera, scene: fxCtx.scene }));
assert.equal(fx._sunFactor, 1, 'isolated FX preview can use its render stub');

// Native applies the legacy renderer practical gain (.55) in the world owner.
// Power changes affect lamps and their emissive lenses, never interior bulbs.
const lamp = new THREE.PointLight();
lamp.userData.owDayIntensity = 0;
lamp.userData.owNightIntensity = 14;
const bulb = new THREE.PointLight();
bulb.userData.owDayIntensity = 1;
bulb.userData.owNightIntensity = 22;
const nightCtx = createTestContext({
  providers: { sky: fixture<SkySystem>({ sunAltitude: -1 }, new complete.SkySystem()) },
});
const world = fixture<WorldSystem>(
  {
    setStreetlightPower: captureMethod(WorldSystem.prototype, 'setStreetlightPower'),
    _updateLights: captureMethod(WorldSystem.prototype, '_updateLights'),
    ctx: nightCtx,
    lamps: [lamp],
    bulbs: [bulb],
    lampLens: new MeshStandardNodeMaterial({ emissiveIntensity: 0 }),
    _lampMix: -1,
    _lampPower: -1,
  },
  new complete.WorldSystem()
);
world.setStreetlightPower(1);
assert.equal(lamp.intensity, 14 * 0.55);
assert.equal(bulb.intensity, 22 * 0.55);
world.setStreetlightPower(0);
assert.equal(lamp.intensity, 0);
assert.equal(world.lampLens!.emissiveIntensity, 0);
assert.equal(bulb.intensity, 22 * 0.55);
assert.equal(lamp.visible, true, 'power cut does not remove a shader light slot');
world.setStreetlightPower(1);
assert.equal(lamp.intensity, 14 * 0.55);

// Toggle keeps the spot/shadow slot, follows camera, and refuses a dead player.
const p = fixture<PlayerSystem>(
  {
    setFlashlightEnabled: captureMethod(PlayerSystem.prototype, 'setFlashlightEnabled'),
    lateUpdate: captureMethod(PlayerSystem.prototype, 'lateUpdate'),
    ctx,
    health: new Health(ctx, null),
    flashlightOn: false,
    flashlight: new THREE.SpotLight(FLASHLIGHT.color, 0),
  },
  complete.testPlayer()
);
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

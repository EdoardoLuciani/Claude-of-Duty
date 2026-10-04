#!/usr/bin/env node
/**
 * CPU + graph-construction smoke test for the TSL sky subsystem.
 *
 * The real render validation is the GPU probe under tools/sky-webgpu/ (it needs
 * a full Chromium and a real adapter). This test runs in plain Node and guards
 * the parts that must not regress without a GPU:
 *   - spherical astronomy and the photometric transmittance
 *   - the CPU cloud-occlusion twin
 *   - every TSL sky module builds its node graph (the failure mode that a
 *     missing nested-loop name or a wrong swizzle produces at shader-build time)
 *   - the strict-WebGPU-only guard.
 */
import assert from 'node:assert/strict';
import { DataTexture, FloatType, HalfFloatType, RGBAFormat } from 'three/webgpu';
import { mat3, texture, uniform, vec2, vec3, vec4 } from 'three/tsl';

import { ATMO, SCENE_LUX, transmittanceToSpace } from '../src/sky/atmosphere.js';
import { Celestial, SITE } from '../src/sky/celestial.js';
import { cloudMacro, cloudSunOcclusion } from '../src/sky/clouds.js';
import { createAtmosphereNodes, createRaymarchSky, createSkyViewLookup } from '../src/sky/atmosphere-tsl.js';
import { createCloudNodes } from '../src/sky/clouds-tsl.js';
import { createNightSkyNodes } from '../src/sky/stars.js';
import { createSkySample, dirFromEquirectUv, createSkyDome } from '../src/sky/dome.js';
import { createVolumetricNodes } from '../src/sky/volumetrics.js';
import { SkyLuts } from '../src/sky/luts.js';
import { SkySystem } from '../src/sky/index.js';

// ---- spherical astronomy --------------------------------------------------
const cel = new Celestial();
cel.setHour(16.5);
assert.ok(Math.abs(cel.sunAlt * 180 / Math.PI - 32.0) < 0.5,
  `sun altitude at 16:30: ${cel.sunAlt * 180 / Math.PI}`);
assert.ok(Math.abs(cel.sun.length() - 1) < 1e-6, 'sun direction must be unit');
cel.setHour(1.5);
assert.ok(cel.sunAlt < 0 && cel.moonAlt > 0, 'night must have the moon up');
assert.ok(cel.moonPhase > 0 && cel.moonPhase <= 1, 'moon phase in range');
assert.ok(SITE.latitudeDeg === 45);

// ---- photometry -----------------------------------------------------------
assert.equal(SCENE_LUX, 25000);
const clear = transmittanceToSpace(Math.sin(32 * Math.PI / 180), 1.35);
assert.ok(clear[0] > 0.5 && clear[0] <= 1, `clear transmittance: ${clear}`);
assert.ok(clear[2] < clear[0], 'blue must be extinguished faster than red');
const low = transmittanceToSpace(Math.sin(2 * Math.PI / 180), 1.35);
assert.ok(low[2] < clear[2] && low[0] > low[2], `low-sun reddening: ${low}`);
assert.ok(ATMO.atmosphereRadiusMM > ATMO.groundRadiusMM);

// ---- CPU cloud occlusion --------------------------------------------------
assert.ok(cloudMacro(0, 0) >= 0 && cloudMacro(0, 0) <= 1);
const occ = cloudSunOcclusion(0, 0, { x: 0, y: 0.7, z: 0 },
  { coverage: 0.7, density: 1.9, windX: 0.003, windZ: 0.001, time: 10 });
assert.ok(occ > 0 && occ <= 1, `occlusion in range: ${occ}`);

// ---- TSL graph construction ----------------------------------------------
const tex = (type) => new DataTexture(new Uint16Array(4 * 4 * 4), 4, 4, RGBAFormat, type);
const shared = {
  uViewPos: uniform(vec3(0, 6.3602, 0)), uMieScale: uniform(1.35),
  uSunDir: uniform(vec3(0, 0.5, -0.8)), uMoonDir: uniform(vec3(0, -0.5, 0.8)),
  uSunIrradiance: uniform(vec3(5.12)), uMoonIrradiance: uniform(vec3(0)),
  uSunDiscRadiance: uniform(vec3(4000)), uMoonDiscRadiance: uniform(vec3(0.35)),
  uDisc: uniform(vec4(0.004654, 0.004516, 3, 4.2)),
  uGroundAlbedo: uniform(vec3(0.33, 0.29, 0.225)),
  uHorizonMurk: uniform(0.13), uSkyRolloff: uniform(vec2(0.3, 1.5)),
  uStarParams: uniform(vec4(0.07, 0.55, 0, 0.16)),
  uCelestial: uniform(mat3(1, 0, 0, 0, 1, 0, 0, 0, 1)),
  uCloudParams: uniform(vec4(0.3, 1.9, 1, 0)),
  uCloudParams2: uniform(vec4(0.21, 0.3, 0.0042, 0.0016)),
  uSunAltitude: uniform(0.5), uMoonAltitude: uniform(-0.5), uMoonRelAz: uniform(2),
  uFog: uniform(vec4(3.6e-3, 1 / 18, -2, 900)),
  uFog2: uniform(vec4(1.45e-3, 2.6, 0.22, 0.55)),
  uFogExt: uniform(vec3(0.0014)), uPhase: uniform(vec4(0.76, -0.36, 0.34, 0.045)),
  uKeyDir: uniform(vec3(0, 0.5, -0.8)), uKeyIrr: uniform(vec3(5)),
  uFogDrift: uniform(vec3(0)),
};
shared.transmittanceTex = tex(FloatType);
shared.multiScatterTex = tex(HalfFloatType);
shared.skyViewTex = tex(HalfFloatType);
shared.ambientTex = tex(HalfFloatType);

const atmo = createAtmosphereNodes(shared);
const skyView = createSkyViewLookup(shared);
const march = createRaymarchSky({ ...atmo, uMieScale: shared.uMieScale }, 40);
assert.ok(typeof march === 'function', 'raymarch graph must build');

const clouds = createCloudNodes(shared, { detail: true, octC: 2 });
shared.skCloudShadow = clouds.skCloudShadow;
const night = createNightSkyNodes(shared, { points: true, mwOctaves: 5 });
const screen = createSkySample(shared, { ...atmo, skSkyView: skyView, ...clouds, skNightSky: night },
  { points: true, moonOct: 4 });
const env = createSkySample(shared, { ...atmo, skSkyView: skyView, ...clouds, skNightSky: night },
  { points: false, moonOct: 2 });
assert.ok(screen(vec3(0, 0.3, -0.9)).isNode, 'screen sky node must build');
assert.ok(env(dirFromEquirectUv(vec2(0.5, 0.5))).isNode, 'env sky node must build');
assert.ok(createSkyDome(screen).isMesh, 'sky dome mesh must build');

// The LUT bake materials build against the bound lookups.
const luts = new SkyLuts(shared);
assert.ok(luts.skyViewRt.texture, 'sky-view target');
luts.build({
  uMieScale: shared.uMieScale,
  skTransmittance: atmo.skTransmittance,
  skRaymarchSky: march,
  skSkyView: skyView,
});
assert.ok(luts.transmittancePass && luts.ambientPass, 'LUT bake passes must build');
luts.dispose();

// The production fog node builds against texture nodes (no temporal history).
const vol = createVolumetricNodes(shared, { steps: 20, march: true });
const fog = vol.createNode({
  color: texture(shared.ambientTex),
  depth: texture(shared.multiScatterTex),
});
assert.ok(fog.isNode, 'fog node must build');
// ---- strict-WebGPU-only guard --------------------------------------------
assert.equal(SkySystem.id, 'sky');
assert.equal(typeof SkySystem.prototype.createFogNode, 'function');
const fakeCtx = {
  get: () => ({ renderer: { isWebGLRenderer: true } }),
  config: { q: {} },
};
await assert.rejects(() => new SkySystem().init(fakeCtx), /strict WebGPU/);
fakeCtx.get = () => ({ renderer: { isWebGPURenderer: true, backend: { isWebGLBackend: true } } });
await assert.rejects(() => new SkySystem().init(fakeCtx), /strict WebGPU/, 'convenience renderer with WebGL fallback is not native');

console.log(JSON.stringify({
  ok: true,
  sunAlt: cel.sunAlt,
  transmittance: clear,
  fogNode: fog.isNode,
}));

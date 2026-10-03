import assert from 'node:assert/strict';
import { Color, DirectionalLight, MeshPhysicalMaterial, MeshStandardMaterial,
  PerspectiveCamera, PointLight, Scene, Texture, Vector3 } from 'three';
import { renderGroup } from 'three/tsl';
import { IndirectFill } from '../../src/render/indirect-webgpu.js';
import { VIEW_LIGHTING, updateViewLighting } from '../../src/render/view-lighting.js';
import { createWeaponMaterial } from '../../src/weapons/asset-material.js';

for (const source of [new MeshStandardMaterial({ metalness: .7 }),
  new MeshPhysicalMaterial({ ior: 1.45, clearcoat: .25, transmission: .97, specularIntensity: .16 })]) {
  source.color.setRGB(.04, .08, .1); source.normalScale.set(.8, -.8); source.map = new Texture();
  const copy = createWeaponMaterial(source);
  assert(copy.isMeshPhysicalNodeMaterial && copy.isMeshStandardNodeMaterial);
  assert.deepEqual(copy.color, source.color); assert.notEqual(copy.color, source.color);
  assert.deepEqual(copy.normalScale, source.normalScale); assert.equal(copy.map, source.map);
  for (const p of ['metalness', 'roughness']) assert.equal(copy[p], source[p]);
  if (source.isMeshPhysicalMaterial) for (const p of ['ior', 'clearcoat', 'transmission', 'specularIntensity']) assert.equal(copy[p], source[p]);
  copy.dispose(); source.map.dispose(); source.dispose();
}

let blocked = false, calls = 0;
const physics = { staticWorld: { version: 1 }, MASK: { SIGHT: 7 }, raycastAny() { calls++; return blocked; } };
const ctx = { camera: new PerspectiveCamera(), scene: new Scene(), viewScene: new Scene(),
  time: { frame: 0, dt: 1 / 60 }, peek: name => name === 'physics' ? physics : null };
const r = { indirect: new IndirectFill(ctx), activeSun: new DirectionalLight(0xffffff, 6),
  sunDir: new Vector3(0, 1, 0), viewSun: new DirectionalLight(), viewFill: new DirectionalLight(),
  lights: [], _viewFillDirection: new Vector3(...VIEW_LIGHTING.fillDirection).normalize(),
  _viewVisibility: 1, _viewVisibilityFrame: null, _viewSkyVisibility: 1,
  _viewLightPosition: new Vector3(), _viewToLight: new Vector3(),
  _viewProbePosition: new Vector3(Infinity, Infinity, Infinity), _viewProbeWorld: null, _viewProbeVersion: -1,
  _viewSkyDirections: Array.from({ length: VIEW_LIGHTING.skySamples }, () => new Vector3(0, 1, 0)),
  viewPracticals: Array.from({ length: VIEW_LIGHTING.practicalCount }, () => ({ light: new PointLight(), score: 0, source: null, irradiance: 0 })) };
r.indirect.sky.value.set(1, .7, .5);
const ids = [r.viewSun.id, r.viewFill.id, ...r.viewPracticals.map(s => s.light.id)];
for (const name of ['sky', 'ground', 'sunDir', 'iblScale', 'viewVisibility']) assert.equal(r.indirect[name].groupNode, renderGroup);
const close = (a, b) => assert(Math.abs(a - b) < 1e-10, `${a} != ${b}`);
updateViewLighting(r, ctx);
close(r.viewSun.intensity, 6); close(r.indirect.viewVisibility.value, 1);
close(r.viewFill.color.r * r.viewFill.intensity, .7); close(r.viewLightLevel, 7);
assert.equal(calls, VIEW_LIGHTING.skySamples + 1);
const keyDirection = r.viewSun.position.clone().sub(r.viewSun.target.position).normalize();
ctx.camera.rotation.y = Math.PI / 2; ctx.time.frame++;
const beforeCalls = calls; updateViewLighting(r, ctx);
assert.equal(calls - beforeCalls, 1, 'turning reuses exact static sky queries, not key visibility');
assert.deepEqual(r.viewSun.position.clone().sub(r.viewSun.target.position).normalize(), keyDirection);
assert(r.viewFill.position.clone().sub(ctx.camera.position).distanceTo(
  r._viewFillDirection.clone().applyQuaternion(ctx.camera.quaternion)) < 1e-12);

const cachedCalls = calls;
ctx.camera.position.x = .01; ctx.time.frame++; updateViewLighting(r, ctx);
assert.equal(calls - cachedCalls, VIEW_LIGHTING.skySamples + 1, 'translation invalidates the sky probe');
ctx.camera.position.x = 0;
r.activeSun.intensity = .06; r.indirect.sky.value.multiplyScalar(.01); ctx.time.frame++;
updateViewLighting(r, ctx); close(r.viewSun.intensity, .06); close(r.viewFill.color.r * r.viewFill.intensity, .007);
r.activeSun.intensity = 0; r.indirect.sky.value.setScalar(0); ctx.time.frame++;
updateViewLighting(r, ctx); assert.deepEqual(r.viewFill.color, new Color(0, 0, 0), 'no permanent night headlight');

blocked = true; physics.staticWorld.version++; ctx.time.frame++;
updateViewLighting(r, ctx); assert(r.indirect.viewVisibility.value < 1 && r.indirect.viewVisibility.value > VIEW_LIGHTING.skyBounceFloor);
const settled = r.indirect.viewVisibility.value, keyVisibility = r._viewVisibility;
for (let i = 0; i < 20; i++) updateViewLighting(r, ctx);
assert.equal(r.indirect.viewVisibility.value, settled, 'render-only/warm calls do not advance smoothing');
assert.equal(r._viewVisibility, keyVisibility);
ctx.time.frame++; ctx.time.dt = 10; updateViewLighting(r, ctx);
close(r.indirect.viewVisibility.value, VIEW_LIGHTING.skyBounceFloor); close(r._viewVisibility, 0);

// Unshadowed world practicals must not acquire view-only wall shadows. A tagged
// light is selected by its world-space irradiance; brighter FX are not duplicated.
const parent = new Scene(); parent.position.set(2, 0, 0);
for (const [intensity, tagged] of [[1, true], [4, true], [2, true], [10000, false]]) {
  const light = new PointLight(0xffbb88, intensity, 10, 2);
  if (tagged) light.userData.owDayIntensity = intensity;
  parent.add(light); r.lights.push({ light });
}
ctx.time.frame++; updateViewLighting(r, ctx);
assert.deepEqual(r.viewPracticals.map(s => s.source.intensity).sort(), [2, 4]);
assert(r.viewPracticals.every(s => s.light.position.x === 2 && s.light.intensity === s.source.intensity));
const irradiance = r.viewPracticals.reduce((sum, s) => sum + s.irradiance * s.source.color.r, 0);
close(r.viewFill.color.r * r.viewFill.intensity, irradiance * VIEW_LIGHTING.readability);
for (const { light } of r.lights) light.castShadow = true;
ctx.time.frame++; updateViewLighting(r, ctx);
assert(r.viewPracticals.every(s => s.source === null && s.light.intensity === 0));
assert.deepEqual(ids, [r.viewSun.id, r.viewFill.id, ...r.viewPracticals.map(s => s.light.id)]);
assert([r.viewSun, r.viewFill, ...r.viewPracticals.map(s => s.light)].every(l => l.visible && !l.castShadow));
console.log('Native material fidelity, live uniform groups, world/camera light frames, local visibility, bounded fill and stable practical identities passed');

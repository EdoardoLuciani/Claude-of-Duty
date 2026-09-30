import assert from 'node:assert/strict';
import * as THREE from 'three';
import { createArmBlood, addArmBloodCoordinates } from '../../src/weapons/arm-blood.js';
import { Health } from '../../src/player/health.js';

const blood = createArmBlood();
const again = createArmBlood();
assert.equal(blood.amount.value, 0, 'full-health arms start clean');
assert.deepEqual(blood.texture.image.data, again.texture.image.data, 'mask is deterministic');
const { data, width, height } = blood.texture.image;
let stained = 0, clean = 0;
for (let y = 0; y < height; y++) {
  for (let x = 0; x < width; x++) {
    const alpha = data[(y * width + x) * 4];
    if (alpha > 32) stained++;
    if (alpha === 0) clean++;
    if ((y + .5) / height * .64 < .025) assert.equal(alpha, 0, 'glove/cuff stitching stays clean');
  }
}
assert(stained > width * height * .15 && stained < width * height * .6, 'stains are localized, not a flat tint');
assert(clean > width * height * .35, 'substantial clean cloth remains');
let snapshots = 0;
const hp = new Health({
  camera: new THREE.PerspectiveCamera(), time: { elapsed: 0 },
  events: { emit(type, payload) {
    if (type === 'player:health') { snapshots++; blood.setHealthFraction(payload.fraction); }
  } },
}, null);
hp.armour = 50;
hp.damage(20, null);
assert.equal(blood.amount.value, 0, 'armour-only hits leave the arms clean');
hp.armour = 0;
hp.damage(70, null);
assert.equal(blood.amount.value, .7, 'health events drive the mask');
assert.equal(hp.heal(50), 50);
assert(Math.abs(blood.amount.value - .2) < 1e-8);
const beforeReset = snapshots;
hp.reset(true);
assert.equal(snapshots, beforeReset + 1, 'reset publishes restored health even without a death-camera event');
assert.equal(blood.amount.value, 0, 'full reset cleans immediately');
const version = blood.texture.version;
blood.setHealthFraction(.30);
assert.equal(blood.amount.value, .70);
blood.setHealthFraction(.80);
assert(Math.abs(blood.amount.value - .20) < 1e-8, '50 restored HP removes 50% of the full-scale stain');
assert.equal(blood.texture.version, version, 'changing health never reuploads the mask');
blood.setHealthFraction(1);
assert.equal(blood.amount.value, 0);
blood.setHealthFraction(NaN);
assert.equal(blood.amount.value, 0, 'invalid snapshots do not poison the uniform');

const material = new THREE.MeshStandardMaterial();
blood.decorate(material);
const shader = {
  uniforms: {},
  vertexShader: THREE.ShaderLib.standard.vertexShader,
  fragmentShader: THREE.ShaderLib.standard.fragmentShader,
};
material.onBeforeCompile(shader);
assert.equal(shader.uniforms.armBloodAmount, blood.amount, 'compiled shaders share the live health uniform');
assert.equal(shader.uniforms.armBloodMask.value, blood.texture);
assert(shader.vertexShader.includes('vArmBloodPosition = armBloodPosition;'));
assert(shader.vertexShader.includes('#include <skinning_vertex>'), 'authored skinning is retained');
assert(shader.fragmentShader.includes('float blood = texture2D(armBloodMask, bloodUv).r * armBloodAmount;'));
assert(shader.fragmentShader.includes('roughnessFactor = mix'));
const key = material.customProgramCacheKey();
blood.setHealthFraction(.10);
assert.equal(material.customProgramCacheKey(), key, 'no shader permutations on damage/healing');

const source = new THREE.Mesh(new THREE.BufferGeometry());
source.geometry.setAttribute('position', new THREE.Float32BufferAttribute([.03, .01, .1, -.03, .02, .4], 3));
source.updateMatrixWorld(true);
const left = source.geometry.clone(), right = source.geometry.clone();
addArmBloodCoordinates(left, source, -1);
addArmBloodCoordinates(right, source, 1);
const coords = left.getAttribute('armBloodPosition');
assert.notEqual(coords, source.geometry.getAttribute('position'), 'mask coordinates are independently owned');
assert.deepEqual([...coords.array], [...source.geometry.getAttribute('position').array]);
assert.notDeepEqual([...coords.array], [...right.getAttribute('armBloodPosition').array], 'arms get distinct stains');
left.applyMatrix4(new THREE.Matrix4().makeScale(.97, .97, .97));
assert.deepEqual([...coords.array], [...source.geometry.getAttribute('position').array], 'bind coordinates are unaffected by arm scale');
let disposed = 0;
blood.texture.addEventListener('dispose', () => disposed++);
blood.dispose();
assert.equal(disposed, 1, 'mask GPU resource is disposed');
again.dispose(); material.dispose(); source.geometry.dispose(); left.dispose(); right.dispose();
console.log('Arm blood: localized deterministic mask, proportional health, stable shader/upload, bind coordinates and disposal passed');

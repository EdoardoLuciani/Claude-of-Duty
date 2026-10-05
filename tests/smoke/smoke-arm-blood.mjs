import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import * as THREE from 'three';
import { MeshStandardNodeMaterial } from 'three/webgpu';
import { createArmBlood, addArmBloodCoordinates } from '../../src/weapons/arm-blood.js';
import { Health } from '../../src/player/health.js';

const blood = createArmBlood();
const again = createArmBlood();
assert.equal(blood.amount.value, 0, 'full-health arms start clean');
assert.deepEqual(blood.texture.image.data, again.texture.image.data, 'mask is deterministic');
const { data, width, height } = blood.texture.image;
assert.equal(createHash('sha256').update(data).digest('hex'),
  '85aa5bbbe08695b80be5223fb50a87a78d997ced48a230b68cabbcfaf7521ed6', 'support rejection preserves every mask texel');
let stained = 0, clean = 0, wet = 0, mottled = 0;
for (let y = 0; y < height; y++) {
  for (let x = 0; x < width; x++) {
    const alpha = data[(y * width + x) * 4];
    if (alpha > 32) stained++;
    if (alpha === 0) clean++;
    const i = (y * width + x) * 4;
    if (data[i + 2] > 32) {
      wet++;
      assert(alpha > 180, 'wet deposits only occur in dense blood');
    }
    if (alpha > 200 && data[i + 1] > 32 && data[i + 1] < 220) mottled++;
    if ((y + .5) / height * .64 < .025) assert.equal(alpha, 0, 'glove/cuff stitching stays clean');
  }
}
assert(stained > width * height * .15 && stained < width * height * .6, 'stains are localized, not a flat tint');
assert(clean > width * height * .35, 'substantial clean cloth remains');
assert(wet > 0 && wet < stained * .75, 'wet highlights are sparse, not a glossy sleeve coating');
assert(mottled > stained * .2, 'dense stains retain varied clot/soak colour');
assert.equal(width, 256, 'satellite droplets have enough texel resolution');
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

const material = new MeshStandardNodeMaterial();
blood.decorate(material);
assert(material.colorNode?.isNode, 'native graph modifies authored albedo');
assert(material.roughnessNode?.isNode, 'native graph modifies authored roughness');
const nodes = new Set();
material.colorNode.traverse(node => nodes.add(node));
material.roughnessNode.traverse(node => nodes.add(node));
assert(nodes.has(blood.amount), 'both native graphs share the live health uniform');
assert([...nodes].some(node => node.isTextureNode && node.value === blood.texture), 'graph samples the owned mask');
assert([...nodes].some(node => node.getAttributeName?.() === 'armBloodPosition'), 'graph uses independent bind coordinates');
for (const [injury, limit] of [[0, 0], [.0001, .000001], [.01, .005], [.7, .65], [1, .65]]) {
  let peak = 0;
  for (let i = 0; i < data.length; i += 4) {
    const halo = THREE.MathUtils.smoothstep(data[i] / 255,
      Math.max(.02, .82 - injury), Math.max(.08, 1.08 - injury)) *
      THREE.MathUtils.smoothstep(injury, 0, .20) * .65;
    peak = Math.max(peak, halo);
  }
  assert(peak <= limit, `injury ${injury}: halo cannot jump on at nearly full health`);
  if (injury >= .7) assert(peak >= .64, 'meaningful injuries retain the existing absorbed-blood opacity');
}
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
blood.texture.dispose();
assert.equal(disposed, 1, 'mask GPU resource is disposed');
again.texture.dispose(); material.dispose(); source.geometry.dispose(); left.dispose(); right.dispose();
console.log('Arm blood: localized deterministic mask, proportional health, stable shader/upload, bind coordinates and disposal passed');

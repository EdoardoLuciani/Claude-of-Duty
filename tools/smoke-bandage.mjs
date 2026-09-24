import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { BANDAGE_PATH, BANDAGE_CONTACT, BANDAGE_POSES, BANDAGE_SEGMENTS } from '../src/weapons/bandage-path.js';

const bytes = readFileSync(new URL('../public/models/player/bandage.glb', import.meta.url));
assert.equal(bytes.readUInt32LE(0), 0x46546c67, 'committed Blender export');
const gltf = JSON.parse(bytes.subarray(20, 20 + bytes.readUInt32LE(12)).toString());
const wrap = gltf.nodes.find(n => n.name === 'Bandage_wrap');
const roll = gltf.nodes.find(n => n.name === 'Bandage_roll');
const cap = gltf.nodes.find(n => n.name === 'Bandage_cap');
assert(wrap && roll && cap, 'strip, roll and coiled end caps exported from the editable arms scene');
assert.equal(gltf.accessors[gltf.meshes[wrap.mesh].primitives[0].indices].count, BANDAGE_SEGMENTS * 24,
  'each revealed section must have four curved, edged lanes');
assert.equal(BANDAGE_CONTACT.length, BANDAGE_SEGMENTS + 1);
assert.equal(BANDAGE_PATH.length, BANDAGE_SEGMENTS / 2 + 1);
assert(BANDAGE_CONTACT.every(p => p.length === 3 && p.every(Number.isFinite)));
assert(BANDAGE_PATH.every(p => p.length === 10 && p.every(Number.isFinite)));
const feed = BANDAGE_PATH.map(p => p[9]);
assert.equal(feed[0], 0);
assert.equal(feed.at(-1), 1);
assert(feed.every((v, i) => v >= 0 && v <= 1 && (i === 0 || v >= feed[i-1])),
  'roll can only pay out cloth, never rewind');
assert(feed[5] > .05 && feed[15] > .25 && feed[25] > .38 && feed[45] > .7,
  'each authored hand pass must pay out the next band');
assert(feed[20] === feed[21] && feed[40] === feed[41],
  'cloth must pause during each hand regrip');
let handTravel = 0;
for (let i = 1; i < BANDAGE_PATH.length; i++) {
  const a = BANDAGE_PATH[i-1], b = BANDAGE_PATH[i];
  const distance = Math.hypot(b[0]-a[0], b[1]-a[1], b[2]-a[2]);
  handTravel += distance;
  if (b[9] - a[9] > .001) assert(distance > .00004, 'cloth must not advance with a stationary hand');
}
assert(handTravel > .35, 'the right hand must sweep across the forearm three times');
assert.deepEqual(Object.keys(BANDAGE_POSES), ['bandage', 'bandageLoose']);
assert(Object.values(BANDAGE_POSES).every(p => p.fingers.length === 4 && p.thumb.length === 2));
assert(gltf.materials.some(m => m.name === 'Bandage_woven_linen'
  && m.pbrMetallicRoughness.baseColorTexture
  && m.pbrMetallicRoughness.metallicRoughnessTexture && m.normalTexture),
'linen has packed colour, roughness and yarn normals');
assert(gltf.materials.some(m => m.name === 'Bandage_spiral_coil' && m.pbrMetallicRoughness.baseColorTexture),
  'roll end caps carry spiral layer detail');
console.log('Blender bandage mesh/guide contract OK');

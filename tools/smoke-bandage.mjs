import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { BANDAGE_PATH, BANDAGE_CONTACT, BANDAGE_POSES, BANDAGE_SEGMENTS, BANDAGE_WIDTH } from '../src/weapons/bandage-path.js';

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
const rollBounds = gltf.accessors[gltf.meshes[roll.mesh].primitives[0].attributes.POSITION];
assert(Math.abs(rollBounds.max[0] - rollBounds.min[0] - BANDAGE_WIDTH) < 1e-6,
  'roll, free strip and dressing must share the authored cloth width');
const pitch = Math.abs(BANDAGE_CONTACT[BANDAGE_SEGMENTS / 3][2] - BANDAGE_CONTACT[0][2]);
assert(BANDAGE_WIDTH > pitch * 2, 'successive turns must overlap, not leave exposed sleeve gaps');
assert.equal(BANDAGE_PATH.length, BANDAGE_SEGMENTS / 2 + 1);
assert(BANDAGE_CONTACT.every(p => p.length === 3 && p.every(Number.isFinite)));
assert(BANDAGE_PATH.every(p => p.length === 10 && p.every(Number.isFinite)));
const feed = BANDAGE_PATH.map(p => p[9]);
assert.equal(feed[0], 0);
assert.equal(feed.at(-1), 1);
assert(feed.every((v, i) => v >= 0 && v <= 1 && (i === 0 || v >= feed[i-1])),
  'roll can only pay out cloth, never rewind');
assert(feed[0] === 0 && feed.at(-1) === 1);
const plates = [];
for (let i = 1; i < feed.length; i++) {
  if (feed[i] === feed[i - 1]) {
    if (plates.at(-1)?.end === i - 1) plates.at(-1).end = i;
    else plates.push({ start: i - 1, end: i });
  }
}
assert.equal(plates.length, 3, 'three deliberate winding passes, each ending in a tension hold');
const radial = BANDAGE_PATH.map(p => Math.hypot(p[0], p[1]));
for (const plate of plates) {
  const a = BANDAGE_PATH[plate.start], b = BANDAGE_PATH[plate.end];
  assert(Math.hypot(a[0] - b[0], a[1] - b[1]) > .015,
    'the roll must keep moving during each payout hold');
}
// A loop encloses area; a brushing stroke merely retraces the same arc. Each
// pass must carry the roll out for its underhand return, not wave back/forth.
for (let lap = 0; lap < 3; lap++) {
  let area = 0;
  for (let j = 0; j < 20; j++) {
    const a = BANDAGE_PATH[lap * 20 + j], b = BANDAGE_PATH[lap * 20 + j + 1];
    area += a[0] * b[1] - b[0] * a[1];
  }
  assert(Math.abs(area) > .008, 'each overhand/underhand loop needs a distinct return path');
}

// The hand rides the strip: same axial station as the cloth it is laying, and a
// standoff that stays outside the sleeve it is wound on. A full orbit used to
// send the wrapping forearm through the support arm, so the swing is bounded.
let lastFinger = null;
const swings = [];
let handTravel = 0;
for (let i = 0; i < BANDAGE_PATH.length; i++) {
  const p = BANDAGE_PATH[i];
  const cloth = BANDAGE_CONTACT[Math.round(p[9] * BANDAGE_SEGMENTS)];
  assert(Math.abs(p[2] - cloth[2]) < .002, 'the hand must work the station it is wrapping');
  const sleeve = Math.hypot(cloth[0], cloth[1]);
  assert(radial[i] > sleeve + .02,
    'the hand must stand off the sleeve, never inside it');
  assert(radial[i] < sleeve + .17, 'the tension pull must stay within a hand span of the sleeve');
  const finger = [p[3], p[4], p[5]];
  if (lastFinger) {
    assert(finger[0]*lastFinger[0] + finger[1]*lastFinger[1] + finger[2]*lastFinger[2] > .2,
      'the finger axis must turn smoothly: a flip collapses it when interpolated');
  }
  lastFinger = finger;
  swings.push(Math.atan2(p[1], p[0]));
  if (i) handTravel += Math.hypot(p[0] - BANDAGE_PATH[i-1][0], p[1] - BANDAGE_PATH[i-1][1], p[2] - BANDAGE_PATH[i-1][2]);
}
// Every stroke sweeps the same near-side arc, so the direction the hand works
// around the limb never runs past half a turn from where it starts each pass.
let span = 0;
for (const a of swings) span = Math.max(span, Math.abs(a - swings[0]));
assert(handTravel > .45, 'the roll must travel over the forearm on every pass');
assert(span > 1.4 && span < Math.PI, `the hand works a bounded arc, got ${span.toFixed(2)} rad`);
assert.deepEqual(Object.keys(BANDAGE_POSES), ['bandage', 'bandageLoose', 'bandageFist']);
assert(BANDAGE_POSES.bandage.fingers.every(f => f[1] >= 1.3), 'fingers must close around the roll');
assert(BANDAGE_POSES.bandageFist.fingers.every(f => f[0] >= 1.3 && f[1] >= 1.5),
  'support hand must be a fist, not the weapon-support cup');
assert(Object.values(BANDAGE_POSES).every(p => p.fingers.length === 4 && p.thumb.length === 2));
assert(gltf.materials.some(m => m.name === 'Bandage_woven_linen'
  && m.pbrMetallicRoughness.baseColorTexture
  && m.pbrMetallicRoughness.metallicRoughnessTexture && m.normalTexture),
'linen has packed colour, roughness and yarn normals');
assert(gltf.materials.some(m => m.name === 'Bandage_spiral_coil' && m.pbrMetallicRoughness.baseColorTexture),
  'roll end caps carry spiral layer detail');
console.log('Blender bandage mesh/guide contract OK');

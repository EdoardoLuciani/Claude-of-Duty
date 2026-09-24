import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { BANDAGE_PATH, BANDAGE_CONTACT, BANDAGE_POSES, BANDAGE_SEGMENTS, BANDAGE_WIDTH, BANDAGE_TURNS, BANDAGE_ELBOW_R } from '../src/weapons/bandage-path.js';

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
const pitch = Math.abs(BANDAGE_CONTACT[BANDAGE_SEGMENTS / BANDAGE_TURNS][2] - BANDAGE_CONTACT[0][2]);
assert(BANDAGE_WIDTH > pitch * 2, 'successive turns must overlap, not leave exposed sleeve gaps');
assert.equal(BANDAGE_PATH.length, BANDAGE_SEGMENTS / 2 + 1);
assert(BANDAGE_CONTACT.every(p => p.length === 3 && p.every(Number.isFinite)));
assert(BANDAGE_CONTACT.every(p => Math.abs(p[2] - BANDAGE_CONTACT[0][2]) < 1e-6),
  'securing turns stay at one station while the right elbow is planted');
assert(BANDAGE_PATH.every(p => p.length === 10 && p.every(Number.isFinite)));
const feed = BANDAGE_PATH.map(p => p[9]);
assert.equal(feed[0], 0);
assert.equal(feed.at(-1), 1);
assert(feed.every((v, i) => v >= 0 && v <= 1 && (i === 0 || v >= feed[i-1])),
  'roll can only pay out cloth, never rewind');
assert.equal(BANDAGE_TURNS, 3, 'three complete turns in the dressing');
const plates = [];
for (let i = 1; i < feed.length; i++) {
  if (feed[i] === feed[i - 1]) {
    if (plates.at(-1)?.end === i - 1) plates.at(-1).end = i;
    else plates.push({ start: i - 1, end: i });
  }
}
assert.equal(plates.length, BANDAGE_TURNS, 'each complete turn ends in a tension hold');
for (const plate of plates) {
  const a = BANDAGE_PATH[plate.start], b = BANDAGE_PATH[plate.end];
  assert(a.every((v, j) => Math.abs(v - b[j]) < 1e-6),
    'a payout hold must also stop the orbit, not hide an unwound return');
}

const radial = BANDAGE_PATH.map(p => Math.hypot(p[0], p[1]));
assert(Math.max(...radial) - Math.min(...radial) < 2e-6, 'wrist follows a circular orbit, not an oval near-side loop');
assert(Math.abs(roll.translation[0]) < 1e-6, 'roll centred across the gripping palm');
const startAngle = Math.atan2(BANDAGE_CONTACT[0][1], BANDAGE_CONTACT[0][0]);
const deltaAngle = (a, b) => Math.atan2(Math.sin(a - b), Math.cos(a - b));
let lastFinger = null, lastRollAngle = null, lastWristAngle = null;
let handTravel = 0, rollSweep = 0, wristSweep = 0;
for (let i = 0; i < BANDAGE_PATH.length; i++) {
  const p = BANDAGE_PATH[i];
  const cloth = BANDAGE_CONTACT[Math.round(p[9] * BANDAGE_SEGMENTS)];
  assert(Math.abs(p[2] - cloth[2]) < .002, 'the hand must work the station it is wrapping');
  const sleeve = Math.hypot(cloth[0], cloth[1]);
  assert(radial[i] > sleeve + .02,
    'the hand must stand off the sleeve, never inside it');
  assert(radial[i] < sleeve + .22, 'fixed-pivot orbit must remain close to the dressing');
  assert(Math.abs(Math.hypot(...p.slice(0, 3).map((v, j) => v - BANDAGE_ELBOW_R[j])) - .30) < 1e-6,
    'every wrist key must lie on the fixed elbow\'s 30 cm forearm sphere');
  const finger = [p[3], p[4], p[5]];
  if (lastFinger) {
    assert(finger[0]*lastFinger[0] + finger[1]*lastFinger[1] + finger[2]*lastFinger[2] > .2,
      'the finger axis must turn smoothly: a flip collapses it when interpolated');
  }
  lastFinger = finger;
  // Reconstruct the actual gripped roll from its GLB palm offset. It must
  // accompany the paid cloth ALL the way around, including the far half.
  const rx = p[0] + p[6] * roll.translation[1] - p[3] * roll.translation[2];
  const ry = p[1] + p[7] * roll.translation[1] - p[4] * roll.translation[2];
  const rollAngle = Math.atan2(ry, rx), wristAngle = Math.atan2(p[1], p[0]);
  const clockAngle = startAngle - p[9] * BANDAGE_TURNS * Math.PI * 2;
  assert(Math.abs(deltaAngle(rollAngle, clockAngle)) < 2e-5, 'roll and paid edge must share one winding angle');
  assert(Math.hypot(rx, ry) > sleeve + .02, 'roll stays outside the sleeve');
  if (i) {
    const rd = deltaAngle(rollAngle, lastRollAngle), wd = deltaAngle(wristAngle, lastWristAngle);
    assert(rd <= 2e-5 && wd <= 2e-5, 'roll AND wrist must never reverse during winding');
    rollSweep -= rd;
    wristSweep -= wd;
    assert(Math.abs(rollSweep - p[9] * BANDAGE_TURNS * Math.PI * 2) < 2e-5,
      'payout cannot advance without the matching physical turn');
    handTravel += Math.hypot(p[0] - BANDAGE_PATH[i-1][0], p[1] - BANDAGE_PATH[i-1][1], p[2] - BANDAGE_PATH[i-1][2]);
  }
  lastRollAngle = rollAngle;
  lastWristAngle = wristAngle;
}
assert(handTravel > BANDAGE_TURNS * Math.PI * 2 * .12, 'wrist must travel the full circumference of every turn');
assert(Math.abs(rollSweep - BANDAGE_TURNS * Math.PI * 2) < 2e-5);
assert(Math.abs(wristSweep - BANDAGE_TURNS * Math.PI * 2) < 2e-5);
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

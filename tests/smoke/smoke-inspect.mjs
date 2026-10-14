import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { WEAPON_DEFS } from '../../src/weapons/defs.ts';
import { makeM4Model, M4Animation, M4_URL } from '../../src/weapons/m4.ts';
import { makeMPXModel, MPXAnimation, MPX_URL } from '../../src/weapons/mpx.ts';
import { makeP320Model, P320Animation, P320_URL } from '../../src/weapons/p320.ts';
import { makeEvolysModel, EvolysAnimation, EVOLYS_URL } from '../../src/weapons/evolys.ts';
import { makeM590Model, M590Animation, M590_URL } from '../../src/weapons/m590.ts';
import { makeAX338Model, AX338Animation, AX338_URL } from '../../src/weapons/ax338.ts';

const bytes = readFileSync(new URL(P320_URL));
const loader = new GLTFLoader().register(() => ({
  name: 'NODE_TEXTURE_STUB',
  loadTexture: () => Promise.resolve(new THREE.Texture()),
}));
const model = makeP320Model(
  await loader.parseAsync(
    bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
    ''
  )
);
const pistol = new P320Animation(model);
const duration = pistol.clips().inspect.duration;
assert.equal(duration, WEAPON_DEFS.pistol.inspectTime);
pistol.update(0, 'inspect', 0, false);
const start = pistol.root.quaternion.clone(),
  slide = pistol.slide.position.clone();
let leftRoll = 0,
  rightRoll = 0,
  handClearance = 0;
for (let i = 0; i <= 120; i++) {
  pistol.update(0, 'inspect', (duration * i) / 120, false);
  assert(pistol.root.position.toArray().every(Number.isFinite));
  assert(pistol.root.quaternion.toArray().every(Number.isFinite));
  leftRoll = Math.max(leftRoll, pistol.root.rotation.z);
  rightRoll = Math.min(rightRoll, pistol.root.rotation.z);
  handClearance = Math.min(handClearance, pistol.hands.left.wrist.position.y);
  assert(pistol.slide.position.distanceTo(slide) < 1e-6, 'inspection must not cycle the slide');
}
assert(leftRoll > 0.45 && rightRoll < -0.55, 'authored pistol rolls to present both sides');
assert(handClearance < -0.17, 'authored support hand clears the weapon');
assert(start.angleTo(pistol.root.quaternion) < 1e-4, 'inspect returns to the starting pose');
pistol.dispose();

// M4 inspection is authored in the GLB, not a procedural rifle pose.
const rifleBytes = readFileSync(new URL(M4_URL));
const rifle = new M4Animation(
  makeM4Model(
    await loader.parseAsync(
      rifleBytes.buffer.slice(rifleBytes.byteOffset, rifleBytes.byteOffset + rifleBytes.byteLength),
      ''
    )
  )
);
const clips = rifle.clips();
for (const action of Object.values(rifle.actions)) {
  const clip = action.getClip();
  for (const track of clip.tracks) {
    assert(
      track.times[0] >= 0 && Math.abs(track.times.at(-1) - clip.duration) < 1e-6,
      `${clip.name}/${track.name}: complete authored channel`
    );
    for (let i = 1; i < track.times.length; i++)
      assert(track.times[i] >= track.times[i - 1], `${clip.name}/${track.name}: ordered keys`);
  }
}
for (const clip of Object.values(clips)) {
  assert(clip.events.every((event) => event.t >= 0 && event.t <= clip.duration));
  for (let i = 1; i < clip.events.length; i++)
    assert(clip.events[i].t >= clip.events[i - 1].t, 'M4 events remain ordered');
}
assert.equal(clips.inspect.duration, WEAPON_DEFS.rifle.inspectTime);
rifle.update(0, 'inspect', 0, false);
const rifleStart = rifle.root.quaternion.clone(),
  bolt = rifle.bolt.position.clone();
let leftYaw = 0,
  rightYaw = 0,
  rifleHandClearance = 0;
for (let i = 0; i <= 120; i++) {
  rifle.update(0, 'inspect', (clips.inspect.duration * i) / 120, false);
  assert(rifle.root.position.toArray().every(Number.isFinite));
  assert(rifle.root.quaternion.toArray().every(Number.isFinite));
  leftYaw = Math.min(leftYaw, rifle.root.rotation.y);
  rightYaw = Math.max(rightYaw, rifle.root.rotation.y);
  rifleHandClearance = Math.min(rifleHandClearance, rifle.hands.left.wrist.position.y);
  assert(rifle.bolt.position.distanceTo(bolt) < 1e-6, 'inspection must not cycle the M4 bolt');
}
assert(leftYaw < -0.65 && rightYaw > 0.65, 'authored M4 presents both receiver sides');
assert(rifleHandClearance < -0.17, 'authored M4 support hand clears the receiver');
assert(rifleStart.angleTo(rifle.root.quaternion) < 1e-4, 'M4 inspect returns to the starting pose');
rifle.dispose();

// LMG coverage moves to its actual Blender clips; it is not dropped.
const lmgBytes = readFileSync(new URL(EVOLYS_URL));
const lmg = new EvolysAnimation(
  makeEvolysModel(
    await loader.parseAsync(
      lmgBytes.buffer.slice(lmgBytes.byteOffset, lmgBytes.byteOffset + lmgBytes.byteLength),
      ''
    )
  )
);
assert.equal(lmg.clips().inspect.duration, WEAPON_DEFS.lmg.inspectTime);
let minYaw = 0,
  maxYaw = 0;
lmg.update(0, 'inspect', 0, false);
const lmgStart = lmg.root.quaternion.clone(),
  lmgBolt = lmg.bolt.position.clone();
for (let i = 0; i <= 120; i++) {
  lmg.update(0, 'inspect', (WEAPON_DEFS.lmg.inspectTime * i) / 120, false);
  assert(lmg.root.position.toArray().every(Number.isFinite));
  assert(lmg.root.quaternion.toArray().every(Number.isFinite));
  assert(lmg.bolt.position.distanceTo(lmgBolt) < 1e-6, 'inspect must not cycle LMG bolt');
  minYaw = Math.min(minYaw, lmg.root.rotation.y);
  maxYaw = Math.max(maxYaw, lmg.root.rotation.y);
}
assert(minYaw < -0.65 && maxYaw > 0.65, 'Blender LMG reveals both sides');
assert(lmgStart.angleTo(lmg.root.quaternion) < 1e-4, 'LMG inspect returns to idle');
lmg.dispose();
for (const [id, url, make, Animation] of [
  ['shotgun', M590_URL, makeM590Model, M590Animation],
  ['smg', MPX_URL, makeMPXModel, MPXAnimation],
  ['sniper', AX338_URL, makeAX338Model, AX338Animation],
]) {
  const bytes = readFileSync(new URL(url));
  const animation = new Animation(
    make(
      await loader.parseAsync(
        bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
        ''
      )
    )
  );
  const duration = animation.clips().inspect.duration;
  assert.equal(duration, WEAPON_DEFS[id].inspectTime);
  for (const clip of Object.values(animation.clips())) {
    assert(clip.events.every((event) => event.t >= 0 && event.t <= clip.duration));
    for (let i = 1; i < clip.events.length; i++) assert(clip.events[i].t >= clip.events[i - 1].t);
  }
  animation.update(0, 'inspect', 0, false);
  const start = animation.root.quaternion.clone(),
    startPosition = animation.root.position.clone(),
    bolt = animation.root.getObjectByName('bolt').position.clone();
  let minYaw = 0,
    maxYaw = 0;
  for (let i = 0; i <= 120; i++) {
    animation.update(0, 'inspect', (duration * i) / 120, false);
    assert(animation.root.position.toArray().every(Number.isFinite));
    assert(animation.root.quaternion.toArray().every(Number.isFinite));
    assert(
      animation.root.getObjectByName('bolt').position.distanceTo(bolt) < 1e-6,
      `${id}: inspect must not cycle bolt`
    );
    minYaw = Math.min(minYaw, animation.root.rotation.y);
    maxYaw = Math.max(maxYaw, animation.root.rotation.y);
  }
  if (id === 'shotgun') {
    assert(minYaw < -0.6 && maxYaw > 0.6, 'authored M590 reveals both sides');
    assert(
      startPosition.distanceTo(animation.root.position) < 1e-6,
      'M590 inspect returns to the starting position'
    );
  }
  assert(start.angleTo(animation.root.quaternion) < 1e-4, `${id}: inspect returns to idle`);
  animation.dispose();
}
console.log('Inspect animation smoke checks passed');

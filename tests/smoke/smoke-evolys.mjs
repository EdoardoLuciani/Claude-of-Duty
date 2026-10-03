// Actual committed Blender asset and its runtime animation contract, no GPU/DCC.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { makeEvolysModel, EvolysAnimation, EVOLYS_URL } from '../../src/weapons/evolys.js';
import { WEAPON_DEFS } from '../../src/weapons/defs.js';
import manifest from '../../assets/weapons/fn-evolys-762/manifest.json' with { type: 'json' };
const bytes = readFileSync(new URL(EVOLYS_URL));
const json = JSON.parse(bytes.subarray(20, 20 + bytes.readUInt32LE(12)).toString());
const primitives = json.nodes.filter(n => n.mesh !== undefined).flatMap(n => json.meshes[n.mesh].primitives);
const triangles = primitives.reduce((n, p) => n + json.accessors[p.indices].count / 3, 0);
assert.equal(triangles, manifest.stats.triangles);
assert.equal(primitives.length, manifest.stats.primitives);
assert(triangles < 150000 && primitives.length <= 48 && json.materials.length <= 18 && bytes.length <= 15 * 1024 * 1024);
assert.equal(json.images.length, 3);
assert(json.buffers.every(b => !b.uri) && json.images.every(i => i.bufferView !== undefined), 'self-contained GLB');
for (const image of json.images) {
  const view = json.bufferViews[image.bufferView];
  const offset = 20 + bytes.readUInt32LE(12) + 8 + view.byteOffset;
  assert.equal(bytes.readUInt32BE(offset + 16), 1024); assert.equal(bytes.readUInt32BE(offset + 20), 1024);
}
for (const mat of json.materials) {
  const p = mat.pbrMetallicRoughness;
  assert(p.baseColorFactor && p.baseColorFactor.slice(0, 3).some(c => c < .8), `${mat.name}: authored colour, not uncoloured white`);
  assert(p.baseColorTexture && p.metallicRoughnessTexture && mat.normalTexture, `${mat.name}: original PBR detail`);
}
const beltNode = json.nodes.find(n => n.name === 'belt_mesh');
assert(beltNode.skin !== undefined, 'belt uses one exported native skin');
assert.equal(json.meshes[beltNode.mesh].primitives.length, 3, 'brass/projectile/link batches, not per-round submissions');
assert.equal(json.skins[beltNode.skin].joints.length, 8);
assert(!json.nodes.some(n => /bipod|spent_case|EVOLYS_arm/.test(n.name)), 'no bipod, duplicate cases or duplicate exported arms');
const loader = new GLTFLoader().register(() => ({ name: 'SMOKE_TEXTURE', loadTexture: () => Promise.resolve(new THREE.Texture()) }));
const gltf = await loader.parseAsync(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), '');
const model = makeEvolysModel(gltf), anim = new EvolysAnimation(model);
assert.equal(anim.constructor.name, 'EvolysAnimation');
assert.equal(model.reactiveFire, true, 'preserve shared reactive recoil, no extra baked kick');
assert.equal(Object.keys(anim.actions).length, 8);
for (const [name, duration] of [['reloadTac', WEAPON_DEFS.lmg.reloadTac], ['reloadEmpty', WEAPON_DEFS.lmg.reloadEmpty], ['inspect', WEAPON_DEFS.lmg.inspectTime], ['draw', WEAPON_DEFS.lmg.drawTime], ['holster', WEAPON_DEFS.lmg.holsterTime]]) {
  assert.equal(anim.clips()[name].duration, duration);
}
for (const action of Object.values(anim.actions)) {
  const clip = action.getClip();
  for (const track of clip.tracks) {
    assert(track.values.every(Number.isFinite));
    assert(Math.abs(track.times.at(-1) - clip.duration) < 1e-6, `${clip.name}: complete channel`);
    for (let i = 1; i < track.times.length; i++) assert(track.times[i] >= track.times[i - 1], `${clip.name}: ordered sampler`);
  }
}
const point = new THREE.Vector3(), start = new THREE.Vector3();
anim.fire(); anim.update(0, null, 0, false, true, 99); anim.bones[3].getWorldPosition(start);
anim.update(.060, null, 0, false, true, 99); anim.bones[3].getWorldPosition(point);
assert(Math.abs(point.distanceTo(start) - manifest.belt.pitch) < .0002, 'one cartridge pitch per fire cycle');
assert(point.x > start.x && point.y > start.y, 'feeds into the left receiver, not away');
const indexed = point.clone();
anim.update(1, null, 0, false, true, 99);
anim.bones[3].getWorldPosition(point); const stopped = point.clone();
anim.update(1, null, 0, false, true, 99); anim.bones[3].getWorldPosition(point);
assert(point.distanceTo(stopped) < 1e-6, 'belt does not scroll while not firing');
assert(indexed.distanceTo(start) > .01);
anim.fire(); anim.update(0, null, 0, false, true, 2);
assert.equal(anim.bones.filter(b => b.scale.x > .5).length, 3, 'two remaining + one departing round');
anim.update(1, null, 0, false, true, 2);
assert.equal(anim.bones.filter(b => b.scale.x > .5).length, 2, 'last rounds visibly run out');
anim.fire(); anim.update(.04, null, 0, true, false, 0);
assert.equal(anim.name, 'Last_Shot'); assert(anim.belt.visible);
anim.update(.08, null, 0, true, false, 0); assert(!anim.belt.visible);
for (const [clip, source] of [['reloadTac', 'Reload_Tactical'], ['reloadEmpty', 'Reload_Empty']]) {
  const info = manifest.clips[source], insert = info.beltInsertTime;
  anim.update(0, clip, info.beltClearTime + .03, true, false, 0);
  assert(!anim.belt.visible && anim.cover.rotation.y < -.5, 'open side cover and cleared belt');
  anim.update(0, clip, insert - .001, true, false, 0); assert(!anim.belt.visible);
  anim.update(0, clip, insert, false, true, 100); assert(anim.belt.visible);
  assert.equal(anim.bones.filter(b => b.scale.x > .5).length, 8, 'restored at insertion, no sticky zero scales');
  anim.update(0, clip, info.duration * .48, true, false, 0);
  assert(anim.spare.visible && !anim.pouch.visible);
  let meshes = 0;
  anim.spare.traverse(o => { if (o.isMesh) { meshes++; assert(Math.abs(Math.abs(o.matrixWorld.determinant()) - 1) < 1e-5, 'spare geometry not permanently collapsed'); } });
  assert(meshes > 0);
  anim.reset(); assert(!anim.spare.visible && anim.pouch.visible);
  assert(anim.cover.quaternion.angleTo(new THREE.Quaternion()) < 1e-6, 'interruption closes side cover');
}
anim.update(0, null, 0, false, true, 1); anim.reset();
assert.equal(anim.bones.filter(b => b.scale.x > .5).length, 1, 'switch/reset preserves remaining count');
anim.update(0, null, 0, false, true, 101);
assert.equal(anim.bones.filter(b => b.scale.x > .5).length, 8, 'new-game/refill restores tail visibility');
for (const name of ['reloadTac', 'reloadEmpty', 'inspect', 'draw', 'holster']) {
  const clip = anim.clips()[name];
  for (let i = 0; i <= 120; i++) {
    anim.update(0, name, clip.duration * i / 120, false, true, 100);
    anim.handTarget('left', point, new THREE.Quaternion()); assert(point.toArray().every(Number.isFinite));
    anim.handTarget('right', point, new THREE.Quaternion()); assert(point.toArray().every(Number.isFinite));
  }
}
assert.equal(WEAPON_DEFS.lmg.rpm, 700); assert.equal(WEAPON_DEFS.lmg.magSize, 100);
assert.equal(WEAPON_DEFS.lmg.damage, 48);
anim.dispose(); assert.equal(model.materials.size, 0); assert.equal(model.textures.size, 0);
console.log(`EVOLYS: ${triangles} triangles / ${primitives.length} primitive instances; PBR, eight clips, native belt pitch, ammo tail, feed insertion, interruption, spare transforms and cleanup passed`);

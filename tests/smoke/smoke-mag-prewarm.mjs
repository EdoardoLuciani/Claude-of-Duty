import assert from 'node:assert/strict';
import * as THREE from 'three/webgpu';
import { WeaponSystem } from '../../src/weapons/index.js';
import { AmmoPickups } from '../../src/weapons/ammo-pickups.js';

const geometry = new THREE.BoxGeometry(), material = new THREE.MeshPhysicalNodeMaterial();
const magazine = new THREE.Group(); magazine.add(new THREE.Mesh(geometry, material));
const group = new THREE.Group(); group.add(magazine); group.visible = false;
const radio = new THREE.Group(); radio.visible = false;
const scopeOverlay = new THREE.Group(); scopeOverlay.visible = false;
const reticle = new THREE.Group(); reticle.visible = false;
const grenade = new THREE.Group(); grenade.visible = false;
const scene = new THREE.Scene(), viewScene = new THREE.Scene(); viewScene.add(group, radio, scopeOverlay, reticle, grenade);
let calls = 0, finish;
const flashlight = new THREE.SpotLight();
const weapon = { id: 'rifle', group, parts: { magazine }, magLen: .15 };
const system = new WeaponSystem();
system._restDone = true; system._droppedMags = [];
system.viewmodel = { radio, scopeOverlay, reticle, grenade, weapons: new Map([['rifle', weapon]]) };
system.rng = { signed: () => assert.fail('warmup consumed gameplay RNG') };
const render = {
  _graph: {}, patchMaterials() {},
  prewarmLightShadow(light) {
    assert.equal(light, flashlight, 'hidden pickups and magazines need flashlight variants');
    return this._warmGraph();
  },
  _warmGraph() {
    calls++;
    assert.equal(scene.children.length, 3);
    assert.equal(system.pickups.items.length, 0); assert.equal(system.pickups._nextId, 1);
    assert(scene.children.every(o => o.visible));
    assert(scopeOverlay.visible && reticle.visible && grenade.visible, 'hidden optics/grenade ancestors must be warmed');
    return new Promise(resolve => { finish = resolve; });
  },
};
system.ctx = { scene, viewScene, viewCamera: new THREE.PerspectiveCamera(), peek: id => id === 'player' ? { flashlight } : render };
system.pickups = new AmmoPickups(system);
let loaded;
system._restTask = new Promise(resolve => { loaded = resolve; });
const pending = system.prewarmMaterials();
assert.equal(system._warming, true);
await system.prewarmMaterials(); // no overlapping async graph warmups
assert.equal(calls, 0, 'boot awaits deferred assets before warming');
assert.equal(scene.children.length, 0);
loaded(); await Promise.resolve();
assert.equal(calls, 1);
finish(); await pending;
assert.equal(system._warming, false); assert.equal(system._warmed, true);
assert.equal(radio.visible, false); assert.equal(group.visible, false);
assert.equal(scopeOverlay.visible || reticle.visible, false);
assert.equal(grenade.visible, false);
assert.equal(scene.children.length, 2, 'temporary ammo visual was removed');
for (const p of system._droppedMags) {
  assert.equal(p.group.visible, false); assert.equal(p.group.parent, scene);
  assert.equal(p.body, null); assert.equal(p.until, 0);
  assert.equal(p.group.children[0].geometry, geometry);
  assert.equal(p.group.children[0].material, material);
}
// Failure restores visibility and leaves an existing pool/body untouched.
system._warmed = false;
const body = {}; system._droppedMags[0].body = body;
system.physics = { removeRigidBody: () => assert.fail('warmup removed live debris') };
render._warmGraph = async () => { throw new Error('intentional warmup failure'); };
const failed = await system.prewarmMaterials();
assert.equal(failed.ok, false); assert.match(failed.error, /intentional warmup failure/);
assert.equal(system._warming, false); assert.equal(system._warmed, false);
assert.equal(radio.visible, false); assert.equal(group.visible, false);
assert(system._droppedMags.every(p => !p.group.visible));
assert.equal(scopeOverlay.visible || reticle.visible, false);
assert.equal(grenade.visible, false);
assert.equal(system._droppedMags[0].body, body);
assert.equal(scene.children.length, 2);
assert.equal(system.pickups.items.length, 0); assert.equal(system.pickups._nextId, 1);
system.pickups.dispose(); geometry.dispose(); material.dispose();
console.log('magazine prewarm ownership/concurrency/failure restoration passed');

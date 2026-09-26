import assert from 'node:assert/strict';
import { Vector3, Mesh, BoxGeometry, MeshBasicMaterial } from 'three';
import { testNav } from './lib/test-nav.mjs';
import { makeWalker } from './nav240/harness.mjs';
import { CoverMap } from '../src/ai/nav.js';
import { INFANTRY } from '../src/ai/capabilities.js';

const nav = await testNav(), phys = nav.physics;
const from = new Vector3(1, 0, 1), to = new Vector3(2.5, 0, 1), next = new Vector3(4, 0, 1);
assert.equal(nav.canVault(from, to, next), true, 'clear full arc plus continuation');
assert.equal(nav.canVault(from, to), false, 'a clear landing alone does not establish continuation');
const meshes = [];
function box(x, y, z, w, h, d) {
  const mesh = new Mesh(new BoxGeometry(w, h, d), new MeshBasicMaterial());
  mesh.position.set(x, y, z); mesh.updateMatrixWorld(true);
  meshes.push(mesh); phys.addStatic(mesh, 'concrete'); phys.rebuildStatic(); return mesh;
}
const ceiling = box(1.75, 2.15, 1, 4, .15, 4);
assert.ok(nav.canStand(from) && nav.canStand(to), 'endpoints fit under the ceiling');
assert.equal(nav.canVault(from, to, next), false, 'middle of the arc must also fit');
phys.removeStatic(ceiling); phys.rebuildStatic();
const wall = box(3.3, 1.5, 1, .2, 3, 4);
assert.ok(nav.canStand(to));
assert.equal(nav.canVault(from, to, next), false, 'landing cannot cut off the current route');
phys.removeStatic(wall); phys.rebuildStatic();
const occupied = box(2.5, .5, 1, .6, 1, .6);
assert.equal(nav.canVault(from, to, next), false, 'occupied landing rejected');
phys.removeStatic(occupied); phys.rebuildStatic();

const candidate = { query(start, end) {
  const points = [], n = nav.findPath(start, end, points);
  return { outcome: nav.lastOutcome, points: points.slice(0, n) };
} };
const a = makeWalker({ grid: nav, physics: phys }, candidate, from, 1, true);
a._goTo(next);
a.vaultFrom.copy(from); a.vaultTo.copy(to); a.vaultT = 0; a.vaultVersion = phys.staticWorld.version;
a._move(.8);
assert.equal(a.vaultOutcome, 'arrived');
assert.ok(a.position.distanceTo(to) < .05);
assert.equal(a.recoveries.length, 0, 'live vault must sweep, never teleport');
assert.ok(a.hasMoveTarget || a.pathPending, 'resume via the budgeted navigator');

a.controller.setPosition(from.x, from.y, from.z); a.position.copy(from);
a.controller.probeGround(); a.vaultT = 0; a.vaultVersion = phys.staticWorld.version;
a._move(.2);
const mid = a.position.clone();
box(2.2, 1, 1, .1, 2, 2);
a._move(.2);
assert.equal(a.vaultOutcome, 'blocked', 'collision revision cancels an in-flight vault');
assert.equal(a.vaultT, -1);
assert.ok(a.position.distanceTo(mid) < 1e-8, 'cancellation cannot snap to either endpoint');
assert.equal(a.recoveries.length, 0);
phys.removeCharacter(a.controller);

// A low wall protects a crouched soldier, but not a standing one or a soldier
// fired down on from above. Baked horizontal normals cannot establish this.
box(6, .6, 5, .2, 1.2, 4);
const cover = new CoverMap(nav, phys), hide = new Vector3(5, 0, 5);
const threat = new Vector3(9, .8, 5);
assert.equal(cover.protects(hide, threat, INFANTRY.height), false);
assert.equal(cover.protects(hide, threat, INFANTRY.crouchHeight), true);
threat.y = 6;
assert.equal(cover.protects(hide, threat, INFANTRY.crouchHeight), false);
for (const mesh of meshes) { phys.removeStatic(mesh); mesh.geometry.dispose(); mesh.material.dispose(); }
nav.dispose();
console.log('ok  collision-swept vault, landing/continuation/arc rejection, cancellation and 3D cover protection');

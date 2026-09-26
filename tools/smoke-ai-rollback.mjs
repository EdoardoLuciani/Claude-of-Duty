import assert from 'node:assert/strict';
import { Vector3, Matrix4, Frustum, Sphere, PerspectiveCamera, Mesh, BoxGeometry, MeshBasicMaterial } from 'three';
import { AiSystem } from '../src/ai/index.js';
import { testNav } from './lib/test-nav.mjs';
import { makeWalker } from './nav240/harness.mjs';

const grid = await testNav([[0, 0, 0, 24, 24], [0, .9, 0, 1.2, 1.2]]);
const phys = grid.physics, candidate = { query(from, to) {
  const points = []; grid.findPath(from, to, points);
  return { points, outcome: grid.lastOutcome, reason: grid.lastReason };
} };
const a = makeWalker({ grid, physics: phys }, candidate, new Vector3(-6, .008, 0), 1, true);
const camera = new PerspectiveCamera(60, 1, .1, 100);
const sky = { sunDirection: new Vector3(0, 1, 0) };
Object.assign(a.ai, {
  ctx: { camera, time: { elapsed: 0 }, peek: id => id === 'sky' ? sky : phys }, phys,
  _frustum: new Frustum(), _mvp: new Matrix4(), _sphere: new Sphere(), _sweep: new Sphere(), _sun: new Vector3(),
  canRollback: AiSystem.prototype.canRollback, _sunDirection: AiSystem.prototype._sunDirection,
});
a.ctx = a.ai.ctx;
function look(x, y, z, tx, ty, tz) {
  // The guard must refresh camera matrices after a turn, not use last frame's view.
  camera.position.set(x, y, z); camera.lookAt(tx, ty, tz);
}
function tick() { a.ctx.time.elapsed += 3.1; a._tickNoProgress(3.1); }
look(0, 2, 20, 0, 2, 21);
a._rememberSafePosition();
assert.ok(a._safeSurface, 'checkpoint is an actual standing, attached pose');
const checkpoint = a._safePosition.clone();
// Fixture placement simulates a stranded island, not a credited walking route.
a.position.set(0, .908, 0); a.controller.setPosition(0, .908, 0); a.controller.probeGround();
a._goTo(new Vector3(-9, .008, 0));
assert.equal(a.pathReason, 'disconnected');
a._rememberSafePosition();
assert.ok(a._safePosition.equals(checkpoint), 'a different component must not replace the safe checkpoint');
for (let i = 0; i < 3; i++) tick();
assert.equal(a.recoveryAttempts, 3);
assert.equal(a.recoveryOutcome, 'blocked');
assert.equal(a.relocations, 0, 'exhaust bounded walking attempts first');

look(0, 2, 20, 0, 1, 0); tick();
assert.equal(a.relocations, 0, 'visible source forbids rollback');
assert.equal(a.recoveryOutcome, 'failed', 'exhausted walking recovery cannot loop forever');
assert.equal(a.pathReason, 'execution-blocked');
assert.equal(a.hasMoveTarget, false);
const old = a.position.clone(); a.position.set(20, .9, 0);
look(-6, 2, 8, -6, 1, 0);
assert.equal(a.ai.canRollback(a, checkpoint), false, 'visible destination also forbids rollback');
a.position.copy(old); look(0, 2, 20, 0, 2, 21);
const neighbor = { alive: true, radius: a.radius, height: a.height, position: checkpoint.clone() };
a.ai.agents.push(neighbor); tick();
assert.equal(a.relocations, 0, 'occupied destination forbids rollback');
const shorter = { position: a.position, radius: .34 * .985, height: 1.78 * .985 };
neighbor.position.y = checkpoint.y - shorter.height - .01;
assert.equal(a.ai.canRollback(shorter, checkpoint), false, 'vertical overlap uses both actor heights');
a.ai.agents.pop();
const wall = new Mesh(new BoxGeometry(1, 2, 1), new MeshBasicMaterial());
wall.position.set(-6, 1, 0); wall.updateMatrixWorld(true); phys.addStatic(wall, 'concrete');
tick(); assert.equal(a.relocations, 0, 'dirty collision forbids rollback');
phys.rebuildStatic(); tick();
assert.equal(a.relocations, 0, 'a previously safe but now blocked pose is not reusable');
phys.removeStatic(wall); phys.rebuildStatic(); tick();
assert.equal(a.relocations, 0, 'collision rebuild invalidates old checkpoints, even after removing the obstruction');
// Establish a new physically occupied checkpoint in the new collision revision.
a.position.copy(checkpoint); a.controller.setPosition(checkpoint.x, checkpoint.y, checkpoint.z);
a._safeSurface = 0; a._recoveryCount = 0; a._rememberSafePosition();
a.position.copy(old); a.controller.setPosition(old.x, old.y, old.z);
a._recoveryCount = 3; a._recoveryOrigin.copy(old);
a.ai._pathBudget = 0; tick();
assert.equal(a.relocations, 1);
assert.equal(a.recoveries.length, 1, 'exceptional repositioning remains observable to traversal gates');
assert.equal(a.recoveryOutcome, 'relocated', 'never label rollback as walking arrival');
assert.ok(a.position.distanceTo(checkpoint) < .02);
assert.ok(a.lastRollback.from[1] > .8);
assert.ok(a.pathPending, 'resume through the ordinary deferred solve queue');
assert.equal(a.ai._pathBudget, 0, 'no emergency budget bypass');
assert.ok(a.position.distanceTo(new Vector3(-9, .008, 0)) > 2, 'rollback is not objective arrival');
phys.removeCharacter(a.controller); grid.dispose(); wall.geometry.dispose(); wall.material.dispose();
console.log('ok  bounded, revalidated, invisible rollback; collision/visibility/occupancy guards; explicit relocation and normal solve budget');

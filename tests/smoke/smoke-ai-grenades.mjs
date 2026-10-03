/** Issue #356: height-aware lob, cooked 3D arc clearance and live launch parity. */
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { AiSystem } from '../../src/ai/index.js';
import { Agent } from '../../src/ai/agent.js';
import { GRENADE } from '../../src/ai/tuning.js';
import { PhysicsSystem } from '../../src/physics/index.js';

function fixture() {
  const phys = new PhysicsSystem(), ai = Object.create(AiSystem.prototype);
  ai._phys = phys;
  ai.ctx = { peek: () => null };
  ai.root = new THREE.Group(); ai._grenades = [];
  ai._grenadeArc = {};
  ai._grenadePoint = new THREE.Vector3(); ai._grenadeStep = new THREE.Vector3();
  ai.agents = [];
  const addBox = (x, y, z, w, h, d) => {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d));
    mesh.position.set(x, y, z); mesh.updateMatrixWorld(true);
    phys.addStatic(mesh, 'concrete'); phys.rebuildStatic();
  };
  addBox(0, -.1, 0, 100, .2, 100);
  return { ai, phys, addBox };
}
const from = new THREE.Vector3(0, 1.5, 0), target = new THREE.Vector3(12, 1.2, 0);
const land = new THREE.Vector3();
const f = fixture();
assert.equal(f.ai.predictGrenadeLand(from, target, land), 12);
assert(Math.abs(land.y - GRENADE.radius) < 1e-5, 'aim at the floor, not the remembered eye height');
const flat = { ...f.ai._grenadeLob(from, target) };
function endpoint(arc, origin) {
  const t = arc.tAir;
  assert(Math.abs(origin.y + arc.vy * t + .5 * f.phys.gravity * t * t - arc.y) < 1e-6);
  assert(Math.abs(arc.vh * t - arc.dist) < 1e-6);
}
endpoint(flat, from);

// The landing floor must be selected at the target's height, even above the
// old thrower-relative ground probe. Same horizontal coordinates, different arc.
f.addBox(12, 3.9, 0, 4, .2, 8);
const upstairs = new THREE.Vector3(12, 5.2, 0);
assert.equal(f.ai.predictGrenadeLand(from, upstairs, land), 12);
assert(Math.abs(land.y - 4 - GRENADE.radius) < 1e-5);
const raised = { ...f.ai._grenadeLob(from, upstairs) };
endpoint(raised, from);
assert(raised.vy > flat.vy, 'an upstairs target changes the vertical launch');

// A descending throw also solves the actual target floor, not launch elevation.
const highFrom = new THREE.Vector3(0, 7.5, 0), downstairs = new THREE.Vector3(-12, 1.2, 0);
assert.equal(f.ai.predictGrenadeLand(highFrom, downstairs, land), 12);
assert(Math.abs(land.y - GRENADE.radius) < 1e-5);
endpoint(f.ai._grenadeLob(highFrom, downstairs), highFrom);
assert.equal(f.ai.predictGrenadeLand(from, new THREE.Vector3(100, 1.2, 0), land), -1, 'out of range');
f.addBox(12, 39.9, 0, 4, .2, 8);
assert.equal(f.ai.predictGrenadeLand(from, new THREE.Vector3(12, 41.2, 0), land), -1, 'unreachable height');

// Real cooked collision, not a straight LOS test: an open sightline under a
// thin ceiling still has an obstructed lob. A high wall is also refused.
for (const obstruction of ['ceiling', 'wall']) {
  const blocked = fixture();
  if (obstruction === 'ceiling') blocked.addBox(6, 2.3, 0, 16, .02, 8);
  else blocked.addBox(6, 3, 0, .02, 6, 8);
  if (obstruction === 'ceiling') assert(blocked.phys.lineOfSight(from, target));
  assert.equal(blocked.ai.predictGrenadeLand(from, target, land), -1, obstruction);
  const agent = { ai: blocked.ai, animator: { muzzleWorld: from }, _v3: land, position: from };
  assert(Agent.prototype._grenadeUnsafe.call(agent, target), 'unsafe arc holds the grenade');
}
const lowWall = fixture(); lowWall.addBox(6, .4, 0, .1, .8, 8);
assert.equal(lowWall.ai.predictGrenadeLand(from, target, land), 12, 'clear arc over low cover is allowed');

const live = fixture();
assert.equal(live.ai.predictGrenadeLand(from, target, land), 12);
const arc = { ...live.ai._grenadeArc };
live.ai.throwGrenade({ animator: { fire() {} } }, from, target);
assert.equal(live.ai._grenades.length, 1);
const body = live.ai._grenades[0].body;
assert.equal(body.linearDamping, 0, 'no unmodelled drag in the live launch');
assert(Math.abs(body.linearVelocity.y - arc.vy) < 1e-6);
assert(Math.abs(body.linearVelocity.x - arc.vh) < 1e-6);
let closest = Infinity;
for (let i = 0; i < Math.ceil((arc.tAir + .1) * 120); i++) {
  live.phys.bodies.step(1 / 120);
  closest = Math.min(closest, body.position.distanceTo(land));
}
assert(closest < GRENADE.landingTolerance, `live landing agrees with safety arc: ${closest} m`);
console.log('AI grenades: elevated/descending targets, range/height limits, thin ceilings, walls, clear low-cover arc, safety holds and live-body landing passed');

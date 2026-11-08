import assert from 'node:assert/strict';

import * as THREE from 'three';

import { Agent } from '../../src/ai/agent.ts';
import { AiSystem } from '../../src/ai/index.ts';
import { GRENADE } from '../../src/ai/tuning.ts';
/** Issue #356: height-aware lob, cooked 3D arc clearance and live launch parity. */
import type { EngineEventMap } from '../../src/core/events.ts';
import { PhysicsSystem } from '../../src/physics/index.ts';
import { GRENADE_FUSE } from '../../src/weapons/index.ts';
import { makeAgent } from '../../tools/lib/agent-fixture.ts';
import { brainAnimator } from '../lib/ai-brain-fixture.ts';
import { createTestContext } from '../lib/context.ts';

function fixture(): {
  ai: AiSystem;
  phys: PhysicsSystem;
  addBox: (x: number, y: number, z: number, w: number, h: number, d: number) => void;
} {
  const phys = new PhysicsSystem(),
    ai = new AiSystem();
  ai._phys = phys;
  ai.ctx = createTestContext();
  ai.root = new THREE.Group();
  ai._grenades = [];
  ai._grenadeArc = { dx: 0, dz: 0, dist: 0, vy: 0, vh: 0, tAir: 0, y: 0, valid: false };
  ai._grenadePoint = new THREE.Vector3();
  ai._grenadeStep = new THREE.Vector3();
  ai.agents = [];
  const addBox = (x: number, y: number, z: number, w: number, h: number, d: number): void => {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d));
    mesh.position.set(x, y, z);
    mesh.updateMatrixWorld(true);
    phys.addStatic(mesh, 'concrete');
    phys.rebuildStatic();
  };
  addBox(0, -0.1, 0, 100, 0.2, 100);
  return { ai, phys, addBox };
}
function measureFlight(
  phys: PhysicsSystem,
  body: ReturnType<PhysicsSystem['addRigidBody']>,
  land: THREE.Vector3,
  duration = GRENADE_FUSE
): { closest: number; airborneImpacts: number } {
  let closest = Infinity,
    airborneImpacts = 0;
  body.onImpact = (_body, _x, y): void => {
    if (y > 1) airborneImpacts++;
  };
  for (let i = 0; i < Math.ceil(duration * 120); i++) {
    phys.bodies.step(1 / 120);
    closest = Math.min(closest, body.position.distanceTo(land));
  }
  return { closest, airborneImpacts };
}
const from = new THREE.Vector3(0, 1.5, 0),
  target = new THREE.Vector3(12, 1.2, 0);
const land = new THREE.Vector3();
const f = fixture();
assert.equal(f.ai.predictGrenadeLand(from, target, land), 12);
assert(Math.abs(land.y - GRENADE.radius) < 1e-5, 'aim at the floor, not the remembered eye height');
const flat = { ...f.ai._grenadeLob(from, target) };
function endpoint(arc: AiSystem['_grenadeArc'], origin: THREE.Vector3): void {
  const t = arc.tAir;
  assert(Math.abs(origin.y + arc.vy * t + 0.5 * f.phys.gravity * t * t - arc.y) < 1e-6);
  assert(Math.abs(arc.vh * t - arc.dist) < 1e-6);
}
endpoint(flat, from);

// The landing floor must be selected at the target's height, even above the
// old thrower-relative ground probe. Same horizontal coordinates, different arc.
f.addBox(12, 3.9, 0, 4, 0.2, 8);
const upstairs = new THREE.Vector3(12, 5.2, 0);
assert.equal(f.ai.predictGrenadeLand(from, upstairs, land), 12);
assert(Math.abs(land.y - 4 - GRENADE.radius) < 1e-5);
const raised = { ...f.ai._grenadeLob(from, upstairs) };
endpoint(raised, from);
assert(raised.vy > flat.vy, 'an upstairs target changes the vertical launch');

// A descending throw also solves the actual target floor, not launch elevation.
const highFrom = new THREE.Vector3(0, 7.5, 0),
  downstairs = new THREE.Vector3(-12, 1.2, 0);
assert.equal(f.ai.predictGrenadeLand(highFrom, downstairs, land), 12);
assert(Math.abs(land.y - GRENADE.radius) < 1e-5);
endpoint(f.ai._grenadeLob(highFrom, downstairs), highFrom);
assert.equal(
  f.ai.predictGrenadeLand(from, new THREE.Vector3(100, 1.2, 0), land),
  -1,
  'out of range'
);
f.addBox(12, 39.9, 0, 4, 0.2, 8);
assert.equal(
  f.ai.predictGrenadeLand(from, new THREE.Vector3(12, 41.2, 0), land),
  -1,
  'unreachable height'
);

// Real cooked collision, not a straight LOS test: an open sightline under a
// thin ceiling still has an obstructed lob. A high wall is also refused.
for (const obstruction of ['ceiling', 'wall']) {
  const blocked = fixture();
  if (obstruction === 'ceiling') blocked.addBox(6, 2.3, 0, 16, 0.02, 8);
  else blocked.addBox(6, 3, 0, 0.02, 6, 8);
  if (obstruction === 'ceiling') assert(blocked.phys.lineOfSight(from, target));
  assert.equal(blocked.ai.predictGrenadeLand(from, target, land), -1, obstruction);
  const agent = makeAgent({
    ai: blocked.ai,
    animator: brainAnimator({ muzzleWorld: from }),
    _v3: land,
    position: from,
  });
  assert(Agent.prototype._grenadeUnsafe.call(agent, target), 'unsafe arc holds the grenade');
}
const lowWall = fixture();
lowWall.addBox(6, 0.4, 0, 0.1, 0.8, 8);
assert.equal(
  lowWall.ai.predictGrenadeLand(from, target, land),
  12,
  'clear arc over low cover is allowed'
);

const live = fixture();
assert.equal(live.ai.predictGrenadeLand(from, target, land), 12);
const arc = { ...live.ai._grenadeArc };
live.ai.throwGrenade(makeAgent(), from, target);
assert.equal(live.ai._grenades.length, 1);
const body = live.ai._grenades[0].body;
assert.equal(body.linearDamping, 0, 'no unmodelled drag in the live launch');
assert(Math.abs(body.linearVelocity.y - arc.vy) < 1e-6);
assert(Math.abs(body.linearVelocity.x - arc.vh) < 1e-6);
const { closest } = measureFlight(live.phys, body, land, arc.tAir + 0.1);
assert(closest < GRENADE.landingTolerance, `live landing agrees with safety arc: ${closest} m`);
const detonations: Array<{ type: 'explosion'; payload: EngineEventMap['explosion'] }> = [];
live.ai.ctx.events.on('explosion', (payload): number =>
  detonations.push({ type: 'explosion', payload })
);
live.ai._updateGrenades(GRENADE_FUSE);
assert.equal(detonations.length, 1);
assert.equal(detonations[0].type, 'explosion');
assert.equal(
  detonations[0].payload.kind,
  'grenade',
  'AI grenade selects the recorded grenade bank'
);

// Grazing sides: a 60 mm gap clears a 50 mm sphere, but a 40 mm gap blocks it.
// The old live CCD core was 90 mm despite prediction sweeping only 50 mm.
for (const gap of [0.06, 0.04]) {
  const side = fixture();
  side.addBox(6, 4, gap + 0.1, 1, 8, 0.2);
  const blocked = gap < GRENADE.radius;
  assert.equal(side.ai.predictGrenadeLand(from, target, land), blocked ? -1 : 12);
  const agent = makeAgent({
    ai: side.ai,
    animator: brainAnimator({ muzzleWorld: from }),
    _v3: land,
    position: new THREE.Vector3(),
  });
  assert.equal(Agent.prototype._grenadeUnsafe.call(agent, target), blocked);
  side.ai.throwGrenade(makeAgent(), from, target);
  const grenade = side.ai._grenades[0].body;
  assert.equal(
    Math.max(grenade.probeRadius, grenade.minExtent * 0.9),
    Math.fround(GRENADE.radius),
    'live CCD radius matches prediction'
  );
  const result = measureFlight(side.phys, grenade, land);
  assert.equal(result.airborneImpacts > 0, blocked, 'side clearance agrees with live collisions');
  assert.equal(
    result.closest < GRENADE.landingTolerance,
    !blocked,
    'side clearance agrees with live landing'
  );
}
// This wall clears the continuous parabola by 75 mm, but not the lower
// semi-implicit 120 Hz trajectory. It must be held before the airborne impact.
const top = fixture(),
  topArc = top.ai._grenadeLob(from, target),
  midpoint = 6 / topArc.vh;
const height = from.y + topArc.vy * midpoint + 0.5 * top.phys.gravity * midpoint ** 2 - 0.075;
top.addBox(6, height / 2, 0, 0.02, height, 8);
assert.equal(top.ai.predictGrenadeLand(from, target, land), -1, 'near-clearance wall top');
assert(
  Agent.prototype._grenadeUnsafe.call(
    makeAgent({
      ai: top.ai,
      animator: brainAnimator({ muzzleWorld: from }),
      _v3: land,
      position: new THREE.Vector3(),
    }),
    target
  )
);
top.ai.throwGrenade(makeAgent(), from, target);
const result = measureFlight(top.phys, top.ai._grenades[0].body, land);
assert(
  result.airborneImpacts > 0 && result.closest > GRENADE.landingTolerance,
  'live wall-top collision confirms the hold'
);
console.log(
  'AI grenades: elevated/descending targets, range/height limits, thin ceilings, walls, clear low-cover arc, safety holds, grazing sides/tops and live-body landing passed'
);

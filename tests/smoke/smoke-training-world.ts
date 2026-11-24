import assert from 'node:assert/strict';

import { Box3, InstancedMesh, Vector3 } from 'three';

import { DEFAULT_BINDINGS } from '../../src/core/bindings.ts';
import { UNITS } from '../../src/core/config.ts';
import { ModelSystem } from '../../src/core/models.ts';
import { PLAYABLE_MAPS } from '../../src/core/playable-maps.ts';
import { PhysicsSystem } from '../../src/physics/index.ts';
import { PlayerSystem } from '../../src/player/index.ts';
import { LedgeProbe, LEDGE_VAULT, LEDGE_NONE } from '../../src/player/mantle.ts';
import { WEAPON_DEFS } from '../../src/weapons/defs.ts';
import { WorldSystem } from '../../src/world/index.ts';
import { WorldQueries } from '../../src/world/queries.ts';
import { RETURN_FLIGHT } from '../../tools/worldgen/level/training-layout.ts';
import { createTestContext, createTestInput } from '../lib/context.ts';
import { physicsFor } from '../lib/nav240/fixtures.ts';

const root = new URL('../../public/', import.meta.url);
const requests: string[] = [];
globalThis.fetch = Object.assign(
  async (request: Parameters<typeof fetch>[0]): Promise<Response> => {
    const path = typeof request === 'string' ? request : '';
    if (!path.startsWith('models/world/')) return new Response(null, { status: 404 });
    requests.push(path);
    const file = Bun.file(new URL(path, root));
    return (await file.exists()) ? new Response(file) : new Response(null, { status: 404 });
  },
  { preconnect: globalThis.fetch.preconnect }
);

const map = PLAYABLE_MAPS.find((entry): boolean => entry.id === 'training-grounds');
assert(map);
const models = new ModelSystem(map);
await models.init();
const { meta, visual, collision, navBytes } = await models.worldPrefetch;
assert.equal(navBytes, undefined);
assert.deepEqual(
  requests.sort(),
  [
    'models/world/training/level.json',
    `models/world/training/${meta.assets.visual}`,
    `models/world/training/${meta.assets.collision}`,
  ].sort()
);

assert(!visual.scene.getObjectByName('prop_training_tote_body'), 'dressing is visually batched');
assert(
  collision.scene.getObjectByName('collide_prop_training_tote_body') instanceof InstancedMesh,
  'visual batching leaves the canonical prop collider instanced'
);
assert(
  visual.scene.getObjectByName('prop_training_target_face') instanceof InstancedMesh,
  'targets stay separately culled from the dressing batches'
);

const physics: PhysicsSystem = physicsFor(collision.scene);
const queries = new WorldQueries(meta);
const targets = meta.WORLD?.MARKERS?.RANGE_TARGETS;
assert(queries.rangeStation && targets?.length === 7);
const [x, , z] = meta.spawns[0].position;
assert.deepEqual(meta.spawns[0].forward, [0, 0, -1]);
const player = physics.createCharacter();
assert(player.checkCapsule(x, 0.02, z, UNITS.playerHeight), 'firing line spawn is clear');
assert.equal(
  physics.groundHeight(x, z, 6),
  0,
  'the actual spawn ray reaches the apron, not the roof'
);
assert(physics.raycast(1, 2, 8, 0, 1, 0, 3).hit, 'canopy uses the visible roof geometry');
assert(player.checkCapsule(1, 0.02, 8, UNITS.playerHeight), 'standing space under the canopy');

for (const [px, pz, surface] of [
  [0, 4.5, 'dirt'],
  [-13.5, 4.5, 'concrete'],
  [33, 4.5, 'concrete'],
  [33, -7.5, 'dirt'],
] as const) {
  const hit = physics.raycast(px, 1, pz, 0, -1, 0, 2);
  assert(
    hit.hit && hit.surface === surface,
    `ground finish at ${px},${pz} must cook into collision`
  );
}

for (const [px, pz] of [
  [0, 5],
  [-13.5, 5],
  [-18.5, 4.4],
  [33, 5],
  [33, -4],
] as const) {
  assert(
    player.checkCapsule(px, 0.02, pz, UNITS.playerHeight),
    `route remains clear at ${px},${pz}`
  );
}

for (const target of targets) {
  // Center plus the corners: the shared rectangle agrees with the cooked face,
  // not its steel backing or any separately colliding paint geometry.
  const points = [[0, 0]];
  for (const sx of [-0.46, 0.46])
    for (const sy of [-0.46, 0.46]) points.push([sx * target.width, sy * target.height]);
  for (const [dx, dy] of points) {
    const hit = physics.raycast(target.x + dx, target.y + dy, target.z + 1, 0, 0, -1, 2);
    assert(
      hit.hit && Math.abs(hit.point.z - target.z) < 0.001 && hit.normal.z > 0.99,
      `target at ${target.x},${target.z} (${dx},${dy}): ${hit.hit ? hit.point.toArray().join(',') : 'miss'}`
    );
    assert(queries.rangeTargetAt(hit.point, hit.normal), 'the world recognizes the cooked face');
  }
}

for (const [i, metres] of [10, 25, 40, 80, 160].entries()) {
  const face: (typeof targets)[number] = targets[i];
  const hit: ReturnType<PhysicsSystem['raycast']> = physics.raycast(
    face.x,
    face.y,
    z,
    0,
    0,
    -1,
    metres + 0.1
  );
  assert(
    hit.hit &&
      queries.rangeTargetAt(hit.point, hit.normal) &&
      Math.abs(hit.distance - metres) < 0.001,
    `lane ${i + 1}: measured distance from the firing line to its cooked face`
  );
}
for (const target of targets.filter((t): boolean => !!t.label)) {
  const gate = queries.course.find((gate): boolean => gate.action === target.label);
  assert(gate, 'course plate has a shooting station');
  const eye = new Vector3(...gate.position);
  eye.y += UNITS.playerHeight - 0.15;
  const dir = new Vector3(target.x, target.y, target.z).sub(eye).normalize();
  const hit = physics.raycast(eye, dir, 30);
  assert(
    hit.hit && queries.rangeTargetAt(hit.point, hit.normal)?.label === target.label,
    'unobstructed sightline from shooting station'
  );
}
const near = targets[0];
assert(!queries.rangeTargetAt(near, { x: 0, y: 0, z: -1 }), 'back faces do not retain marks');
const rifle = WEAPON_DEFS.rifle;
for (const [offset, impacts] of [
  [0, ['plaster:entry', 'plaster:exit', 'metal:entry']],
  [near.width / 2 + 0.04, ['metal:entry']],
] as const) {
  const shot = physics.fireBullet({
    origin: new Vector3(near.x + offset, near.y, near.z + 1),
    dir: new Vector3(0, 0, -1),
    maxDist: 2,
    damage: rifle.damage,
    penetration: rifle.penetration,
    emit: false,
  });
  assert.equal(shot.stopReason, 'blocked', 'the steel backing stops the rifle round');
  assert.deepEqual(
    shot.impacts.map((hit): string => `${hit.surface}:${hit.exit ? 'exit' : 'entry'}`),
    impacts
  );
}

const muzzle = new Vector3(x, 0.35, z);
const direction = new Vector3(near.x, near.y, near.z).sub(muzzle).normalize();
const proneHit = physics.raycast(muzzle, direction, 20);
assert(proneHit.hit && Math.abs(proneHit.point.z - near.z) < 0.001, 'prone lane is unobstructed');

player.setPosition(-13.5, 0, -0.98);
assert.equal(new LedgeProbe(physics).probe(player, 0, -1, UNITS.playerHeight), LEDGE_VAULT);
for (const [px, pz, top] of [
  [-13.5, -4.7, 0.65],
  [-14.6, -8.15, 1],
  [-13.4, -11.65, 1.22],
  [-12.15, -15.5, 1.45],
]) {
  assert(Math.abs(physics.groundHeight(px, pz, top + 1) - top) < 0.02, 'trestle supports landings');
}
for (const pz of [-23.1, -25, -26.9]) {
  const deck = physics.groundHeight(-15.5, pz, 6);
  assert(Math.abs(deck - 5.8) < 0.02);
  assert(player.checkCapsule(-15.5, deck + 0.01, pz, UNITS.playerCrouchHeight));
  assert(!player.checkCapsule(-15.5, deck + 0.01, pz, UNITS.playerHeight));
}
assert(physics.raycast(33, 0.45, -4, 0, 0, -1, 5).hit, 'bay divider participates in world physics');
// The eastern perimeter offers no step up and over.
assert(player.checkCapsule(38.48, 0.03, -11.3, UNITS.playerHeight));
player.setPosition(38.94, 0, -11.3);
assert.equal(new LedgeProbe(physics).probe(player, 1, 0, UNITS.playerHeight), LEDGE_NONE);

const world = new WorldSystem();
world.bounds = new Box3(new Vector3(...meta.bounds.min), new Vector3(...meta.bounds.max));
world.queries = queries;
world.spawnPoints = [{ position: new Vector3(x, 0, z), yaw: 0, tag: 'line' }];
const runner = new PlayerSystem();
const ctx = createTestContext({
  input: createTestInput(),
  providers: { physics, world, player: runner },
});
ctx.config.mode = 'training';
await runner.init(ctx);
// Catch the authored ladder from its lower platform, then verify the actual top
// exit (not the mast itself) has standing clearance and a deck underneath.
const ladder = queries.ladders[0];
assert(ladder);
const movement = runner.movement;
movement.teleport(ladder.x, ladder.y0 + 0.01, ladder.z);
movement.cmd.moveY = 1;
movement.step(ctx.time.fixed);
assert(movement.climbMotion.active);
for (let i = 0; i < 500 && movement.climbMotion.active; i++) {
  assert(
    player.checkCapsule(
      movement.position.x,
      movement.position.y + 0.01,
      movement.position.z,
      UNITS.playerHeight
    )
  );
  movement.step(ctx.time.fixed);
}
assert(!movement.climbMotion.active && Math.abs(movement.position.y - ladder.y1) < 0.01);
assert(
  Math.abs(
    physics.groundHeight(movement.position.x, movement.position.z, ladder.y1 + 0.1) - ladder.y1
  ) < 0.02
);
// Same runway, same takeoff stripe: the finish needs both speed and a jump.
const { x: runwayX, sill, edge } = RETURN_FLIGHT;
for (const [sprint, jump] of [
  [false, true],
  [true, false],
  [true, true],
]) {
  movement.teleport(runwayX, sill + 0.01, edge - 3.2);
  movement.yaw = Math.PI;
  ctx.input.down.clear();
  ctx.input.down.add(DEFAULT_BINDINGS.forward[0]);
  if (sprint) ctx.input.down.add(DEFAULT_BINDINGS.sprint[0]);
  let airborneCatch = false;
  for (let i = 0; i < 240; i++) {
    if (jump && movement.position.z >= edge - 0.12) ctx.input.down.add(DEFAULT_BINDINGS.jump[0]);
    const airborne = !movement.grounded;
    movement.latchInput(++ctx.time.frame);
    movement.step(ctx.time.fixed);
    ctx.time.elapsed += ctx.time.fixed;
    if (movement.mantleMotion.active && airborne && movement.position.y > sill)
      airborneCatch = true;
    if (movement.position.y < 6 || (movement.grounded && movement.position.y > 9)) break;
  }
  assert.equal(airborneCatch && movement.grounded && movement.position.y > 9, sprint && jump);
}
ctx.input.down.clear();
ctx.events.on('player:respawn', (): never => assert.fail('a fall must not replenish equipment'));
runner.movement.teleport(world.bounds.max.x + 2, world.bounds.min.y - 1, z);
runner.fixedUpdate(ctx.time.fixed, ctx);
assert(
  runner.position.distanceTo(world.spawnPoints[0].position) < 0.1,
  'fall returns to the firing line'
);

console.log(
  'Training Grounds: separate runtime bundle, supported spawn, target faces and practice collision'
);

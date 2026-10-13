import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Movement } from '../../src/player/movement.ts';
import { MOVE } from '../../src/player/tuning.ts';
import { WorldQueries } from '../../src/world/queries.ts';
import { parseWorldManifest } from '../../src/core/model-metadata.ts';

const manifest = JSON.parse(readFileSync(new URL('../../public/models/world/level.json', import.meta.url)));
const authored = manifest.volumes.find(volume => volume.kind === 'ladder');
assert.ok(authored && authored.nx !== 1 && authored.nz !== 0, 'exercise an authored non-+X ladder');
function fixture(ladder, world = new WorldQueries({ ...manifest, volumes: ladder ? [ladder] : [] })) {
  const movement = new Movement({ peek: () => world }, {});
  movement.position.set(authored.x, authored.y0, authored.z);
  let placements = 0;
  movement.character = { height: 1.8, stepHeight: .3, velocity: { x: 0, y: 0, z: 0 },
    setPosition: () => placements++ };
  return { movement, placements: () => placements };
}
function snapshot(f) {
  const m = f.movement;
  return { climb: { ...m.climbMotion }, position: m.position.toArray(), velocity: m.velocity.toArray(),
    state: m.state, prevState: m.prevState, stateTime: m.stateTime, grounded: m.grounded,
    stance: m.stance, stanceWant: m.stanceWant, sprinting: m.sprinting, tacticalSprint: m.tacticalSprint,
    sliding: m.sliding, jumpBuffer: m._jumpBuffer, height: m.character.height,
    stepHeight: m.character.stepHeight, placements: f.placements() };
}
for (const ladder of [authored, { ...authored, nx: 0, nz: -1 }]) {
  for (const exit of ['jump', 'top', 'bottom']) {
    const f = fixture(ladder), m = f.movement;
    const y = exit === 'top' ? ladder.y1 : exit === 'bottom' ? ladder.y0 : (ladder.y0 + ladder.y1) / 2;
    m.position.y = y;
    assert.equal(m._tryClimb(1), true);
    assert.deepEqual([m.climbMotion.nx, m.climbMotion.nz], [ladder.nx, ladder.nz], 'catching retains authored exit normal');
    let leave;
    m._leaveClimb = (...args) => { leave = args; };
    const moveY = exit === 'top' ? 1 : exit === 'bottom' ? -1 : 0;
    m._stepClimb(1 / 120, { jump: exit === 'jump', moveY });
    const distance = exit === 'jump' ? MOVE.climb.jumpOff : exit === 'top' ? MOVE.climb.dismount : MOVE.climb.footStep;
    assert.deepEqual(leave, [ladder.x + ladder.nx * distance, y, ladder.z + ladder.nz * distance,
      exit === 'jump' ? ladder.nx * MOVE.climb.jumpOffSpeed : 0,
      exit === 'jump' ? MOVE.climb.jumpOffRise : 0,
      exit === 'jump' ? ladder.nz * MOVE.climb.jumpOffSpeed : 0], `${exit}: position and velocity follow that ladder's normal`);
  }
}
// A later catch must replace the previous ladder's direction, not retain it.
{
  let current = authored;
  const { movement: m } = fixture(null, { ladderAt: () => current });
  assert.equal(m._tryClimb(1), true);
  m.climbMotion.active = false;
  current = { ...authored, nx: 0, nz: -1 };
  assert.equal(m._tryClimb(1), true);
  assert.deepEqual([m.climbMotion.nx, m.climbMotion.nz], [0, -1]);
}
for (const field of ['x', 'z', 'y0', 'y1', 'nx', 'nz']) {
  for (const bad of [undefined, 'invalid', NaN, Infinity, -Infinity]) {
    const ladder = { ...authored, [field]: bad };
    if (bad === undefined) delete ladder[field];
    const f = fixture(ladder), before = snapshot(f);
    assert.equal(f.movement._tryClimb(1), false, `reject malformed ${field}: ${String(bad)}`);
    assert.deepEqual(snapshot(f), before, 'malformed boundary cannot commit climb or character state');
  }
}
for (const value of [null, undefined, 7, {}, { ladderAt: 1 }, { ladderAt: () => null }]) {
  const f = fixture(null), before = snapshot(f);
  assert.throws(() => parseWorldManifest({ ...manifest, volumes: [value] }), /\[models\]/,
    'malformed external volume data is rejected at the manifest boundary');
  assert.equal(f.movement._tryClimb(1), false);
  assert.deepEqual(snapshot(f), before);
}
for (const world of [null, undefined, { ladderAt: () => null }]) {
  const f = fixture(null, world), before = snapshot(f);
  assert.equal(f.movement._tryClimb(1), false, 'absent world/ladder lookup remains optional');
  assert.deepEqual(snapshot(f), before);
}
assert.equal(new WorldQueries(manifest).ladderAt(authored.x, authored.y0, authored.z), authored,
  'typed lookup borrows the validated ladder without hot-path allocations');
console.log('movement-climb: authored/alternate normals drive jump/top/bottom exits; malformed manifest/ladder data and absent providers do not mutate state');

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import type { WorldLadder } from '../../src/core/model-metadata.ts';
import { parseWorldManifest } from '../../src/core/model-metadata.ts';
import { StaticWorld } from '../../src/physics/bvh.ts';
import { CharacterController } from '../../src/physics/character.ts';
import { Movement } from '../../src/player/movement.ts';
import { MOVE } from '../../src/player/tuning.ts';
import { WorldQueries } from '../../src/world/queries.ts';
import { createTestContext, createTestInput } from '../lib/context.ts';

const manifest = parseWorldManifest(
  JSON.parse(readFileSync(new URL('../../public/models/world/level.json', import.meta.url), 'utf8'))
);
const found = manifest.volumes?.find((volume): boolean => volume.kind === 'ladder');
assert.ok(found && found.nx !== 1 && found.nz !== 0, 'exercise an authored non-+X ladder');
assert.ok(typeof found.nx === 'number' && typeof found.nz === 'number');
const authored = { ...found, nx: found.nx, nz: found.nz };
// Keep the exact validated manifest object for the borrowed-identity assertion below.
const borrowed = found;
type LadderLookup = Pick<WorldQueries, 'ladderAt'>;
interface ClimbFixture {
  movement: Movement;
  character: CharacterController;
  placements(): number;
}
function fixture(
  ladder: WorldLadder | null,
  world: LadderLookup | null = new WorldQueries({ ...manifest, volumes: ladder ? [ladder] : [] })
): ClimbFixture {
  const ctx = createTestContext({ input: createTestInput() });
  const movement = new Movement(
    { input: ctx.input, time: ctx.time, peek: (): LadderLookup | null => world },
    {}
  );
  movement.position.set(authored.x, authored.y0, authored.z);
  let placements = 0;
  const character = new CharacterController(new StaticWorld(), { height: 1.8, stepHeight: 0.3 });
  character.setPosition = (): void => {
    placements++;
  };
  movement.character = character;
  return { movement, character, placements: (): number => placements };
}
function snapshot(f: ClimbFixture): object {
  const m = f.movement;
  return {
    climb: { ...m.climbMotion },
    position: m.position.toArray(),
    velocity: m.velocity.toArray(),
    state: m.state,
    prevState: m.prevState,
    stateTime: m.stateTime,
    grounded: m.grounded,
    stance: m.stance,
    stanceWant: m.stanceWant,
    sprinting: m.sprinting,
    tacticalSprint: m.tacticalSprint,
    sliding: m.sliding,
    jumpBuffer: m._jumpBuffer,
    height: f.character.height,
    stepHeight: f.character.stepHeight,
    placements: f.placements(),
  };
}
for (const ladder of [authored, { ...authored, nx: 0, nz: -1 }]) {
  for (const exit of ['jump', 'top', 'bottom']) {
    const f = fixture(ladder),
      m = f.movement;
    const y =
      exit === 'top' ? ladder.y1 : exit === 'bottom' ? ladder.y0 : (ladder.y0 + ladder.y1) / 2;
    m.position.y = y;
    assert.equal(m._tryClimb(1), true);
    assert.deepEqual(
      [m.climbMotion.nx, m.climbMotion.nz],
      [ladder.nx, ladder.nz],
      'catching retains authored exit normal'
    );
    let leave: Parameters<Movement['_leaveClimb']> | undefined;
    m._leaveClimb = (...args): void => {
      leave = args;
    };
    const moveY = exit === 'top' ? 1 : exit === 'bottom' ? -1 : 0;
    m._stepClimb(1 / 120, { ...m.cmd, jump: exit === 'jump', moveY });
    const distance =
      exit === 'jump'
        ? MOVE.climb.jumpOff
        : exit === 'top'
          ? MOVE.climb.dismount
          : MOVE.climb.footStep;
    assert.deepEqual(
      leave,
      [
        ladder.x + ladder.nx * distance,
        y,
        ladder.z + ladder.nz * distance,
        exit === 'jump' ? ladder.nx * MOVE.climb.jumpOffSpeed : 0,
        exit === 'jump' ? MOVE.climb.jumpOffRise : 0,
        exit === 'jump' ? ladder.nz * MOVE.climb.jumpOffSpeed : 0,
      ],
      `${exit}: position and velocity follow that ladder's normal`
    );
  }
}
// A later catch must replace the previous ladder's direction, not retain it.
{
  let current = authored;
  const { movement: m } = fixture(null, { ladderAt: (): typeof current => current });
  assert.equal(m._tryClimb(1), true);
  m.climbMotion.active = false;
  current = { ...authored, nx: 0, nz: -1 };
  assert.equal(m._tryClimb(1), true);
  assert.deepEqual([m.climbMotion.nx, m.climbMotion.nz], [0, -1]);
}
for (const field of ['x', 'z', 'y0', 'y1', 'nx', 'nz']) {
  for (const bad of [undefined, 'invalid', NaN, Infinity, -Infinity]) {
    const ladder: Record<string, unknown> = { ...authored, [field]: bad };
    if (bad === undefined) delete ladder[field];
    // Deliberately enter as an untyped caller: WorldQueries must reject malformed ladders.
    const malformedWorld: unknown = Reflect.construct(WorldQueries, [
      { ...manifest, volumes: [ladder] },
    ]);
    assert.ok(malformedWorld instanceof WorldQueries);
    const f = fixture(null, malformedWorld),
      before = snapshot(f);
    assert.equal(f.movement._tryClimb(1), false, `reject malformed ${field}: ${String(bad)}`);
    assert.deepEqual(
      snapshot(f),
      before,
      'malformed boundary cannot commit climb or character state'
    );
  }
}
for (const value of [null, undefined, 7, {}, { ladderAt: 1 }, { ladderAt: (): null => null }]) {
  const f = fixture(null),
    before = snapshot(f);
  assert.throws(
    (): unknown => parseWorldManifest({ ...manifest, volumes: [value] }),
    /\[models\]/,
    'malformed external volume data is rejected at the manifest boundary'
  );
  assert.equal(f.movement._tryClimb(1), false);
  assert.deepEqual(snapshot(f), before);
}
for (const world of [null, undefined, { ladderAt: (): null => null }]) {
  const f = fixture(null, world),
    before = snapshot(f);
  assert.equal(f.movement._tryClimb(1), false, 'absent world/ladder lookup remains optional');
  assert.deepEqual(snapshot(f), before);
}
assert.equal(
  new WorldQueries(manifest).ladderAt(authored.x, authored.y0, authored.z),
  borrowed,
  'typed lookup borrows the validated ladder without hot-path allocations'
);
console.log(
  'movement-climb: authored/alternate normals drive jump/top/bottom exits; malformed manifest/ladder data and absent providers do not mutate state'
);

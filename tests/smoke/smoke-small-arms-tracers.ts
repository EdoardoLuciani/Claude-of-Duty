/**
 * Issue 278: ordinary small-arms fire must not emit tracers.
 *   bun test ./tests/smoke/smoke-small-arms-tracers.ts
 */
import assert from 'node:assert/strict';

import * as THREE from 'three';

import { Animator } from '../../src/ai/animator.ts';
import { AiSystem } from '../../src/ai/index.ts';
import { AudioSystem } from '../../src/audio/index.ts';
import type { EngineEventMap, EngineEventName } from '../../src/core/events.ts';
import { EventBus } from '../../src/core/registry.ts';
import { Rng } from '../../src/core/rng.ts';
import { PhysicsSystem } from '../../src/physics/index.ts';
import { ProjectileSim } from '../../src/weapons/ballistics.ts';
import { WEAPON_DEFS, WEAPON_IDS, buildRecoilPattern } from '../../src/weapons/defs.ts';
import type { Viewmodel } from '../../src/weapons/viewmodel.ts';
import { makeAgent } from '../lib/agent-fixture.ts';
import { ArmedWeaponSystem } from '../lib/ballistics-fixture.ts';
import { createTestContext } from '../lib/context.ts';
import * as complete from '../lib/fixture-targets.ts';
import { fixture } from '../lib/fixture.ts';

for (const id of WEAPON_IDS) {
  assert.equal(
    'tracerEvery' in WEAPON_DEFS[id] ? WEAPON_DEFS[id].tracerEvery : undefined,
    undefined,
    `${id} has no tracer cadence`
  );
}

let clipName: string | null = null;
const vm = fixture<Viewmodel>(
  {
    get clipName(): string | null {
      return clipName;
    },
    play(name): number {
      clipName = name;
      return 1;
    },
    stopClip(): void {
      clipName = null;
    },
    syncToCamera(): void {},
    muzzleWorld(out): THREE.Vector3 {
      return out;
    },
    addRecoil(): void {},
  },
  complete.testViewmodel()
);

function makeRifle(seed: number): ArmedWeaponSystem {
  const wp = new ArmedWeaponSystem();
  wp.ctx = createTestContext();
  wp.rng = new Rng(seed);
  wp.stats = { tris: 0, drawCalls: 0, live: 0, fired: 0 };
  wp.viewmodel = vm;
  const def = { ...WEAPON_DEFS.rifle };
  wp.states.set('rifle', {
    def,
    pattern: buildRecoilPattern(def, Rng),
    mag: def.magSize,
    chambered: true,
    reserve: def.reserve,
    mode: def.modes[0],
    modeIndex: 0,
  });
  return wp;
}

function fireRifle(wp: ArmedWeaponSystem): Array<boolean | undefined> {
  const spawned: Array<boolean | undefined> = [];
  wp.sim = fixture<ProjectileSim>(
    {
      spawn(o): null {
        spawned.push(o.tracer);
        return null;
      },
    },
    complete.testProjectileSim()
  );
  wp._spread = 1.2;
  for (let i = 0; i < 9; i++) {
    wp.state.chambered = true;
    wp._fireTimer = 0;
    wp.viewmodel.stopClip();
    assert.equal(wp.tryFire(), true);
  }
  return spawned;
}

{
  const spawned = fireRifle(makeRifle(0x278b00));
  assert.equal(spawned.length, 9);
  assert(spawned.every((tracer): boolean => tracer === false));
}

const events = new EventBus();
const rng = new Rng(0x278c00);
const phys = new PhysicsSystem();
phys.ctx = { events, scene: null, camera: null, time: { alpha: 0, elapsed: 0, dt: 1 / 60 }, rng };
phys.rng = rng.fork();
phys.ballistics.rng = phys.rng;
phys
  .addCollider({
    shape: 'capsule',
    layer: phys.LAYER.ACTOR,
    surface: 'flesh',
    owner: { id: 'enemy' },
    part: 'torso',
    radius: 0.185,
  })
  .setSegment(0, 1.18, 0, 0, 1.55, 0);

function take<K extends EngineEventName>(type: K): { got: EngineEventMap[K][]; off(): void } {
  const got: EngineEventMap[K][] = [];
  return { got, off: events.on(type, (e): number => got.push(e)) };
}

{
  const impacts = take('bullet:impact');
  const damage = take('damage:dealt');
  const ctx = createTestContext({ events, providers: { physics: phys }, rng });
  ctx.has = (): boolean => false;
  const sim = new ProjectileSim(ctx);
  sim.spawn({
    origin: new THREE.Vector3(0, 1.36, 4),
    dir: new THREE.Vector3(0, 0, -1),
    speed: 880,
    damage: 33,
    penetration: 1.0,
    dragK: 0.28,
    dropoff: 0.62,
    maxRange: 420,
    weapon: WEAPON_DEFS.rifle,
    tracer: false,
  });
  for (let i = 0; i < 8; i++) sim.fixedUpdate(1 / 120);
  assert.equal(sim.live.length, 1, 'the penetrated round survives contact');
  assert.equal(damage.got.length, 1);
  for (let i = 0; i < 240 && sim.live.length; i++) sim.fixedUpdate(1 / 120);
  impacts.off();
  damage.off();
  assert.equal(sim.live.length, 0);
  assert.ok(impacts.got.length >= 1);
  assert.equal(damage.got.length, 1);
}

const ai = new AiSystem();
ai.ctx = createTestContext({ events, providers: { physics: phys } });
ai.ctx.time.elapsed = 12;
ai.ctx.time.frame = 40;
ai.ctx.config.deterministic = false;
ai._phys = phys;
ai._v = new THREE.Vector3();
ai._v2 = new THREE.Vector3();
ai._fireEvent = {
  actor: null,
  weapon: 'ai_rifle',
  origin: new THREE.Vector3(),
  dir: new THREE.Vector3(),
  seed: 0,
  intensity: 0.12,
  light: 0.006,
  flashScale: 0.8,
};
ai._shellEvent = { position: new THREE.Vector3(), velocity: new THREE.Vector3() };
const agent = makeAgent({
  id: 0,
  ammo: 0,
  team: 1,
  weaponDamage: 17,
  position: new THREE.Vector3(0, 0, 8),
  lastFired: -Infinity,
  fireX: 0,
  fireZ: 0,
  animator: fixture<Animator>(
    { ejectWorld: new THREE.Vector3(0.2, 1.2, 8) },
    complete.makeAgent().animator
  ),
});

{
  const fires = take('weapon:fire');
  const shells = take('weapon:shell');
  const damage = take('damage:dealt');
  ai.onAgentFire(agent, new THREE.Vector3(0, 1.36, 8), new THREE.Vector3(0, 0, -1));
  fires.off();
  shells.off();
  damage.off();
  assert.equal(fires.got.length, 1);
  assert.equal(shells.got.length, 1);
  assert.ok(damage.got.length >= 1);
  assert.equal(agent.lastFired, 12);
}

{
  const plays: string[] = [];
  const audio = new AudioSystem();
  audio.running = true;
  audio.ctx = createTestContext();
  audio.rng = new Rng(1);
  audio.rng.float = (): number => 0;
  audio.field = fixture<NonNullable<AudioSystem['field']>>(
    {
      listenerPos: { x: 0, y: 1.36, z: 0 },
      distanceTo(x, y, z): number {
        return Math.hypot(x, y - 1.36, z);
      },
    },
    complete.testSpatialField()
  );
  audio._budget.whizz = 0;
  audio._whizzShots = new Float64Array(64);
  audio._whizzCursor = 0;
  audio._space = {
    tight: 0,
    room: 0,
    street: 0,
    tunnel: 0,
    open: 0,
    enclosure: 0,
    meanFree: 0,
    ceiling: 0,
  };
  audio.actx = fixture<AudioContext>({ currentTime: 0 }, complete.createAudioContext());
  audio.mixer = fixture<NonNullable<AudioSystem['mixer']>>(
    { duck(): void {} },
    complete.testMixer()
  );
  audio._playAt = (kind): boolean => {
    plays.push(kind);
    return true;
  };
  audio._playDry = (): boolean => true;
  const fire: EngineEventMap['weapon:fire'] = {
    actor: null,
    seed: 0,
    weapon: 'ai_rifle',
    origin: new THREE.Vector3(1, 1.36, 20),
    dir: new THREE.Vector3(0, 0, -1),
  };
  for (let i = 0; i < 6; i++) {
    audio._budget.whizz = 0;
    audio._onFire(fire);
  }
  assert.equal(
    plays.filter((k): boolean => k === 'whizz').length,
    0,
    'muzzle direction is not a resolved near miss'
  );
  for (let i = 0; i < 6; i++) {
    audio._budget.whizz = 0;
    audio._onBulletSegment({
      from: fire.origin,
      to: new THREE.Vector3(1, 1.36, -10),
      shooter: null,
      weapon: null,
      speed: 0,
      tracer: false,
      shot: i + 1,
    });
  }
  assert.equal(
    plays.filter((k): boolean => k === 'whizz').length,
    6,
    'resolved segments preserve whizz feedback'
  );
  audio._budget.whizz = 0;
  audio._onBulletSegment({
    from: fire.origin,
    to: new THREE.Vector3(1, 1.36, -10),
    shooter: null,
    weapon: null,
    speed: 0,
    tracer: false,
    shot: 6,
  });
  assert.equal(plays.filter((k): boolean => k === 'whizz').length, 6, 'one whizz per round');
  plays.length = 0;
  audio._budget.whizz = 0;
  audio._onFire({ ...fire, origin: new THREE.Vector3(0, 1.36, 0) });
  assert.equal(plays.filter((k): boolean => k === 'whizz').length, 0, 'own muzzle does not whizz');
}

console.log('smoke-small-arms-tracers: ok');

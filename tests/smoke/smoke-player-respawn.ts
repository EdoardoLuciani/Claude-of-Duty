import assert from 'node:assert/strict';

import * as THREE from 'three';

import { AiSystem } from '../../src/ai/index.ts';
/** Respawn must publish the reset damage capsule before nested restart consumers run. */
import { EventBus } from '../../src/core/registry.ts';
import { StaticWorld } from '../../src/physics/bvh.ts';
import { CharacterController } from '../../src/physics/character.ts';
import { PhysicsSystem } from '../../src/physics/index.ts';
import { Collider } from '../../src/physics/index.ts';
import { CameraRig } from '../../src/player/camera.ts';
import { HealController } from '../../src/player/heal.ts';
import { Health } from '../../src/player/health.ts';
import { PlayerSystem } from '../../src/player/index.ts';
import { Movement } from '../../src/player/movement.ts';
import type { PlayerStance } from '../../src/player/tuning.ts';
import { HEALTH, HEALING, STANCE } from '../../src/player/tuning.ts';
import { WorldSystem } from '../../src/world/index.ts';
import { createTestContext } from '../lib/context.ts';
import * as complete from '../lib/fixture-targets.ts';

interface RespawnFixture {
  player: PlayerSystem;
  events: EventBus;
  ai: AiSystem;
  placementOrigins: THREE.Vector3[];
  populate: () => number;
}
function fixture(dead: boolean, stance: PlayerStance): RespawnFixture {
  const player = new PlayerSystem();
  const spawn = { position: new THREE.Vector3(12, 2, 20), yaw: 0.7, tag: 'test' };
  const world = new WorldSystem();
  world.spawnPoints = [spawn, { position: new THREE.Vector3(-60, 2, -40), yaw: 0, tag: 'test' }];
  const events = new EventBus();
  const ctx = createTestContext({ events, providers: { player, world } });
  ctx.time.elapsed = 10;
  ctx.config.fov = 75;
  player.ctx = ctx;
  player.physics = new PhysicsSystem();
  player.physics.groundHeight = (): number => 2;
  player.movement = new Movement(ctx, player);
  const character = new CharacterController(new StaticWorld());
  character.position = new THREE.Vector3();
  character.grounded = true;
  character.teleport = (x, y, z): void => {
    character.setPosition(x, y, z);
  };
  player.movement.character = character;
  player.rig = new CameraRig(ctx);
  player.health = new Health(ctx, player.rig);
  player.healCtrl = new HealController(player);
  player.flashlight = new THREE.SpotLight();
  player.hitbox = new Collider({ owner: player });
  player.movement.teleport(-35, 0, -45);
  player.movement.stance = stance;
  player.movement.stanceWant = stance;
  player.movement.leanAmount = 0.8;
  player.movement.leanOffsetX = 0.25;
  player.movement.leanOffsetZ = -0.15;
  player.rig.eye = STANCE[stance].eye;
  player.health.value = dead ? 0 : 25;
  player.health.dead = dead;
  player._death.active = dead;
  player.controlEnabled = !dead;
  player.healCtrl.bandages = 0;
  player._syncHitbox();
  assert.equal(player.hitbox.enabled, !dead, 'old death collider starts disabled');
  assert.equal(player.hitbox.ax, -35);
  assert.equal(player.hitbox.bx, -34.75, 'old capsule includes lean');

  const ai = new AiSystem();
  ai.ctx = ctx;
  // Native navigation is never queried when perSquad is zero; only readiness is used.
  ai.grid = complete.testNav();
  ai._v3 = new THREE.Vector3();
  const placementOrigins: THREE.Vector3[] = [];
  ai.playerPosition = function (out, sample): THREE.Vector3 {
    const result = AiSystem.prototype.playerPosition.call(this, out, sample);
    placementOrigins.push(result.clone());
    return result;
  };
  // Exercise populate's actual origin selection, without constructing/rendering soldiers.
  const populate = (): number => ai.populate({ squads: 1, perSquad: 0 });
  events.on('game:restart', (): void => player.respawn());
  events.on('game:restart', populate);
  return { player, events, ai, placementOrigins, populate };
}

function assertReset(player: PlayerSystem): void {
  assert.equal(player.dead, false);
  assert.equal(player.health.value, HEALTH.max);
  assert.equal(player.health.armour, HEALTH.plateSize);
  assert.equal(player.bandages, HEALING.startCount);
  assert.equal(player.stance, 'stand');
  assert.equal(player.rig.eye, STANCE.stand.eye);
  assert.equal(player.movement.leanAmount, 0);
  assert.equal(player.movement.leanOffsetX, 0);
  assert.equal(player.movement.leanOffsetZ, 0);
  assert.deepEqual(player.position.toArray(), [12, 2.03, 20]);
  assert.ok(player.hitbox);
  assert.equal(player.hitbox.enabled, true, 'reset capsule is enabled synchronously');
  const c = player.hitbox;
  assert.deepEqual([c.ax, c.ay, c.az], [12, 2.03 + 0.3, 20]);
  assert.deepEqual([c.bx, c.by, c.bz], [12, 2.03 + STANCE.stand.height - 0.3, 20]);
  assert.equal(c.radius, 0.3);
}

for (const dead of [true, false]) {
  for (const stance of ['crouch', 'prone'] as const) {
    const { player, events, ai, placementOrigins, populate } = fixture(dead, stance);
    let respawns = 0;
    events.on('player:respawn', ({ position }): void => {
      respawns++;
      assertReset(player);
      assert.equal(player._death.active, false);
      assert.equal(player.controlEnabled, true);
      assert.deepEqual(position.toArray(), player.position.toArray());
      populate(); // A synchronous nested observer must already see the new capsule.
    });
    events.emit('game:restart', { source: 'test' });
    assertReset(player);
    assert.equal(respawns, dead ? 1 : 0, 'living respawn retains its no-death-event behavior');
    assert.equal(placementOrigins.length, dead ? 2 : 1);
    const expectedY = 2.03 + STANCE.stand.height * 0.62;
    for (const origin of placementOrigins) {
      assert.deepEqual(origin.toArray(), [12, expectedY, 20], 'actual populate uses reset origin');
    }
    for (const sample of [0, 1, 2]) {
      const origin = ai.playerPosition(new THREE.Vector3(), sample);
      assert.equal(origin.x, 12);
      assert.equal(origin.z, 20);
    }
  }
}
console.log(
  'ALL PASS: dead/living respawn synchronizes capsule before nested observers and AI placement'
);

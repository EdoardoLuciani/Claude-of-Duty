import assert from 'node:assert/strict';

import * as THREE from 'three';

import { Agent } from '../../src/ai/agent.ts';
import { TACTICS } from '../../src/ai/tuning.ts';
import { CALLOUT_CAST, calloutBank } from '../../src/audio/callouts.ts';
import type { EngineEventMap } from '../../src/core/events.ts';
import { makeAgent } from '../../tools/lib/agent-fixture.ts';
import { BrainPlayer, brainPhysics } from '../lib/ai-brain-fixture.ts';
import { createTestContext } from '../lib/context.ts';

const a = makeAgent({ yaw: 0, state: 'combat' });
const heard: EngineEventMap['ai:bark'][] = [];
a.ctx.events.on('ai:bark', (p): number => heard.push({ ...p }));
a.ai.playerPosition = (out): THREE.Vector3 => out.set(0, 1.2, 8);
a.phys = brainPhysics();
a._sense(0.01);
assert.equal(heard.length, 0, 'seeing a partial acquisition is not yet contact');
a._sense(1);
assert.equal(heard.length, 1);
assert.equal(heard[0].kind, 'spot');
assert.equal(heard[0].voice, a.id);
assert.equal(heard[0].position, a.position, 'retained actor position supports moving emitters');
for (let i = 0; i < 30; i++) a._sense(0.1);
assert.equal(heard.length, 1, 'ongoing LOS never repeats contact each tick');
a.phys.lineOfSight = (): boolean => false;
a._sense(TACTICS.visualMemory + 0.1);
assert.equal(a.hasTarget, false);
assert.equal(heard.length, 1);
a.hear(new THREE.Vector3(0, 0, 8), 40);
assert.equal(heard.length, 1, 'hearing/report evidence is not a visual contact announcement');
a.phys.lineOfSight = (): boolean => true;
a._sense(1);
assert.equal(heard.length, 2, 'fresh visual reacquisition can request a new contact');
a.hasTarget = false;
const player = new BrainPlayer();
player.hitbox.enabled = false;
a.ai.ctx = createTestContext({ events: a.ctx.events, providers: { player } });
a._sense(1);
assert.equal(heard.length, 2, 'disabled/dead player cannot be spotted');

function lastBark(): EngineEventMap['ai:bark'] {
  const bark = heard.at(-1);
  assert.ok(bark);
  return bark;
}
const reloads: EngineEventMap['weapon:reload'][] = [];
a.ctx.events.on('weapon:reload', (p): number => reloads.push(p));
a.ai.emitReload(a);
assert.equal(reloads.length, 1);
assert.equal(reloads[0].actor, a);
assert.equal(lastBark().kind, 'reload');
assert.equal(lastBark().voice, a.id, 'reload preserves the contact speaker');

const target = new THREE.Vector3(0, 0, 12);
a.hasGrenade = true;
a.ai.throwGrenade = (): boolean => false;
const before = heard.length;
a._throwGrenade(target);
assert.equal(heard.length, before, 'failed launch cannot announce a grenade that does not exist');
assert.equal(a.hasGrenade, true, 'failed launch retains its grenade');
a.ai.throwGrenade = (): boolean => true;
a._throwGrenade(target);
assert.equal(heard.length, before + 1);
assert.equal(lastBark().kind, 'grenade');
assert.equal(lastBark().voice, a.id, 'throw preserves the same speaker');
assert.equal(a.hasGrenade, false);
assert(a.grenadeCooldown >= 16);

// Exercise the actual constructor's consecutive IDs, not random per-line voice selection.
const reference = makeAgent();
const counts = Object.fromEntries(
  CALLOUT_CAST.map((voice): ['orus' | 'algenib' | 'alnilam' | 'iapetus', number] => [voice, 0])
);
for (let i = 0; i < 20; i++) {
  const enemy = new Agent(reference.ai);
  const voice = calloutBank(enemy.id, 'spot').replace('-spot', '');
  counts[voice]++;
  assert.equal(calloutBank(enemy.id, 'reload'), voice + '-reload');
  assert.equal(calloutBank(enemy.id, 'grenade'), voice + '-grenade');
  enemy.group.removeFromParent();
  enemy.skeleton.dispose();
}
assert.deepEqual(
  Object.values(counts),
  [5, 5, 5, 5],
  'uniform cast without extra gameplay RNG draws'
);
console.log(
  'Visual acquisition, real reload/throw semantics and evenly distributed immutable enemy voices'
);

import assert from 'node:assert/strict';

import * as THREE from 'three';

/**
 * Bun smoke test for enemy footsteps the player can hear — no browser.
 *
 * The player has always heard their own boots. This covers the other direction:
 * the animator marks the foot plant off its stride phase, the agent turns that
 * into `ai:footstep`, and the rate of those events is the clip's own cadence —
 * walking, sprinting and crouch-walking each sound like themselves, and an
 * actor in the air or mid-vault makes no sound at all.
 *
 *   bun test ./tests/smoke/smoke-ai-footsteps.ts
 */
import type { Agent } from '../../src/ai/agent.ts';
import { Animator } from '../../src/ai/animator.ts';
import { RIG } from '../../src/ai/rig.ts';
import type { EngineEventMap } from '../../src/core/events.ts';
import { makeAgent } from '../lib/agent-fixture.ts';
import { createTestContext } from '../lib/context.ts';
import * as complete from '../lib/fixture-targets.ts';
import { fixture } from '../lib/fixture.ts';

type Footstep = {
  t: number;
  surface: EngineEventMap['ai:footstep']['surface'];
  gait: EngineEventMap['ai:footstep']['gait'];
  x: number;
  y: number;
  z: number;
};
const SURFACE = 'metal';

/** Flat ground under every foot, so the rig's own IK plants them. */
function flatGround(_x: number, _z: number, _fromY: number, out: Animator['_probeOut']): boolean {
  out.y = 0;
  out.nx = 0;
  out.ny = 1;
  out.nz = 0;
  return true;
}

/** Mean seconds between consecutive events. */
function meanGap(list: Footstep[]): number {
  const gaps = list.slice(1).map((e, i): number => e.t - list[i].t);
  return gaps.reduce((a, b): number => a + b, 0) / gaps.length;
}

/**
 * A soldier that exists only as far as `Animator` and `Agent._drive` care.
 * `lod` puts the actor off-screen, where animation is evaluated one frame in three.
 */
function soldier(lod = false): {
  agent: Agent;
  animator: Animator;
  run: (seconds: number, speed: number, dt?: number) => Footstep[];
} {
  const group = new THREE.Group();
  const { bones } = RIG.createSkeleton();
  group.add(bones[0]);
  group.updateMatrixWorld(true);

  const animator = new Animator(RIG, bones, { scale: 1, probe: flatGround });
  const heard: Footstep[] = [];
  let elapsed = 0;

  const ctx = createTestContext();
  ctx.events.on('ai:footstep', (p): void => {
    heard.push({
      t: elapsed,
      surface: p.surface,
      gait: p.gait,
      x: p.position.x,
      y: p.position.y,
      z: p.position.z,
    });
  });
  const agent = makeAgent({
    animator,
    group,
    lodIrrelevant: lod,
    controller: fixture<NonNullable<Agent['controller']>>(
      { groundSurfaceName: SURFACE },
      new complete.CharacterController(new complete.StaticWorld())
    ),
    ctx,
  });

  /** `seconds` of 60 Hz frames at `speed`, returning what was emitted. */
  function run(seconds: number, speed: number, dt = 1 / 60): Footstep[] {
    heard.length = 0;
    for (let i = 0, n = Math.round(seconds / dt); i < n; i++) {
      agent.speed = speed;
      elapsed += dt;
      ctx.time.elapsed = elapsed;
      agent._drive(dt);
    }
    return heard;
  }

  return { agent, animator, run };
}

/* ------------------------------------------------------------------ */
/* the animator's plant signal                                        */
/* ------------------------------------------------------------------ */

{
  const { animator } = soldier();
  const dt = 1 / 60;

  animator.setState({ clip: 'walk', speed: 1.42 });
  let pulses = 0;
  let doubled = 0;
  let prev = false;
  for (let i = 0; i < 60 * 5; i++) {
    animator.update(dt, i * dt);
    const f = animator.footfall;
    if (f && prev) doubled++;
    if (f) pulses++;
    prev = f;
  }
  // walk cadence is speed / 1.42 cycles per second, two plants per cycle
  assert.ok(pulses >= 9 && pulses <= 11, `walk plants ~2/s, got ${pulses}`);
  assert.equal(doubled, 0, 'a plant is a single-update pulse, never a run of them');

  // idle keeps ticking the phase (breathing) and must not mark time
  animator.setState({ clip: 'idle', speed: 0 });
  let idlePulses = 0;
  for (let i = 0; i < 60 * 5; i++) {
    animator.update(dt, i * dt);
    if (animator.footfall) idlePulses++;
  }
  assert.equal(idlePulses, 0, 'standing still plants nothing');

  // a disabled animator must not hand the same plant out a second time
  animator.setState({ clip: 'walk', speed: 1.42 });
  let n = 0;
  while (!animator.footfall && n++ < 600) animator.update(dt, n * dt);
  assert.equal(animator.footfall, true, 'the plant arrives');
  animator.enabled = false;
  animator.update(dt, 99);
  assert.equal(animator.footfall, false, 'disabling clears a plant the agent has not read yet');
  animator.enabled = true;
}

/* ------------------------------------------------------------------ */
/* gait, surface and cadence reach the event                           */
/* ------------------------------------------------------------------ */

{
  const s = soldier();
  const walked = s.run(4, 1.42);
  assert.ok(walked.length >= 7 && walked.length <= 9, `walk: ~2 plants/s, got ${walked.length}`);
  for (const e of walked) {
    assert.equal(e.gait, 'walk', 'a 1.4 m/s clip is a walk');
    assert.equal(e.surface, SURFACE, 'the boot lands on the surface under the actor');
    assert.equal(e.x, s.agent.position.x, 'the sound sits on the actor, not at the origin');
    assert.equal(e.y, s.agent.position.y);
    assert.equal(e.z, s.agent.position.z);
  }
}

{
  const s = soldier();
  const ran = s.run(2, 4.2);
  // run cadence is speed / 2.05 cycles per second, two plants per cycle
  assert.ok(ran.length >= 7 && ran.length <= 9, `run: ~4.1 plants/s, got ${ran.length}`);
  for (const e of ran) assert.equal(e.gait, 'run', 'a 4.2 m/s clip is a run');
  const runGap = meanGap(ran);
  assert.ok(Math.abs(runGap - 0.244) < 0.03, `run plants every ~0.24 s, got ${runGap.toFixed(3)}`);
}

{
  const s = soldier();
  s.agent.crouch = true;
  // crouch cadence is speed / 0.95, and a crouched man is a quieter foot
  const crept = s.run(3, 0.7);
  assert.ok(crept.length >= 4 && crept.length <= 6, `crouch: ~1.5 plants/s, got ${crept.length}`);
  for (const e of crept) assert.equal(e.gait, 'crouch', 'crouch-walking reports the crouch gait');
}

/* ------------------------------------------------------------------ */
/* silence: no ground, no sound                                        */
/* ------------------------------------------------------------------ */

{
  const s = soldier();
  s.agent.grounded = false;
  assert.equal(s.run(2, 1.42).length, 0, 'a walking clip in mid-air makes no sound');
}

{
  const s = soldier();
  s.agent.animator.vault(0.85);
  assert.equal(s.run(0.6, 1.42).length, 0, 'a vault is silent');
}

{
  const s = soldier();
  assert.equal(s.run(2, 0).length, 0, 'standing still is silent');
}

{
  // Off-screen actors animate one frame in three (Agent._drive), so a single
  // evaluation can hold a whole foot plant and more. At 10 FPS it holds 0.673 of
  // a stride cycle, so every evaluation past the first contains one. Comparing
  // half-cycle buckets instead dropped those to 27 of the 40.
  const visible = soldier().run(12, 4.6, 0.1).length;
  const offScreen = soldier(true).run(12, 4.6, 0.1).length;
  const evaluations = Math.floor((12 * 10) / 3);
  assert.ok(Math.abs(visible - 53.9) < 2, `full rate: ~54 plants, got ${visible}`);
  // The first evaluation carries one frame of stride, not three, so it can pass
  // without reaching a contact.
  assert.ok(
    offScreen >= evaluations - 1,
    `a skipped update still boots: got ${offScreen} of ${evaluations} evaluations`
  );
}

console.log('  ok  enemy footsteps reach the audio contract');

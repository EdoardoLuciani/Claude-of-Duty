import * as THREE from 'three';

import { Agent, STATE } from '../../src/ai/agent.ts';
import { INFANTRY } from '../../src/ai/capabilities.ts';
import { NAV_PROFILE } from '../../src/ai/nav-format.ts';
import { makeAi } from '../lib/agent-fixture.ts';
import type { FixtureAi } from '../lib/agent-fixture.ts';
import type { SurfaceNav } from '../../src/ai/nav.ts';
import type { PhysicsSystem } from '../../src/physics/index.ts';
import type { CharacterController } from '../../src/physics/character.ts';
import { applyDefinedPatch } from '../../src/core/patch.ts';
import type { NavigationCase } from './fixtures.ts';

export interface WalkerFixture { physics: PhysicsSystem; grid: SurfaceNav | null }
export interface PathCandidate {
  query(from: THREE.Vector3, to: THREE.Vector3): { points: THREE.Vector3[]; outcome: string | null; reason?: string | null };
}
export interface WalkerOptions { scale?: number; slopeLimit?: number; speed?: number; dt?: number }
export interface Recovery { from: [number, number, number]; to: [number, number, number] }
export class WalkerAgent extends Agent {
  declare controller: CharacterController;
  declare ai: FixtureAi;
  recoveries: Recovery[] = [];
}
export interface TraversalResult {
  name: string; initialOutcome: string | null; finalOutcome: string | null; arrived: boolean; status: string | null;
  elapsed: number; pathDistance: number; horizontalError: number; floorError: number; maxStall: number; maxJump: number;
  end: [number, number, number]; recovery: Recovery[]; recoveryAttempts: number; recoveryOutcome: string | null;
  initialPath: [number, number, number][]; trace: [number, number, number][];
}

// Independent direct-controller traversal, without consulting the navigator.
export function canConnect(physics: PhysicsSystem, from: THREE.Vector3, to: THREE.Vector3): boolean {
  const c = physics.createCharacter({
    radius: NAV_PROFILE.radius,
    height: NAV_PROFILE.height,
    stepHeight: INFANTRY.stepHeight,
    slopeLimit: INFANTRY.slopeRadians,
    position: from,
  });
  c.probeGround();
  let vy = 0;
  let ok = false;
  const frames = Math.ceil((Math.hypot(to.x - from.x, to.z - from.z) / 1.5) * 60) + 20;
  for (let i = 0; i < frames; i++) {
    const dx = to.x - c.position.x,
      dz = to.z - c.position.z,
      d = Math.hypot(dx, dz);
    if (d < 0.12 && Math.abs(to.y - c.position.y) < 0.18) {
      ok = true;
      break;
    }
    const step = Math.min(d, 1.5 / 60);
    vy += physics.gravity / 60;
    c.move(d ? (dx / d) * step : 0, vy / 60, d ? (dz / d) * step : 0);
    if (c.grounded) vy = 0;
  }
  physics.removeCharacter(c);
  return ok;
}

export function makeWalker(
  fixture: WalkerFixture,
  candidate: PathCandidate | null,
  from: THREE.Vector3,
  id = 1,
  { scale = INFANTRY.maxScale, slopeLimit = INFANTRY.slopeRadians }: WalkerOptions = {}
): WalkerAgent {
  const physics = fixture.physics;
  const radius = INFANTRY.radius * scale,
    height = INFANTRY.height * scale;
  const ai = makeAi(fixture.grid);
  ai.groundAt = (x: number, z: number, y: number): number => physics.groundHeight(x, z, y);
  ai.requestPath = (start, to, out): number => {
    if (ai._pathBudget <= 0) {
      ai.lastPathOutcome = 'deferred';
      ai.deferred++;
      return -1;
    }
    ai._pathBudget--;
    if (!candidate) throw new Error('walker path request requires a candidate');
    const result = candidate.query(start, to);
    ai.lastPathOutcome = result.outcome;
    ai.lastPathReason = result.reason ?? null;
    ai.lastPathResFloor = result.points.at(-1)?.y ?? NaN;
    for (let i = 0; i < result.points.length; i++)
      (out[i] ??= new THREE.Vector3()).copy(result.points[i]);
    return result.points.length;
  };
  // Real Agent movement/navigation methods; omit only rendering, senses and gun.
  const a = new WalkerAgent(ai, { position: from });
  a.group.removeFromParent();
  a.skeleton.dispose();
  a.animator.weapon = null;
  applyDefinedPatch<Agent>(a, {
    id,
    ai,
    phys: physics,
    state: STATE.COMBAT,
    position: from.clone(),
    scale,
    radius,
    height,
    controller: physics.createCharacter({
      radius,
      height,
      position: from,
      stepHeight: INFANTRY.stepHeight,
      slopeLimit,
    }),

    desiredSpeed: 1.5,

  });
  if (!a.controller) throw new Error('walker requires a controller');
  a.animator.turn = (): void => {};
  a.animator.vault = (): void => {};
  const teleport = a.controller.teleport.bind(a.controller);
  a.controller.teleport = (x, y, z): void => {
    a.recoveries.push({ from: a.position.toArray(), to: [x, y, z] });
    return teleport(x, y, z);
  };
  ai.agents.push(a);
  return a;
}

export function execute(fixture: WalkerFixture, candidate: PathCandidate, sample: NavigationCase, options: WalkerOptions = {}): TraversalResult {
  const a = makeWalker(fixture, candidate, sample.from, sample.recorded ?? 1, options);
  a.desiredSpeed = options.speed ?? 1.5;
  const dt = options.dt ?? 1 / 60;
  a._goTo(sample.to);
  const initialOutcome = a.pathOutcome;
  const initialPath = a.path.slice(0, a.pathLen).map((p): [number, number, number] => p.toArray());
  let elapsed = 0,
    maxStall = 0,
    stall = 0,
    maxJump = 0;
  const progressPos = a.position.clone(),
    prev = a.position.clone();
  const trace = [a.position.toArray()];
  let pathDistance = 0,
    anchor = sample.from;
  for (const p of a.path.slice(0, a.pathLen)) {
    pathDistance += anchor.distanceTo(p);
    anchor = p;
  }
  const seconds = Math.min(240, Math.max(15, (pathDistance / 1.5) * 1.6 + 8));
  for (; elapsed < seconds && a.hasMoveTarget; elapsed += dt) {
    a.ai._pathBudget = 2;
    if (a.pathPending) a._goTo(a._pendingDest);
    prev.copy(a.position);
    a._move(dt);
    a._tickNoProgress(dt);
    maxJump = Math.max(maxJump, prev.distanceTo(a.position));
    if (a.position.distanceTo(progressPos) >= 0.5) {
      stall = 0;
      progressPos.copy(a.position);
    } else {
      stall += dt;
      maxStall = Math.max(maxStall, stall);
    }
    if (Math.round(elapsed * 60) % 12 === 0) trace.push(a.position.toArray());
    if (a.recoveries.length) break; // never credit emergency repositioning as traversal
  }
  const horizontalError = Math.hypot(a.position.x - sample.to.x, a.position.z - sample.to.z);
  const floorError = Math.abs(a.position.y - sample.to.y);
  const alreadyAtGoal =
    Math.hypot(sample.from.x - sample.to.x, sample.from.z - sample.to.z) <= 0.5 &&
    Math.abs(sample.from.y - sample.to.y) <= 0.18;
  const arrived =
    initialOutcome === 'success' &&
    !a.recoveries.length &&
    horizontalError <= 0.5 &&
    floorError <= 0.18;
  const result = {
    name: sample.name,
    initialOutcome,
    finalOutcome: a.pathOutcome,
    arrived,
    status: alreadyAtGoal
      ? 'already-at-goal'
      : arrived
        ? 'arrived'
        : a.recoveries.length
          ? 'recovery'
          : initialOutcome !== 'success'
            ? initialOutcome
            : maxStall >= 3
              ? 'stalled'
              : a.hasMoveTarget
                ? 'timeout-progress'
                : a.pathOutcome !== 'success'
                  ? 'execution-failure'
                  : 'wrong-arrival',
    elapsed,
    pathDistance,
    horizontalError,
    floorError,
    maxStall,
    maxJump,
    end: a.position.toArray(),
    recovery: a.recoveries,
    recoveryAttempts: a.recoveryAttempts ?? 0,
    recoveryOutcome: a.recoveryOutcome ?? null,
    initialPath,
    trace,
  };
  fixture.physics.removeCharacter(a.controller);
  return result;
}

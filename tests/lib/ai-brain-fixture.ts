import * as THREE from 'three';

import { Animator } from '../../src/ai/animator.ts';
import { AiSystem } from '../../src/ai/index.ts';
import type { BakedCoverPoint } from '../../src/ai/nav-format.ts';
import { RIG } from '../../src/ai/rig.ts';
import type { EventBus } from '../../src/core/registry.ts';
import { Rng } from '../../src/core/rng.ts';
import { isMesh } from '../../src/core/three-guards.ts';
import { PhysicsSystem } from '../../src/physics/index.ts';
import { Health } from '../../src/player/health.ts';
import { PlayerSystem } from '../../src/player/index.ts';
import { Movement } from '../../src/player/movement.ts';
import { createTestContext } from './context.ts';

/** Presentation is inert in brain tests, but retains the actual animator state contract. */
export function brainAnimator(
  over: Partial<Pick<Animator, 'muzzleWorld' | 'muzzleDir' | 'ejectWorld'>> = {}
): Animator {
  const animator = new Animator(RIG, RIG.createSkeleton().bones);
  animator.fire = (): void => {};
  animator.turn = (): void => {};
  animator.reload = (): void => {};
  if (over.muzzleWorld) animator.muzzleWorld.copy(over.muzzleWorld);
  if (over.muzzleDir) animator.muzzleDir.copy(over.muzzleDir);
  if (over.ejectWorld) animator.ejectWorld.copy(over.ejectWorld);
  return animator;
}

export function brainPhysics(sight = true): PhysicsSystem {
  const physics = new PhysicsSystem();
  physics.lineOfSight = (): boolean => sight;
  return physics;
}

export function coverPoint(over: Partial<BakedCoverPoint> = {}): BakedCoverPoint {
  return {
    x: 0,
    y: 0,
    z: 0,
    dx: 0,
    dz: 1,
    high: false,
    component: 1,
    claimed: -1,
    dist: 0,
    surface: 1,
    ...over,
  };
}

/** Real provider with test-controlled pose/stance independent of movement integration. */
export class BrainPlayer extends PlayerSystem {
  declare hitbox: NonNullable<PlayerSystem['hitbox']>;
  readonly testPosition = new THREE.Vector3();
  testHeight = 1.78;
  testStance: 'stand' | 'crouch' | 'prone' = 'stand';
  testDead = false;
  override get position(): THREE.Vector3 {
    return this.testPosition;
  }
  override get height(): number {
    return this.testHeight;
  }
  override get stance(): 'stand' | 'crouch' | 'prone' {
    return this.testStance;
  }
  override get dead(): boolean {
    return this.testDead;
  }
  constructor(physics = new PhysicsSystem(), height = 1.78) {
    super();
    this.testHeight = height;
    this.ctx = createTestContext();
    this.hitbox = physics.addCollider({
      shape: 'capsule',
      layer: physics.LAYER.PLAYER,
      surface: 'flesh',
      owner: this,
      part: 'torso',
      radius: 0.3,
    });
    this.movement = new Movement(this.ctx, this);
    this.health = new Health(this.ctx, null);
  }

  /** Fit the torso capsule to the test pose and height (production uses STANCE heights and lean). */
  fitHitbox(): void {
    const r = this.hitbox.radius,
      p = this.testPosition;
    this.hitbox.setSegment(p.x, p.y + r, p.z, p.x, p.y + Math.max(r, this.testHeight - r), p.z, r);
  }
}

/** Real AiSystem wired to test physics and an optional player at a fixed 60 Hz step. */
export function brainAi(
  physics: PhysicsSystem,
  player: BrainPlayer | null,
  events?: EventBus
): AiSystem {
  const ai = new AiSystem();
  ai.ctx = createTestContext({
    ...(events ? { events } : {}),
    providers: { physics, ...(player ? { player } : {}) },
  });
  ai.ctx.time.dt = 1 / 60;
  return ai;
}

export function midpointRng(): Rng {
  const rng = new Rng(1);
  rng.float = (): number => 0.5;
  rng.range = (a: number, b: number): number => (a + b) * 0.5;
  rng.int = (a: number): number => a;
  rng.gauss = (): number => 0;
  return rng;
}

export function disposeMesh(object: THREE.Object3D): void {
  if (!isMesh(object)) return;
  object.geometry.dispose();
  const material = object.material;
  if (Array.isArray(material)) {
    for (const entry of material) entry.dispose();
  } else material.dispose();
}

import * as THREE from 'three';

import { Agent } from '../../src/ai/agent.ts';
import { Animator } from '../../src/ai/animator.ts';
import { AiSystem } from '../../src/ai/index.ts';
import type { AiVariant } from '../../src/ai/index.ts';
import type { SurfaceNav } from '../../src/ai/nav.ts';
import { RIG } from '../../src/ai/rig.ts';
import { VARIANTS } from '../../src/ai/soldier.ts';
import { applyDefinedPatch } from '../../src/core/patch.ts';
import { Rng } from '../../src/core/rng.ts';
import { createTestContext } from './context.ts';

// Exercise the real constructor, not a second, incomplete copy of Agent state.
// Brain-only tests replace presentation/physics explicitly; controller gates
// supply their real character after construction.
const model: AiVariant = {
  geometry: new THREE.BoxGeometry(),
  material: new THREE.MeshBasicMaterial(),
  parts: null,
  variant: { ...VARIANTS.vanguard, scale: 1, faceWrap: false, beard: false },
  weapon: {
    muzzle: [0, 0, 0],
    foregrip: [0, 0, 0],
    magBottom: [0, 0, 0],
    ejection: [0, 0, 0],
    stockTop: [0, 0, 0],
  },
  stats: { vertices: 0, triangles: 0 },
};
export function makeAgent(over: Partial<Agent> = {}): Agent {
  const ai = makeAi();
  const a = new Agent(ai, over.position ? { position: over.position } : {});
  detachFixtureAgent(a);
  a.id = 1;
  applyDefinedPatch(a, over);
  if (!over.route) a.route.points = a.path;
  return a;
}

/** Keep the original brain fixture's null-weapon animation defaults, without
 * weakening the operational AiVariant weapon metadata contract. */
export function detachFixtureAgent(agent: Agent): void {
  agent.group.removeFromParent();
  agent.skeleton.dispose();
  agent.animator = new Animator(RIG, agent.bones, {
    weapon: null,
    rng: agent.animator.rng,
    probe: agent.animator.probe ?? null,
    scale: agent.scale,
  });
}

export class FixtureAi extends AiSystem {
  deferred = 0;
}

export function makeAi(grid: SurfaceNav | null = null): FixtureAi {
  const ai = new FixtureAi();
  ai.ctx = createTestContext();
  ai.rng = new Rng(1);
  ai.root = new THREE.Group();
  ai.variant = (): AiVariant => model;
  ai.grid = grid;
  ai.cover = null;
  ai.agents = [];
  ai.pathsPerFrame = 2;
  ai._pathBudget = 2;
  ai._pathCursor = 0;
  ai.stats = {
    agents: 0,
    alive: 0,
    navMs: 0,
    coverPts: 0,
    walkable: 0,
    friendlyHolds: 0,
    pathsDeferred: 0,
    grenadeHolds: 0,
  };
  return ai;
}

// Preserve the existing search/patrol scenarios' deterministic sequence.
class FixtureRng extends Rng {
  private value: number;
  constructor(seed: number) {
    super(1);
    this.value = seed;
  }
  override float(): number {
    this.value = (this.value * 1.7 + 0.13) % 1;
    return this.value;
  }
  override int(min: number, _max?: number): number {
    return min;
  }
  override gauss(): number {
    return 0;
  }
  override fork(): Rng {
    return makeRng(this.float());
  }
}
export function makeRng(seed = 0.31): Rng {
  return new FixtureRng(seed);
}

import * as THREE from 'three';
import { Agent } from '../../src/ai/agent.js';
import { AiSystem } from '../../src/ai/index.js';
import { Rng } from '../../src/core/rng.ts';

// Exercise the real constructor, not a second, incomplete copy of Agent state.
// Brain-only tests replace presentation/physics explicitly; controller gates
// supply their real character after construction.
const geometry = new THREE.BoxGeometry();
const model = { geometry, materials: [], variant: { scale: 1 }, weapon: null };
export function makeAgent(over = {}) {
  const ai = { ctx: { peek: () => null }, rng: new Rng(1), root: new THREE.Group(), variant: () => model };
  const a = new Agent(ai, { position: over.position });
  a.group.removeFromParent();
  a.skeleton.dispose();
  return Object.assign(a, { id: 1 }, over);
}

export function makeAi(grid = null) {
  return Object.assign(new AiSystem(), {
    grid, cover: null, agents: [], pathsPerFrame: 2, _pathBudget: 2, _pathCursor: 0,
    stats: { pathsDeferred: 0, grenadeHolds: 0 },
  });
}

// Preserve the existing search/patrol scenarios' deterministic sequence.
export function makeRng(seed = .31) {
  let x = seed;
  return {
    float() { x = (x * 1.7 + .13) % 1; return x; },
    range(a, b) { return a + (b - a) * this.float(); },
    int(a) { return a; }, gauss() { return 0; },
    signed() { return this.float() * 2 - 1; },
    fork() { return makeRng(this.float()); },
  };
}

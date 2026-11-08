import type { Vector3 } from 'three';

import type { AiSystem } from '../../src/ai/index.ts';
import type { EventBus } from '../../src/core/registry.ts';
import type { PhysicsSystem } from '../../src/physics/index.ts';
import type { WorldSystem } from '../../src/world/index.ts';

export interface FriendlyDamageReport {
  friendlyHits: number;
  friendlyDamage: number;
}
// Controlled rifle fixtures: only the AI team fires. Count all damage to that
// team's fixture actors, including penetration hits with no `source` field.
export function observeFriendlyDamage(
  events: EventBus,
  actors: readonly { team: number }[],
  team: number,
  report: FriendlyDamageReport
): () => void {
  report.friendlyHits = 0;
  report.friendlyDamage = 0;
  return events.on('damage:dealt', ({ target, amount }): void => {
    const actor = actors.find((actor): boolean => actor === target);
    if (!actor || actor.team !== team) return;
    report.friendlyHits++;
    report.friendlyDamage += amount;
  });
}

// Browser E2E placement only: exact clear lanes, not snapping authored offsets
// into walls and then mistaking a setup failure for a combat failure.
export function combatLane(
  ai: AiSystem,
  world: WorldSystem,
  physics: PhysicsSystem,
  slots: readonly (readonly [number, number])[]
): { positions: Vector3[]; fx: number; fz: number } {
  if (!ai.grid) throw new Error('combat lane requires navigation');
  const eye = world.spawnPoints[0].position.clone(),
    target = eye.clone();
  for (const anchor of world.spawnPoints)
    for (let turn = 0; turn < 32; turn++) {
      const angle = (turn * Math.PI) / 16,
        fx = Math.sin(angle),
        fz = Math.cos(angle);
      const positions = [];
      let component;
      for (const [distance, lateral] of [[0, 0], ...slots]) {
        const x = anchor.position.x + fx * distance - fz * lateral;
        const z = anchor.position.z + fz * distance + fx * lateral;
        const p = eye.clone();
        const ref = ai.grid.sampleGround(x, z, anchor.position.y, p);
        if (!ref || Math.hypot(p.x - x, p.z - z) > 0.1 || !ai.grid.canStand(p)) break;
        const next = ai.grid.components.get(ref);
        if (positions.length && next !== component) break;
        component = next;
        target.copy(p);
        target.y += 1.2;
        if (positions.length && !physics.lineOfSight(eye, target, physics.MASK.SIGHT)) break;
        positions.push(p);
        if (positions.length === 1) {
          eye.copy(p);
          eye.y += 1.2;
        }
      }
      if (positions.length === slots.length + 1) return { positions, fx, fz };
    }
  throw new Error('no physically clear combat lane for the requested fixture');
}

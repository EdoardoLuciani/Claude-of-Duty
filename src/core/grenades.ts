import { Vector3, type Object3D } from 'three';

import type { RigidBody } from '../physics/rigidbody.ts';
import type { EngineContext, EngineSystems } from './context.ts';

/** An uncooked, near-vertical long throw from level ground flies for ~3.2 s;
 * the fuse leaves a small margin for it to land before detonation. */
export const GRENADE_FUSE = 3.5;
export const GRENADE_RADIUS = 10; // m
export const GRENADE_DAMAGE = 250;

export interface LiveGrenade<Body extends RigidBody | undefined = RigidBody | undefined> {
  body: Body;
  mesh: Object3D;
  fuse: number;
  /** Thrower captured at spawn. */
  source: unknown;
}

type GrenadePhysics = Pick<EngineSystems['physics'], 'removeRigidBody'> | null;

function removeGrenade(grenade: LiveGrenade, physics: GrenadePhysics): void {
  if (grenade.body && physics?.removeRigidBody) physics.removeRigidBody(grenade.body);
  grenade.mesh.removeFromParent();
}

export function clearGrenades(grenades: LiveGrenade[], physics: GrenadePhysics): void {
  for (const grenade of grenades) removeGrenade(grenade, physics);
  grenades.length = 0;
}

/** Tick the owner's list at its usual point in the scaled frame. */
export function updateGrenades(
  grenades: LiveGrenade[],
  dt: number,
  ctx: Pick<EngineContext, 'events'>,
  physics: GrenadePhysics
): void {
  // A blast can cause a player to drop a new grenade; its fuse starts next tick.
  for (let i = grenades.length - 1; i >= 0; i--) {
    const grenade = grenades[i];
    grenade.fuse -= dt;
    if (grenade.fuse > 0) continue;
    // Emit before cleanup, with an independent position for listeners to retain.
    ctx.events.emit('explosion', {
      kind: 'grenade',
      position: new Vector3().copy(grenade.body?.position ?? grenade.mesh.position),
      radius: GRENADE_RADIUS,
      damage: GRENADE_DAMAGE,
      source: grenade.source,
    });
    removeGrenade(grenade, physics);
    grenades.splice(i, 1);
  }
}

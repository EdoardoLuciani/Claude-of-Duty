import { Vector3, type Object3D } from 'three';

import type { RigidBody } from '../physics/rigidbody.ts';
import type { EngineContext, EngineSystems } from './context.ts';

/** Leave enough fuse for the long throw's flight time. */
export const GRENADE_FUSE = 3.5;
export const GRENADE_RADIUS = 10; // m
export const GRENADE_DAMAGE = 250;

export interface LiveGrenade<Body extends RigidBody | undefined = RigidBody | undefined> {
  body: Body;
  mesh: Object3D;
  fuse: number;
  /** Per-throw source when the owner has multiple throwers. */
  source?: unknown;
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
  physics: GrenadePhysics,
  defaultSource?: unknown
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
      source: grenade.source ?? defaultSource,
    });
    removeGrenade(grenade, physics);
    grenades.splice(i, 1);
  }
}

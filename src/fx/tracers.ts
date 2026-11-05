import type { Vector3Like as Vec3Like } from 'three';

import { P } from './atlas.ts';
import type { FxSystem } from './index.ts';
import { resetSpawn, setSpawnColorRamp, setSpawnPosition, setSpawnVelocity } from './particles.ts';

/** Tracers have a hot head, bright core and dimmer afterglow; clamp visual speed for legibility.
 * Core/afterglow use anchored trails (particle flag bit 1): project head and tail separately
 * so incoming rounds foreshorten correctly. Preserve reached departure/arrival timing.
 */

const MIN_SPEED = 55;
const MAX_SPEED = 340;
interface TracerOptions {
  flightTime?: number;
  warm?: number;
}
type TracerEmitter = Pick<FxSystem, 'rng' | 'emitAdd'>;

export function spawnTracer(
  fx: TracerEmitter,
  from: Vec3Like,
  to: Vec3Like,
  speed: number,
  opts?: TracerOptions
): void {
  const rng = fx.rng;
  let dx = to.x - from.x;
  let dy = to.y - from.y;
  let dz = to.z - from.z;
  const dist = Math.hypot(dx, dy, dz);
  if (dist < 0.35) return;
  dx /= dist;
  dy /= dist;
  dz /= dist;
  // Start a little out of the bore so the tracer is not born inside the flash,
  // but subtract that offset from its lifetime so it still expires at `to`.
  const muzzleOffset = 0.25;
  // Capture staging requests a readable flight time to a nearby wall; normal
  // gameplay keeps the shipped-shooter speed clamps.
  const flightTime = opts?.flightTime;
  const v =
    flightTime !== undefined && flightTime > 0
      ? (dist - muzzleOffset) / flightTime
      : Math.min(MAX_SPEED, Math.max(MIN_SPEED, speed || 260));
  const warm = opts?.warm ?? 1;
  const life = (dist - muzzleOffset) / v;
  const ox = from.x + dx * muzzleOffset;
  const oy = from.y + dy * muzzleOffset;
  const oz = from.z + dz * muzzleOffset;

  // core streak
  const s = resetSpawn();
  setSpawnPosition(s, ox, oy, oz);
  setSpawnVelocity(s, dx * v, dy * v, dz * v);
  s.tile = P.STREAK;
  s.size0 = 0.055;
  s.size1 = 0.04;
  s.stretch = 0.26;
  s.life = life;
  s.drag = 0.02;
  s.gravity = -1.2;
  // Anchored trail: the particle is the head; the projected segment trails it.
  s.flags = 2;
  setSpawnColorRamp(s, 1, 0.52 * warm, 0.18 * warm, 1, 0.4 * warm, 0.12 * warm);
  s.i0 = 26;
  s.i1 = 16;
  s.alphaCurve = 0.25;
  s.soft = 0.1;
  s.seed = rng.float();
  fx.emitAdd(s);

  // Reuse the flight setup: emit copies the descriptor into the GPU ring.
  // afterglow: longer, dimmer, sits behind the core
  s.size0 = 0.09;
  s.size1 = 0.07;
  s.stretch = 0.6;
  setSpawnColorRamp(s, 1, 0.33 * warm, 0.1 * warm, 1, 0.24 * warm, 0.06 * warm);
  s.i0 = 5.5;
  s.i1 = 2.5;
  s.alphaCurve = 0.3;
  s.soft = 0.14;
  s.seed = rng.float();
  fx.emitAdd(s);

  // incandescent head
  s.tile = P.SPARK;
  s.stretch = 0;
  s.flags = 0;
  s.size0 = 0.05;
  s.size1 = 0.042;
  setSpawnColorRamp(s, 1, 0.85, 0.6, 1, 0.6, 0.3);
  s.i0 = 30;
  s.i1 = 18;
  s.alphaCurve = 0.2;
  s.soft = 0.08;
  s.seed = rng.float();
  fx.emitAdd(s);
}

import * as THREE from 'three';
import { FIXED_DT } from '../core/config.ts';
import type { EngineContext } from '../core/context.ts';
import type { PhysicsSystem } from '../physics/index.ts';

/**
 * Projectile ballistics.
 *
 * Rounds are simulated, not hitscanned: each shot is a body with a muzzle
 * velocity, gravity and a drag term, stepped at the physics rate. A 9 mm round
 * takes 140 ms to cross a 50 m street and drops about 10 cm doing it, and you
 * can see the tracer travel. Terminal effects (penetration, spall, damage) are
 * handed to `physics.fireBullet()` at contact, stopping at the first authorized
 * exit. The surviving round resumes timed flight with its remaining energy.
 */

const GRAVITY = -9.81;
const MAX_LIVE = 96;

/**
 * Vertical drop (m) of a round over `range` metres of travel.
 *
 * Same integrator as ProjectileSim.fixedUpdate — gravity, then a linear drag
 * term, at the fixed physics rate — so a weapon zeroed with this rise crosses
 * the sight line exactly at `range`. A few dozen float ops, no allocation.
 */
export interface BallisticDefinition { muzzleVelocity: number; dragK: number }
export function dropAt(def: BallisticDefinition, range: number): number {
  const h = FIXED_DT;
  let y = 0, z = 0, vy = 0, vz = def.muzzleVelocity;
  let py = 0, pz = 0;
  for (let t = 0; z < range && t < 10; t += h) {
    py = y;
    pz = z;
    vy += GRAVITY * h;
    const decay = Math.max(0, 1 - def.dragK * h);
    vy *= decay;
    vz *= decay;
    y += vy * h;
    z += vz * h;
  }
  // Interpolate across the last step: the round crosses the plane mid-segment,
  // exactly as the impact raycast sees it.
  const f = z > pz ? (range - pz) / (z - pz) : 0;
  return -(py + (y - py) * f);
}

type EventWeapon = import('../core/events.ts').EventWeapon;
type BulletImpact = ReturnType<PhysicsSystem['fireBullet']>['impacts'][number];
type ResolvedImpact = Pick<BulletImpact, 'point' | 'actor' | 'part' | 'amount'>;
type ProjectilePhysics = PhysicsSystem;
type ProjectileContext = EngineContext;
interface SpawnOptions {
  origin: THREE.Vector3; dir: THREE.Vector3; speed?: number; damage?: number; penetration?: number;
  dragK?: number; maxRange?: number; dropoff?: number; weapon?: EventWeapon; pellet?: number;
  mask?: number; shooter?: unknown; tracer?: boolean;
}
function isActorEntry(hit: BulletImpact): boolean {
  return !hit.exit && Boolean(hit.actor);
}

class Projectile {
  alive: boolean;
  pos: THREE.Vector3;
  prev: THREE.Vector3;
  origin: THREE.Vector3;
  vel: THREE.Vector3;
  damage: number;
  penetration: number;
  dragK: number;
  travelled: number;
  maxRange: number;
  age: number;
  dropoff: number;
  weapon: EventWeapon;
  pellet: number;
  mask: number | undefined;
  shooter: unknown;
  shot: number;
  speed: number;
  tracer: boolean;
  hitActors: unknown[] = [];
  layers = 0;
  materialTime = 0;
  hasImpact = false;
  impact: ResolvedImpact = { point: new THREE.Vector3(), actor: null, part: null, amount: 0 };

  constructor() {
    this.alive = false;
    this.pos = new THREE.Vector3();
    this.prev = new THREE.Vector3();
    this.origin = new THREE.Vector3();
    this.vel = new THREE.Vector3();
    this.damage = 30;
    this.penetration = 1;
    this.dragK = 0.3;
    this.travelled = 0;
    this.maxRange = 400;
    this.age = 0;
    this.dropoff = 0.5;
    this.weapon = null;
    this.pellet = 0;
    this.mask = undefined;
    this.shooter = null;
    this.shot = 0;
    this.speed = 800;
    this.tracer = false;
  }
}

export class ProjectileSim {
  ctx: ProjectileContext;
  pool: Projectile[];
  live: Projectile[];
  _hitDir: THREE.Vector3;
  stats: { fired: number; impacts: number; live: number };
  _physics: ProjectilePhysics | null | undefined;

  constructor(ctx: ProjectileContext) {
    this.ctx = ctx;
    this.pool = [];
    for (let i = 0; i < MAX_LIVE; i++) this.pool.push(new Projectile());
    this.live = [];
    this._hitDir = new THREE.Vector3();
    this.stats = { fired: 0, impacts: 0, live: 0 };
  }

  get physics(): ProjectilePhysics | null | undefined {
    if (!this._physics) this._physics = this.ctx.peek('physics');
    return this._physics;
  }

  /**
   * @param {object} o origin, dir (unit), speed, damage, penetration, dragK,
   *                   maxRange, dropoff, weapon, tracer
   */
  spawn(o: SpawnOptions): Projectile | null {
    let p = null;
    for (let i = 0; i < this.pool.length; i++) {
      if (!this.pool[i].alive) {
        p = this.pool[i];
        break;
      }
    }
    if (!p) {
      // Oldest round yields its slot rather than dropping the shot.
      p = this.live[0];
      if (!p) return null;
      this._emitResolved(p, p.pos, 'recycled');
      this._retire(p);
      this.live.shift();
    }
    p.alive = true;
    p.pos.copy(o.origin);
    p.prev.copy(o.origin);
    p.origin.copy(o.origin);
    p.vel.copy(o.dir).normalize().multiplyScalar(o.speed ?? 800);
    p.damage = o.damage ?? 30;
    p.penetration = o.penetration ?? 1;
    p.dragK = o.dragK ?? 0.3;
    p.dropoff = o.dropoff ?? 0.5;
    p.maxRange = o.maxRange ?? 400;
    p.travelled = 0;
    p.age = 0;
    p.weapon = o.weapon ?? null;
    p.pellet = o.pellet ?? 0;
    p.mask = o.mask;
    p.shooter = o.shooter ?? this.ctx.peek('player');
    p.shot = this.physics?.nextShotId?.() ?? 0;
    p.speed = o.speed ?? 800;
    p.tracer = o.tracer === true;
    p.hitActors.length = 0;
    p.layers = p.materialTime = 0;
    p.hasImpact = false;
    p.impact.actor = p.impact.part = null;
    p.impact.amount = 0;
    this.live.push(p);
    this.stats.fired++;

    return p;
  }

  fixedUpdate(h: number): void {
    const phys = this.physics;
    for (let i = this.live.length - 1; i >= 0; i--) {
      const p = this.live[i];
      p.prev.copy(p.pos);
      // gravity + a linear drag term (good enough over game distances)
      p.vel.y += GRAVITY * h;
      const decay = Math.max(0, 1 - p.dragK * h);
      p.vel.multiplyScalar(decay);
      p.age += h;
      let timeLeft = Math.max(0, h - p.materialTime);
      p.materialTime = Math.max(0, p.materialTime - h);

      while (timeLeft > 1e-9 && p.alive) {
        const speed = p.vel.length();
        const segLen = Math.min(speed * timeLeft, Math.max(0, p.maxRange - p.travelled));
        if (segLen <= 1e-6) break;
        p.prev.copy(p.pos);
        p.speed = speed;
        this._hitDir.copy(p.vel).divideScalar(speed);
        const hit = phys?.raycast(p.prev, this._hitDir, segLen, p.mask ?? phys.MASK.BULLET, p.shooter, p.hitActors);
        if (hit?.hit && phys) {
          const shot = phys.fireBullet({
            origin: p.prev, dir: this._hitDir, from: p.origin,
            maxDist: p.maxRange - p.travelled, maxRange: p.maxRange,
            travelled: p.travelled, damage: p.damage, penetration: p.penetration,
            dropoff: p.dropoff, mask: p.mask, shooter: p.shooter,
            weapon: p.weapon, shot: p.shot, speed, tracer: p.tracer,
            stopAtExit: true, ignoreActors: p.hitActors, layers: p.layers,
          });
          const resolved = shot.impacts.find(isActorEntry) ?? shot.impacts[0] ?? null;
          if (resolved && (!p.hasImpact || (!p.impact.actor && resolved.actor))) {
            p.impact.point.copy(resolved.point);
            p.impact.actor = resolved.actor; p.impact.part = resolved.part;
            p.impact.amount = resolved.amount; p.hasImpact = true;
          }
          for (const impact of shot.impacts) if (isActorEntry(impact)) p.hitActors.push(impact.actor);
          p.layers++;
          this.stats.impacts++;
          const next = shot.continuation;
          if (next) {
            // Interiors resolve atomically, but their transit time is charged:
            // a thick penetrable volume cannot grant extra free flight this tick.
            timeLeft -= (next.travelled - p.travelled) / speed;
            p.materialTime = Math.max(0, -timeLeft);
            p.pos.copy(next.position); p.travelled = next.travelled;
            p.vel.copy(next.dir).multiplyScalar(speed * Math.sqrt(next.damage / p.damage));
            p.damage = next.damage; p.penetration = next.penetration;
            continue;
          }
          p.pos.copy(shot.end);
          this._emitResolved(p, p.pos, 'impact', shot.stopReason);
          this._retire(p);
          break;
        }
        p.pos.addScaledVector(this._hitDir, segLen);
        p.travelled += segLen;
        phys?.emitBulletSegment(p.prev, p.pos, p);
        break;
      }

      if (p.alive && (p.travelled >= p.maxRange || p.age > 5 || p.pos.y < -80)) {
        const reason = p.travelled >= p.maxRange ? 'range' : 'expired';
        this._emitResolved(p, p.pos, p.hasImpact ? 'impact' : reason, reason);
        this._retire(p);
      }
      if (!p.alive) this.live.splice(i, 1);
    }
    this.stats.live = this.live.length;
  }

  _emitResolved(p: Projectile, to: THREE.Vector3, result: string, stopReason = result): void {
    if (!this.ctx.has('telemetry')) return;
    const impact = p.hasImpact ? p.impact : null;
    if (impact) to = impact.point;
    this.ctx.events.emit('shot:resolved', {
      shooter: p.shooter ?? 'player', weapon: p.weapon, from: p.origin, to, result, stopReason,
      shot: p.shot,
      target: impact?.actor ?? null, part: impact?.part ?? null,
      damage: impact?.amount ?? 0, pellet: p.pellet,
    });
  }

  _retire(p: Projectile): void {
    p.alive = false;
    p.weapon = null;
    p.shooter = null;
    p.hitActors.length = 0;
    p.impact.actor = null;
  }

  clear(): void {
    for (const p of this.live) {
      this._emitResolved(p, p.pos, 'cleared');
      this._retire(p);
    }
    this.live.length = 0;
  }
}

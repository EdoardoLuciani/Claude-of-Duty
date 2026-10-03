import * as THREE from 'three';
import { FIXED_DT } from '../core/config.js';

/**
 * Projectile ballistics.
 *
 * Rounds are simulated, not hitscanned: each shot is a body with a muzzle
 * velocity, gravity and a drag term, stepped at the physics rate. A 9 mm round
 * takes 140 ms to cross a 50 m street and drops about 10 cm doing it, and you
 * can see the tracer travel. Terminal effects (penetration, spall, damage) are
 * handed to `physics.fireBullet()` at the moment of contact so wall penetration
 * and multi-layer hits stay in one place.
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
export function dropAt(def, range) {
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

function isActorEntry(hit) {
  return !hit.exit && hit.actor;
}

class Projectile {
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
  constructor(ctx) {
    this.ctx = ctx;
    this.pool = [];
    for (let i = 0; i < MAX_LIVE; i++) this.pool.push(new Projectile());
    this.live = [];
    this._seg = new THREE.Vector3();
    this._hitDir = new THREE.Vector3();
    this.stats = { fired: 0, impacts: 0, live: 0 };
  }

  get physics() {
    if (!this._physics) this._physics = this.ctx.peek('physics');
    return this._physics;
  }

  /**
   * @param {object} o origin, dir (unit), speed, damage, penetration, dragK,
   *                   maxRange, dropoff, weapon, tracer
   */
  spawn(o) {
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
    this.live.push(p);
    this.stats.fired++;

    return p;
  }

  fixedUpdate(h) {
    const phys = this.physics;
    for (let i = this.live.length - 1; i >= 0; i--) {
      const p = this.live[i];
      p.prev.copy(p.pos);
      // gravity + a linear drag term (good enough over game distances)
      p.vel.y += GRAVITY * h;
      const decay = Math.max(0, 1 - p.dragK * h);
      p.vel.multiplyScalar(decay);
      p.pos.addScaledVector(p.vel, h);
      p.age += h;

      this._seg.copy(p.pos).sub(p.prev);
      let segLen = this._seg.length();
      const remaining = Math.max(0, p.maxRange - p.travelled);
      if (segLen > remaining) {
        this._seg.multiplyScalar(remaining / segLen);
        p.pos.copy(p.prev).add(this._seg);
        segLen = remaining;
      }
      p.travelled += segLen;

      if (segLen > 1e-6 && phys) {
        this._hitDir.copy(this._seg).divideScalar(segLen);
        const hit = phys.raycast(p.prev, this._hitDir, segLen, p.mask ?? phys.MASK?.BULLET, p.shooter);
        if (hit?.hit) {
          // Contact: hand the round to the penetration solver, which emits
          // `bullet:impact` for every entry and exit face it goes through.
          const shot = phys.fireBullet({
            origin: p.prev,
            dir: this._hitDir,
            from: p.origin,
            maxDist: p.maxRange - p.travelled + segLen,
            maxRange: p.maxRange,
            travelled: p.travelled - segLen,
            damage: p.damage,
            penetration: p.penetration,
            dropoff: p.dropoff,
            mask: p.mask,
            shooter: p.shooter,
            weapon: p.weapon,
            shot: p.shot,
            speed: p.speed,
            tracer: p.tracer,
          });
          const resolved = shot.impacts.find(isActorEntry) ?? shot.impacts[0] ?? null;
          this._emitResolved(p, resolved?.point ?? shot.end, 'impact', resolved, shot.stopReason);
          this.stats.impacts++;
          this._retire(p);
          this.live.splice(i, 1);
          continue;
        }
        phys.emitBulletSegment?.(p.prev, p.pos, p);
      }

      if (p.travelled >= p.maxRange || p.age > 5 || p.pos.y < -80) {
        this._emitResolved(p, p.pos, p.travelled >= p.maxRange ? 'range' : 'expired');
        this._retire(p);
        this.live.splice(i, 1);
      }
    }
    this.stats.live = this.live.length;
  }

  _emitResolved(p, to, result, impact = null, stopReason = result) {
    if (!this.ctx.has('telemetry')) return;
    this.ctx.events.emit('shot:resolved', {
      shooter: p.shooter ?? 'player', weapon: p.weapon, from: p.origin, to, result, stopReason,
      shot: p.shot,
      target: impact?.actor ?? null, part: impact?.part ?? null,
      damage: impact?.amount ?? 0, pellet: p.pellet,
    });
  }

  _retire(p) {
    p.alive = false;
    p.weapon = null;
    p.shooter = null;
  }

  clear() {
    for (const p of this.live) {
      this._emitResolved(p, p.pos, 'cleared');
      this._retire(p);
    }
    this.live.length = 0;
  }
}

import * as THREE from 'three';

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

class Projectile {
  constructor() {
    this.alive = false;
    this.pos = new THREE.Vector3();
    this.prev = new THREE.Vector3();
    this.origin = new THREE.Vector3();
    this.vel = new THREE.Vector3();
    this.dir = new THREE.Vector3();
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
    this._tracerFrom = new THREE.Vector3();
    this._tracerTo = new THREE.Vector3();
    this._tracerPayload = { from: this._tracerFrom, to: this._tracerTo, speed: 800, weapon: null };
    this._shotFrom = new THREE.Vector3();
    this._shotTo = new THREE.Vector3();
    this._shotPayload = {
      shooter: 'player', weapon: null, from: this._shotFrom, to: this._shotTo,
      result: 'impact', target: null, part: null, damage: 0, pellet: 0,
    };
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
    p.dir.copy(o.dir).normalize();
    p.vel.copy(p.dir).multiplyScalar(o.speed ?? 800);
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
    this.live.push(p);
    this.stats.fired++;

    if (o.tracer) this._emitTracer(p, o.speed ?? 800);
    return p;
  }

  /** One tracer per burst of rounds: muzzle to wherever the round will land. */
  _emitTracer(p, speed) {
    const phys = this.physics;
    this._tracerFrom.copy(p.pos);
    let dist = Math.min(p.maxRange, 260);
    if (phys) {
      const hit = phys.raycast(p.pos, p.dir, dist, phys.MASK?.BULLET);
      if (hit?.hit) dist = hit.distance;
    }
    this._tracerTo.copy(p.pos).addScaledVector(p.dir, dist);
    this._tracerPayload.speed = speed;
    this._tracerPayload.weapon = p.weapon;
    this.ctx.events.emit('bullet:tracer', this._tracerPayload);
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
      const segLen = this._seg.length();
      p.travelled += segLen;

      if (segLen > 1e-6 && phys) {
        this._hitDir.copy(this._seg).divideScalar(segLen);
        const hit = phys.raycast(p.prev, this._hitDir, segLen, phys.MASK?.BULLET);
        if (hit?.hit) {
          // Contact: hand the round to the penetration solver, which emits
          // `bullet:impact` for every entry and exit face it goes through.
          const range01 = Math.min(1, p.travelled / p.maxRange);
          const falloff = 1 - (1 - p.dropoff) * range01 * range01;
          const impacts = phys.fireBullet({
            origin: p.prev,
            dir: this._hitDir,
            maxDist: Math.min(24, Math.max(1.5, p.maxRange - p.travelled + segLen)),
            damage: p.damage * falloff,
            penetration: p.penetration,
            dropoff: 1,
            mask: p.mask,
          });
          const first = impacts[0] ?? null;
          this._emitResolved(p, first?.point ?? p.pos, 'impact', first);
          this.stats.impacts++;
          this._retire(p);
          this.live.splice(i, 1);
          continue;
        }
      }

      if (p.travelled > p.maxRange || p.age > 5 || p.pos.y < -80) {
        this._emitResolved(p, p.pos, p.travelled > p.maxRange ? 'range' : 'expired');
        this._retire(p);
        this.live.splice(i, 1);
      }
    }
    this.stats.live = this.live.length;
  }

  _emitResolved(p, to, result, impact = null) {
    if (!this.ctx.has?.('telemetry')) return;
    const e = this._shotPayload;
    e.weapon = p.weapon;
    e.from.copy(p.origin);
    e.to.copy(to);
    e.result = result;
    e.target = impact?.actor ?? null;
    e.part = impact?.part ?? null;
    e.damage = impact?.damage ?? 0;
    e.pellet = p.pellet;
    this.ctx.events.emit('shot:resolved', e);
  }

  _retire(p) {
    p.alive = false;
    p.weapon = null;
  }

  clear() {
    for (const p of this.live) {
      this._emitResolved(p, p.pos, 'cleared');
      this._retire(p);
    }
    this.live.length = 0;
  }
}

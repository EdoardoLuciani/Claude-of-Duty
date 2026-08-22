/**
 * AI — squad coordination.
 *
 * The squad exists to stop four individually-sensible soldiers from behaving
 * like one four-headed idiot: it hands out permission to peek so they alternate
 * instead of all leaning out together, shares contact reports so one man
 * spotting you alerts the rest (after a believable call-out delay), rations
 * grenades, and allows only one flanker at a time.
 *
 * Intent (intent.js) is the squad job this fight: pin, wrap, or flush.
 */

import * as THREE from 'three';
import {
  INTENT,
  PLANT_HOLD,
  PLANT_RADIUS,
  clusterPeekDeaths,
  CLUSTER_MAX_AGE,
  decideIntent,
  isBannedCover,
  LONG_RANGE,
} from './intent.js';

let _nextSquad = 1;

export class Squad {
  constructor(rng) {
    this.id = _nextSquad++;
    this.members = [];
    this.rng = rng;
    this.ai = null;
    this.peekTokens = 1;
    this.peekHolders = new Set();
    this.peekTimer = 0;
    this.grenadeCooldown = 6;
    this.flanker = null;
    this.contact = new THREE.Vector3();
    this.hasContact = false;
    this.contactAge = Infinity;
    this._pending = [];

    this.time = 0;
    this.intent = INTENT.PIN;
    this.why = 'default';
    this.wantFlush = false;
    this.banned = null;
    this.planted = false;
    this.plantAge = 0;
    this.plantHold = 0;
    this._plantPos = new THREE.Vector3();
    this._hasPlantPos = false;
    this.peekDeaths = [];
    this.wrapper = null;
    this.wrapSide = 1;
    this.wrapDest = new THREE.Vector3();
    this.hasWrapDest = false;
    this.flushUsed = false;
  }

  add(agent) {
    agent.squad = this;
    this.members.push(agent);
    this.peekTokens = Math.max(1, Math.round(this.members.length * 0.5));
    return agent;
  }

  /**
   * Drop an agent (corpse despawn) and every reference to it. Endless waves
   * mean this runs constantly — without it, squads accumulate disposed agents
   * and this.squads grows by 2-3 per wave, so per-frame update cost would grow
   * without bound. Returns the remaining member count (0 = prune the squad).
   */
  remove(agent) {
    const i = this.members.indexOf(agent);
    if (i >= 0) this.members.splice(i, 1);
    this.peekHolders.delete(agent.id);
    if (this.flanker === agent) this.flanker = null;
    if (this.wrapper === agent) this.wrapper = null;
    if (agent.squad === this) agent.squad = null;
    if (this.intent === INTENT.PIN) {
      this.peekTokens = Math.max(1, Math.round(this.members.length * 0.5));
    }
    return this.members.length;
  }

  get alive() {
    let n = 0;
    for (const m of this.members) if (m.alive) n++;
    return n;
  }

  /** Called once per frame by the AI system. */
  update(dt) {
    this.time += dt;
    this.grenadeCooldown -= dt;
    this.contactAge += dt;
    if (this.flanker && (!this.flanker.alive || this.flanker.state !== 'flank')) this.flanker = null;

    // contact sharing: whoever can see the player broadcasts, with a delay
    for (const m of this.members) {
      if (!m.alive) continue;
      if (m.hasTarget && m.targetVisible) {
        this.contact.copy(m.lastKnown);
        this.hasContact = true;
        this.contactAge = 0;
        break;
      }
    }
    if (this.hasContact && this.contactAge < 4) {
      for (const m of this.members) {
        if (!m.alive || m.hasTarget) continue;
        // a call-out only gives a direction to check, never a free kill
        if (m.lastKnownAge > 1.5) {
          m.lastKnown.copy(this.contact);
          m.lastKnownAge = 0.9 + this.rng.float() * 0.8;
          m.alertness = 1;
          if (m.state === 'idle' || m.state === 'patrol') m._setState('alert');
        }
      }
    }

    // rotate the peek tokens so the same man is not always exposed
    this.peekTimer -= dt;
    if (this.peekTimer <= 0) {
      this.peekTimer = 1.1 + this.rng.float() * 1.2;
      this.peekHolders.clear();
    }

    this._updatePlant(dt);
    this._updateIntent();
  }

  _updatePlant(dt) {
    if (this.hasContact && this.contactAge < 1.2) {
      if (!this._hasPlantPos) {
        this._plantPos.copy(this.contact);
        this._hasPlantPos = true;
        this.plantHold = 0;
      } else if (this.contact.distanceTo(this._plantPos) > PLANT_RADIUS) {
        this._plantPos.copy(this.contact);
        this.plantHold = 0;
      } else {
        this.plantHold += dt;
      }
      this.planted = this.plantHold >= PLANT_HOLD;
      this.plantAge = this.planted ? this.plantHold - PLANT_HOLD : 0;
    } else if (this.contactAge > 6) {
      this.planted = false;
      this.plantHold = 0;
      this.plantAge = 0;
      this._hasPlantPos = false;
    }
  }

  _updateIntent() {
    const alive = [];
    let known = Infinity;
    let hasGrenade = false;
    let anyVisual = false;
    for (const m of this.members) {
      if (!m.alive) continue;
      alive.push(m);
      if (m.lastKnownAge < known) known = m.lastKnownAge;
      if (m.hasGrenade) hasGrenade = true;
      if (m.targetVisible && m.hasTarget) anyVisual = true;
    }
    const cluster = clusterPeekDeaths(this.peekDeaths, this.time);
    let peekDeathCount = 0;
    for (let i = 0; i < this.peekDeaths.length; i++) {
      if (this.time - this.peekDeaths[i].t <= CLUSTER_MAX_AGE) peekDeathCount++;
    }
    const next = decideIntent({
      planted: this.planted,
      plantAge: this.plantAge,
      lastKnownAge: known,
      cluster,
      peekDeathCount,
      hasGrenade,
      anyVisual,
    });

    const changed = next.intent !== this.intent || next.why !== this.why;
    this.wantFlush = next.wantFlush;
    this.banned = next.banned;
    if (!changed) {
      if (this.intent === INTENT.WRAP && this.wrapper && !this.wrapper.alive) {
        this._assignRoles(alive);
      }
      return;
    }

    const prev = this.intent;
    this.intent = next.intent;
    this.why = next.why;
    this.flushUsed = false;
    if (next.intent === INTENT.WRAP && prev !== INTENT.WRAP) {
      for (const m of this.members) m._wrapDone = false;
      this.wrapSide = this.rng.float() < 0.5 ? 1 : -1;
    }
    this._assignRoles(alive);
  }

  _assignRoles(alive) {
    this.wrapper = null;
    this.hasWrapDest = false;
    if (!alive.length) return;

    if (this.intent === INTENT.WRAP) {
      const threat = this.hasContact ? this.contact : alive[0].lastKnown;
      const far = threat && alive.some((m) => m.position.distanceTo(threat) > LONG_RANGE);
      const offX = this.why === 'unseen-deaths' || far;
      if (offX) {
        this.pickWrapDest(alive[0].position, threat);
        // The street is a killzone: nobody holds it. Everyone leaves the barrel.
        for (const m of alive) {
          m.role = 'wrap';
          m.wrapWait = this.rng.range(0.08, 0.55);
          m._wrapDone = false;
        }
        this.wrapper = alive[0];
        this.peekTokens = 1;
        return;
      }
      const candidates = alive.filter((m) => !m._wrapDone);
      const pool = candidates.length ? candidates : alive;
      this.wrapper = this._pickWrapper(pool);
      this.pickWrapDest(this.wrapper.position, threat);
      this.wrapper.role = 'wrap';
      this.wrapper.wrapWait = this.rng.range(0.35, 1.05);
      for (const m of alive) {
        if (m === this.wrapper) continue;
        m.role = 'hold';
        if (isBannedCover(m.cover, this.banned)) {
          this.ai?.cover?.release(m.id);
          m.cover = null;
          m.repathTimer = 0;
        }
      }
      this.peekTokens = Math.min(2, Math.max(1, alive.length - 1));
      if (this.wantFlush) this._armGrenadier(alive, this.wrapper);
      return;
    }

    if (this.intent === INTENT.FLUSH) {
      for (const m of alive) m.role = 'pin';
      this.peekTokens = Math.max(1, Math.round(alive.length * 0.5));
      this._armGrenadier(alive, null);
      return;
    }

    for (const m of alive) m.role = 'pin';
    this.peekTokens = Math.max(1, Math.round(alive.length * 0.5));
  }

  _pickWrapper(pool) {
    // Prefer someone not currently peeking, then the one furthest off the lane.
    let best = pool[0];
    let bestScore = -Infinity;
    const tx = this.contact.x, tz = this.contact.z;
    for (const m of pool) {
      let score = Math.hypot(m.position.x - tx, m.position.z - tz);
      if (m.peeking) score -= 4;
      if (m.state === 'flank') score -= 2;
      if (score > bestScore) {
        bestScore = score;
        best = m;
      }
    }
    return best;
  }

  _armGrenadier(alive, except) {
    let g = null;
    for (const m of alive) {
      if (m === except) continue;
      if (m.hasGrenade) { g = m; break; }
    }
    if (!g) {
      for (const m of alive) if (m.hasGrenade) { g = m; break; }
    }
    if (!g) return;
    g.grenadeCooldown = Math.min(g.grenadeCooldown, this.rng.range(0.45, 1.15));
  }

  /**
   * Walkable point beside / slightly behind the last-known, snapped to the
   * nav grid. Falls back to a lateral offset if no cell sits behind.
   */
  pickWrapDest(from, threat) {
    const grid = this.ai?.grid;
    this.hasWrapDest = false;
    if (!grid || !from || !threat) return false;
    const lx = threat.x - from.x;
    const lz = threat.z - from.z;
    const len = Math.hypot(lx, lz) || 1;
    if (len > LONG_RANGE && this._pickOffAxisRally(from, threat, lx / len, lz / len)) return true;
    const fx = lx / len, fz = lz / len;
    const rx = -fz, rz = fx;
    const side = this.wrapSide;
    const y = threat.y ?? from.y;
    const tries = [
      [-5, 12], [-8, 10], [2, 14], [-3, 16], [6, 11], [-6, 8], [0, 18], [4, 9],
    ];
    for (const [f, r] of tries) {
      for (const s of [side, -side]) {
        const x = threat.x + fx * f + rx * s * r;
        const z = threat.z + fz * f + rz * s * r;
        const i = grid.nearest(x, z, y, 10, 1.6);
        if (i < 0) continue;
        const wx = grid.worldX(i % grid.nx);
        const wz = grid.worldZ((i / grid.nx) | 0);
        const wy = grid.floor[i];
        if (Math.hypot(wx - from.x, wz - from.z) < 6) continue;
        this.wrapDest.set(wx, wy, wz);
        this.hasWrapDest = true;
        this.wrapSide = s;
        return true;
      }
    }
    return false;
  }

  _pickOffAxisRally(from, threat, bx, bz) {
    const world = this.ai.ctx?.peek?.('world');
    const spawns = world?.spawnPoints ?? [];
    const grid = this.ai.grid;
    if (!spawns.length || !grid) return false;
    let best = null, bestScore = -Infinity;
    for (let i = 0; i < spawns.length; i++) {
      const p = spawns[i].position;
      const dThreat = Math.hypot(p.x - threat.x, p.z - threat.z);
      if (dThreat < 16 || dThreat > 52) continue;
      const sx = p.x - from.x, sz = p.z - from.z;
      const sl = Math.hypot(sx, sz) || 1;
      const along = (sx * bx + sz * bz) / sl;
      const cross = Math.abs(-bz * sx + bx * sz) / sl;
      if (cross < 0.22 && along > 0.55) continue;
      const score = cross * 2.4 + (dThreat > 22 ? 0.4 : 0) - along * 0.2;
      if (score > bestScore) {
        bestScore = score;
        best = p;
      }
    }
    if (!best) return false;
    const i = grid.nearest(best.x, best.z, best.y, 10, 1.6);
    if (i < 0) return false;
    this.wrapDest.set(grid.worldX(i % grid.nx), grid.floor[i], grid.worldZ((i / grid.nx) | 0));
    this.hasWrapDest = true;
    return true;
  }

  noteDeath(agent) {
    if (!agent || agent.silentDeath || agent.team === 0) return;
    const c = agent.cover;
    this.peekDeaths.push({
      x: c ? c.x : agent.position.x,
      z: c ? c.z : agent.position.z,
      t: this.time,
    });
    if (this.peekDeaths.length > 12) this.peekDeaths.shift();
  }

  /** Ask to lean out of cover. Only `peekTokens` members may at once. */
  requestPeek(agent, dt) {
    if (isBannedCover(agent.cover, this.banned)) return false;
    if (this.peekHolders.has(agent.id)) return true;
    if (this.peekHolders.size >= this.peekTokens) return false;
    this.peekHolders.add(agent.id);
    return true;
  }

  releasePeek(agent) {
    this.peekHolders.delete(agent.id);
  }

  /** One flanker at a time, and only if someone else is holding attention. */
  canFlank(agent) {
    if (this.flanker) return false;
    if (this.intent === INTENT.WRAP && this.wrapper && agent !== this.wrapper) return false;
    let shooting = 0;
    for (const m of this.members) {
      if (m !== agent && m.alive && (m.state === 'combat' || m.state === 'suppressed')) shooting++;
    }
    return shooting >= 1;
  }

  claimFlank(agent) {
    this.flanker = agent;
  }

  requestGrenade() {
    if (this.wantFlush && !this.flushUsed) {
      this.flushUsed = true;
      this.grenadeCooldown = 14 + this.rng.float() * 12;
      return true;
    }
    if (this.grenadeCooldown > 0) return false;
    this.grenadeCooldown = 14 + this.rng.float() * 12;
    return true;
  }
}

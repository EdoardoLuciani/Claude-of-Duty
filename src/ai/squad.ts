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
import { TACTICS } from './tuning.ts';
import { NAV_PENDING, NAV_CANCELLED } from './attachment-queries.js';
import {
  INTENT,
  PLANT_HOLD,
  PLANT_RADIUS,
  clusterPeekDeaths,
  CLUSTER_MAX_AGE,
  decideIntent,
  isBannedCover,
  LONG_RANGE,
  type IntentName, type CoverCluster,
} from './intent.ts';

let _nextSquad = 1;
interface CoverPoint { x: number; y: number; z: number }
interface SquadAgent {
  id: number; alive: boolean; state: string; squad: Squad | null; position: THREE.Vector3;
  lastKnown: THREE.Vector3; lastKnownAge: number; hasTarget: boolean; targetVisible: boolean; wantFire: boolean;
  health: number; suppression: number; alertness: number; role: string; cover: CoverPoint | null; coverPos: THREE.Vector3;
  peeking: boolean; _returning: boolean; peekTimer: number; silentDeath: boolean; hasGrenade: boolean; grenadeCooldown: number;
  animator?: { reloading: boolean } | null; _muzzleBlocked: boolean; _friendlyBlock: number;
  _noteEvidence(pos: THREE.Vector3, kind: string, age: number): boolean; _setState(state: string): void;
  _firingLaneClear?(pos: THREE.Vector3): boolean; _rejectCover(reason: string): void; _endPeek(): void;
  _goTo(pos: THREE.Vector3): void; _wrapDone: boolean; wrapWait: number; _failedCovers: unknown[];
  eyeHeight: number; _combatClock: number; _recovering: boolean; vaultT: number; _engaging: boolean;
  firePos: THREE.Vector3; _elevatedRouteChecked: boolean; _peekFail: number; repathTimer: number;
}
interface SquadRng { float(): number; range(min: number, max: number): number }
interface SquadAI {
  cover?: { lastReject: string; pick(position: THREE.Vector3, contact: THREE.Vector3, options: Record<string, unknown>): CoverPoint | null | typeof NAV_PENDING | typeof NAV_CANCELLED; release(id: number): void };
  grid: { components: Map<number, number>; project(point: THREE.Vector3, out: THREE.Vector3, a?: unknown, b?: boolean): number | null; sampleGround(x: number, z: number, y: number, out: THREE.Vector3): number | null } | null;
  ctx: { peek(name: string): { spawnPoints?: { position: THREE.Vector3 }[] } | null };
}
type SquadIntent = IntentName;
interface PeekDeath { x: number; z: number; t: number }

export class Squad {
  id!: number; members!: SquadAgent[]; rng!: SquadRng; ai!: SquadAI | null; peekTokens!: number; peekHolders!: Set<number>;
  grenadeCooldown!: number; flanker!: SquadAgent | null; contact!: THREE.Vector3; hasContact!: boolean; contactAge!: number;
  time!: number; intent!: SquadIntent; why!: string; wantFlush!: boolean; banned!: CoverCluster | null | undefined;
  planted!: boolean; plantAge!: number; plantHold!: number; _plantPos!: THREE.Vector3; _hasPlantPos!: boolean; peekDeaths!: PeekDeath[];
  wrapper!: SquadAgent | null; wrapSide!: number; wrapDest!: THREE.Vector3; hasWrapDest!: boolean; flushUsed!: boolean; flushFails!: number;
  _peekAt!: Map<number, number>; holder!: SquadAgent | null; elevated!: SquadAgent | null;
  _pressureWait!: number; _elevatedWait!: number; _unsupported!: number; _elevatedCursor!: number; elevatedSince!: number; elevationStatus!: string;
  constructor(rng: SquadRng) {
    this.id = _nextSquad++;
    this.members = [];
    this.rng = rng;
    this.ai = null;
    this.peekTokens = 1;
    this.peekHolders = new Set();
    this.grenadeCooldown = 6;
    this.flanker = null;
    this.contact = new THREE.Vector3();
    this.hasContact = false;
    this.contactAge = Infinity;

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
    this.flushFails = 0;
    this._peekAt = new Map();
    this.holder = null;
    this.elevated = null;
    this._pressureWait = 0;
    this._elevatedWait = TACTICS.elevatedCheck;
    this._unsupported = 0;
    this._elevatedCursor = 0;
    this.elevatedSince = 0;
    this.elevationStatus = 'waiting';
  }

  add(agent: SquadAgent): SquadAgent {
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
  remove(agent: SquadAgent): number {
    const i = this.members.indexOf(agent);
    if (i >= 0) this.members.splice(i, 1);
    this.peekHolders.delete(agent.id);
    this._peekAt.delete(agent.id);
    if (this.flanker === agent) this.flanker = null;
    if (this.wrapper === agent) this.wrapper = null;
    if (this.holder === agent) this.holder = null;
    if (this.elevated === agent) this.elevated = null;
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
  update(dt: number): void {
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
        this.contactAge = m.lastKnownAge;
        break;
      }
    }
    if (this.hasContact && this.contactAge < 4) {
      for (const m of this.members) {
        if (!m.alive || m.hasTarget) continue;
        // a call-out only gives a direction to check, never a free kill
        if (m._noteEvidence?.(this.contact, 'report', this.contactAge)) {
          m.alertness = 1;
          if (m.state === 'idle' || m.state === 'patrol') m._setState('alert');
        }
      }
    }

    this._updatePlant(dt);
    this._updateIntent();
    this._updatePressure(dt);
    this._updateElevation(dt);
  }

  // State names aren't support: a relocating or suppressed 'combat' soldier
  // cannot cover a flank. This observes the previous tick's real firing gates.
  supports(m: SquadAgent): boolean {
    return m.alive && m.hasTarget && m.targetVisible && m.wantFire
      && !m.animator?.reloading && m.suppression < TACTICS.strongSuppression
      && !m._muzzleBlocked && !(m._friendlyBlock > 0);
  }

  _updatePressure(dt: number): void {
    this._pressureWait -= dt;
    if (this._pressureWait > 0 && this.holder?.alive) return;
    this._pressureWait = TACTICS.pressureCheck;
    let best = null, score = -Infinity;
    for (const m of this.members) {
      if (!m.alive || m === this.elevated || m.role === 'wrap' || m.state !== 'combat'
        || !m.hasTarget || !m.targetVisible || m.health < 34 || m.animator?.reloading
        || m.suppression >= TACTICS.strongSuppression || m._friendlyBlock > 0
        || !m._firingLaneClear?.(m.lastKnown)) continue;
      const value = (this.supports(m) ? 3 : 0) + (m === this.holder ? 1 : 0);
      if (value > score) { score = value; best = m; }
    }
    this.holder = best;
  }

  _updateElevation(dt: number): void {
    this._elevatedWait -= dt;
    const a = this.elevated;
    if (a) {
      let supported = false;
      for (const m of this.members) if (m !== a && this.supports(m)) { supported = true; break; }
      this._unsupported = supported ? 0 : this._unsupported + dt;
      const arrived = a.cover && (a.peeking || a._returning || a.position.distanceTo(a.coverPos) < .5);
      const cancel = !a.alive || !a.cover || a.state === 'retreat' || a.role === 'wrap'
        || this.contactAge > TACTICS.elevatedContactAge
        || (!arrived && (this._unsupported > TACTICS.elevatedSupportGrace
          || this.time - this.elevatedSince > TACTICS.elevatedTimeMax));
      if (cancel) {
        if (a.alive && a.cover) a._rejectCover('elevated-reassess');
        this.elevated = null;
        this.elevationStatus = 'reassess';
        this._elevatedWait = TACTICS.elevatedCheck;
      }
      return;
    }
    if (this._elevatedWait > 0 || !this.ai?.cover || !this.hasContact
      || this.contactAge > TACTICS.elevatedContactAge || this.alive < 2
      || this.why === 'unseen-deaths' || !this.holder || !this.supports(this.holder)) return;
    this._elevatedWait = TACTICS.elevatedCheck;
    // Only one candidate member and one bounded cover shortlist per interval.
    // Rotate failed attempts rather than starving the last squad member.
    for (let i = 0; i < this.members.length; i++) {
      const m = this.members[this._elevatedCursor++ % this.members.length];
      if (!m.alive || m === this.holder || m.state === 'retreat' || m.state === 'suppressed'
        || m._recovering || m.vaultT >= 0 || m._engaging || m.health < 34 || m.role === 'wrap') continue;
      const pick = this.ai.cover.pick(m.position, this.contact, {
        id: m.id, squad: this.members, elevated: true, maxTravel: TACTICS.elevatedTravel,
        eyeHeight: m.eyeHeight, failed: m._failedCovers, now: m._combatClock,
      });
      if (pick === NAV_PENDING) {
        this._elevatedCursor--; this._elevatedWait = 0; this.elevationStatus = 'pending'; return;
      }
      if (pick === NAV_CANCELLED) { this.elevationStatus = 'superseded'; return; }
      this.elevationStatus = pick ? 'assigned' : this.ai.cover.lastReject;
      if (!pick) return;
      this.elevated = m; this.elevatedSince = this.time; this._unsupported = 0;
      m._endPeek(); m._setState('combat'); m.cover = pick;
      m.coverPos.set(pick.x, pick.y, pick.z); m.firePos.copy(m.coverPos);
      m._elevatedRouteChecked = false; m._peekFail = 0;
      m._goTo(m.coverPos);
      return;
    }
  }

  _updatePlant(dt: number): void {
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
      this.flushFails = 0;
    }
  }

  _updateIntent(): void {
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
      flushFails: this.flushFails,
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

  _assignRoles(alive: SquadAgent[]): void {
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
      const candidates = alive.filter((m) => !m._wrapDone && m !== this.elevated && m !== this.holder);
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

    for (const m of alive) m.role = 'pin';
    this.peekTokens = Math.max(1, Math.round(alive.length * 0.5));
    if (this.intent === INTENT.FLUSH) this._armGrenadier(alive, null);
  }

  _pickWrapper(pool: SquadAgent[]): SquadAgent {
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

  _armGrenadier(alive: SquadAgent[], except: SquadAgent | null): void {
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
  pickWrapDest(from: THREE.Vector3, threat: THREE.Vector3): boolean {
    const grid = this.ai?.grid;
    this.hasWrapDest = false;
    if (!grid || !from || !threat) return false;
    const fromRef = grid.project(from, this.wrapDest);
    if (!fromRef) return false;
    const component = grid.components.get(fromRef);
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
        const ref = grid.sampleGround(x, z, y, this.wrapDest);
        if (!ref || grid.components.get(ref) !== component) continue;
        if (Math.hypot(this.wrapDest.x - from.x, this.wrapDest.z - from.z) < 6) continue;
        this.hasWrapDest = true;
        this.wrapSide = s;
        return true;
      }
    }
    return false;
  }

  _pickOffAxisRally(from: THREE.Vector3, threat: THREE.Vector3, bx: number, bz: number): boolean {
    if (!this.ai) return false;
    const world = this.ai.ctx.peek('world');
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
    const fromRef = grid.project(from, this.wrapDest);
    if (!fromRef) return false;
    const ref = grid.project(best, this.wrapDest, null, true);
    if (!ref || grid.components.get(ref) !== grid.components.get(fromRef)) return false;
    this.hasWrapDest = true;
    return true;
  }

  noteDeath(agent: SquadAgent): void {
    if (agent.silentDeath) return;
    const c = agent.cover;
    this.peekDeaths.push({
      x: c ? c.x : agent.position.x,
      z: c ? c.z : agent.position.z,
      t: this.time,
    });
    if (this.peekDeaths.length > 12) this.peekDeaths.shift();
  }

  /** Ask to lean out of cover. Only `peekTokens` members may at once. */
  requestPeek(agent: SquadAgent): boolean {
    if (!agent.alive) return false;
    if (isBannedCover(agent.cover, this.banned)) return false;
    if (this.peekHolders.has(agent.id)) return true;
    if (this.peekHolders.size >= this.peekTokens) return false;
    const last = this._peekAt.get(agent.id) ?? -1;
    if (last >= 0 && this.time - last < 0.55) return false;
    for (const m of this.members) {
      if (m === agent || !m.alive || this.peekHolders.has(m.id)) continue;
      if (m.state !== 'combat' || !m.cover || !m.coverPos) continue;
      if (m.peeking || m._returning || (m.peekTimer ?? 0) > 0) continue;
      if ((m.lastKnownAge ?? Infinity) > 2.8) continue;
      if (m.position.distanceTo(m.coverPos) > 0.85) continue;
      if ((this._peekAt.get(m.id) ?? -1) < last) return false;
    }
    this.peekHolders.add(agent.id);
    this._peekAt.set(agent.id, this.time);
    return true;
  }

  releasePeek(agent: SquadAgent): void {
    this.peekHolders.delete(agent.id);
  }

  /** One flanker at a time, and only if someone else is holding attention. */
  canFlank(agent: SquadAgent): boolean {
    if (this.flanker || this.holder === agent || this.elevated === agent) return false;
    if (this.intent === INTENT.WRAP && this.wrapper && agent !== this.wrapper) return false;
    for (const m of this.members) {
      if (m !== agent && this.supports(m)) return true;
    }
    return false;
  }

  claimFlank(agent: SquadAgent): void {
    this.flanker = agent;
  }

  requestGrenade() {
    if (this.wantFlush && !this.flushUsed) {
      this.flushUsed = true;
      this.flushFails = 0;
      this.grenadeCooldown = 14 + this.rng.float() * 12;
      return true;
    }
    if (this.grenadeCooldown > 0) return false;
    this.grenadeCooldown = 14 + this.rng.float() * 12;
    return true;
  }
}

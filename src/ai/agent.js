/**
 * AI — one enemy: body, senses, brain, gun.
 *
 * PERCEPTION is deliberately imperfect. A target has to be inside a 100 degree
 * cone, in line of sight through the physics BVH, and then *stay* there for a
 * reaction delay that scales with angle off-centre and distance before the
 * agent acknowledges it. Gunshots and footsteps arrive as events and only give
 * a direction with uncertainty, not exact coordinates. Alert then searches a
 * few reachable spots around that evidence instead of chasing an unseen player.
 *
 * BEHAVIOUR is a small state machine:
 *   idle / patrol -> alert -> combat -> suppressed -> flank -> retreat -> dead
 * Combat runs a peek-and-shoot loop from a scored cover point, with the squad
 * handing out permission to peek so they never all lean out at once, plus
 * suppressing fire, grenades and repositioning when the player stops moving.
 * Squad intent (pin / wrap / flush) can override that loop.
 *
 * DAMAGE is per-bone: capsule colliders for head, chest, pelvis, arms and legs
 * are pushed into `physics` every frame, so a headshot is a headshot because of
 * where the round landed, not because of a random roll. Death hands the live
 * skeleton to the ragdoll solver with the bullet's impulse.
 */

import * as THREE from 'three';
import { GRENADE_FUSE, GRENADE_RADIUS } from '../weapons/index.js';
import { RIG } from './rig.js';
import { INFANTRY, vaultPoint } from './capabilities.js';
import { Animator } from './animator.js';
import {
  isBannedCover, FRIENDLY_HOLD, GRENADE_CLOSE_SPEED, LONG_RANGE,
} from './intent.js';
import { COMBAT, TACTICS, acquireSeconds, applySpread } from './tuning.js';

const STATE = {
  IDLE: 'idle',
  PATROL: 'patrol',
  ALERT: 'alert',
  COMBAT: 'combat',
  SUPPRESSED: 'suppressed',
  FLANK: 'flank',
  RETREAT: 'retreat',
  DEAD: 'dead',
};

export { STATE };

export const PATH_OUTCOME = Object.freeze({
  SUCCESS: 'success',
  DEFERRED: 'deferred',
  INVALID: 'invalid',
  UNREACHABLE: 'unreachable',
});

export const FIRE_BLOCK = Object.freeze({
  ACQUIRING: 'acquiring',
  RELOCATING: 'relocating',
  PEEK_WAIT: 'peek-wait',
  MUZZLE: 'muzzle',
  BURST: 'burst',
  RELOAD: 'reload',
  SUPPRESSED: 'suppressed',
  FRIENDLY: 'friendly',
});

export const SEARCH_OUTCOME = Object.freeze({
  ACTIVE: 'active',
  COMPLETE: 'complete',
  FAILED: 'failed',
});

export const EVIDENCE = {
  VISUAL: 'visual',
  SOUND: 'sound',
  GUNFIRE: 'gunfire',
  FIRE: 'fire',
  REPORT: 'report',
};

export const EVIDENCE_TTL = 10;
export const VISUAL_LOCK = 2;
export const SOUND_ERROR = 6;
export const SEARCH_RADIUS = 7;
export const SEARCH_CANDIDATES = 3;
export const SEARCH_DURATION = 8;
const SEARCH_DWELL = 1.1;
const SEARCH_ARRIVE = 0.5;
const SEARCH_TRAVEL_MAX = 90;
const COVER_ARRIVE = 0.25;
export const RELOCATE_GIVE_UP = 1;
export const PEEK_WAIT_GIVE_UP = 4.5;
const MUZZLE_AIM_DOT = 0.72;
const PATH_FAIL_WAIT = 0.35;
const PATH_FAIL_WAIT_MAX = 2.5;
const PATROL_ALT_MAX = 2;
const PATH_OBJECTIVE = {
  [STATE.ALERT]: 'search',
  [STATE.PATROL]: 'patrol',
  [STATE.FLANK]: 'flank',
  [STATE.RETREAT]: 'retreat',
};

const HITBOXES = [
  ['head', 'Head', 'HeadTop', 0.098, 4.0],
  ['torso', 'Spine1', 'Neck', 0.185, 1.0],
  ['torso', 'Hips', 'Spine1', 0.175, 0.9],
  ['arm', 'UpperArmR', 'HandR', 0.072, 0.65],
  ['arm', 'UpperArmL', 'HandL', 0.072, 0.65],
  ['leg', 'UpLegR', 'FootR', 0.105, 0.7],
  ['leg', 'UpLegL', 'FootL', 0.105, 0.7],
];

let _nextId = 1;

export class Agent {
  constructor(ai, opts = {}) {
    this.ai = ai;
    this.ctx = ai.ctx;
    this.id = _nextId++;
    this.rng = ai.rng.fork();
    this.variantName = opts.variant ?? 'vanguard';
    const def = ai.variant(this.variantName);
    this.def = def;
    this.scale = def.variant.scale ?? 1;

    /* ---------------- body ---------------- */
    const { bones, skeleton, root } = RIG.createSkeleton();
    this.bones = bones;
    this.skeleton = skeleton;
    this.mesh = new THREE.SkinnedMesh(def.geometry, def.materials);
    this.mesh.castShadow = true;
    this.mesh.receiveShadow = true;
    this.mesh.frustumCulled = true;
    this.mesh.userData.agent = this;
    this.group = new THREE.Group();
    this.group.name = `enemy${this.id}`;
    this.group.add(root);
    this.group.add(this.mesh);
    this.mesh.bind(skeleton);
    this.group.scale.setScalar(this.scale);
    ai.root.add(this.group);

    /** Physics looks for these when it adopts the skeleton on death. */
    this.skinnedMesh = this.mesh;
    this.mass = 82 * this.scale;

    this.position = new THREE.Vector3().copy(opts.position ?? new THREE.Vector3());
    this.yaw = opts.yaw ?? 0;
    this.targetYaw = this.yaw;
    this.group.position.copy(this.position);
    this.group.rotation.y = this.yaw;
    // The bones' world matrices are derived from the group's, so the group has
    // to be current before anything reads them — including the very first
    // animator pass and a same-frame ragdoll hand-off.
    this.group.updateMatrixWorld(true);

    this.animator = new Animator(RIG, bones, {
      weapon: def.weapon,
      rng: this.rng.fork(),
      scale: this.scale,
      probe: (x, z, fromY, out) => this.ai.probeGround(x, z, fromY, out),
    });

    /* ---------------- physics ---------------- */
    const phys = this.ctx.peek('physics');
    this.phys = phys;
    this.height = INFANTRY.height * this.scale;
    this.radius = INFANTRY.radius * this.scale;
    this.controller = phys
      ? phys.createCharacter({
        radius: this.radius,
        height: this.height,
        position: this.position,
        stepHeight: INFANTRY.stepHeight,
        slopeLimit: INFANTRY.slopeRadians,
      })
      : null;
    this.velocity = new THREE.Vector3();
    this.grounded = true;
    for (const key of ['navStart', 'navGoal']) this[key] = {
      nav: null, version: -1, ref: 0, radius: this.radius, height: this.height,
      position: new THREE.Vector3(), point: new THREE.Vector3(),
    };

    this.colliders = [];
    if (phys) {
      for (const [part, a, b, r, dmg] of HITBOXES) {
        const c = phys.addCollider({
          shape: 'capsule',
          layer: phys.LAYER.ACTOR,
          surface: 'flesh',
          owner: this,
          part,
          radius: r * this.scale,
          damageScale: dmg,
        });
        c.userData = { a, b };
        this.colliders.push(c);
      }
    }

    /* ---------------- stats ---------------- */
    this.health = 100;
    this.maxHealth = 100;
    this.alive = true;
    this.state = STATE.IDLE;
    this.stateTime = 0;
    this.squad = opts.squad ?? null;
    this.team = opts.team ?? 1;
    // Player death creates a visual-only corpse through this same ragdoll path;
    // it must not masquerade as an enemy kill in the killfeed/wave director.
    this.silentDeath = opts.silentDeath === true;

    /* ---------------- perception ---------------- */
    this.eyeHeight = RIG.eyeHeight * this.scale;
    this.viewRange = COMBAT.viewRange;
    this.viewCos = Math.cos((COMBAT.viewConeDeg * Math.PI) / 180 / 2);
    this.awareness = 0; // 0..1 build-up before the target is acknowledged
    this.hasTarget = false;
    this.targetVisible = false;
    this.targetSample = -1; // 0 chest, 1 head, 2 upper body; diagnostic only
    this.target = null;
    this.lastKnown = new THREE.Vector3();
    this.lastKnownAge = Infinity;
    this.lastKnownKind = null;
    this.visualAge = Infinity; // independent of hearing, reports and HUD sightings
    this.lastSeen = -Infinity;
    this.lastFired = -Infinity;
    this.lastSeenX = this.position.x;
    this.lastSeenZ = this.position.z;
    this.fireX = this.position.x;
    this.fireZ = this.position.z;
    this.searchPoint = new THREE.Vector3();
    this._searchCand = [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()];
    this._searchCount = 0;
    this._searchIndex = 0;
    this._searchDwell = 0;
    this._searchUntil = 0;
    this._searchTravelUntil = 0;
    this._searchOrigin = new THREE.Vector3();
    this._searchReached = false;
    this.searchOutcome = null;
    this.suppression = 0;
    this.alertness = 0;
    this._impactCooldown = 0;
    this._observationSearch = false;
    this._positionScores = new Float64Array(SEARCH_CANDIDATES);
    this._laneBlockedTime = 0;
    this._repositioning = false;
    this._repositionUntil = 0;
    this._positionRetry = 0;

    /* ---------------- combat ---------------- */
    this.weaponRange = COMBAT.viewRange;
    this.fireRate = this.variantName === 'irregular' ? COMBAT.fireRateIrregular : COMBAT.fireRate;
    this.burstLeft = 0;
    this.fireCooldown = 0;
    this.burstCooldown = this.rng.range(COMBAT.firstBurstMin, COMBAT.firstBurstMax);
    this.magSize = COMBAT.magSize;
    this.ammo = this.magSize;
    this.spread = COMBAT.spread;
    this.weaponDamage = COMBAT.damage;
    this.aimTarget = new THREE.Vector3();
    this.aimActual = new THREE.Vector3();
    this.aimWeight = 0;
    this.wantFire = false;
    this.peekSide = 0;
    this.peeking = false;
    this.peekTimer = this.rng.range(0.5, 2.5);
    this.grenadeCooldown = this.rng.range(9, 22);
    this.hasGrenade = true;
    this.role = 'pin';
    this.wrapWait = 0;
    this._wrapDone = false;
    this._friendlyBlock = 0;
    this._muzzleBlocked = false;
    this.fireBlock = null;
    this._relocWait = 0;
    this._peekWait = 0;
    this._coverHold = 0;
    this._coverCheck = 0;
    this._engaging = false;
    this._engageHold = 0;
    this._engageCooldown = 0;
    this.combatAction = null;
    this.coverFailure = null;
    this._combatClock = 0;
    this._failedCoverIndex = 0;
    this._failedCovers = Array.from({ length: 6 }, () => ({ x: 0, y: 0, z: 0, until: 0, threat: new THREE.Vector3() }));
    this._peekTravel = 0;
    this._elevatedRouteChecked = false;
    this._peekSettle = 0;

    /* ---------------- navigation ---------------- */
    this.path = [];
    this.pathLen = 0;
    this.pathIndex = 0;
    this.repathTimer = 0;
    this.moveTarget = new THREE.Vector3().copy(this.position);
    this.hasMoveTarget = false;
    this.desiredSpeed = 0;
    this.speed = 0;
    this.crouch = false;
    this.cover = null;
    this.coverPos = new THREE.Vector3();
    this.firePos = new THREE.Vector3();
    this._returning = false;
    this._peekFail = 0;
    this.patrolPoints = opts.patrol ?? null;
    this.patrolIndex = 0;
    this.stuckTimer = 0;
    this.stuckHits = 0;
    this.noProgressTime = 0;
    this._progressPos = new THREE.Vector3().copy(this.position);
    this.vaultCooldown = 0;
    this.vaultT = -1;
    this.vaultFrom = new THREE.Vector3();
    this.vaultTo = new THREE.Vector3();
    this.vaultOutcome = null;
    this.recoveryOutcome = null;
    this.recoveryAttempts = 0;
    this._recovering = false;
    this._recoveryTime = 0;
    this._recoveryWait = 0;
    this._noRouteTime = 0;
    this._recoveryCount = 0;
    this._recoveryOrigin = this.position.clone();
    this._safePosition = this.position.clone();
    this._safeNav = null;
    this._safeSurface = 0;
    this._safeVersion = -1;
    this.relocations = 0;
    this.lastRollback = null;
    /** a path request the frame budget pushed to the next frame */
    this.pathPending = false;
    this._pendingDest = new THREE.Vector3();
    this.pathOutcome = null;
    this.pathObjective = null;
    this.pathReqFloor = NaN;
    this.pathResFloor = NaN;
    this._failWait = 0;
    this._failStreak = 0;
    this._holdMove = false;

    /* ---------------- LOD ---------------- */
    /** set by AiSystem._updateRelevance: nothing this actor does reaches a pixel */
    this.lodIrrelevant = false;
    this._animSkip = 0;
    this._animAccum = 0;

    /* ---------------- scratch ---------------- */
    this._v = new THREE.Vector3();
    this._v2 = new THREE.Vector3();
    this._v3 = new THREE.Vector3();
    this._eye = new THREE.Vector3();
    this._dir = new THREE.Vector3();
    this._steer = new THREE.Vector3();
    this._boneA = new THREE.Vector3();
    this._boneB = new THREE.Vector3();
    this._muzzleDir = new THREE.Vector3();

    this._stepPayload = { position: new THREE.Vector3(), surface: 'concrete', gait: 'walk' };

    this.clip = 'idle';
  }

  /* ================================================================== */
  /* frame                                                              */
  /* ================================================================== */

  get eye() {
    return this._eye.set(this.position.x, this.position.y + this.eyeHeight, this.position.z);
  }

  update(dt) {
    if (!this.alive) return;
    // Under the map they stay on the minimap and cannot be damaged, so the wave never ends.
    if (this.position.y < -3) {
      this.silentDeath = true;
      this.die(this.position, null, 0);
      return;
    }
    this.stateTime += dt;
    this.suppression = Math.max(0, this.suppression - dt * COMBAT.suppressDecay);
    this._impactCooldown = Math.max(0, this._impactCooldown - dt);
    this.fireCooldown -= dt;
    this.burstCooldown -= dt;
    this.grenadeCooldown -= dt;
    this.peekTimer -= dt;
    this.repathTimer -= dt;
    this.vaultCooldown -= dt;
    if (this.lastKnownAge < 1e6) this.lastKnownAge += dt;

    // a path the frame budget deferred: ask again before anything else does
    if (this.pathPending) this._goTo(this._pendingDest);

    this._sense(dt);
    if (this._recovering || this.vaultT >= 0) {
      this.wantFire = false;
      this.crouch = false;
      this.desiredSpeed = 1.5;
    } else this._think(dt);
    this._move(dt);
    this._tickNoProgress(dt);
    this._shoot(dt);
    this._updateFireBlock();
    this._drive(dt);
  }

  /* ================================================================== */
  /* perception                                                         */
  /* ================================================================== */

  _sense(dt) {
    this.visualAge += dt;
    this.targetSample = -1;
    const disabled = this.ai.ctx?.peek?.('player')?.hitbox?.enabled === false;
    let player = disabled ? null : this.ai.playerPosition(this._v3);
    if (!player) {
      this.targetVisible = false;
      if (this.visualAge > TACTICS.visualMemory) this.hasTarget = false;
      return;
    }
    const eye = this.eye;
    let dist = 0, visible = false;
    const fx = Math.sin(this.yaw), fz = Math.cos(this.yaw);
    const cone = this.hasTarget ? -0.2 : this.viewCos - this.alertness * 0.25;
    // Chest first: the common open-combat case still needs only one ray.
    // Each fallback must pass its own cone/range/LOS; awareness advances ONCE.
    for (let sample = 0; sample < 3; sample++) {
      if (sample) player = this.ai.playerPosition(this._v3, sample);
      if (!player) break;
      const to = this._dir.copy(player).sub(eye);
      dist = to.length();
      const dot = (fx * to.x + fz * to.z) / Math.max(dist, .001);
      if (dist >= this.viewRange || (dot <= cone && dist >= COMBAT.closeAcquire)) continue;
      visible = !this.phys || this.phys.lineOfSight(eye, player, this.phys.MASK.SIGHT);
      if (visible) { this.targetSample = sample; break; }
    }
    this.targetVisible = visible;

    if (visible) {
      // reaction: fast head-on and close, slow at the edge of vision
      this.awareness = Math.min(1, this.awareness + dt / acquireSeconds(dist, this.alertness));
      this._noteEvidence(player, EVIDENCE.VISUAL, 0);
      this.alertness = 1;
      if (this.awareness >= 1) {
        this.hasTarget = true;
        this.target = player;
      }
    } else {
      this.awareness = Math.max(0, this.awareness - dt * COMBAT.acquireDecay);
      if (this.hasTarget && this.visualAge > TACTICS.visualMemory) this.hasTarget = false;
    }
  }

  /** A gunshot or footstep heard from `pos` with a given loudness (metres). */
  hear(pos, loudness, kind = EVIDENCE.SOUND) {
    if (!this.alive) return;
    const d = this.position.distanceTo(pos);
    if (d > loudness) return;
    const strength = 1 - d / loudness;
    this.alertness = Math.max(this.alertness, Math.min(1, 0.35 + strength));
    const err = (1 - strength) * SOUND_ERROR;
    const ang = this.rng.float() * Math.PI * 2;
    this._v.set(pos.x + Math.cos(ang) * err, pos.y, pos.z + Math.sin(ang) * err);
    this._noteEvidence(this._v, kind, 0);
    // hearing alone never grants a target; it turns the head and the body
    this.awareness = Math.min(0.85, this.awareness + strength * 0.5);
    if (this.state === STATE.IDLE || this.state === STATE.PATROL) this._setState(STATE.ALERT);
  }

  /** Impact locations are danger, not shooter locations. Penetration exits
   * cannot stack a dozen suppression impulses from one round in one frame. */
  hearImpact(pos) {
    const d = this.position.distanceTo(pos);
    if (d >= 12) return;
    this.alertness = Math.max(this.alertness, .5);
    if (d < 3.2 && this._impactCooldown <= 0) {
      this.suppress(.5 * (1 - d / 3.2));
      this._impactCooldown = TACTICS.impactInterval;
    }
  }

  /** Record a contact. Reports never rejuvenate an unexpired clock. */
  _noteEvidence(pos, kind, age) {
    const had = this.lastKnownAge < 1e6;
    if (kind === EVIDENCE.REPORT) {
      if (had && this.lastKnownAge < EVIDENCE_TTL) return false;
    } else {
      if (this.lastKnownKind === EVIDENCE.GUNFIRE && kind === EVIDENCE.SOUND
        && this.lastKnownAge < TACTICS.gunfireLock) return false;
      if (had && age > this.lastKnownAge) return false;
      if (
        this.lastKnownKind === EVIDENCE.VISUAL &&
        this.lastKnownAge < VISUAL_LOCK &&
        kind !== EVIDENCE.VISUAL
      ) return false;
    }

    const jump = !had || this.lastKnown.distanceToSquared(pos) > 4;
    this.lastKnown.copy(pos);
    this.lastKnownKind = kind;
    this.lastKnownAge = age;
    if (kind === EVIDENCE.VISUAL) this.visualAge = age;

    if (kind === EVIDENCE.REPORT) return true;
    if (this.state === STATE.ALERT) {
      if (this._searchUntil <= 0) this._beginSearch();
      else if (jump && !this._recovering && !(this.vaultT >= 0)
        && ((!this.hasMoveTarget && !this.pathPending)
          || this._searchOrigin.distanceToSquared(pos) > (SEARCH_RADIUS * 2) ** 2)) {
        // Noisy nearby sounds update evidence without cancelling a valid route.
        if (age < 0.25) this._searchUntil = this.stateTime + SEARCH_DURATION;
        this._rebuildSearch();
      }
    }
    return true;
  }

  /** Rounds cracking past raise suppression, which drives the flinch + duck. */
  suppress(amount) {
    if (!this.alive) return;
    this.suppression = Math.min(COMBAT.suppressMax, this.suppression + amount);
    this.alertness = 1;
  }

  /* ================================================================== */
  /* behaviour                                                          */
  /* ================================================================== */

  _setState(s) {
    if (this.state === s) return;
    const prev = this.state;
    this.state = s;
    this.stateTime = 0;
    this.wantFire = false;
    this._relocWait = 0;
    this._peekWait = 0;
    this._coverHold = 0;
    if (s !== STATE.COMBAT) {
      this._endPeek();
      this._repositioning = false;
    }
    if (s === STATE.SUPPRESSED) this.repathTimer = 0;
    if (s === STATE.ALERT) this._beginSearch();
    else if (prev === STATE.ALERT) this._finishSearch(SEARCH_OUTCOME.COMPLETE);
    if (s === STATE.COMBAT || s === STATE.ALERT) {
      this._holdMove = false;
      this._failWait = 0;
      this._failStreak = 0;
    }
  }

  _clearSearch() {
    this._observationSearch = false;
    this._searchCount = 0;
    this._searchIndex = 0;
    this._searchDwell = 0;
    this._searchUntil = 0;
    this._searchTravelUntil = 0;
    this.pathPending = false;
    this.hasMoveTarget = false;
  }

  _finishSearch(outcome) {
    if (this.searchOutcome === SEARCH_OUTCOME.ACTIVE) this.searchOutcome = outcome;
    this._clearSearch();
  }

  _beginSearch() {
    this._clearSearch();
    if (this.lastKnownAge >= EVIDENCE_TTL) return;
    this.searchOutcome = SEARCH_OUTCOME.ACTIVE;
    this._searchUntil = this.stateTime + SEARCH_DURATION;
    this._rebuildSearch();
  }

  _rebuildSearch() {
    this._searchTravelUntil = 0;
    this._searchReached = false;
    this._searchOrigin.copy(this.lastKnown);
    this._buildSearchCandidates();
    this._searchIndex = 0;
    this._searchDwell = 0;
    this._goSearchCandidate();
  }

  _buildSearchCandidates() {
    this._searchCount = 0;
    const origin = this.lastKnown;
    const grid = this.ai.grid;
    const start = grid?.project(this.position, this._v2);
    const direct = grid?.sampleGround(origin.x, origin.z, origin.y, this._v);
    this._observationSearch = !!(grid && start
      && (!direct || grid.components.get(direct) !== grid.components.get(start)));
    if (this._observationSearch) {
      this._pickObservationPoints(origin, false);
      // No useful route: at least turn and inspect the cue for one bounded
      // dwell, rather than instantly going idle with our back to the gunfire.
      if (!this._searchCount) {
        this._searchCand[0].copy(this.position);
        this._searchCount = 1;
      }
      return;
    }
    const push = (x, y, z) => {
      if (this._searchCount >= SEARCH_CANDIDATES) return;
      const grid = this.ai.grid;
      if (grid) {
        const goal = grid.sampleGround(x, z, y, this._v);
        if (!goal || (start && grid.components.get(goal) !== grid.components.get(start))) return;
        x = this._v.x; y = this._v.y; z = this._v.z;
      }
      for (let k = 0; k < this._searchCount; k++) {
        if (Math.hypot(this._searchCand[k].x - x, this._searchCand[k].z - z) < 1.6) return;
      }
      this._searchCand[this._searchCount].set(x, y, z);
      this._searchCount++;
    };
    push(origin.x, origin.y, origin.z);
    let guard = 0;
    while (this._searchCount < SEARCH_CANDIDATES && guard++ < 12) {
      const ang = this.rng.float() * Math.PI * 2;
      const d = SEARCH_RADIUS * (0.45 + 0.55 * this.rng.float());
      push(origin.x + Math.cos(ang) * d, origin.y, origin.z + Math.sin(ang) * d);
    }
  }

  _goSearchCandidate() {
    while (this._searchIndex < this._searchCount) {
      const p = this._searchCand[this._searchIndex];
      this.searchPoint.copy(p);
      const ok = this._goTo(p);
      if (this.pathPending) return;
      if (ok) {
        this._searchDwell = 0;
        return;
      }
      this._searchIndex++;
    }
    if (this.searchOutcome === SEARCH_OUTCOME.ACTIVE && !this._searchReached) {
      this.searchOutcome = SEARCH_OUTCOME.FAILED;
    }
  }

  _tickSearch(dt) {
    const deadline = !this._searchReached && this._searchTravelUntil > 0
      ? this._searchTravelUntil : this._searchUntil;
    if (this._searchIndex >= this._searchCount || this.stateTime >= deadline) {
      this._finishSearch(this._searchReached ? SEARCH_OUTCOME.COMPLETE : SEARCH_OUTCOME.FAILED);
      return;
    }
    const dest = this.searchPoint;
    const dist = this.position.distanceTo(dest);
    this.desiredSpeed = dist > LONG_RANGE ? 4.3 : 1.5;

    if (this._searchDwell > 0) {
      this.desiredSpeed = 0;
      this.hasMoveTarget = false;
      this._searchDwell -= dt;
      this.targetYaw = Math.atan2(
        this.lastKnown.x - this.position.x,
        this.lastKnown.z - this.position.z,
      );
      if (this._searchDwell <= 0) {
        if (this._observationSearch) this._rememberFailedPosition(this.position);
        this._searchIndex++;
        this._goSearchCandidate();
      }
      return;
    }

    if (this.pathPending) return;

    if (dist < SEARCH_ARRIVE && Math.abs(dest.y - this.position.y) <= INFANTRY.arrivalHeight) {
      // Investigation time starts at physical arrival, not at the path solve.
      if (!this._searchReached) this._searchUntil = this.stateTime + SEARCH_DURATION;
      this._searchReached = true;
      this._searchDwell = SEARCH_DWELL;
      this.desiredSpeed = 0;
      this.hasMoveTarget = false;
      this.targetYaw = Math.atan2(
        this.lastKnown.x - this.position.x,
        this.lastKnown.z - this.position.z,
      );
      return;
    }

    if (!this.hasMoveTarget) {
      // A pending retry that came back empty is a failed candidate.
      this._searchIndex++;
      this._goSearchCandidate();
    }
  }

  _think(dt) {
    this.wantFire = false;
    this.combatAction = null;
    this._combatClock += dt;
    // Incoming fire sends a covered fighter back to protection before another
    // peek. Without cover, keep fighting while the normal picker finds shelter.
    if (this.state === STATE.COMBAT && this.cover && this.suppression >= TACTICS.strongSuppression) {
      this._setState(STATE.SUPPRESSED);
    }
    if (this._updateReposition()) return;
    if (this._engageClose(dt)) return;
    if (this._tryElevation(dt)) return;
    switch (this.state) {
      case STATE.IDLE:
        this.desiredSpeed = 0;
        this.crouch = false;
        if (this.hasTarget) this._enterCombat();
        else if (this.patrolPoints && this.stateTime > 2.5) this._setState(STATE.PATROL);
        break;

      case STATE.PATROL: {
        this.crouch = false;
        if (this.hasTarget) {
          this._enterCombat();
          break;
        }
        // a route point whose path is still queued is not a route point reached:
        // taking the next one here would walk the patrol index forward for free
        if (this.pathPending) {
          this.desiredSpeed = 1.35;
          break;
        }
        if (this._failWait > 0) this._failWait -= dt;
        // Only the floor-aware follower may complete an active patrol leg.
        if (this.hasMoveTarget) {
          this.desiredSpeed = 1.35;
          break;
        }
        if (this._failWait > 0) {
          this.desiredSpeed = 0;
          break;
        }
        if (this._holdMove) {
          this._failStreak = 0;
          this._holdMove = false;
        }
        if (!this._pickNextPatrol()) {
          if (!this.patrolPoints?.length) {
            this._setState(STATE.IDLE);
            break;
          }
          this._holdMove = true;
          this.desiredSpeed = 0;
          this.hasMoveTarget = false;
          this._failWait = PATH_FAIL_WAIT_MAX;
        } else {
          this.desiredSpeed = this.hasMoveTarget || this.pathPending ? 1.35 : 0;
        }
        break;
      }

      case STATE.ALERT: {
        this.crouch = false;
        if (this.hasTarget) {
          this._enterCombat();
          break;
        }
        if (this._searchUntil > 0) {
          this._tickSearch(dt);
          if (this._searchUntil <= 0) {
            this._setState(this.patrolPoints ? STATE.PATROL : STATE.IDLE);
          }
          break;
        }
        this.desiredSpeed = 0;
        if (this.stateTime > 12) this._setState(this.patrolPoints ? STATE.PATROL : STATE.IDLE);
        break;
      }

      case STATE.COMBAT:
        this._combat(dt);
        break;

      case STATE.SUPPRESSED: {
        this.wantFire = false;
        const height = INFANTRY.crouchHeight * this.scale;
        if (!this.cover || !this.ai.cover.protects(this.coverPos, this.lastKnown, height)) {
          this.ai.cover?.release(this.id);
          this.cover = null;
          this._setState(STATE.COMBAT);
          this._combat(dt);
          break;
        }
        const safe = this.position.distanceTo(this.coverPos) < COVER_ARRIVE
          && this.ai.cover.protects(this.position, this.lastKnown, height);
        this.crouch = safe;
        this.aimWeight = safe ? .55 : 1;
        this.combatAction = safe ? 'suppressed-hide' : 'suppressed-move';
        this.desiredSpeed = safe ? 0 : TACTICS.suppressedMoveSpeed;
        if (!safe && !this.pathPending && this.repathTimer <= 0
          && (!this.hasMoveTarget || this.moveTarget.distanceToSquared(this.coverPos) > .01)) {
          this._goTo(this.coverPos);
          this.repathTimer = .5;
        }
        if (this.suppression < TACTICS.suppressionRelease) this._setState(STATE.COMBAT);
        break;
      }

      case STATE.FLANK: {
        this.crouch = false;
        this.desiredSpeed = 4.4;
        this.wantFire = false;
        if (
          this.position.distanceTo(this.moveTarget) < 1.2 ||
          (!this.hasMoveTarget && !this.pathPending) ||
          this.stateTime > 20 ||
          (this.pathPending && !this.hasMoveTarget && this.stateTime > RELOCATE_GIVE_UP)
        ) {
          if (this.pathPending && !this.hasMoveTarget) this.pathPending = false;
          this._setState(STATE.COMBAT);
          this.cover = null;
        }
        if (this.suppression > 1.0) this._setState(STATE.COMBAT);
        break;
      }

      case STATE.RETREAT: {
        this.crouch = false;
        this.desiredSpeed = 4.6;
        this.wantFire = false;
        if (!this.hasMoveTarget || this.position.distanceTo(this.moveTarget) < 1.2) {
          this._setState(STATE.COMBAT);
        }
        if (this.health > 45 && this.stateTime > 4) this._setState(STATE.COMBAT);
        break;
      }
    }

    // Suppression is not a firing veto. Outside verified protection, retain
    // acquired defensive fire without cancelling the route to shelter/retreat.
    if ((this.state === STATE.SUPPRESSED && !this.crouch)
      || (this.suppression >= TACTICS.strongSuppression
        && (this.state === STATE.COMBAT || this.state === STATE.FLANK || this.state === STATE.RETREAT))) {
      this.wantFire = this.hasTarget && this.position.distanceTo(this.lastKnown) < this.weaponRange
        && this._canFireAtLastKnown();
      this.aimWeight = this.wantFire ? 1 : .55;
      this.combatAction = this.desiredSpeed > 0 && (this.hasMoveTarget || this.pathPending)
        ? 'suppressed-move' : 'suppressed-engage';
    }
  }

  // Pause the existing route/state rather than inventing a second movement
  // executor. Hysteresis keeps a nearby visible opponent from toggling run/aim.
  _engageClose(dt) {
    this._engageCooldown = Math.max(0, this._engageCooldown - dt);
    this._engageHold = Math.max(0, this._engageHold - dt);
    const eligible = (this.state === STATE.COMBAT || this.state === STATE.FLANK || this.state === STATE.RETREAT)
      && this.hasTarget && this.suppression < TACTICS.strongSuppression
      && !this.animator.reloading && !this.animator.vaulting && this.vaultT < 0 && !this._recovering;
    const distance = this.position.distanceTo(this.lastKnown);
    const holding = this.squad?.holder === this && this.state === STATE.COMBAT;
    const visible = eligible && this.targetVisible
      && distance < (holding ? LONG_RANGE : this._engaging ? TACTICS.closeRelease : TACTICS.closeEngage)
      && this._firingLaneClear(this.lastKnown);
    if (visible && (this._engaging || this._engageCooldown <= 0)) {
      if (!this._engaging) {
        this._endPeek();
        this.ai.cover?.release(this.id);
        this.cover = null;
        // Flank/retreat routes resume when the interruption ends. Cover travel
        // is reconsidered from the new engagement position instead.
        if (this.state === STATE.COMBAT) {
          this.hasMoveTarget = this.pathPending = false;
          this.pathLen = 0;
        }
        this._engageHold = TACTICS.engageHold;
      }
      this._engaging = true;
    } else if (!(this._engaging && eligible && this._engageHold > 0
      && this.visualAge < TACTICS.engageLostGrace)) {
      if (this._engaging) this._engageCooldown = TACTICS.engageCooldown;
      this._engaging = false;
      return false;
    }
    if (!this._engaging) return false;
    this.desiredSpeed = 0;
    this.crouch = false;
    this.aimWeight = 1;
    this.wantFire = visible;
    this.combatAction = holding && distance >= TACTICS.closeEngage ? 'hold-pressure' : 'close-engage';
    if (this.state === STATE.COMBAT) this._tryGrenade(this.lastKnown, distance);
    return true;
  }

  _tryElevation(dt) {
    const sq = this.squad;
    if (sq?.elevated !== this || !this.cover || this.state === STATE.SUPPRESSED) return false;
    const target = this.hasTarget && this.lastKnownKind === EVIDENCE.VISUAL ? this.lastKnown : sq.contact;
    if (this.suppression >= TACTICS.strongSuppression) {
      this._setState(STATE.SUPPRESSED);
      return false;
    }
    if (!this._elevatedRouteChecked && this.hasMoveTarget && !this.pathPending) {
      let length = this.position.distanceTo(this.path[this.pathIndex]);
      for (let i = this.pathIndex + 1; i < this.pathLen; i++) length += this.path[i - 1].distanceTo(this.path[i]);
      this._elevatedRouteChecked = true;
      if (length > TACTICS.elevatedPathMax) { this._rejectCover('elevated-route-cost'); return false; }
    }
    const atHide = this.position.distanceTo(this.coverPos) < COVER_ARRIVE;
    if (!atHide && !this.peeking && !this._returning) {
      if (!this.hasMoveTarget && !this.pathPending) { this._rejectCover('elevated-route-failed'); return false; }
      this.desiredSpeed = 3.5; this.crouch = false; this.aimWeight = .35;
      this.combatAction = 'elevated-travel';
      return true;
    }
    this._coverCheck -= dt;
    if (this._coverCheck <= 0) {
      this._coverCheck = .35;
      if (!this.ai.cover.protects(this.coverPos, target, this.cover.high ? this.height : INFANTRY.crouchHeight * this.scale)) {
        this._rejectCover('elevated-exposed'); return false;
      }
    }
    this.combatAction = 'elevated-peek';
    this._updatePeek(sq, target, this.position.distanceTo(target), dt);
    return true;
  }

  _canFireAtLastKnown() {
    return this.targetVisible || (
      this.lastKnownKind === EVIDENCE.VISUAL && this.lastKnownAge < TACTICS.suppressFireAge
    );
  }

  _fallbackStuck(dt, target, dist) {
    if (!(this.pathPending && !this.hasMoveTarget)) {
      this._relocWait = 0;
      return false;
    }
    this._relocWait += dt;
    if (this._relocWait < RELOCATE_GIVE_UP) return false;
    this._abandonMove(target, dist);
    return true;
  }

  _abandonMove(target, dist) {
    const expose = this.hasTarget && dist < this.weaponRange && this._canFireAtLastKnown()
      && !this.animator.reloading && !this.animator.vaulting
      && this._muzzleClear(target);
    this._rejectCover('relocate-timeout');
    this._coverHold = this.rng.range(1.4, 2.4);
    this._relocWait = 0;
    this._peekWait = 0;
    if (expose) {
      this.desiredSpeed = 0;
      this.crouch = false;
      this.aimWeight = 1;
      this.wantFire = true;
    }
  }

  _firingLaneClear(target) {
    if (!this._muzzleClear(target)) return false;
    const from = this.animator.muzzleWorld;
    this._muzzleDir.copy(target).sub(from).normalize();
    return !this._shotBlockedByFriend(from, this._muzzleDir);
  }

  _muzzleOk(target) {
    if (!this._muzzleClear(target)) return false;
    const from = this.animator.muzzleWorld;
    const dir = this.animator.muzzleDir;
    const dx = target.x - from.x, dy = target.y - from.y, dz = target.z - from.z;
    const len = Math.hypot(dx, dy, dz) || 1;
    return (dir.x * dx + dir.y * dy + dir.z * dz) / len >= MUZZLE_AIM_DOT;
  }

  _enterCombat() {
    this._setState(STATE.COMBAT);
    this.cover = null;
    this.repathTimer = 0;
  }

  _combat(dt) {
    const target = this.hasTarget
      ? this.lastKnown
      : this.lastKnownAge < 5 && this.lastKnownKind === EVIDENCE.VISUAL
        ? this.lastKnown
        : null;
    if (!target) {
      this._setState(STATE.ALERT);
      return;
    }
    const sq = this.squad;
    const dist = this.position.distanceTo(target);

    const pressured = this.suppression >= TACTICS.strongSuppression;
    if (!pressured && this._tryWrap(dt, sq, target)) return;

    this._coverCheck = Math.max(0, this._coverCheck - dt);
    const height = this.cover?.high ? this.height : INFANTRY.crouchHeight * this.scale;
    const exposed = this.cover && this._coverCheck <= 0
      && (!this.ai.cover.protects(this.coverPos, target, height)
        || (!this.peeking && !this._returning && this.position.distanceTo(this.coverPos) < COVER_ARRIVE
          && !this.ai.cover.protects(this.position, target, height)));
    if (this._coverCheck <= 0) this._coverCheck = .35;
    // A claim/normal does not establish protection from the current 3D threat.
    if (exposed || (sq && isBannedCover(this.cover, sq.banned))) this._rejectCover('exposed');

    // wounded and outgunned: fall back
    if (!pressured && this.health < 34 && this.stateTime > 1.5 && this.rng.float() < dt * 0.5) {
      const away = this._v
        .copy(this.position)
        .sub(target)
        .setY(0)
        .normalize()
        .multiplyScalar(9)
        .add(this.position);
      if (this.ai.grid?.sampleGround(away.x, away.z, away.y, away) && this._goTo(away)) {
        this._setState(STATE.RETREAT);
        return;
      }
    }

    // no cover yet, or the current one no longer protects: find one
    if (this._coverHold > 0) this._coverHold -= dt;
    if (this._coverHold <= 0 && this.repathTimer <= 0 && !this.peeking && !this._returning) {
      const pick = this.ai.cover?.pick(this.position, target, {
        id: this.id,
        squad: sq?.members,
        minRange: 7,
        maxRange: 30,
        maxTravel: this.cover ? 12 : 26,
        avoid: sq?.banned ?? null,
        eyeHeight: this.eyeHeight,
        failed: this._failedCovers, now: this._combatClock,
      });
      this.repathTimer = this.rng.range(2.2, 4.5);
      if (pick && pick !== this.cover) {
        this._endPeek();
        this.cover = pick;
        this._peekFail = 0;
        this.coverFailure = null;
        this.coverPos.set(pick.x, pick.y, pick.z);
        this.firePos.copy(this.coverPos);
        this._goTo(this.coverPos);
      } else if (!this.cover && dist > LONG_RANGE) {
        this.desiredSpeed = 4.3;
        this.wantFire = false;
        this._goOffAxis(target);
        this._fallbackStuck(dt, target, dist);
        return;
      }
    }

    // Failed or exhausted routes must not leave the actor holding fire short
    // of cover. A budget-deferred request is still pending, not a failure.
    if (
      this.cover &&
      !this.hasMoveTarget &&
      !this.pathPending && // still queued behind the frame's A* budget
      !this.peeking &&
      !this._returning &&
      this.position.distanceTo(this.coverPos) > COVER_ARRIVE
    ) {
      this._rejectCover('route-failed');
    }

    const atHide = this.cover && this.position.distanceTo(this.coverPos) < COVER_ARRIVE;
    const inPeek = this.peeking || this._returning;

    if (this.cover && !atHide && !inPeek) {
      // moving into position: close self-defense is handled before this branch
      this.combatAction = 'cover-travel';
      this.desiredSpeed = 4.3;
      this.crouch = false;
      this.wantFire = false;
      this.aimWeight = 0.35;
      this._fallbackStuck(dt, target, dist);
    } else if (this.cover) {
      this.combatAction = 'cover-peek';
      this._updatePeek(sq, target, dist, dt);
    } else {
      this.combatAction = 'open-engage';
      this.desiredSpeed = 0;
      this.crouch = false;
      this.aimWeight = this.targetVisible ? 1 : 0.55;
      this.wantFire = this.hasTarget && dist < this.weaponRange && this._canFireAtLastKnown();
    }

    // Opportunistic lateral relocate — skipped while the squad is wrapping so
    // the designated man owns the only flank slot.
    if (
      !pressured && sq &&
      this.role === 'pin' &&
      this.stateTime > 4 &&
      sq.canFlank(this) &&
      this.rng.float() < dt * 0.25
    ) {
      const side = this.rng.float() < 0.5 ? 1 : -1;
      const perp = this._v.copy(target).sub(this.position).setY(0).normalize();
      const flank = this._v2
        .set(-perp.z * side, 0, perp.x * side)
        .multiplyScalar(this.rng.range(8, 15))
        .add(this.position)
        .addScaledVector(perp, 4);
      if (this._goTo(flank)) {
        this.cover = null;
        this.ai.cover?.release(this.id);
        this._setState(STATE.FLANK);
        sq.claimFlank(this);
        return;
      }
    }

    this._tryGrenade(target, dist);
  }

  _tryGrenade(target, dist) {
    const sq = this.squad;
    const flush = !!(sq?.wantFlush && this.hasGrenade);
    if (
      this.hasGrenade && this.hasTarget && this.lastKnownKind === EVIDENCE.VISUAL &&
      this.grenadeCooldown <= 0 &&
      dist > (flush ? 6 : 8) &&
      dist < (flush ? 30 : 26) &&
      this.lastKnownAge < 1.5
    ) {
      if (this._grenadeUnsafe(target)) {
        this.ai.stats.grenadeHolds++;
        this.grenadeCooldown = 0.45;
        if (flush) sq.flushFails++;
      } else if (!sq || sq.requestGrenade(this)) {
        this._throwGrenade(target);
      }
    }
  }

  _goOffAxis(threat) {
    const sq = this.squad;
    if (sq) {
      if (!sq.hasWrapDest) sq.pickWrapDest(this.position, threat);
      if (sq.hasWrapDest) return this._goTo(sq.wrapDest);
    }
    const lx = threat.x - this.position.x;
    const lz = threat.z - this.position.z;
    const len = Math.hypot(lx, lz) || 1;
    const side = sq?.wrapSide || (this.id % 2 ? 1 : -1);
    this._v2.set(
      this.position.x + (-lz / len) * side * 14 + (lx / len) * 6,
      this.position.y,
      this.position.z + (lx / len) * side * 14 + (lz / len) * 6,
    );
    return this._goTo(this._v2);
  }

  _tryWrap(dt, sq, target) {
    if (!sq || this.role !== 'wrap' || this._wrapDone) return false;
    if (sq.alive > 1 && sq.contactAge < TACTICS.elevatedContactAge
      && sq.why !== 'unseen-deaths' && !sq.canFlank(this)) return false;
    if (this.wrapWait > 0) {
      this.wrapWait -= dt;
      return false;
    }
    if (!sq.hasWrapDest) sq.pickWrapDest(this.position, target);
    if (sq.hasWrapDest && this.position.distanceTo(sq.wrapDest) < 1.4) {
      this._wrapDone = true;
      this.role = 'hold';
      return false;
    }
    if (this.pathPending) {
      this.wantFire = false;
      const gaveUp = this._fallbackStuck(dt, target, this.position.distanceTo(target));
      if (gaveUp) {
        this._wrapDone = true;
        this.role = 'hold';
      }
      return this.pathPending || this.wantFire;
    }
    // A route already installed by the shared budget is success. Do not solve again.
    let matching = false;
    if (sq.hasWrapDest && this.hasMoveTarget) {
      const dx = this.moveTarget.x - sq.wrapDest.x;
      const dz = this.moveTarget.z - sq.wrapDest.z;
      matching = dx * dx + dz * dz < 2;
    }
    if (matching || this._goOffAxis(target)) {
      this.cover = null;
      this.ai.cover?.release(this.id);
      this._setState(STATE.FLANK);
      sq.claimFlank(this);
      this.wantFire = false;
      return true;
    }
    // Created this tick, so the give-up above cannot have elapsed yet.
    if (this.pathPending) {
      this.wantFire = false;
      return true;
    }
    return false;
  }

  /* ================================================================== */
  /* cover peek                                                         */
  /* ================================================================== */

  _rememberFailedPosition(p) {
    const f = this._failedCovers[this._failedCoverIndex];
    this._failedCoverIndex = (this._failedCoverIndex + 1) % this._failedCovers.length;
    f.x = p.x; f.y = p.y; f.z = p.z;
    f.threat.copy(this.lastKnown); f.until = this._combatClock + TACTICS.failedCoverAge;
  }

  _rejectCover(reason) {
    if (this.cover) this._rememberFailedPosition(this.cover);
    this.coverFailure = reason;
    this._endPeek();
    this.ai.cover?.release(this.id);
    this.cover = null;
    this.hasMoveTarget = this.pathPending = false;
    this.pathLen = 0;
    this.repathTimer = .6;
  }

  // One bounded scan, no path solves. Actual routes still pass through _goTo
  // and the shared two-solves/frame scheduler. Never consult the live player.
  _pickObservationPoints(target, local) {
    this._searchCount = 0;
    this._positionScores.fill(Infinity);
    const grid = this.ai.grid;
    if (!grid || !this.phys) return;
    const start = grid.project(this.position, this._v2);
    if (!start) return;
    const component = grid.components.get(start);
    const center = local ? this.position : target;
    for (let i = local ? 0 : -1; i < TACTICS.observationProbes; i++) {
      const ring = Math.floor(i / 8), angle = (i % 8) * Math.PI / 4 + (this.id % 8) * Math.PI / 16;
      const radius = local ? TACTICS.firingStepRadii[ring] : TACTICS.observationRadii[ring];
      // A useful current position calls for looking, not an unnecessary detour.
      const x = i < 0 ? this.position.x : center.x + Math.sin(angle) * radius;
      const z = i < 0 ? this.position.z : center.z + Math.cos(angle) * radius;
      let ref = grid.sampleGround(x, z, local || i < 0 ? this.position.y : target.y, this._v);
      if (!ref || grid.components.get(ref) !== component) ref = grid.sampleGround(x, z, this.position.y, this._v);
      if (!ref || grid.components.get(ref) !== component) continue;
      const p = this._v, travel = p.distanceTo(this.position);
      if ((i >= 0 && travel < .5) || travel > (local ? TACTICS.firingStepTravel : TACTICS.observationTravel)) continue;
      let failed = false;
      for (const f of this._failedCovers) {
        if (f.until > this._combatClock && f.threat.distanceToSquared(target) < TACTICS.failedThreatMove ** 2
          && Math.hypot(p.x - f.x, p.y - f.y, p.z - f.z) < TACTICS.firingPositionRadius) { failed = true; break; }
      }
      if (failed || (local && !grid.lineOfWalk(this.position, p))) continue;
      this._v2.copy(p); this._v2.y += this.eyeHeight;
      if (!this.phys.lineOfSight(this._v2, target, this.phys.MASK.SIGHT)) continue;
      this._dir.copy(target).sub(p).setY(0).normalize();
      this._v3.copy(this._v2).addScaledVector(this._dir, TACTICS.muzzleForward);
      this._v3.y -= TACTICS.muzzleDrop;
      if (!this.phys.lineOfSight(this._v3, target, this.phys.MASK.SIGHT)) continue;
      this._dir.copy(target).sub(this._v3).normalize();
      if (this._shotBlockedByFriend(this._v3, this._dir)) continue;
      let slot = this._searchCount < SEARCH_CANDIDATES ? this._searchCount : 0;
      let crowded = false;
      for (let k = 0; k < this._searchCount; k++) {
        if (this._searchCand[k].distanceTo(p) < 1.6) { crowded = true; break; }
        if (this._searchCount === SEARCH_CANDIDATES && this._positionScores[k] > this._positionScores[slot]) slot = k;
      }
      if (crowded || travel >= this._positionScores[slot]) continue;
      this._searchCand[slot].copy(p); this._positionScores[slot] = travel;
      this._searchCount = Math.min(SEARCH_CANDIDATES, this._searchCount + 1);
    }
    for (let i = 0; i < this._searchCount; i++) {
      for (let j = i + 1; j < this._searchCount; j++) {
        if (this._positionScores[j] >= this._positionScores[i]) continue;
        const p = this._searchCand[i]; this._searchCand[i] = this._searchCand[j]; this._searchCand[j] = p;
        const score = this._positionScores[i]; this._positionScores[i] = this._positionScores[j]; this._positionScores[j] = score;
      }
    }
  }

  _startReposition(reason) {
    if (this._repositioning || this._combatClock < this._positionRetry || !this.hasTarget
      || (this.state !== STATE.COMBAT && this.state !== STATE.SUPPRESSED)
      || !this._canFireAtLastKnown() || this._recovering || this.vaultT >= 0) return;
    this._positionRetry = this._combatClock + TACTICS.positionRetry;
    this._rememberFailedPosition(this.position);
    this._rejectCover(reason);
    this._engaging = false;
    this._laneBlockedTime = 0;
    this._pickObservationPoints(this.lastKnown, true);
    if (this._searchCount && (this._goTo(this._searchCand[0]) || this.pathPending)) {
      this._repositioning = true;
      this._repositionUntil = this._combatClock + TACTICS.firingStepTime;
    } else {
      this.repathTimer = this._coverHold = 0; // normal cover selection gets the next attempt
    }
  }

  _updateReposition() {
    if (!this._repositioning) return false;
    const arrived = this.position.distanceTo(this.moveTarget) < COVER_ARRIVE;
    const failed = !arrived && (this._combatClock >= this._repositionUntil || (!this.hasMoveTarget && !this.pathPending));
    if (!this.hasTarget || !this._canFireAtLastKnown() || failed || arrived) {
      if (failed) this._rememberFailedPosition(this.moveTarget);
      this._repositioning = false;
      this.hasMoveTarget = this.pathPending = false;
      this.pathLen = 0;
      this.repathTimer = 0;
      return false;
    }
    this.combatAction = 'firing-reposition';
    this.desiredSpeed = TACTICS.firingStepSpeed;
    this.crouch = false;
    this.aimWeight = 1;
    this.wantFire = this.position.distanceTo(this.lastKnown) < this.weaponRange;
    return true;
  }

  _endPeek() {
    this.squad?.releasePeek(this);
    this.peeking = false;
    this._returning = false;
    this._peekTravel = 0;
    this._peekSettle = 0;
    this.wantFire = false;
    this._muzzleBlocked = false;
  }

  /** Local 1-metre step — does not spend the A* budget. */
  _stepTo(dest, objective = 'local') {
    if (!this.path[0]) this.path[0] = new THREE.Vector3();
    this.path[0].copy(dest);
    this.pathLen = 1;
    this.pathIndex = 0;
    this.hasMoveTarget = true;
    this.pathPending = false;
    this.moveTarget.copy(dest);
    this.pathObjective = objective;
  }

  _muzzleClear(target) {
    return this.phys.lineOfSight(this.animator.muzzleWorld, target, this.phys.MASK.SIGHT);
  }

  _updatePeek(sq, target, dist, dt) {
    const recent = this.lastKnownAge < 2.8 || (sq?.elevated === this && sq.contactAge < TACTICS.elevatedContactAge);
    const atFire = Math.hypot(this.position.x - this.firePos.x, this.position.z - this.firePos.z) < INFANTRY.precisionRadius + .01
      && Math.abs(this.position.y - this.firePos.y) <= INFANTRY.arrivalHeight;
    const atHide = this.position.distanceTo(this.coverPos) < COVER_ARRIVE;

    if (this.peeking) {
      if (!atFire) this._stepTo(this.firePos);
      else this.hasMoveTarget = false;
      this.desiredSpeed = atFire ? 0 : 1.7;
      this.crouch = false;
      this.aimWeight = 1;
      // Exposure time starts at the firing position, not on the walk there.
      if (!atFire) {
        this.peekTimer += dt;
        this._peekTravel += dt;
        if (this._peekTravel > TACTICS.peekReachTime) this._rejectCover('peek-execution');
        this.wantFire = false;
        return;
      }
      this._peekTravel = 0;
      // Light pressure shortens exposure; heavy pressure returns to shelter in
      // _think. Travel still cannot consume the useful firing window.
      this.peekTimer -= dt * this.suppression * TACTICS.peekSuppressionScale;
      if (this.peekTimer <= 0) {
        this.peeking = false;
        this._returning = true;
        this.wantFire = false;
        this.peekTimer = this.rng.range(0.7, 1.8);
        this._stepTo(this.coverPos);
        return;
      }
      if (!this._muzzleClear(target)) {
        // The animated rifle needs time to rise after the exposure step.
        this._peekSettle += dt;
        if (this._peekSettle < TACTICS.peekSettleTime) { this.wantFire = false; return; }
        this._muzzleBlocked = true;
        this._peekFail++;
        this.peeking = false;
        this._returning = true;
        this.wantFire = false;
        this.peekTimer = this.rng.range(0.4, 0.9);
        this._stepTo(this.coverPos);
        if (this._peekFail >= 2) this._rejectCover('peek-muzzle');
        return;
      }
      this._peekFail = 0;
      this._muzzleBlocked = false;
      this.wantFire = this.hasTarget && dist < this.weaponRange && this._canFireAtLastKnown();
      return;
    }

    if (this._returning) {
      this._stepTo(this.coverPos);
      this.desiredSpeed = 1.7;
      this.crouch = !!(this.cover && !this.cover.high);
      this.aimWeight = 0.55;
      this.wantFire = false;
      if (atHide) {
        this._returning = false;
        this._muzzleBlocked = false;
        this.desiredSpeed = 0;
        this.hasMoveTarget = false;
        this.squad?.releasePeek(this);
      }
      return;
    }

    this.desiredSpeed = 0;
    this.hasMoveTarget = false;
    this.crouch = !!(this.cover && !this.cover.high);
    this.aimWeight = 0.55;
    this.wantFire = false;

    if (!sq?.peekHolders?.size) {
      this._peekWait += dt;
      if (this._peekWait >= PEEK_WAIT_GIVE_UP) {
        this._abandonMove(target, dist);
        return;
      }
    } else {
      this._peekWait = 0;
    }

    if (this.peekTimer > 0 || !recent) return;
    const allowed = !sq || sq.requestPeek(this);
    if (!allowed) {
      this.peekTimer = this.rng.range(0.25, 0.6);
      return;
    }
    this._peekWait = 0;
    if (this.ai.cover) {
      this.peekSide = this.ai.cover.peekOffset(this.cover, target, this.eyeHeight, this.firePos);
      if (this.peekSide === null) { this._rejectCover('no-firing-peek'); return; }
    } else {
      this.peekSide = 0;
      this.firePos.copy(this.coverPos);
    }
    this.peeking = true;
    this.crouch = false;
    this.aimWeight = 1;
    this.peekTimer = TACTICS.peekFireTime;
    this._peekTravel = 0;
    this._peekSettle = 0;
    this._stepTo(this.firePos);
  }

  /* ================================================================== */
  /* movement                                                           */
  /* ================================================================== */

  _notePathFail() {
    if (this.pathObjective !== 'patrol') return;
    this._failStreak++;
    this._failWait = PATH_FAIL_WAIT;
  }

  /** Next patrol point, then a bounded local wander. False = nothing left. */
  _pickNextPatrol() {
    const pts = this.patrolPoints;
    const n = pts?.length ?? 0;
    if (!n) return false;
    const fails = this._failStreak;
    if (fails >= n + PATROL_ALT_MAX) return false;
    if (fails >= n) {
      const alt = this._pickLocalAlt(this._v2);
      if (!alt) return false;
      this._goTo(alt);
      return true;
    }
    this._goTo(pts[(this.patrolIndex++) % n]);
    return true;
  }

  _pickLocalAlt(out) {
    const grid = this.ai.grid;
    if (!grid) return null;
    const origin = this._v, ref = grid.project(this.position, origin);
    if (!ref) return null;
    const component = grid.components.get(ref);
    for (let tries = 0; tries < 8; tries++) {
      const ang = this.rng.float() * Math.PI * 2;
      const d = 2.4 + this.rng.float() * 4;
      const goal = grid.sampleGround(origin.x + Math.cos(ang) * d, origin.z + Math.sin(ang) * d, origin.y, out);
      if (!goal || grid.components.get(goal) !== component) continue;
      if (Math.hypot(out.x - origin.x, out.z - origin.z) < 1.6) continue;
      return out;
    }
    return null;
  }

  _goTo(dest) {
    this.pathObjective = PATH_OBJECTIVE[this.state]
      ?? (this.cover ? 'cover' : this.role === 'wrap' ? 'wrap' : 'move');
    const dy = dest.y;
    this._pendingDest.copy(dest);
    const grid = this.ai.grid;
    if (!grid) {
      this.pathOutcome = PATH_OUTCOME.INVALID; this.pathReason = 'nav-unavailable';
      this.pathReqFloor = dy; this.pathResFloor = NaN;
      this.pathStartSurface = this.pathGoalSurface = 0;
      this.hasMoveTarget = this.pathPending = false; this.pathLen = 0;
      this._notePathFail(); return false;
    }
    // Every objective submits actual feet and the actual goal. The shared
    // navigator validates attachments; callers must not hide a bad start by snapping it.
    const n = this.ai.requestPath(this.position, dest, this.path, this);
    this.pathOutcome = this.ai.lastPathOutcome;
    if (this.pathOutcome !== PATH_OUTCOME.DEFERRED) {
      this.pathReqFloor = dy;
      this.pathResFloor = this.ai.lastPathResFloor;
      this.pathReason = this.ai.lastPathReason;
      this.pathStartSurface = this.ai.lastPathStartSurface;
      this.pathGoalSurface = this.ai.lastPathGoalSurface;
    }
    if (n < 0) {
      // Preserve the request for retry; budget deferral is not an unreachable goal.
      this.pathPending = true;
      return false;
    }
    this.pathPending = false;
    if (n === 0) {
      this.hasMoveTarget = false;
      this.pathLen = 0;
      this._notePathFail();
      return false;
    }
    this.pathLen = n;
    this.pathIndex = 0;
    this.moveTarget.copy(this.path[n - 1]);
    this.hasMoveTarget = true;
    // Query success cannot erase execution failures without physical progress.
    if (!this._recoveryCount) this._failStreak = 0;
    this._failWait = 0;
    if (this.state === STATE.ALERT && !this._searchReached && !(this._searchTravelUntil > 0)) {
      let distance = this.position.distanceTo(this.path[0]);
      for (let i = 1; i < n; i++) distance += this.path[i - 1].distanceTo(this.path[i]);
      this._searchTravelUntil = Math.max(this._searchUntil,
        this.stateTime + Math.min(SEARCH_TRAVEL_MAX, distance / 1.5 * 1.4 + 2));
    }
    return true;
  }

  _move(dt) {
    if (this.vaultT >= 0) { this._moveVault(dt); return; }
    const wp = this.hasMoveTarget && this.pathIndex < this.pathLen ? this.path[this.pathIndex] : null;
    this._steer.set(0, 0, 0);
    let want = 0, distance = Infinity;

    if (wp) {
      const to = this._v.copy(wp).sub(this.position);
      to.y = 0;
      const d = to.length();
      distance = d;
      const final = this.pathIndex === this.pathLen - 1;
      // Descending soldiers must reach the floor, not stop on the last tread.
      const radius = final ? (this.cover || this._recovering || this.pathObjective === 'local'
        ? INFANTRY.precisionRadius : INFANTRY.arrivalRadius)
        : Math.min(INFANTRY.cornerRadius, Math.max(.01, wp.distanceTo(this.path[this.pathIndex + 1]) / 2));
      if (d < radius && (!final || Math.abs(wp.y - this.position.y) <= INFANTRY.arrivalHeight)) {
        this.pathIndex++;
        if (this.pathIndex >= this.pathLen) {
          this.hasMoveTarget = false;
          if (!this._recovering && this.pathObjective !== 'local') this._recoveryCount = this._failStreak = 0;
        }
      } else if (d > 1e-6) {
        to.multiplyScalar(1 / d);
        this._steer.copy(to);
        want = this.desiredSpeed;
      }
    }

    // local avoidance: push off squadmates and steer around them
    const others = this.ai.agents;
    for (let i = 0; i < others.length; i++) {
      const o = others[i];
      if (o === this || !o.alive || Math.abs(o.position.y - this.position.y) > this.height) continue;
      const dx = this.position.x - o.position.x;
      const dz = this.position.z - o.position.z;
      const d2 = dx * dx + dz * dz;
      const rr = (this.radius + o.radius + 0.42) ** 2;
      if (d2 > rr || d2 < 1e-6) continue;
      const d = Math.sqrt(d2);
      // Yield extra spacing at a blocked doorway, not body-contact separation.
      const yieldSpace = (this.stuckTimer > INFANTRY.avoidanceYieldAfter || this.controller?.touchingWall)
        && d > this.radius + o.radius;
      const push = (1 - d / Math.sqrt(rr)) * 1.5 * (yieldSpace ? INFANTRY.avoidanceYieldScale : 1);
      this._steer.x += (dx / d) * push;
      this._steer.z += (dz / d) * push;
      // tangential bias breaks head-on deadlocks deterministically
      this._steer.x += (-dz / d) * push * 0.35 * (this.id % 2 ? 1 : -1);
      this._steer.z += (dx / d) * push * 0.35 * (this.id % 2 ? 1 : -1);
      if (want === 0) want = this.desiredSpeed * 0.35;
    }

    if (this._steer.lengthSq() > 1e-6) this._steer.normalize();

    // speed: ease toward the request so starts and stops have weight
    const targetSpeed = want * (this.crouch ? 0.42 : 1) * (1 - this.suppression * 0.25);
    this.speed += (targetSpeed - this.speed) * Math.min(1, dt * 7);
    if (this.speed < 0.05) this.speed = 0;

    // facing: look where we are going, or at the threat when engaged
    const engaged =
      this.state === STATE.COMBAT || this.state === STATE.SUPPRESSED || this.hasTarget
      || (this.state === STATE.ALERT && this.lastKnownKind === EVIDENCE.GUNFIRE
        && this.lastKnownAge < TACTICS.gunfireLock);
    const reported = this.squad?.elevated === this && (!this.hasTarget || this.lastKnownKind !== EVIDENCE.VISUAL);
    const look = reported ? this.squad.contact : this.lastKnown;
    if (engaged && (reported ? this.squad.contactAge : this.lastKnownAge) < 8) {
      this.targetYaw = Math.atan2(look.x - this.position.x, look.z - this.position.z);
    } else if (this.speed > 0.2) {
      this.targetYaw = Math.atan2(this._steer.x, this._steer.z);
    }
    let dy = this.targetYaw - this.yaw;
    while (dy > Math.PI) dy -= Math.PI * 2;
    while (dy < -Math.PI) dy += Math.PI * 2;
    // a big turn while standing still becomes a real turn-in-place step
    if (Math.abs(dy) > 0.9 && this.speed < 0.3) this.animator.turn(dy > 0 ? 1 : -1);
    const turnRate = this.speed > 0.3 ? 6.5 : 3.4;
    this.yaw += Math.max(-turnRate * dt, Math.min(turnRate * dt, dy));

    /* integrate through the character controller */
    // Dense corners can be closer than one running frame: never overshoot them.
    const travel = Math.min(this.speed * dt, distance);
    const c = this.controller;
    if (c) {
      const g = this.phys.gravity;
      this.velocity.y += g * dt;
      c.setHeight(this.crouch ? INFANTRY.crouchHeight * this.scale : this.height);
      c.move(this._steer.x * travel, this.velocity.y * dt, this._steer.z * travel);
      this.position.copy(c.position);
      this.grounded = c.grounded;
      if (c.grounded && this.velocity.y < 0) this.velocity.y = 0;

      // blocked by something low: vault it
      if (c.lastMoveBlocked && this.speed > 1.5 && this.vaultCooldown <= 0 && this.grounded) {
        this._tryVault();
      }
      if (c.lastMoveBlocked && this.speed > 0.5) {
        this.stuckTimer += dt;
        if (this.stuckTimer > 1.1) {
          this.stuckTimer = 0;
          this.repathTimer = 0;
          this.stuckHits++;
          if (this.stuckHits >= 2) {
            this._recoverMove();
          } else if (this.hasMoveTarget && !this._recovering) {
            this._goTo(this.moveTarget);
          }
        }
      } else {
        this.stuckTimer = 0;
        this.stuckHits = 0;
      }
    } else {
      this.position.x += this._steer.x * travel;
      this.position.z += this._steer.z * travel;
    }
  }

  /** Bounded, physically executable local steps. Never snap across a seam. */
  _unstickDest(out) {
    const grid = this.ai.grid;
    if (!grid) return null;
    const start = grid.project(this.position, this._v2);
    const heading = this._steer.lengthSq() > .01 ? Math.atan2(this._steer.x, this._steer.z) : this.yaw;
    const side = this.id % 2 ? 1 : -1;
    for (let i = 0; i < 8; i++) {
      const angle = heading + side * (Math.PI / 2 + i * Math.PI / 4);
      const goal = grid.sampleGround(this.position.x + Math.sin(angle) * INFANTRY.recoveryDistance,
        this.position.z + Math.cos(angle) * INFANTRY.recoveryDistance, this.position.y, out);
      if (!goal || (start && grid.components.get(start) !== grid.components.get(goal))) continue;
      if (Math.hypot(out.x - this.position.x, out.z - this.position.z) < .4) continue;
      if (grid.canAttach(this.position, out)) return out;
    }
    return null;
  }

  _rememberSafePosition() {
    const grid = this.ai.grid;
    if (!grid || !this.grounded || this._recoveryCount > 0 || this._recovering || this.vaultT >= 0) return;
    if (this._safeSurface && this.position.distanceToSquared(this._safePosition) < (INFANTRY.recoveryDistance * 2) ** 2) return;
    if (!grid.canStand(this.position, this.radius, this.height)) return;
    const ref = grid.project(this.position, this._v2);
    if (!ref || (this._safeSurface && (this._safeNav !== grid
      || grid.components.get(ref) !== grid.components.get(this._safeSurface)))) return;
    this._safePosition.copy(this.position);
    this._safeSurface = ref;
    this._safeNav = grid;
    this._safeVersion = grid.physics.staticWorld.version;
  }

  _rollback() {
    const grid = this.ai.grid;
    // A rebuilt collision scene invalidates the checkpoint. Surface overlap
    // alone cannot prove a capsule isn't wholly enclosed by a new solid.
    if (!this._safeSurface || this._safeNav !== grid || !this.controller
      || this._safeVersion !== grid.physics.staticWorld.version
      || this.position.distanceToSquared(this._safePosition) < .25
      || !this.ai.canRollback?.(this, this._safePosition)
      || !grid.canStand(this._safePosition, this.radius, this.height)) return false;
    const ref = grid.project(this._safePosition, this._v2);
    if (!ref || grid.components.get(ref) !== grid.components.get(this._safeSurface)) return false;
    // Exceptional, explicitly recorded repositioning. Never normal traversal.
    const from = this.position.toArray();
    this.controller.teleport(this._safePosition.x, this._safePosition.y, this._safePosition.z);
    this.position.copy(this.controller.position);
    this.lastRollback = { t: this.ctx.time.elapsed, from, to: this.position.toArray() };
    this.velocity.set(0, 0, 0); this.speed = 0;
    this.grounded = this.controller.grounded;
    this._endPeek(); this.ai.cover?.release(this.id); this.cover = null;
    this._recoveryCount = 0;
    this.relocations++;
    this.recoveryOutcome = 'relocated';
    this._progressPos.copy(this.position);
    this._goTo(this._pendingDest);
    return true;
  }

  _recoverMove() {
    if (this._recovering || this.pathPending || this._recoveryWait > 0 || this.vaultT >= 0) return;
    if (!this._recoveryCount) this._recoveryOrigin.copy(this.position);
    this._recoveryCount++;
    this.recoveryAttempts++;
    this._recoveryWait = INFANTRY.recoveryTimeout;
    this.stuckTimer = this.stuckHits = this.noProgressTime = this._noRouteTime = 0;
    if (this._recoveryCount > INFANTRY.recoveryAttempts) {
      if (this._rollback()) return;
      // Stop retrying an unexecutable objective. The brain may choose another;
      // stranded actors keep the bounded watchdog, including visibility checks.
      this.recoveryOutcome = 'failed';
      this.pathOutcome = PATH_OUTCOME.INVALID; this.pathReason = 'execution-blocked';
      if (this.pathObjective === 'local') this.pathObjective = 'move';
      this.hasMoveTarget = false; this.pathLen = 0;
      this._notePathFail();
      return;
    }
    const p = this._unstickDest(this._v);
    this.recoveryOutcome = p ? 'moving' : 'blocked';
    if (!p) return;
    this._endPeek();
    // Keep the failed objective's owner through both successful and blocked sidesteps.
    this._stepTo(p, this.pathObjective);
    this._recovering = true;
    this._recoveryTime = 0;
    this.desiredSpeed = 1.5;
    this.crouch = false;
  }

  /** Include failed starts with no remaining movement target in the watchdog. */
  _tickNoProgress(dt) {
    this._recoveryWait = Math.max(0, this._recoveryWait - dt);
    if (this.vaultT >= 0) return;
    if (this._engaging) { this.noProgressTime = this._noRouteTime = 0; return; }
    if (this._recoveryCount > 0 && !this._recovering
      && this.position.distanceToSquared(this._recoveryOrigin) >= INFANTRY.recoveryResetDistance ** 2) this._recoveryCount = this._failStreak = 0;
    if (!this._safeSurface || this.position.distanceToSquared(this._progressPos) >= .25) this._rememberSafePosition();
    if (this._recovering) {
      this._recoveryTime += dt;
      if (!this.hasMoveTarget || this._recoveryTime >= INFANTRY.recoveryTimeout) {
        this.recoveryOutcome = this.position.distanceTo(this.moveTarget) < .25 ? 'arrived' : 'blocked';
        this._recovering = false;
        this.hasMoveTarget = false;
        this.pathLen = 0;
        this._recoveryWait = INFANTRY.recoveryTimeout;
        // A sidestep is not arrival at (or failure of) the original objective.
        if (this.recoveryOutcome === 'arrived') this._goTo(this._pendingDest);
      }
      return;
    }
    const stranded = this.state !== STATE.IDLE && !this.hasMoveTarget && this.pathObjective !== 'local'
      && (this.pathReason === 'start-attachment' || this.pathReason === 'disconnected' || this.pathReason === 'execution-blocked');
    if (!stranded) this._noRouteTime = 0;
    else if (!this.pathPending) this._noRouteTime += dt;
    if (this.position.distanceToSquared(this._progressPos) >= 0.25) {
      this.noProgressTime = 0;
      this._progressPos.copy(this.position);
    } else if (this.hasMoveTarget && this.desiredSpeed > .5) {
      // Consuming a corner or briefly waiting for steering must not erase a
      // sustained stall. Actual displacement, not nominal speed, is progress.
      this.noProgressTime += dt;
    } else if (!this.pathPending) this.noProgressTime = 0;
    if (this.noProgressTime >= INFANTRY.recoveryTimeout || this._noRouteTime >= INFANTRY.recoveryTimeout) {
      this._recoverMove();
      this._progressPos.copy(this.position);
    }
  }

  _tryVault() {
    if (!this.hasMoveTarget || this.pathPending || !this.ai.grid || !this.controller) return;
    this.vaultCooldown = 2.5;
    this.vaultOutcome = 'rejected';
    const phys = this.phys;
    const fwd = this._v.set(Math.sin(this.yaw), 0, Math.cos(this.yaw));
    const low = phys.raycast(
      this.position.x, this.position.y + 0.35, this.position.z,
      fwd.x, 0, fwd.z, 0.85, phys.MASK.WORLD
    );
    if (!low.hit) return;
    const high = phys.raycastAny(
      this.position.x, this.position.y + 1.25, this.position.z,
      fwd.x, 0, fwd.z, 1.1, phys.MASK.WORLD
    );
    if (high) return; // a wall, not a ledge
    // landing spot on the other side
    const lx = this.position.x + fwd.x * INFANTRY.vaultDistance;
    const lz = this.position.z + fwd.z * INFANTRY.vaultDistance;
    const y = this.ai.groundAt(lx, lz, this.position.y + 2.2);
    if (!Number.isFinite(y) || Math.abs(y - this.position.y) > 1.3) return;
    this._v2.set(lx, y, lz);
    if (!this.ai.grid.canVault(this.position, this._v2, this.path[this.pathIndex])) return;
    this.vaultFrom.copy(this.position);
    this.vaultTo.copy(this._v2);
    this.vaultVersion = phys.staticWorld.version;
    this.vaultOutcome = 'moving';
    this.vaultT = 0;
    this.crouch = false;
    this.animator.vault(INFANTRY.vaultDuration);
  }

  _moveVault(dt) {
    const c = this.controller;
    let blocked = this.phys.staticWorld.dirty || this.phys.staticWorld.version !== this.vaultVersion;
    // Match the feasibility probe; every live segment still uses collision.
    while (!blocked && dt > 1e-8 && this.vaultT < 1) {
      const step = Math.min(dt, 1 / 60);
      this.vaultT = Math.min(1, this.vaultT + step / INFANTRY.vaultDuration);
      vaultPoint(this.vaultFrom, this.vaultTo, this.vaultT, this._v);
      c.setHeight(this.height);
      c.move(this._v.x - c.position.x, this._v.y - c.position.y, this._v.z - c.position.z);
      this.position.copy(c.position);
      this.grounded = c.grounded;
      blocked = this._v.distanceToSquared(this.position) > .05 ** 2;
      dt -= step;
    }
    this.velocity.y = 0;
    if (blocked || this.vaultT >= 1 - 1e-8) {
      this.vaultT = -1;
      this.animator.vaultT = -1;
      this.vaultOutcome = blocked ? 'blocked' : 'arrived';
      const resume = this.hasMoveTarget;
      this.hasMoveTarget = false;
      if (resume) this._goTo(this.moveTarget);
    }
  }

  /* ================================================================== */
  /* shooting                                                           */
  /* ================================================================== */

  _updateFireBlock() {
    let reason = null;
    const state = this.state;
    if (this._engaging) {
      if (this._friendlyBlock > 0) reason = FIRE_BLOCK.FRIENDLY;
      else if (this._muzzleBlocked) reason = FIRE_BLOCK.MUZZLE;
      else if (!this.wantFire) reason = FIRE_BLOCK.ACQUIRING;
      else if (this.burstLeft <= 0 && this.burstCooldown > 0) reason = FIRE_BLOCK.BURST;
    }
    else if ((state === STATE.FLANK || state === STATE.RETREAT) && !this.wantFire) reason = FIRE_BLOCK.RELOCATING;
    else if (state === STATE.COMBAT || state === STATE.SUPPRESSED || this.wantFire) {
      if (this.animator.reloading) reason = FIRE_BLOCK.RELOAD;
      else if (this._friendlyBlock > 0) reason = FIRE_BLOCK.FRIENDLY;
      else if (state === STATE.SUPPRESSED && this.crouch) reason = FIRE_BLOCK.SUPPRESSED;
      else if (this._muzzleBlocked) reason = FIRE_BLOCK.MUZZLE;
      else if (this.wantFire) {
        if (this.burstLeft <= 0 && this.burstCooldown > 0) reason = FIRE_BLOCK.BURST;
      }
      else if (this.cover && !this.peeking && !this._returning) {
        const dx = this.position.x - this.coverPos.x;
        const dz = this.position.z - this.coverPos.z;
        reason = dx * dx + dz * dz > COVER_ARRIVE ** 2 ? FIRE_BLOCK.RELOCATING : FIRE_BLOCK.PEEK_WAIT;
      } else if (this._returning) reason = FIRE_BLOCK.RELOCATING;
      else if (this.peeking) {
        const dx = this.position.x - this.firePos.x;
        const dz = this.position.z - this.firePos.z;
        if (dx * dx + dz * dz >= COVER_ARRIVE ** 2) reason = FIRE_BLOCK.RELOCATING;
        else if (this.wantFire && this.burstLeft <= 0 && this.burstCooldown > 0) {
          reason = FIRE_BLOCK.BURST;
        } else if (!this.wantFire) reason = FIRE_BLOCK.ACQUIRING;
      } else if (!this.wantFire) reason = FIRE_BLOCK.ACQUIRING;
      else if (this.burstLeft <= 0 && this.burstCooldown > 0) reason = FIRE_BLOCK.BURST;
    }
    this.fireBlock = reason;
  }

  _shoot(dt) {
    // where the gun is pointing: lead toward the target with human error
    const reported = this.squad?.elevated === this && (!this.hasTarget || this.lastKnownKind !== EVIDENCE.VISUAL);
    const t = reported ? this.squad.contact : this.hasTarget || this.lastKnownAge < 3 ? this.lastKnown : null;
    if (t) {
      // aim at the chest, not the feet
      this._v.set(t.x, t.y + COMBAT.aimChest, t.z);
      const dist = this.position.distanceTo(this._v);
      const wobbleT = this.ctx.time.elapsed * 1.7 + this.id;
      const wob = COMBAT.aimWobble + this.suppression * COMBAT.aimWobbleSuppress;
      this._v.x += Math.sin(wobbleT) * wob * dist * COMBAT.aimWobbleLat;
      this._v.y += Math.sin(wobbleT * 1.7 + 1.1) * wob * dist * COMBAT.aimWobbleVert;
      this._v.z += Math.cos(wobbleT * 0.8) * wob * dist * COMBAT.aimWobbleLat;
      this.aimTarget.lerp(this._v, Math.min(1, dt * COMBAT.aimTrack));
    } else {
      const fwd = this._v.set(Math.sin(this.yaw), 0, Math.cos(this.yaw));
      this._v2
        .copy(this.position)
        .addScaledVector(fwd, 12)
        .setY(this.position.y + this.eyeHeight - 0.1);
      this.aimTarget.lerp(this._v2, Math.min(1, dt * COMBAT.aimIdleTrack));
    }

    if (
      !this.wantFire ||
      (this.state !== STATE.COMBAT && this.state !== STATE.SUPPRESSED
        && this.state !== STATE.FLANK && this.state !== STATE.RETREAT && !this._engaging) ||
      this.animator.reloading ||
      this.animator.vaulting
    ) {
      this._laneBlockedTime = 0;
      this._friendlyBlock = 0;
      return;
    }
    if (t && !this._muzzleOk(t)) {
      this._muzzleBlocked = true;
      this._friendlyBlock = 0;
      // Alignment/raising is not a bad position. Count only sustained actual
      // world obstruction while stationary, not a route already being followed.
      if (!this._repositioning && this.speed < .2 && !this._muzzleClear(t)) {
        this._laneBlockedTime += dt;
        if (this._laneBlockedTime >= TACTICS.blockedFireTime) this._startReposition('blocked-firing-position');
      } else this._laneBlockedTime = 0;
      return;
    }
    this._laneBlockedTime = 0;
    this._muzzleBlocked = false;
    if (this.ammo <= 0) {
      this.animator.reload(this.variantName === 'irregular' ? 2.9 : 2.35);
      this.ai.emitReload(this);
      this.ammo = this.magSize;
      return;
    }
    if (this.burstLeft <= 0) {
      if (this.burstCooldown > 0) return;
      this.burstLeft = this.rng.int(COMBAT.burstMin, COMBAT.burstMax);
      this.burstCooldown = this.rng.range(COMBAT.burstGapMin, COMBAT.burstGapMax)
        + this.suppression * COMBAT.burstGapSuppress;
    }
    if (this.fireCooldown > 0) return;

    const an = this.animator;
    const origin = an.muzzleWorld;
    const dir = this._muzzleDir.copy(an.muzzleDir);
    applySpread(dir, this.rng, this.spread * (1 + this.suppression * COMBAT.suppressSpread));
    if (this._shotBlockedByFriend(origin, dir)) {
      this.ai.stats.friendlyHolds++;
      this._friendlyBlock += dt;
      if (this._friendlyBlock >= FRIENDLY_HOLD) this._breakFriendlyPeek();
      return;
    }
    this._friendlyBlock = 0;
    this.fireCooldown = 1 / this.fireRate;
    this.burstLeft--;
    this.ammo--;
    an.fire(1);
    this.ai.onAgentFire(this, origin, dir);
  }

  _shotBlockedByFriend(origin, dir) {
    const agents = this.ai.agents;
    // The torso-centre proxy below misses heads/extended limbs. Check the
    // actual animated hitboxes along the spread-adjusted round as well. Do not
    // treat a wall as protection here: rifle rounds can penetrate it.
    const phys = this.phys;
    if (agents.length > 1 && phys?.LAYER?.ACTOR) {
      const hit = phys.raycast(origin.x, origin.y, origin.z, dir.x, dir.y, dir.z, 200, phys.LAYER.ACTOR);
      if (hit.hit && hit.actor?.alive && hit.actor !== this && hit.actor.team === this.team) return true;
    }
    let bestT = 80;
    if (this.targetVisible && this.hasTarget) {
      const p = this.lastKnown;
      const px = p.x - origin.x, py = p.y - origin.y, pz = p.z - origin.z;
      const t = px * dir.x + py * dir.y + pz * dir.z;
      const miss = Math.hypot(px - dir.x * t, py - dir.y * t, pz - dir.z * t);
      if (t > 0.4 && miss < 0.42) bestT = t;
    }
    let blocked = false;
    for (let i = 0; i < agents.length; i++) {
      const o = agents[i];
      if (o === this || !o.alive || o.team !== this.team || o.silentDeath) continue;
      const px = o.position.x - origin.x;
      const py = o.position.y + 0.95 - origin.y;
      const pz = o.position.z - origin.z;
      const t = px * dir.x + py * dir.y + pz * dir.z;
      if (t < 0.4 || t > bestT) continue;
      const miss = Math.hypot(px - dir.x * t, py - dir.y * t, pz - dir.z * t);
      if (miss < 0.48) {
        bestT = t;
        blocked = true;
      }
    }
    if (!blocked) return false;
    if (phys) {
      const wall = phys.raycast(
        origin.x, origin.y, origin.z, dir.x, dir.y, dir.z, bestT - 0.08, phys.MASK.WORLD
      );
      if (wall.hit) return false;
    }
    return true;
  }

  _breakFriendlyPeek() {
    this._engaging = false;
    this._engageCooldown = FRIENDLY_HOLD;
    this._friendlyBlock = 0;
    this._startReposition('friendly-lane');
    if (!this._repositioning) this._rejectCover('friendly-lane');
    this.peekTimer = this.rng.range(0.5, 1.1);
  }

  _grenadeUnsafe(target) {
    const from = this.animator.muzzleWorld;
    const land = this._v3;
    const landDist = this.ai.predictGrenadeLand(from, target, land);
    const toTarget = Math.hypot(target.x - from.x, target.z - from.z);
    if (landDist < toTarget * 0.55) return true;
    if (this.position.distanceToSquared(land) < GRENADE_RADIUS * GRENADE_RADIUS) return true;
    const r2 = (GRENADE_RADIUS + GRENADE_FUSE * GRENADE_CLOSE_SPEED) ** 2;
    const agents = this.ai.agents;
    for (let i = 0; i < agents.length; i++) {
      const o = agents[i];
      if (o === this || !o.alive || o.team !== this.team || o.silentDeath) continue;
      if (o.position.distanceToSquared(land) < r2) return true;
    }
    return false;
  }

  _throwGrenade(target) {
    this.grenadeCooldown = this.rng.range(16, 34);
    this.hasGrenade = false;
    this.ctx.events.emit('ai:bark', { kind: 'grenade', position: this.position, voice: this.id });
    const from = this._v.copy(this.animator.muzzleWorld);
    this.ai.throwGrenade(this, from, target);
  }

  /* ================================================================== */
  /* damage                                                             */
  /* ================================================================== */

  /**
   * Take a hit. NOTE: named `applyDamage`, not `damage` — the weapon's damage
   * value is a field on this object and a method of the same name would be
   * shadowed by it.
   * @param amount  post-falloff damage
   * @param part    'head' | 'torso' | 'arm' | 'leg'
   * @param point   world impact point
   * @param dir     incident direction (unit)
   */
  applyDamage(amount, part, point, dir) {
    if (!this.alive) return;
    this.health -= amount;
    this.alertness = 1;
    this.suppression = Math.min(COMBAT.suppressMax, this.suppression + 0.35);
    // knowing where it came from
    if (dir) {
      this._v.copy(point).addScaledVector(dir, -14);
      this._noteEvidence(this._v, EVIDENCE.FIRE, 0.4);
    }
    if (this.state === STATE.IDLE || this.state === STATE.PATROL) this._setState(STATE.ALERT);

    if (this.health <= 0) {
      this.die(point, dir, amount);
      return;
    }
    // hit reaction by region, with the side the round came from
    const side = dir ? Math.sign(dir.x * Math.cos(this.yaw) - dir.z * Math.sin(this.yaw)) || 1 : 1;
    const region =
      part === 'head' ? 'head'
        : part === 'arm' ? (this._sideOf(point) < 0 ? 'armR' : 'armL')
          : part === 'leg' ? (this._sideOf(point) < 0 ? 'legR' : 'legL')
            : 'torso';
    this.animator.hit(region, side, Math.min(1.4, 0.5 + amount / 45));
    if (part === 'leg') this.speed *= 0.4;
  }

  /** Which side of the body a world point is on: <0 right, >0 left. */
  _sideOf(p) {
    const dx = p.x - this.position.x;
    const dz = p.z - this.position.z;
    return dx * Math.cos(this.yaw) - dz * Math.sin(this.yaw);
  }

  die(point, dir, amount = 30) {
    if (!this.alive) return;
    this._endPeek();
    this._clearSearch();
    this.squad?.noteDeath(this);
    this.alive = false;
    this.state = STATE.DEAD;
    this.wantFire = false;
    this.animator.enabled = false;
    this.ai.cover?.release(this.id);
    if (this.controller) this.phys.removeCharacter(this.controller);
    this.controller = null;
    for (const c of this.colliders) this.phys?.removeCollider(c);
    this.colliders.length = 0;

    // Impulse is N·s, and the ragdoll turns it into a velocity change on the
    // particles it lands near: a 5.56 round carries ~4 N·s, so anything in the
    // hundreds launches the body across the street instead of dropping it.
    this.group.updateMatrixWorld(true);
    const impulse = this._v2
      .copy(dir ?? this._v.set(0, 0, 1))
      .normalize()
      .multiplyScalar(Math.min(5.5, 1.5 + amount * 0.02));
    const hitPoint = point ?? this._v.copy(this.position).setY(this.position.y + 1.2);

    // Own the hand-off: build the capsule spec from the *live* animated pose,
    // hand it to the solver and let it drive the skeleton from here.
    const rd = this._makeRagdoll(impulse, hitPoint);
    if (rd) this.ragdoll = rd;
    if (!this.silentDeath) {
      this.ctx.events.emit('actor:death', {
        actor: this,
        point: hitPoint,
        impulse,
        headshot: false,
      });
    }
    this.deadTime = 0;
  }

  /**
   * Hand the live pose to the ragdoll solver. `physics` derives the capsule
   * chain from the skeleton itself, so the doll starts exactly in the pose the
   * animator left — the death has no pop. `radiusRatio` fattens the capsules
   * (its default is thin enough that a settled body reads as a pancake).
   */
  _makeRagdoll(impulse, point) {
    const phys = this.phys;
    if (!phys) return null;
    // Fat capsules that start half-buried in the floor tunnel straight through
    // it: the contact normal flips once a bone's axis is on the far side. Lift
    // the pose clear of the ground for the one frame it takes to build the doll,
    // then put the group back — the body drops the 15 cm invisibly.
    const lift = 0.15 * this.scale;
    this.group.position.y += lift;
    this.group.updateMatrixWorld(true);
    const rd = phys.createRagdollFromSkeleton(this.mesh, {
      actor: this,
      mass: this.mass,
      radiusRatio: 0.42,
      cone: 74,
      twist: 38,
      iterations: 8,
      velocity: { x: this.velocity.x * 0.6, y: 0, z: this.velocity.z * 0.6 },
    });
    this.group.position.y -= lift;
    this.group.updateMatrixWorld(true);
    if (!rd) return null;
    if (impulse && point) {
      // wide radius: a tight one dumps all of it into whichever light bone is
      // nearest and whips the limb across the street
      rd.applyImpulse(point.x, point.y, point.z, impulse.x, impulse.y, impulse.z, 0.85);
    }
    if (this.ai.debugLog) {
      console.info(
        `[ai] ragdoll ${rd.boneCount} bones / ${rd.particleCount} particles, ` +
          `mask=${rd.mask} tris=${rd.world?.triCount}`
      );
    }
    return rd;
  }

  /* ================================================================== */
  /* drive the visual                                                   */
  /* ================================================================== */

  _drive(dt) {
    this.group.position.copy(this.position);
    this.group.rotation.y = this.yaw;
    this.group.updateMatrixWorld(true);

    const moving = this.speed > 0.25;
    let clip;
    if (this.crouch) clip = moving ? 'crouchWalk' : 'crouchIdle';
    else if (this.speed > 2.6) clip = 'run';
    else if (moving) clip = 'walk';
    else clip = this.health < 35 ? 'hurtIdle' : 'idle';
    this.clip = clip;

    const an = this.animator;
    an.setState({
      clip,
      speed: this.speed,
      crouch: this.crouch,
      aimTarget: this.aimTarget,
      lookTarget: this.hasTarget || this.lastKnownAge < 4 || this._searchUntil > 0 ? this.lastKnown : this.aimTarget,
      aimWeight: this.aimWeight,
      suppress: Math.min(1, this.suppression * 0.8),
    });

    // ANIMATION RATE LOD. The pose write, the three IK chains and the two foot
    // ground rays are the whole per-actor cost, and for an actor that cannot
    // reach a pixel this frame (see AiSystem._updateRelevance) they buy nothing.
    // Evaluate a third as often and hand the solver the accumulated dt, so the
    // stride phase, the recoil envelope and the reload timeline stay on the same
    // clock — nothing skates or slides when the actor becomes visible again, and
    // the frame it does become visible is always a full evaluation because
    // lodIrrelevant is false by then.
    this._animAccum += dt;
    if (this.lodIrrelevant) {
      if (this._animSkip > 0) {
        this._animSkip--;
        return;
      }
      this._animSkip = 2; // one evaluation in three while nothing can see it
    } else {
      this._animSkip = 0;
    }
    an.update(this._animAccum, this.ctx.time.elapsed);
    this._animAccum = 0;

    // Airborne or vaulting the stride phase still ticks, but nobody lands.
    if (an.footfall && this.grounded && !an.vaulting) {
      const p = this._stepPayload;
      p.position.copy(this.position);
      p.surface = this.controller?.groundSurfaceName ?? 'concrete';
      p.gait = clip === 'run' ? 'run' : clip === 'crouchWalk' ? 'crouch' : 'walk';
      this.ctx.events.emit('ai:footstep', p);
    }
  }

  /** Push the hit capsules onto the animated skeleton. */
  syncHitboxes() {
    if (!this.alive) return;
    const an = this.animator;
    for (let i = 0; i < this.colliders.length; i++) {
      const c = this.colliders[i];
      const { a, b } = c.userData;
      an.bonePos(a, this._boneA);
      an.bonePos(b, this._boneB);
      c.setSegment(
        this._boneA.x, this._boneA.y, this._boneA.z,
        this._boneB.x, this._boneB.y, this._boneB.z
      );
    }
  }

  dispose() {
    this._endPeek();
    this._clearSearch();
    this.ai?.cover?.release(this.id);
    this.cover = null;
    if (this.controller) this.phys?.removeCharacter(this.controller);
    for (const c of this.colliders) this.phys?.removeCollider(c);
    this.colliders.length = 0;
    if (this.ragdoll) this.phys?.removeRagdoll(this.ragdoll);
    this.group.parent?.remove(this.group);
  }
}

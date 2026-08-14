import * as THREE from 'three';
import { Rng } from '../core/rng.js';
import { WeaponMaterials, ENV_OCCLUSION } from './materials.js';
import { Viewmodel } from './viewmodel.js';
import { ProjectileSim } from './ballistics.js';
import { WEAPON_DEFS, WEAPON_IDS, buildRecoilPattern, SPREAD_MODS } from './defs.js';
import { AmmoPickups } from './ammo-pickups.js';
import { grenadeMesh } from './grenade-mesh.js';
import { clamp, clamp01, lerp, damp, DEG } from './mathx.js';

const GRENADES_PER_LIFE = 2;
const GRENADES_MAX = 6; // bought at the market, +1 per pack
const GRENADE_FUSE = 2.35; // s — matches the AI throw
// M67-style blast: ~4 m kill radius, wounds out to 10 m. Shared with the AI
// grenades (ai/index.js imports these) so player and enemy blasts match.
export const GRENADE_RADIUS = 10; // m
export const GRENADE_DAMAGE = 250;
const GRENADE_SPEED = 15; // m/s — SHORT throw keeps roughly today's reach
const GRENADE_LONG_SPEED = 30; // m/s — LONG throw, over double the reach
const GRENADE_SHORT_UP = 1.2; // vertical bias (m/s) of the short toss
const GRENADE_LONG_UP = 2.6; // vertical bias (m/s) — a lofted arc, not a laser
const GRENADE_TICK_AT = 0.5; // s left on the fuse when the warning tick plays

/**
 * WEAPONS — weapon meshes, the first-person viewmodel rig, ADS, recoil, sway,
 * bob, reload/inspect animation and projectile ballistics.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * WHAT LIVES HERE
 *   geometry.js   hard-surface kit: chamfered boxes, lathes, extrusions,
 *                 Picatinny rail, M-LOK, knurling, screws, and the Assembly
 *                 that merges everything down to a handful of draw calls.
 *   parts.js      real firearm components built from published dimensions:
 *                 receivers, barrels, muzzle devices, handguards, stocks,
 *                 grips, magazines, optics, iron sights, triggers.
 *   models/*.js   the three weapons assembled from those parts.
 *   hands.js      gloved hands + sleeved arms, two-bone IK from the hand.
 *   viewmodel.js  the animation stack (sway/bob/lag/recoil/ADS/clips).
 *   clips.js      keyframed reload / inspect / draw timelines.
 *   ballistics.js travelling projectiles with gravity and drag.
 *   defs.js       every tuning number, plus the deterministic recoil patterns.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * PUBLIC API — `const wp = ctx.get('weapons')`
 * ────────────────────────────────────────────────────────────────────────────
 *   wp.current            { id, label, class, mode, magSize, ... } (the def)
 *   wp.ammo               { mag, chambered, reserve, magSize, total, empty }
 *   wp.fireMode           'auto' | 'burst' | 'semi'
 *   wp.spreadDegrees      live cone half-angle — drive the crosshair gap with it
 *   wp.adsProgress        0..1
 *   wp.reloading / wp.firing / wp.switching / wp.inspecting
 *   wp.weaponIds          owned weapons only (spawn: rifle/smg/pistol)
 *   wp.setWeapon(id)      draw/holster animated swap
 *   wp.nextWeapon()
 *   wp.cycleFireMode()
 *   wp.reload()           no-op if full or empty of reserve
 *   wp.inspect()
 *   wp.tryFire()          honours fire mode + rpm; returns true if a shot left
 *   wp.viewmodel          the rig (fx/ui may read muzzle/eject transforms)
 *   wp.muzzleWorld(v3)    world-space muzzle, for anything that needs it
 *   wp.debugPose(kind)    'idle' | 'ads' | 'fire'  (the capture harness)
 *   wp.stats              { tris, drawCalls, live, fired }
 *
 * EVENTS EMITTED  (all canonical, see ARCHITECTURE.md)
 *   weapon:fire    { weapon, origin, dir, seed }
 *   weapon:shell   { position, velocity }
 *   weapon:reload  { weapon, phase: 'start'|'magout'|'magin'|'end' }
 *   bullet:tracer  { from, to, speed }
 * `bullet:impact` comes from physics, because physics owns penetration.
 * Anything else (ammo counts, fire mode, the current weapon) is a getter on
 * this object rather than an event, so no new event types are introduced.
 */
export class WeaponSystem {
  static id = 'weapons';
  static deps = ['materials', 'physics', 'models'];

  constructor() {
    this.viewmodel = null;
    this.sim = null;
    this.pickups = null;
    this.states = new Map();
    /** Primary-slot ownership: the LMG is a market purchase that replaces the
     *  rifle, so the spawn loadout is rifle/smg/pistol — no 4th slot. */
    this.owned = new Set(['rifle', 'smg', 'pistol']);
    this.activeId = 'rifle';
    this.debugMode = null;
    this.disabled = false;

    this._fireTimer = 0;
    this._burstLeft = 0;
    this._burstCooldown = 0;
    this._semiLatch = false;
    this._spread = 0;
    this._shotIndex = 0;
    this._sinceShot = 10;
    this._switchTimer = 0;
    this._switchTo = null;
    this._reloadPhase = null;

    this._muzzle = new THREE.Vector3();
    this._dir = new THREE.Vector3();
    this._right = new THREE.Vector3();
    this._up = new THREE.Vector3();
    this._tmp = new THREE.Vector3();
    this._camDir = new THREE.Vector3();
    this._firePayload = { weapon: null, origin: new THREE.Vector3(), dir: new THREE.Vector3(), seed: 0 };
    this._reloadPayload = { weapon: null, phase: 'start' };
    // `weapon:shell` carries the canonical { position, velocity } plus the real
    // case dimensions and a spin, so fx can size and tumble the brass instead of
    // guessing: a 9x19 case is less than half the length of a 5.56x45 one.
    this._shellPayload = {
      position: new THREE.Vector3(),
      velocity: new THREE.Vector3(),
      weapon: null,
      caseLen: 0.0446,
      caseRadius: 0.00495,
      spin: 0,
    };
    this._pendingShots = 0;
    this._pendingFirst = false;

    // Deferred shell ejections (a case leaves the port a few ms after the shot).
    this._shellQueue = [];
    for (let i = 0; i < 8; i++) {
      this._shellQueue.push({ t: -1, pos: new THREE.Vector3(), vel: new THREE.Vector3() });
    }
    this._droppedMags = [];
    this._grenades = []; // live thrown grenades: { body, mesh, fuse }
    this.grenades = GRENADES_PER_LIFE;
    /** Grenade in the hand: G drew it, the weapon is stowed. Equipping is
     *  free — stowing (G again, or a weapon switch) spends nothing. */
    this.grenadeEquipped = false;
    /** A mouse button is held; the fuse burns. `_cookButton` is the button
     *  that started it ('left' | 'right'); releasing it commits the throw. */
    this.cooking = false;
    this._cookButton = null;
    this._throwType = 'long'; // decided by the button at cook start
    this._cookTime = 0;
    this._cookTicked = false;
    this._throwing = false; // release accepted; arm anim in flight
    this._throwReleased = false; // release beat fired: the grenade is out
    this._throwFuse = 0; // fuse decided at release, spent at the release beat
    this._throwPos = new THREE.Vector3();
    this._boomPos = new THREE.Vector3();
    this._state = {
      ads: false,
      sprint: false,
      lowReady: false,
      speed: 0,
      crouch: false,
      airborne: false,
      trigger: false,
      empty: false,
    };
    // Preallocated HUD snapshot handed to `ui` (see getHudState).
    this._hudState = {
      name: '', mode: 'auto', ammo: 0, reserve: 0, magSize: 0,
      reloading: false, reloadProgress: 0, ads: false, spread: 0, firing: false,
      lethalCount: GRENADES_PER_LIFE, cooking: false, grenadeEquipped: false,
    };
  }

  /* ====================================================================== */
  /*  init                                                                  */
  /* ====================================================================== */

  async init(ctx) {
    this.ctx = ctx;
    this.rng = ctx.rng.fork();
    this.mats = new WeaponMaterials(ctx);
    this.sim = new ProjectileSim(ctx);
    this.viewmodel = new Viewmodel(ctx, this.mats);
    // three only honours `material.envMapIntensity` when the material carries its
    // OWN `envMap`; for a material lit by `scene.environment` the renderer
    // overwrites that uniform with `scene.environmentIntensity` every frame
    // (WebGLRenderer.setProgram, the isMeshStandardMaterial branch). The
    // viewmodel is drawn from its own scene, so ENV_OCCLUSION — how much of the
    // sky a shouldered weapon actually sees, see materials.js — has to be
    // expressed there or it is silently a no-op.
    ctx.viewScene.environmentIntensity = ENV_OCCLUSION;
    this.viewmodel.onClipEvent = (name, clip) => this._onClipEvent(name, clip);

    const t0 = performance.now();
    const models = ctx.get('models');
    let tris = 0;
    // Fetch every GLB in parallel; the loader cache makes repeats free.
    const ids = WEAPON_IDS;
    const records = await Promise.all(ids.map((id) => models.getWeapon(id)));
    for (let i = 0; i < ids.length; i++) {
      const id = ids[i];
      const def = { ...WEAPON_DEFS[id] };
      def.cycleTime = 60 / def.rpm;
      const entry = this.viewmodel.addWeapon(records[i], def);
      tris += entry.tris;
      this.states.set(id, {
        def,
        pattern: buildRecoilPattern(def, Rng),
        mag: def.magSize,
        chambered: true,
        reserve: def.reserve,
        mode: def.modes[0],
        modeIndex: 0,
      });
    }
    this.viewmodel.setActive(this.activeId);
    this.viewmodel.play('draw');
    this.pickups = new AmmoPickups(this);

    // Player hooks (all optional: the viewmodel works standalone).
    this.player = ctx.peek('player');
    this.fx = ctx.peek('fx');
    this.physics = ctx.peek('physics');
    this.audio = ctx.peek('audio');
    this.ui = ctx.peek('ui');
    this._off = [];
    this._off.push(
      ctx.events.on('player:land', (e) => this.viewmodel.land(Math.abs(e?.velocity ?? 3)))
    );
    this._off.push(ctx.events.on('player:jump', () => this.viewmodel.jump()));
    this._off.push(ctx.events.on('player:death', () => this._onPlayerDeath()));
    this._off.push(
      ctx.events.on('player:respawn', () => {
        this.cooking = false;
        this._cookButton = null;
        this._cookTime = 0;
        this._throwing = false;
        this._throwReleased = false;
        this.grenadeEquipped = false;
        this.grenades = GRENADES_PER_LIFE;
        this.viewmodel?.endGrenade();
        this.ui?.clearPrompt?.();
        this._setDeathDisabled(false);
      })
    );
    this._off.push(ctx.events.on('actor:death', (e) => this.pickups.onActorDeath(e)));
    this._off.push(ctx.events.on('game:restart', () => this.resetForNewGame()));

    this.stats = { tris, drawCalls: 0, live: 0, fired: 0 };
    console.info(
      `[weapons] ${this.states.size} weapons · ${(tris / 1000).toFixed(1)}k tris viewmodel · ` +
        `loaded in ${(performance.now() - t0).toFixed(0)}ms`
    );
  }

  /* ====================================================================== */
  /*  public getters                                                        */
  /* ====================================================================== */

  get state() {
    return this.states.get(this.activeId);
  }

  get current() {
    return this.state?.def ?? null;
  }

  get weaponIds() {
    return WEAPON_IDS.filter((id) => this.owned.has(id));
  }

  /** Buy grenades at the market: +n up to the cap. */
  addGrenades(n) {
    this.grenades = Math.min(GRENADES_MAX, this.grenades + n);
  }

  /** True when the player owns `id` — non-owned weapons can't be drawn. */
  owns(id) {
    return this.owned.has(id);
  }

  /** Market: buy a primary weapon (rifle ↔ lmg), replacing the other in the
   *  primary slot and equipping it immediately. Fresh purchase, fresh ammo. */
  equipPrimary(id) {
    if ((id !== 'rifle' && id !== 'lmg') || this.owned.has(id)) return false;
    this.owned.delete(id === 'rifle' ? 'lmg' : 'rifle');
    this.owned.add(id);
    const s = this.states.get(id);
    if (s) {
      s.mag = s.def.magSize;
      s.chambered = true;
      s.reserve = s.def.reserve;
    }
    this.setWeaponImmediate(id);
    return true;
  }

  /** Fraction 0..1 of total reserve ammo left across owned weapons (market). */
  ammoFraction() {
    let have = 0, max = 0;
    this.states.forEach((s, id) => {
      if (!this.owned.has(id)) return;
      have += s.reserve;
      max += s.def.reserve;
    });
    return max > 0 ? have / max : 1;
  }

  /** Market: top every owned weapon's reserve back to full. */
  refillAmmo() {
    this.states.forEach((s, id) => {
      if (this.owned.has(id)) s.reserve = s.def.reserve;
    });
  }

  get ammo() {
    const s = this.state;
    if (!s) return { mag: 0, chambered: false, reserve: 0, magSize: 0, total: 0, empty: true };
    const mag = s.mag;
    const ch = s.chambered ? 1 : 0;
    return {
      mag: mag + ch,
      inMag: mag,
      chambered: s.chambered,
      reserve: s.reserve,
      magSize: s.def.magSize,
      total: mag + ch + s.reserve,
      empty: mag + ch === 0,
    };
  }

  get fireMode() {
    return this.state?.mode ?? 'semi';
  }

  get adsProgress() {
    return this.viewmodel?.adsT ?? 0;
  }

  get reloading() {
    const n = this.viewmodel?.clipName;
    return n === 'reloadTac' || n === 'reloadEmpty';
  }

  get inspecting() {
    return this.viewmodel?.clipName === 'inspect';
  }

  get switching() {
    return this._switchTo !== null;
  }

  get firing() {
    return this._sinceShot < 0.12;
  }

  /** Current spread cone half-angle in degrees — the crosshair should use this. */
  get spreadDegrees() {
    return this._spread;
  }

  muzzleWorld(out) {
    return this.viewmodel.muzzleWorld(out ?? this._tmp);
  }

  /**
   * HUD adapter polled by `ui` every lateUpdate. Shape is fixed by the contract
   * documented at the top of src/ui/index.js; the object is preallocated and
   * mutated in place because `ui` reads it once per frame and never keeps it.
   */
  getHudState() {
    const h = this._hudState;
    const s = this.state;
    if (!s) return h;
    const a = this.ammo;
    const vm = this.viewmodel;
    h.name = s.def.label ?? s.def.id;
    h.mode = s.mode;
    // `a.mag` counts the chambered round, so a topped-off rifle is 31. The HUD
    // draws one pip per round against magSize, so clamp the *display* to the
    // magazine capacity rather than overflowing the pip strip.
    h.ammo = Math.min(a.mag, a.magSize);
    h.reserve = a.reserve;
    h.magSize = a.magSize;
    h.reloading = this.reloading;
    // 0..1 through the active reload clip; the bar is meaningless otherwise.
    h.reloadProgress = h.reloading && vm?.clip?.duration
      ? Math.min(1, vm.clipT / vm.clip.duration)
      : 0;
    h.ads = (vm?.adsT ?? 0) > 0.5;
    // `ui` maps this to reticle bloom as 4 + spread * 40 px, so hand it a
    // normalised 0..1 rather than raw degrees.
    h.spread = Math.min(1, Math.max(0, this._spread / 6));
    h.firing = this.firing;
    h.lethalCount = this.grenades;
    h.cooking = this.cooking;
    h.grenadeEquipped = this.grenadeEquipped;
    return h;
  }

  /* ====================================================================== */
  /*  weapon management                                                     */
  /* ====================================================================== */

  /** Add rounds to reserve without bypassing the weapon's authored cap. */
  addReserve(amount, id = this.activeId) {
    const s = this.states.get(id);
    if (!s || amount <= 0) return 0;
    const before = s.reserve;
    s.reserve = Math.min(s.def.reserve, s.reserve + Math.floor(amount));
    return s.reserve - before;
  }

  /** Reset the complete loadout and transient combat state for a fresh run. */
  resetForNewGame() {
    for (const s of this.states.values()) {
      s.mag = s.def.magSize;
      s.chambered = true;
      s.reserve = s.def.reserve;
      s.modeIndex = 0;
      s.mode = s.def.modes[0];
    }
    this.disabled = false;
    this._fireTimer = 0;
    this._burstLeft = 0;
    this._burstCooldown = 0;
    this._semiLatch = false;
    this._spread = 0;
    this._shotIndex = 0;
    this._sinceShot = 10;
    this._pendingShots = 0;
    this._switchTo = null;
    this.sim?.clear();
    this.pickups?.clear();
    this.grenades = GRENADES_PER_LIFE;
    this.grenadeEquipped = false;
    this.cooking = false;
    this._cookButton = null;
    this._cookTime = 0;
    this._throwing = false;
    this._throwReleased = false;
    this.ui?.clearPrompt?.();
    this.viewmodel?.endGrenade();
    this._clearGrenades();
    for (const p of this._droppedMags) {
      p.group.visible = false;
      if (p.body && this.physics?.removeRigidBody) this.physics.removeRigidBody(p.body);
      p.body = null;
      p.until = 0;
    }
    this.owned = new Set(['rifle', 'smg', 'pistol']);
    this.activeId = 'rifle';
    if (this.viewmodel) {
      this.viewmodel.anchor.visible = true;
      this.viewmodel.stopClip();
      this.viewmodel.setActive(this.activeId);
      this.viewmodel.boltHold = 0;
      this.viewmodel.adsT = 0;
      this.viewmodel.adsTarget = 0;
      this.viewmodel.play('draw');
    }
  }

  setWeapon(id) {
    if (this.disabled || !this.owned.has(id) || id === this.activeId || this._switchTo) return false;
    if (this.cooking || this._throwing) return false; // committed to the throw — no mid-throw swap
    if (this.grenadeEquipped) this._stowGrenade(); // swapping away stows the grenade, unspent
    this._switchTo = id;
    this._switchTimer = this.viewmodel.play('holster');
    return true;
  }

  nextWeapon() {
    const ids = this.weaponIds;
    const i = ids.indexOf(this.activeId);
    return this.setWeapon(ids[(i + 1) % ids.length]);
  }

  cycleFireMode() {
    const s = this.state;
    if (this.disabled || !s || s.def.modes.length < 2) return s?.mode;
    s.modeIndex = (s.modeIndex + 1) % s.def.modes.length;
    s.mode = s.def.modes[s.modeIndex];
    this._burstLeft = 0;
    return s.mode;
  }

  reload() {
    const s = this.state;
    if (this.disabled || !s || this.reloading || this.switching) return false;
    if (this.cooking) return false; // both hands are on the grenade
    if (this.grenadeEquipped) return false; // the weapon is stowed, not in reach
    if (s.mag >= s.def.magSize || s.reserve <= 0) return false;
    this.viewmodel.stopClip();
    const empty = s.mag === 0 && !s.chambered;
    this.viewmodel.play(empty ? 'reloadEmpty' : 'reloadTac');
    this._pendingReloadEmpty = empty;
    return true;
  }

  inspect() {
    if (this.disabled || this.reloading || this.switching || this.inspecting) return false;
    if (this.cooking) return false;
    if (this.grenadeEquipped) return false;
    this.viewmodel.play('inspect');
    return true;
  }

  /* ====================================================================== */
  /*  firing                                                                */
  /* ====================================================================== */

  canFire() {
    const s = this.state;
    if (this.disabled || this.player?.dead === true || !s) return false;
    if (this.reloading || this.switching) return false;
    if (this.cooking) return false; // grenade in hand, not the rifle
    if (this.grenadeEquipped) return false; // weapon is stowed — LMB cooks instead
    if (this._fireTimer > 0) return false;
    return s.chambered;
  }

  /** One round leaves the barrel. Returns false if the trigger clicked dry. */
  tryFire() {
    const s = this.state;
    if (this.disabled || this.player?.dead === true || !s) return false;
    if (this.reloading || this.switching || this._fireTimer > 0) return false;
    if (this.grenadeEquipped) return false; // weapon stowed — no firing through the grenade
    if (!s.chambered) {
      // Dry: lock the bolt back and let the player know by feel.
      this.viewmodel.boltHold = 1;
      this._fireTimer = 0.25;
      return false;
    }
    if (this.inspecting) this.viewmodel.stopClip();

    const def = s.def;
    const first = this._sinceShot > 0.35;
    // ---- feed the next round ----
    s.chambered = false;
    if (s.mag > 0) {
      s.mag--;
      s.chambered = true;
    } else {
      this.viewmodel.boltHold = 1;
    }

    // ---- deterministic recoil pattern ----
    const idx = Math.min(this._shotIndex, def.recoil.patternLength - 1);
    const pitch = s.pattern[idx * 2];
    const yaw = s.pattern[idx * 2 + 1];
    this._shotIndex++;

    // ---- aim: camera forward + a spread cone ----
    const cam = this.ctx.camera;
    cam.updateMatrixWorld();
    this._camDir.set(0, 0, -1).applyQuaternion(cam.quaternion).normalize();
    this._dir.copy(this._camDir);
    const spreadRad = this._spread * DEG;
    if (spreadRad > 1e-5) {
      const d = this.rng.disc(this._disc ?? (this._disc = { x: 0, y: 0 }));
      this._right.set(1, 0, 0).applyQuaternion(cam.quaternion);
      this._up.set(0, 1, 0).applyQuaternion(cam.quaternion);
      this._dir
        .addScaledVector(this._right, Math.tan(spreadRad) * d.x)
        .addScaledVector(this._up, Math.tan(spreadRad) * d.y)
        .normalize();
    }

    // ---- projectile ----
    this.viewmodel.muzzleWorld(this._muzzle);
    const seed = this.rng.u32();
    this.sim.spawn({
      origin: this._muzzle,
      dir: this._dir,
      speed: def.muzzleVelocity,
      damage: def.damage,
      penetration: def.penetration,
      dragK: def.dragK,
      dropoff: def.dropoff,
      maxRange: def.maxRange,
      weapon: def,
      tracer: this.stats.fired % def.tracerEvery === 0,
    });

    // ---- feedback ----
    this.viewmodel.addRecoil(pitch, yaw, first);
    const p = this.player;
    if (p?.addRecoil) {
      // Support scales learnable sightline movement, not random spread.
      const recoil = def.recoil;
      let brace = lerp(1, recoil.adsScale, this.adsProgress);
      if (this._state.crouch) brace *= recoil.crouchScale;
      if (this._state.airborne) brace *= 1.25;
      // Roll follows the horizontal impulse instead of always tipping the same
      // way. Near the centreline, alternate it so a straight pattern still has
      // a small mechanical reaction without turning into random camera shake.
      const rollSide = Math.abs(yaw) > 1e-5 ? Math.sign(yaw) : (idx & 1 ? -1 : 1);
      p.addRecoil(
        pitch * brace,
        yaw * brace,
        rollSide * recoil.roll * 0.24 * brace,
        recoil.punch * brace
      );
    }
    this._spread = Math.min(def.spreadMax, this._spread + def.spreadPerShot);
    this._fireTimer = 60 / def.rpm;
    this._sinceShot = 0;
    this.stats.fired++;
    this._pendingShots++;
    this._pendingFirst = this._pendingFirst || first;
    this._fireSeed = seed;

    // Shell leaves the port shortly after the shot, once the bolt is back.
    this._queueShell(Math.min(0.05, this._fireTimer * 0.45));
    return true;
  }

  _queueShell(delay) {
    for (const q of this._shellQueue) {
      if (q.t < 0) {
        q.t = delay;
        return q;
      }
    }
    return null;
  }

  /* ====================================================================== */
  /*  reload / clip callbacks                                               */
  /* ====================================================================== */

  _onClipEvent(name, clipName) {
    const s = this.state;
    const isReload = clipName === 'reloadTac' || clipName === 'reloadEmpty';
    switch (name) {
      case 'start':
        if (isReload) this._emitReload('start');
        break;
      case 'magout':
        if (isReload) this._emitReload('magout');
        break;
      case 'magdrop':
        if (isReload) this._dropMagazine();
        break;
      case 'magin':
        if (isReload) {
          this._emitReload('magin');
          this._completeReload(clipName === 'reloadEmpty');
        }
        break;
      case 'boltrelease':
        this.viewmodel.boltHold = 0;
        break;
      case 'grenade:release':
        // The arm reached the release beat: the grenade is actually out. The
        // throw stays committed (`_throwing`) until grenade:done so a
        // follow-through click cannot recook and a weapon switch cannot
        // cancel the spent grenade mid-flight. Idempotent: no-op when the
        // release was already forced (market swap / death) so a late beat
        // cannot spawn a second grenade from the same spent throw.
        if (!this._throwing || this._throwReleased) break;
        this._throwReleased = true;
        this._throwGrenade(this._throwFuse, this._throwType);
        break;
      case 'grenade:done':
        // The throw finished and the rifle came back up. Unwind the throw
        // state and clear the cook latch defensively: nothing may leave
        // `cooking` set once the grenade is out of the hand.
        this._throwing = false;
        this._throwReleased = false;
        this.grenadeEquipped = false;
        this.cooking = false;
        this._cookButton = null;
        this._cookTime = 0;
        this._cookTicked = false;
        this.ui?.clearPrompt?.();
        break;
      case 'end':
        if (isReload) {
          this._emitReload('end');
          this.viewmodel.boltHold = 0;
        }
        if (clipName === 'holster' && this._switchTo) {
          this.activeId = this._switchTo;
          this._switchTo = null;
          this.viewmodel.setActive(this.activeId);
          this.viewmodel.play('draw');
          this._shotIndex = 0;
          this._spread = 0;
        }
        break;
      default:
        break;
    }
  }

  /**
   * The chambered-round model: a tactical reload keeps the round in the chamber
   * and gives you magSize+1; an empty reload has to feed one out of the fresh
   * magazine, so you end up with exactly magSize.
   */
  _completeReload(empty) {
    const s = this.state;
    if (!s) return;
    const want = s.def.magSize - s.mag;
    const take = Math.min(want, s.reserve);
    s.reserve -= take;
    s.mag += take;
    if (empty && !s.chambered && s.mag > 0) {
      s.mag--;
      s.chambered = true;
    }
    this._shotIndex = 0;
  }

  _emitReload(phase) {
    this._reloadPayload.weapon = this.current;
    this._reloadPayload.phase = phase;
    this.ctx.events.emit('weapon:reload', this._reloadPayload);
  }

  /** Spawn the discarded magazine as a real rigid body in the world. */
  _dropMagazine() {
    const phys = this.physics ?? (this.physics = this.ctx.peek('physics'));
    const w = this.viewmodel.active;
    if (!w) return;
    const proxy = this._magProxy(w);
    if (!proxy) return;
    const mag = w.parts.magazine;
    mag.updateMatrixWorld();
    proxy.group.position.setFromMatrixPosition(mag.matrixWorld);
    proxy.group.quaternion.setFromRotationMatrix(mag.matrixWorld);
    proxy.group.visible = true;
    // Magazine geometry hangs below its origin, so bias the body centre down.
    const half = w.magLen * 0.45;
    proxy.group.position.y -= half * 0.4;

    const vel = this._tmp.set(0, -0.7, 0);
    const pv = this.player?.velocity;
    if (pv) vel.add(pv);
    vel.x += this.rng.signed() * 0.25;
    vel.z += this.rng.signed() * 0.25;

    if (phys?.spawnDebris) {
      proxy.body = phys.spawnDebris(proxy.group.position, vel, {
        size: Math.max(0.02, w.magLen * 0.28),
        surface: 'rubber',
        mass: 0.38,
        lifetime: 22,
        restitution: 0.18,
        object3D: proxy.group,
      });
      proxy.until = this.ctx.time.elapsed + 22;
    } else {
      proxy.until = this.ctx.time.elapsed + 2;
    }
  }

  /** Two reusable world-space magazine props per weapon. */
  _magProxy(w) {
    if (!this._magPools) this._magPools = new Map();
    let pool = this._magPools.get(w.id);
    if (!pool) {
      pool = [];
      for (let i = 0; i < 2; i++) {
        const group = new THREE.Object3D();
        group.name = `dropped-mag-${w.id}-${i}`;
        group.visible = false;
        // Share the viewmodel's geometry and materials; the world copy needs no
        // resources of its own.
        w.parts.magazine.traverse((o) => {
          if (o.isMesh) {
            const m = new THREE.Mesh(o.geometry, o.material);
            m.position.copy(o.position);
            m.quaternion.copy(o.quaternion);
            m.castShadow = true;
            group.add(m);
          }
        });
        this.ctx.scene.add(group);
        pool.push({ group, body: null, until: 0 });
        this._droppedMags.push(pool[i]);
      }
      this._magPools.set(w.id, pool);
    }
    // Reuse the oldest.
    let best = pool[0];
    for (const p of pool) if (p.until < best.until) best = p;
    if (best.body && this.physics?.removeRigidBody) this.physics.removeRigidBody(best.body);
    best.body = null;
    return best;
  }

  /* ====================================================================== */
  /*  frame                                                                 */
  /* ====================================================================== */

  _setDeathDisabled(on) {
    this.disabled = !!on;
    if (!this.viewmodel) return;
    this.viewmodel.anchor.visible = !this.disabled;
    if (this.disabled) {
      this._burstLeft = 0;
      this._pendingShots = 0;
      this._semiLatch = false;
      this._state.ads = false;
      this._state.trigger = false;
      this.viewmodel.adsTarget = 0;
      this.viewmodel.stopClip();
    }
  }

  fixedUpdate(h) {
    this.sim.fixedUpdate(h);
  }

  /* ====================================================================== */
  /*  grenades                                                              */
  /* ====================================================================== */

  /**
   * Grenade flow: G equips the grenade (weapon stowed). While it is in hand,
   * LMB cooks and throws LONG, RMB cooks and throws SHORT. The fuse burns only
   * while a mouse button is held — releasing commits the throw with whatever
   * fuse is left. Overcooking detonates in your hand. Equipping is free:
   * pressing G again (or switching weapons) stows the grenade unspent, so the
   * G key never throws — it only arms and stows.
   */
  _updateGrenade(dt, input, live) {
    if (!live) return; // death drops the grenade via its own listener

    // G toggles the grenade in and out of the hand.
    if (input.actionPressed('grenade')) {
      if (this.cooking || this._throwing || this.switching) return; // hands are busy
      if (this.grenadeEquipped) {
        this._stowGrenade();
        return;
      }
      if (this.grenades > 0) {
        this.grenadeEquipped = true;
        // Arming interrupts a reload in progress, like a weapon switch does.
        if (this.reloading) this.viewmodel?.stopClip();
        this.viewmodel?.holdGrenade();
        this.ui?.setPrompt?.({
          key: 'LMB', text: 'LONG THROW', sub: 'RMB SHORT THROW · G STOWS',
        });
      }
      return;
    }
    if (this._throwing) return;
    if (!this.grenadeEquipped) return;

    // A mouse button starts the cook; releasing it commits the throw.
    if (!this.cooking) {
      if (input.firePressed) this._startCook('long');
      else if (input.pressed('Mouse2')) this._startCook('short');
      return;
    }
    this._cookTime += dt;
    if (this._cookTime >= GRENADE_FUSE) {
      // Overcooked: it goes off in your hand.
      this.cooking = false;
      this._cookButton = null;
      this._cookTime = 0;
      this.grenadeEquipped = false;
      this.viewmodel?.endGrenade();
      this.ui?.clearPrompt?.();
      this.ctx.events.emit('explosion', {
        position: this._boomPos.copy(this._throwOrigin()),
        radius: GRENADE_RADIUS,
        damage: GRENADE_DAMAGE,
        source: this.player,
      });
      return;
    }
    const cookCode = this._cookButton === 'right' ? 'Mouse2' : 'Mouse0';
    if (!input.held(cookCode)) {
      // Released: the arm throws; the grenade leaves at the release beat.
      const fuse = GRENADE_FUSE - this._cookTime;
      this.cooking = false;
      this._cookButton = null;
      this._cookTime = 0;
      this._throwing = true;
      this._throwFuse = fuse;
      this.viewmodel?.throwGrenade(this._throwType);
      return;
    }
    if (!this._cookTicked && GRENADE_FUSE - this._cookTime <= GRENADE_TICK_AT) {
      this._cookTicked = true;
      this.audio?.playUi?.('grenade_tick', 0.9);
    }
  }

  /** Pull the pin and start the fuse — the moment the grenade is spent. */
  _startCook(type) {
    if (this.grenades <= 0) return;
    this.cooking = true;
    this._throwType = type;
    this._cookButton = type === 'short' ? 'right' : 'left';
    this._cookTime = 0;
    this._cookTicked = false;
    this.grenades--;
    this.audio?.playUi?.('grenade_pin', 0.9);
  }

  /** Stow the equipped grenade back into the pouch, unspent and unthrown. */
  _stowGrenade() {
    if (!this.grenadeEquipped) return;
    this.grenadeEquipped = false;
    this.viewmodel?.endGrenade();
    this.ui?.clearPrompt?.();
  }

  /** Eye position pushed a little along the view; the grenade leaves from here. */
  _throwOrigin() {
    const player = this.player ?? (this.player = this.ctx.peek('player'));
    const eye = player?.eyePosition ?? this.ctx.camera.position;
    const fwd = player?.forward;
    this._throwPos.copy(eye);
    if (fwd) this._throwPos.addScaledVector(fwd, 0.4);
    this._throwPos.y -= 0.05;
    return this._throwPos;
  }

  /** Add a live grenade to the world with the shared rigid-body setup. */
  _spawnGrenade(position, velocity, fuse) {
    const mesh = grenadeMesh();
    this.ctx.scene.add(mesh);
    const body = this.physics?.addRigidBody?.({
      shape: 'sphere',
      radius: 0.05,
      mass: 0.42,
      position,
      velocity,
      restitution: 0.28,
      friction: 0.7,
      lifetime: 9,
      object3D: mesh,
      surfaceType: 'metal',
    });
    this._grenades.push({ body, mesh, fuse });
  }

  /** Launch a live grenade from the hand at the release beat. The long throw
   *  is a full-power heave (double today's reach), the short throw a compact
   *  toss that lands about where the old G-throw did. */
  _throwGrenade(fuse, type = 'long') {
    const player = this.player ?? (this.player = this.ctx.peek('player'));
    const fwd = player?.forward ?? { x: 0, y: 0, z: -1 };
    const vel = player?.velocity;
    const long = type !== 'short';
    const speed = long ? GRENADE_LONG_SPEED : GRENADE_SPEED;
    const up = long ? GRENADE_LONG_UP : GRENADE_SHORT_UP;
    const at = this.viewmodel?.grenadeReleaseWorld
      ? this.viewmodel.grenadeReleaseWorld(this._throwPos)
      : this._throwOrigin();
    this._spawnGrenade(at, {
      x: fwd.x * speed + (vel?.x ?? 0) * 0.6,
      y: fwd.y * speed + up,
      z: fwd.z * speed + (vel?.z ?? 0) * 0.6,
    }, fuse);
    player?.addTrauma?.(long ? 0.11 : 0.05);
    this.audio?.playUi?.('grenade_throw', long ? 0.8 : 0.6);
  }

  /** Dying with a live grenade in hand drops it, still cooking, at your feet. */
  _dropCookedGrenade() {
    if (!this.cooking) return;
    this.cooking = false;
    const fuse = Math.max(0.05, GRENADE_FUSE - this._cookTime);
    this._cookTime = 0;
    this.viewmodel?.endGrenade();
    const player = this.player ?? (this.player = this.ctx.peek('player'));
    const at = player?.feetPosition ?? this.ctx.camera.position;
    this._spawnGrenade(at, {
      x: this.rng.signed() * 0.4,
      y: 1,
      z: this.rng.signed() * 0.4,
    }, fuse);
  }

  /** Death: a cooking grenade drops and cooks; a committed throw (pin pulled,
   *  arm mid-swing) releases where it is so the spent grenade does not vanish;
   *  a stowed one stays safe in the pouch. Never `endGrenade()` a committed
   *  throw without releasing it — the release beat must fire exactly once. */
  _onPlayerDeath() {
    // A live grenade in your hand is a live grenade: it drops and cooks.
    this._dropCookedGrenade();
    // A committed throw must not be cancelled: if the release beat had not
    // fired yet, release the grenade now so it lands near the body.
    if (this._throwing) {
      if (!this._throwReleased) this._throwGrenade(this._throwFuse, this._throwType);
      this._throwing = false;
      this._throwReleased = true; // the grenade is out — a late beat is a no-op
    }
    // Equipped but not cooking: back to the pouch, safe and unspent.
    this._stowGrenade();
    this._setDeathDisabled(true);
  }

  /** Fuse countdown for every live grenade; detonation emits `explosion`. */
  _updateGrenades(dt) {
    for (let i = this._grenades.length - 1; i >= 0; i--) {
      const g = this._grenades[i];
      g.fuse -= dt;
      if (g.fuse > 0) continue;
      const p = g.body?.position ?? g.mesh.position;
      this.ctx.events.emit('explosion', {
        position: this._boomPos.copy(p),
        radius: GRENADE_RADIUS,
        damage: GRENADE_DAMAGE,
        source: this.player,
      });
      if (g.body && this.physics?.removeRigidBody) this.physics.removeRigidBody(g.body);
      g.mesh.removeFromParent();
      this._grenades.splice(i, 1);
    }
  }

  _clearGrenades() {
    for (const g of this._grenades) {
      if (g.body && this.physics?.removeRigidBody) this.physics.removeRigidBody(g.body);
      g.mesh.removeFromParent();
    }
    this._grenades.length = 0;
  }

  update(dt, ctx) {
    const s = this.state;
    if (!s) return;
    const def = s.def;
    const input = ctx.input;
    const player = this.player ?? (this.player = ctx.peek('player'));
    const st = this._state;

    this._updateGrenades(dt);

    this._sinceShot += dt;
    if (this._fireTimer > 0) this._fireTimer -= dt;
    if (this._burstCooldown > 0) this._burstCooldown -= dt;

    // ---- spread recovery -------------------------------------------------
    const rest = this._restSpread(def, player, st);
    this._spread = Math.max(rest, this._spread - def.spreadDecay * dt * (1 + this.adsProgress));
    if (this._sinceShot > 0.6) this._shotIndex = 0;

    // ---- gather state ----------------------------------------------------
    const live =
      !this.disabled && player?.dead !== true && player?.controlEnabled !== false &&
      !input.frozen && input.enabled !== false && this.debugMode === null;
    st.ads = live ? (input.ads || player?.adsRequested === true) && !this.cooking && !this.grenadeEquipped : this.debugMode === 'ads';
    st.sprint = live ? player?.sprinting === true && this._sinceShot > 0.3 : false;
    st.speed = player?.horizontalSpeed ?? player?.speed ?? 0;
    st.crouch = player?.stance === 'crouch';
    st.airborne = player?.airborne === true;
    st.lowReady = player?.state === 'mantle' || player?.mantling === true;
    st.empty = s.mag === 0 && !s.chambered;

    // ---- input -----------------------------------------------------------
    if (live) {
      if (input.actionPressed('reload')) this.reload();
      if (input.pressed('KeyB')) this.cycleFireMode();
      if (input.pressed('KeyI')) this.inspect();
      if (input.pressed('Digit1')) this.setWeapon(this.owned.has('lmg') ? 'lmg' : 'rifle');
      if (input.pressed('Digit2')) this.setWeapon('smg');
      if (input.pressed('Digit3')) this.setWeapon('pistol');
      if (input.pressed('Tab')) this.nextWeapon();
      if (input.wheel) this.nextWeapon();
      this._runTrigger(dt, input.fire, input.firePressed, def, s);
      st.trigger = input.fire && this.canFire();
      // Auto-reload on a dry trigger pull, like every modern shooter.
      if (input.firePressed && st.empty) this.reload();
    } else if (this.debugMode && !this.disabled && player?.dead !== true) {
      this._runDebug(ctx);
      st.trigger = this._sinceShot < 0.09;
    } else {
      st.trigger = false;
    }

    // Push the ADS curve to the player so camera FOV / move speed follow it.
    player?.setAdsProgress?.(this.disabled ? 0 : this.viewmodel.adsT);
    this._updateGrenade(dt, input, live);
    this.pickups?.update(dt);

    this.stats.live = this.sim.stats.live;
    this.stats.fired = this.sim.stats.fired;
  }

  /** Fire-mode state machine. */
  _runTrigger(dt, held, pressed, def, s) {
    switch (s.mode) {
      case 'auto':
        if (held) this.tryFire();
        break;
      case 'burst':
        if (pressed && this._burstLeft === 0 && this._burstCooldown <= 0) {
          this._burstLeft = def.burstCount;
        }
        if (this._burstLeft > 0 && this._fireTimer <= 0) {
          if (this.tryFire()) {
            this._burstLeft--;
            this._fireTimer = 60 / def.burstRpm;
            if (this._burstLeft === 0) this._burstCooldown = def.burstDelay;
          } else {
            this._burstLeft = 0;
          }
        }
        break;
      default: // semi
        if (pressed) this.tryFire();
        break;
    }
  }

  _restSpread(def, player, st) {
    let base = lerp(def.spreadHip, def.spreadAds, this.adsProgress);
    if (st.crouch) base *= SPREAD_MODS.crouch;
    if (player?.stance === 'prone') base *= SPREAD_MODS.prone;
    if (st.speed < 0.4) base *= SPREAD_MODS.still;
    else if (st.speed > 3.2) base *= SPREAD_MODS.walking;
    if (st.sprint) base *= SPREAD_MODS.sprinting;
    if (st.airborne) base *= SPREAD_MODS.airborne;
    return base;
  }

  lateUpdate(dt, ctx) {
    const vm = this.viewmodel;
    if (!vm) return;
    vm.update(dt, this._state);

    // ---- muzzle flash / audio, now that the pose is final ---------------
    if (this._pendingShots > 0) {
      const def = this.current;
      vm.muzzleWorld(this._firePayload.origin);
      vm.boreDir(this._firePayload.dir);
      this._firePayload.weapon = def;
      this._firePayload.seed = this._fireSeed >>> 0;
      for (let i = 0; i < this._pendingShots; i++) {
        ctx.events.emit('weapon:fire', this._firePayload);
      }
      this._pendingShots = 0;
      this._pendingFirst = false;
    }

    // ---- deferred shell ejection ---------------------------------------
    for (const q of this._shellQueue) {
      if (q.t < 0) continue;
      q.t -= dt;
      if (q.t > 0) continue;
      q.t = -1;
      vm.ejectWorld(this._shellPayload.position);
      vm.ejectVelocity(this._shellPayload.velocity, 2.3 + this.rng.float() * 1.2);
      const pv = this.player?.velocity;
      if (pv) this._shellPayload.velocity.add(pv);
      this._shellPayload.velocity.y += 1.1;
      this._shellPayload.weapon = this.current;
      const shell = vm.active?.shell;
      this._shellPayload.caseLen = shell?.caseLen ?? 0.0446;
      this._shellPayload.caseRadius = shell?.rimR ?? 0.00495;
      this._shellPayload.spin = 28 + this.rng.float() * 34;
      ctx.events.emit('weapon:shell', this._shellPayload);
    }

    // ---- retire dropped magazines --------------------------------------
    if (this._droppedMags.length) {
      const now = ctx.time.elapsed;
      for (const p of this._droppedMags) {
        if (p.group.visible && p.until && now > p.until) {
          p.group.visible = false;
          if (p.body && this.physics?.removeRigidBody) {
            this.physics.removeRigidBody(p.body);
            p.body = null;
          }
        }
      }
    }
  }

  /* ====================================================================== */
  /*  capture harness                                                       */
  /* ====================================================================== */

  /**
   * Freeze the viewmodel in a photogenic state.
   * The harness applies a shot, then pumps `SETTLE` frames before grabbing the
   * frame, so 'fire' schedules a short burst that peaks right at the capture.
   */
  debugPose(kind = 'idle', opts = {}) {
    const vm = this.viewmodel;
    this.debugMode = kind;
    this.setWeaponImmediate('rifle');
    vm.stopClip();
    vm.recPos.reset();
    vm.recRot.reset();
    vm.settle.reset();
    vm.lag.reset();
    vm.lagRot.reset();
    vm.boltHold = 0;
    vm.boltCycle = 0;
    vm.sprintT = 0;
    vm.lowReadyT = 0;
    vm.bobPhase = 0;
    vm._angVel.yaw = 0;
    vm._angVel.pitch = 0;
    vm._hasPrev = false;
    // A fixed, non-zero noise phase: a settled but not artificially symmetric pose.
    vm.noiseT = 12.37;
    vm.debugFrozen = true;
    this._spread = kind === 'ads' ? 0.24 : 2.05;
    this._sinceShot = 10;
    this._debugFrame = 0;

    const s = this.state;
    if (s) {
      s.mag = kind === 'fire' ? 22 : s.def.magSize;
      s.chambered = true;
      s.reserve = s.def.reserve;
    }

    if (kind === 'ads') {
      vm.adsT = 1;
      this._state.ads = true;
    } else {
      vm.adsT = 0;
      this._state.ads = false;
    }
    this._state.sprint = false;
    this._state.speed = 0;
    this._state.trigger = false;
    // Frames (at the harness's fixed 60 Hz) on which to fire for the 'fire'
    // shot. The burst has to land at the END of the harness's settle window: a
    // flash core lives 52 ms (~3 frames), so the last rounds must leave the
    // barrel a frame or two before the grab or there is nothing to photograph.
    // `grabFrame` is how many frames the harness will pump — it is a CLI flag
    // (`--settle`), so it cannot be hard-coded here. The offsets below straddle
    // the grab because the harness pumps on its own rAF chain, which can land a
    // frame either side of the engine's.
    // A flash core lives 52 ms — about three frames at 60 Hz — while the exact
    // frame the shutter lands on is only known to within a handful of frames
    // (the harness pumps its settle count on its own rAF chain, then the
    // screenshot RPC costs a few more). So: three spaced rounds early to fill
    // the frame with drifting smoke, brass in flight and a tracer, then a
    // sustained tail on a 2-frame cadence, so a flash is lit continuously
    // across the whole uncertainty window.
    //
    // The cadence was 3 frames, which is the flash core's own lifetime rounded
    // UP: measured across settle 86/88/90/92/94, frame 90 landed in the trough
    // between two cores and photographed a dying flash (10k hot pixels against
    // 26-29k on either side). Two frames guarantees overlap.
    if (kind === 'fire') {
      const grab = Math.round(opts?.grabFrame ?? 90);
      const frames = [grab - 26, grab - 19, grab - 12];
      for (let f = grab - 6; f <= grab + 18; f += 2) frames.push(f);
      this._scriptFrames = frames.filter((f) => f >= 2);
    } else {
      this._scriptFrames = null;
    }
    return kind;
  }

  /** Swap without the draw animation (harness + debug only). */
  setWeaponImmediate(id) {
    if (!this.states.has(id)) return false;
    this._switchTo = null;
    this.activeId = id;
    // A grenade in hand is stowed unspent, like setWeapon — unless it is
    // already committed. A committed throw must not be cancelled: if the clip
    // drop below skips the release beat, release the grenade now so it does
    // not silently vanish, then stop the viewmodel throw timeline (endGrenade)
    // so the release beat cannot fire a second grenade from the same spent
    // throw, and unwind the throw state so the new gun is not left blocked by
    // a phantom grenade.
    if (this._throwing) {
      if (!this._throwReleased) this._throwGrenade(this._throwFuse, this._throwType);
      this._throwing = false;
      this._throwReleased = true; // the grenade is out — a late release is a no-op
      this.grenadeEquipped = false;
      this.viewmodel?.endGrenade();
      this.ui?.clearPrompt?.();
    } else if (this.grenadeEquipped && !this.cooking) {
      this._stowGrenade();
    }
    // Drop any in-flight viewmodel clip (a mid-reload market purchase is the
    // case that matters): `reloading` is derived from clipName, so a leftover
    // reloadTac/reloadEmpty clip would keep tryFire() blocked after the swap.
    // Same pattern as resetForNewGame() — the bought gun must be idle and
    // shootable the moment the shop closes.
    this.viewmodel.stopClip();
    this.viewmodel.setActive(id);
    this._shotIndex = 0;
    this._spread = 0;
    return true;
  }

  _runDebug(ctx) {
    this._debugFrame = (this._debugFrame ?? 0) + 1;
    const frames = this._scriptFrames;
    if (!frames) return;
    for (const f of frames) {
      if (f === this._debugFrame) {
        this._fireTimer = 0;
        this.tryFire();
      }
    }
  }

  /* ====================================================================== */

  resize() {}

  dispose() {
    for (const off of this._off ?? []) off();
    this.sim?.clear();
    this._clearGrenades();
    for (const p of this._droppedMags) {
      p.group.removeFromParent();
      if (p.body && this.physics?.removeRigidBody) this.physics.removeRigidBody(p.body);
    }
    this._droppedMags.length = 0;
    this.pickups?.dispose();
    this.pickups = null;
    this.viewmodel?.dispose();
    this.mats?.dispose();
  }
}

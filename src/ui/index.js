import * as THREE from 'three';
import { installStyles, removeStyles } from './style.js';
import { el, clamp, clamp01, damp, setStyle } from './util.js';
import { Crosshair } from './crosshair.js';
import { Hitmarkers } from './hitmarkers.js';
import { DamageArcs } from './damage.js';
import { HealthFx } from './health.js';
import { AmmoPanel } from './ammo.js';
import { Killfeed } from './killfeed.js';
import { Compass, ScoreBar } from './compass.js';
import { Minimap } from './minimap.js';
import { WorldMarkers } from './markers.js';
import { Prompt, Banner } from './prompts.js';
import { PauseMenu } from './menu.js';
import { GameOverScreen } from './gameover.js';
import { MarketOverlay, MarketCountdown } from './market.js';
import { RadioPanel } from './radio.js';
import { CombatDemo } from './demo.js';

const MAX_BLIPS = 48;

/**
 * ===========================================================================
 * HUD / UI subsystem
 * ===========================================================================
 *
 * A DOM+CSS overlay (see style.js for the design system) driven entirely from
 * `lateUpdate`, after the camera has reached its final transform for the frame.
 * Nothing animates on a CSS keyframe or transition: every value is integrated
 * from `dt` here, which is what makes the capture harness deterministic and
 * lets the whole HUD freeze correctly when the game is paused.
 *
 * ---------------------------------------------------------------------------
 * PUBLIC API — `const ui = ctx.get('ui')`
 * ---------------------------------------------------------------------------
 *   ui.hitmarker(kind)                  'hit' | 'armour' | 'head' | 'kill'
 *   ui.damageNumber(worldPos, n, kind)  'hit' | 'hs' | 'armour' | 'kill'
 *   ui.hurt(amount, dirX, dirZ)         directional arc + flash + flinch
 *   ui.killfeed.push({attacker,victim,headshot,mine,attackerFriendly})
 *   ui.banner.show(title, sub, life)    kill / objective confirmation
 *   ui.setPrompt({key,text,sub,progress}) / ui.clearPrompt()
 *   ui.setObjectives([{position,label,name}])
 *   ui.setBlips([{x,z,kind:'enemy'|'friend',heading}])
 *   ui.spawnGrenade(worldPos, fuse)
 *   ui.setHudVisible(bool)              hide everything (cinematics)
 *   ui.pause() / ui.resume() / ui.menu.toggle()
 *   ui.debugState('combat'|'menu'|'clean'|'market')
 *
 * ---------------------------------------------------------------------------
 * WHAT THIS SUBSYSTEM READS FROM OTHERS (all optional, all duck-typed)
 * ---------------------------------------------------------------------------
 *   weapons.getHudState() -> { name, mode, ammo, reserve, magSize, reloading,
 *                              reloadProgress, ads, spread, lethalCount }
 *   player.getHudState()  -> { health, maxHealth, armour, maxArmour, regen,
 *                              bandages, healing, healProgress,
 *                              move, sprint, crouch, ads, airborne, position }
 *   ai.getHudActors()     -> [agent] (position, hudX, hudZ, hudFade)
 *   audio.playUi(id, gain) — hit ticks, heartbeat, warnings
 *
 * Events consumed: weapon:fire, weapon:reload, damage:dealt, damage:taken,
 * player:state, score:change, wave:start, wave:complete, explosion, hud:heard,
 * hud:search, resize.
 * Events emitted:  ui:pause, ui:sensitivity, ui:fov, ui:setting.
 */
export class UiSystem {
  static id = 'ui';
  static deps = ['render', 'game', 'market'];

  async init(ctx) {
    this.ctx = ctx;
    this.rng = ctx.rng.fork();
    installStyles();

    const host = document.getElementById('ui') ?? document.body;
    this.root = el('div', 'ow-hud', host);

    // Stacking order: hurt overlays sit under the HUD, the menu over everything.
    this.hurtLayer = el('div', 'ow-layer', this.root);
    this.worldLayer = el('div', 'ow-layer', this.root);
    this.centreLayer = el('div', 'ow-layer', this.root);
    this.chromeLayer = el('div', 'ow-layer', this.root);

    this.health = new HealthFx(this.hurtLayer, this.chromeLayer);
    this.markers = new WorldMarkers(this.worldLayer, this.rng.fork());
    this.arcs = new DamageArcs(this.centreLayer);
    this.crosshair = new Crosshair(this.centreLayer);
    this.hit = new Hitmarkers(this.centreLayer);
    this.minimap = new Minimap(this.chromeLayer, this.rng.fork());
    this.compass = new Compass(this.chromeLayer);
    this.scoreBar = new ScoreBar(this.chromeLayer);
    this.killfeed = new Killfeed(this.chromeLayer);
    this.ammo = new AmmoPanel(this.chromeLayer);
    this.prompt = new Prompt(this.chromeLayer);
    this.banner = new Banner(this.chromeLayer);
    this.menu = new PauseMenu(this.root, ctx);
    this.gameOver = new GameOverScreen(this.root, ctx, () => {
      ctx.events.emit('game:restart', { source: 'game-over' });
      ctx.input?.requestPointerLock?.();
    });
    this.shop = new MarketOverlay(this.root, ctx);
    this.marketCountdown = new MarketCountdown(this.chromeLayer, ctx.get('market').delay);
    this.radio = new RadioPanel(this.chromeLayer, ctx);

    this.health.onBeat = (i) => this.sfx('heartbeat', 0.35 + i * 0.5);

    /** Single source of truth for everything the HUD draws. */
    this.state = {
      health: 100,
      maxHealth: 100,
      armour: 0,
      maxArmour: 150,
      regen: false,
      bandages: 2,
      healing: false,
      healProgress: 0,
      hurt: 0,
      credits: 0,
      marketIn: 0,
      ammo: 30,
      reserve: 210,
      magSize: 30,
      reloading: false,
      reloadProgress: 0,
      weaponName: 'M4A1',
      fireMode: 'AUTO',
      lethalCount: 2,
      radioEquipped: false,
      carpetCount: 1,
      move: 0,
      sprint: false,
      crouch: false,
      ads: false,
      airborne: false,
      baseSpread: 5.5,
      score: 0,
      wave: 0,
      enemiesRemaining: 0,
      waveTotal: 0,
      waveIncoming: false,
      nextWaveIn: 0,
      /** true when no player/weapons subsystem is driving us (stub-safe demo) */
      simulate: false,
      time: 0,
    };

    this.k = 1;
    this.vw = 1920;
    this.vh = 1080;
    this.hudVisible = 1;
    this.hudTarget = 1;
    this._lastRaw = ctx.time.raw;
    this._hadPointerLock = false;
    this._marketJustClosed = false; // one frame after the shop closes
    this._healPrompt = false;
    this._bakeFrame = 0;

    this._pos = new THREE.Vector3();
    this._tmp = new THREE.Vector3();
    this._objectives = [];
    this._compassObjs = [];
    this._blips = new Array(MAX_BLIPS);
    for (let i = 0; i < MAX_BLIPS; i++) this._blips[i] = { x: 0, z: 0, kind: 'enemy', heading: 0 };
    this._blipCount = 0;
    this._blipView = [];

    this.demo = null;

    this._unsubs = [];
    const on = (type, fn) => this._unsubs.push(ctx.events.on(type, fn));

    on('weapon:fire', (e) => {
      this.crosshair.onFire(e?.recoil ?? 1);
    });

    on('weapon:reload', (e) => {
      const s = this.state;
      if (e?.phase === 'start') {
        s.reloading = true;
        s.reloadProgress = 0;
      } else if (e?.phase === 'end') {
        s.reloading = false;
      }
    });

    on('damage:dealt', (e) => {
      if (!e) return;
      // The payload means "damage dealt TO e.target". `ai` uses it for enemy
      // rounds that connect with the player, which must not draw a hitmarker or
      // a "YOU killed" killfeed row — that arrives as `damage:taken` below.
      if (this._isPlayerTarget(e.target)) return;
      const kind = e.killed ? 'kill' : e.headshot ? 'head' : e.armour ? 'armour' : 'hit';
      this.hitmarker(kind);
      if (e.point) {
        this.damageNumber(
          e.point,
          e.amount ?? 0,
          e.killed ? 'kill' : e.headshot ? 'hs' : e.armour ? 'armour' : 'hit'
        );
      }
      if (e.killed) {
        this.killfeed.push({
          attacker: 'YOU',
          victim: e.target?.name ?? e.name ?? 'ENEMY',
          headshot: !!e.headshot,
          mine: true,
        });
        const points = e.headshot ? 150 : 100;
        this.banner.show('Enemy Eliminated', e.headshot ? `+${points} · HEADSHOT` : `+${points}`);
      }
    });

    on('damage:taken', (e) => {
      const amount = e?.amount ?? 10;
      if (e?.health !== undefined) this.state.health = e.health;
      else this.state.health = Math.max(0, this.state.health - amount);
      let dx = 0;
      let dz = 1;
      if (e?.from) {
        this._tmp.copy(e.from).sub(this._playerPos());
        dx = this._tmp.x;
        dz = this._tmp.z;
      }
      // Armour absorbs first: a plate strike clinks instead of alarming.
      const absorbed = e?.armourAbsorbed ?? 0;
      if (absorbed > 0) {
        this.health.onArmour(absorbed, e?.plateBreak);
        this.sfx(e?.plateBreak ? 'armour_break' : 'armour_hit', e?.plateBreak ? 1.6 : 1.05);
      }
      if (amount > 0) this.hurt(amount, dx, dz);
    });

    on('score:change', (e) => {
      if (e?.score !== undefined) this.state.score = e.score;
    });

    on('wave:start', (e) => {
      if (!e) return;
      this.state.wave = e.wave ?? this.state.wave;
      this.state.enemiesRemaining = e.enemies ?? this.state.enemiesRemaining;
      this.state.waveTotal = e.enemies ?? this.state.waveTotal;
      this.state.waveIncoming = false;
      if ((e.wave ?? 0) > 1) {
        this.banner.show(`Wave ${e.wave}`, `${e.enemies ?? 0} HOSTILES INBOUND`, 2.1);
        this.sfx('objective', 0.6);
      }
    });

    on('wave:complete', (e) => {
      if (!e) return;
      this.state.enemiesRemaining = 0;
      this.state.waveIncoming = true;
      this.state.nextWaveIn = e.delay ?? 0;
      const points = Math.max(1, e.wave ?? 1) * 250;
      // The shop opens after a 10 s grace period (see MARKET_DELAY), so the
      // banner has the moment to itself before the countdown takes over.
      this.banner.show(`Wave ${e.wave ?? this.state.wave} Cleared`, `+${points} · WAVE BONUS`, 2.4);
      this.sfx('objective', 0.7);
    });

    on('market:open', (e) => {
      this.shop.show(e?.wave ?? 0);
      this.sfx('market_open', 0.85);
    });
    on('market:close', () => {
      this.shop.hide();
      this.sfx('market_close', 0.7);
      // The shop released the pointer and possibly consumed the Escape that
      // closed it — keep the pause machinery out of this frame entirely.
      this._hadPointerLock = false;
      this._marketJustClosed = true;
      this.ctx.input?.requestPointerLock?.();
    });

    on('explosion', (e) => {
      if (!e?.position) return;
      this._tmp.copy(e.position).sub(this._playerPos());
      const d = this._tmp.length();
      if (d < (e.radius ?? 6) * 2.5) this.crosshair.onFlinch(0.6);
    });

    on('radio:strike', () => {
      this.banner.show('CARPET BOMB INBOUND', 'TAKE COVER', 4);
      this.sfx('radio_strike', 0.7);
    });

    on('hud:heard', (e) => {
      if (!e) return;
      this.compass.ping(e.bearing);
      this.sfx('compass_ping', 0.4);
    });
    on('hud:search', (e) => {
      if (!e) return;
      this.compass.ping(e.bearing);
      this.banner.show(`Search ${e.sector}`, `${e.remaining} ${e.remaining === 1 ? 'HOSTILE' : 'HOSTILES'}`, 2.0);
      this.sfx('compass_ping', 0.45);
    });

    on('player:state', (e) => {
      if (!e) return;
      const s = this.state;
      if (e.ads !== undefined) s.ads = !!e.ads;
      if (e.sprinting !== undefined) s.sprint = !!e.sprinting;
      if (e.stance !== undefined) s.crouch = e.stance === 'crouch' || e.stance === 'prone';
    });

    // Clear the combat chrome while the world camera cranes into the death
    // shot; leaving ammo, crosshair and minimap over it defeats the cinematic.
    on('player:death', () => {
      this.hudTarget = 0;
      this._hadPointerLock = false;
      const run = ctx.peek('game')?.getHudState?.() ?? this.state;
      this.gameOver.show(run, ctx.peek('market')?.credits ?? 0);
    });
    on('player:respawn', () => {
      this.hudTarget = 1;
      this.gameOver.hide();
    });
    on('player:heal', (e) => {
      if (e?.phase === 'complete') {
        const amt = Math.round(e.amount ?? 0);
        this.banner.show('Bandage Applied', amt > 0 ? `+${amt} HP` : 'STABILISED', 1.6);
      }
    });
    on('ammo:pickup', (e) => {
      this.banner.show('Ammunition Recovered', `+${e?.amount ?? 0} ROUNDS`, 1.5);
      this.sfx('objective', 0.45);
    });
    on('game:restart', () => {
      this.state.score = 0;
      this.state.wave = 1;
      this.state.enemiesRemaining = 0;
      this.state.waveIncoming = false;
      this.state.nextWaveIn = 0;
      this.state.regen = false;
      this.killfeed.clear();
      this.arcs.clear();
      this.hit.clear();
      this.markers.clear();
      this.clearPrompt();
    });

    this.resize(ctx.canvas.clientWidth || innerWidth, ctx.canvas.clientHeight || innerHeight, ctx);
  }

  /* ------------------------------------------------------------- helpers -- */

  _weaponState() {
    const w = this.ctx.peek('weapons');
    if (!w || typeof w.getHudState !== 'function') return null;
    const s = w.getHudState();
    return s && typeof s === 'object' ? s : null;
  }

  /** True when a `damage:dealt` payload is aimed at the local player. */
  _isPlayerTarget(t) {
    if (!t) return false;
    return t === 'player' || t === this.ctx.peek('player') || t.isPlayer === true;
  }

  _playerState() {
    const p = this.ctx.peek('player');
    if (!p || typeof p.getHudState !== 'function') return null;
    const s = p.getHudState();
    return s && typeof s === 'object' ? s : null;
  }

  _playerPos() {
    const p = this.ctx.peek('player');
    const pos = p?.position;
    if (pos && pos.isVector3) return this._pos.copy(pos);
    return this._pos.copy(this.ctx.camera.position);
  }

  /** Fire-and-forget audio; the audio subsystem may not exist yet. */
  sfx(id, gain = 1) {
    const a = this.ctx.peek('audio');
    if (!a) return;
    try {
      a.playUi?.(id, gain);
    } catch {
      /* audio is optional feedback — never let it break the HUD */
    }
  }

  /* ---------------------------------------------------------------- api --- */

  hitmarker(kind = 'hit') {
    this.hit.spawn(kind);
    this.crosshair.onHit();
    this.sfx(
      kind === 'kill' ? 'hit_kill' : kind === 'head' ? 'hit_head' : kind === 'armour' ? 'hit_armour' : 'hit_flesh',
      kind === 'kill' ? 1 : 0.7
    );
  }

  damageNumber(worldPos, amount, kind = 'hit') {
    this.markers.spawnDamage(worldPos, amount, kind);
  }

  /** Incoming damage: arc toward the source, screen flash, reticle flinch. */
  hurt(amount = 10, dirX = 0, dirZ = 1) {
    const i = clamp01(amount / 40);
    this.arcs.spawn(dirX, dirZ, 0.45 + i * 0.55);
    this.health.onDamage(i);
    this.crosshair.onFlinch(0.5 + i);
    this.state.regen = false;
    this.sfx('player_hurt', 0.6 + i * 0.4);
  }

  setPrompt(p) {
    // A replacement prompt is no longer owned by bandage cleanup.
    this._healPrompt = false;
    this.prompt.set(p);
  }

  clearPrompt() {
    this._healPrompt = false;
    this.prompt.clear();
  }

  setObjectives(list) {
    this._objectives = list ?? [];
  }

  /** Copies into a preallocated array — the caller's array is not retained. */
  setBlips(list) {
    const n = Math.min(list?.length ?? 0, MAX_BLIPS);
    for (let i = 0; i < n; i++) {
      const src = list[i];
      const dst = this._blips[i];
      dst.x = src.x ?? src.position?.x ?? 0;
      dst.z = src.z ?? src.position?.z ?? 0;
      dst.kind = src.kind ?? (src.friendly ? 'friend' : 'enemy');
      dst.heading = src.heading ?? 0;
      dst.fade = src.fade ?? 1;
    }
    this._blipCount = n;
  }

  spawnGrenade(worldPos, fuse = 2.4) {
    this.markers.spawnGrenade(worldPos, fuse);
    this.sfx('grenade_warn', 0.6);
  }

  setHudVisible(v) {
    this.hudTarget = v ? 1 : 0;
  }

  pause() {
    this.menu.show();
  }

  resume() {
    this.menu.close();
  }

  /* --------------------------------------------------------------- debug -- */

  /**
   * Populate a representative state for screenshots / critics.
   * 'combat' runs the scripted firefight timeline in demo.js.
   */
  debugState(name = 'combat') {
    if (name === 'clean') {
      this.demo?.stop(this);
      this.demo = null;
      this.state.simulate = false;
      this.killfeed.clear();
      this.arcs.clear();
      this.hit.clear();
      this.markers.clear();
      this.clearPrompt();
      return { state: 'clean' };
    }
    if (name === 'menu') {
      this.debugState('combat');
      this.menu.show();
      return { state: 'menu' };
    }
    if (name === 'market') {
      this.demo?.stop(this);
      this.demo = null;
      this.state.simulate = false;
      this.menu.close();
      this.killfeed.clear();
      this.clearPrompt();
      const rifle = this.ctx.peek('weapons')?.states?.get?.('rifle');
      if (rifle) rifle.reserve = Math.round((rifle.def?.reserve ?? 90) * 0.4);
      const hp = this.ctx.peek('player')?.health;
      if (hp) hp.armour = 50;
      const m = this.ctx.peek('market');
      if (m) {
        m.credits = 1850;
        if (!m.open) m.openShop(3);
      }
      this.shop.show(3);
      this.shop.shown = 1;
      return { state: 'market' };
    }
    if (!this.demo) this.demo = new CombatDemo();
    this.demo.start(this);
    return { state: 'combat', frames: 'timeline keyed to frame 90' };
  }

  /* -------------------------------------------------------------- frame --- */

  lateUpdate(dt, ctx) {
    const t = ctx.time;
    const rawDt = clamp(t.raw - this._lastRaw, 0, 0.1);
    this._lastRaw = t.raw;
    const s = this.state;
    s.time = t.elapsed;

    // ---- pause -----------------------------------------------------------
    const playerDead = ctx.peek('player')?.dead === true;
    const marketOpen = ctx.peek('market')?.open === true;
    // The shop owns the pointer and the Escape key while it is open; letting
    // the pause machinery see either would open the menu under the shop or
    // double-toggle on the same Esc that skipped it.
    if (this._marketJustClosed) {
      this._marketJustClosed = false;
    } else if (ctx.input.enabled && !ctx.input.frozen && !playerDead && !marketOpen) {
      if (ctx.input.actionPressed('pause')) this.menu.toggle();
      // Losing pointer lock mid-match is the same intent as pressing Escape.
      if (ctx.input.pointerLocked) this._hadPointerLock = true;
      else if (this._hadPointerLock && !this.menu.open) {
        this._hadPointerLock = false;
        this.menu.show();
      }
    }
    this.menu.update(rawDt);
    this.gameOver.update(rawDt);
    this.shop.update(rawDt);

    // ---- external state --------------------------------------------------
    // `simulate` means a scripted debug timeline owns the HUD numbers; letting
    // the live weapon/player state through would fight it every frame.
    const ws = s.simulate ? null : this._weaponState();
    if (ws) {
      if (ws.name) s.weaponName = ws.name;
      if (ws.mode) s.fireMode = ws.mode;
      if (ws.ammo !== undefined) s.ammo = ws.ammo;
      if (ws.reserve !== undefined) s.reserve = ws.reserve;
      if (ws.magSize !== undefined) s.magSize = ws.magSize;
      if (ws.reloading !== undefined) s.reloading = !!ws.reloading;
      if (ws.reloadProgress !== undefined) s.reloadProgress = ws.reloadProgress;
      if (ws.ads !== undefined) s.ads = !!ws.ads;
      if (ws.spread !== undefined) s.baseSpread = 4 + ws.spread * 40;
      if (ws.lethalCount !== undefined) s.lethalCount = ws.lethalCount;
      if (ws.cooking !== undefined) s.cooking = !!ws.cooking;
      if (ws.grenadeEquipped !== undefined) s.grenadeEquipped = !!ws.grenadeEquipped;
      if (ws.radioEquipped !== undefined) s.radioEquipped = !!ws.radioEquipped;
      if (ws.carpetCount !== undefined) s.carpetCount = ws.carpetCount;
    }

    const gameState = s.simulate ? null : ctx.peek('game')?.getHudState?.();
    if (gameState) {
      s.score = gameState.score ?? s.score;
      s.wave = gameState.wave ?? s.wave;
      s.enemiesRemaining = gameState.enemiesRemaining ?? s.enemiesRemaining;
      s.waveTotal = gameState.waveTotal ?? s.waveTotal;
      s.waveIncoming = gameState.waveIncoming ?? s.waveIncoming;
      s.nextWaveIn = gameState.nextWaveIn ?? s.nextWaveIn;
    }

    const marketState = s.simulate ? null : ctx.peek('market')?.getHudState?.();
    if (marketState) {
      s.credits = marketState.credits ?? s.credits;
      s.marketIn = marketState.marketIn ?? s.marketIn;
    }

    const ps = s.simulate ? null : this._playerState();
    if (ps) {
      if (ps.health !== undefined) s.health = ps.health;
      if (ps.maxHealth !== undefined) s.maxHealth = ps.maxHealth;
      if (ps.armour !== undefined) s.armour = ps.armour;
      if (ps.regen !== undefined) s.regen = !!ps.regen;
      if (ps.bandages !== undefined) s.bandages = ps.bandages;
      if (ps.healing !== undefined) s.healing = !!ps.healing;
      if (ps.healProgress !== undefined) s.healProgress = ps.healProgress;
      if (ps.hurt !== undefined) s.hurt = ps.hurt;
      if (ps.move !== undefined) s.move = ps.move;
      if (ps.sprint !== undefined) s.sprint = !!ps.sprint;
      if (ps.crouch !== undefined) s.crouch = !!ps.crouch;
      if (ps.ads !== undefined) s.ads = !!ps.ads;
      if (ps.airborne !== undefined) s.airborne = !!ps.airborne;
    }

    const pos = this._playerPos();

    // ---- demo timeline ---------------------------------------------------
    if (this.demo?.active) this.demo.update(this, dt);

    // ---- ai blips --------------------------------------------------------
    this._collectBlips();

    // ---- camera basis ----------------------------------------------------
    const m = ctx.camera.matrixWorld.elements;
    let rx = m[0];
    let rz = m[2];
    let fx = -m[8];
    let fz = -m[10];
    const rl = Math.hypot(rx, rz) || 1;
    const fl = Math.hypot(fx, fz) || 1;
    rx /= rl;
    rz /= rl;
    fx /= fl;
    fz /= fl;
    const heading = (Math.atan2(fx, -fz) * 180) / Math.PI;

    // ---- widgets ---------------------------------------------------------
    const hudGoal = this.hudTarget * (this.menu.open ? 0.15 : 1);
    this.hudVisible = damp(this.hudVisible, hudGoal, 10, rawDt);
    const hudOp = this.hudVisible.toFixed(3);
    setStyle(this.chromeLayer, 'opacity', hudOp);
    setStyle(this.worldLayer, 'opacity', hudOp);
    setStyle(this.centreLayer, 'opacity', hudOp);

    this.crosshair.update(dt, s);
    this.hit.update(dt);
    this.arcs.update(dt, rx, rz, fx, fz);
    this.health.update(dt, s);
    this.ammo.update(dt, s);
    this.killfeed.update(dt);
    this.scoreBar.update(s);
    if (s.healing) {
      this.setPrompt({
        key: 'H', text: 'BANDAGING', sub: `${Math.max(0, s.bandages | 0)} LEFT`,
        progress: s.healProgress ?? 0,
      });
      this._healPrompt = true;
    } else if (this._healPrompt) {
      this.clearPrompt();
    }
    this.prompt.update(dt);
    this.banner.update(dt);
    this.marketCountdown.update(rawDt, s.marketIn);
    this.radio.update(rawDt);

    this._buildCompassObjectives(pos);
    this.compass.update(heading, this._compassObjs, dt);

    this.markers.updateObjectives(this._objectives, ctx.camera, this.vw, this.vh, this.k);
    this.markers.updateGrenades(dt, ctx.camera, this.vw, this.vh, this.k);
    this.markers.updateDamage(dt, ctx.camera, this.vw, this.vh, this.k);

    // ---- minimap ---------------------------------------------------------
    if (!this.minimap.bakeDone && ++this._bakeFrame > 6 && this._bakeFrame % 20 === 0) {
      this.minimap.tryBake(ctx);
    }
    this._blipView.length = this._blipCount;
    for (let i = 0; i < this._blipCount; i++) this._blipView[i] = this._blips[i];
    this._mmState = this._mmState ?? { x: 0, z: 0, heading: 0, fov: 80, blips: null, objectives: null };
    this._mmState.x = pos.x;
    this._mmState.z = pos.z;
    this._mmState.heading = heading;
    this._mmState.fov = ctx.camera.fov;
    this._mmState.blips = this._blipView;
    this._mmState.objectives = this._mmObjs ?? (this._mmObjs = []);
    this._mmObjs.length = 0;
    for (const o of this._objectives) {
      if (!o.position) continue;
      this._mmObjs.push(o._mm ?? (o._mm = { x: 0, z: 0, label: o.label }));
      const last = this._mmObjs[this._mmObjs.length - 1];
      last.x = o.position.x;
      last.z = o.position.z;
      last.label = o.label;
    }
    this.minimap.draw(this._mmState);
  }

  _collectBlips() {
    if (this.demo?.active) return; // demo drives its own contacts
    const ai = this.ctx.peek('ai');
    const list = typeof ai?.getHudActors === 'function' ? ai.getHudActors() : null;
    if (!Array.isArray(list)) return;
    let n = 0;
    for (let i = 0; i < list.length && n < MAX_BLIPS; i++) {
      const a = list[i];
      const p = a?.position;
      if (!p || a.alive === false || a.dead === true) continue;
      const b = this._blips[n++];
      b.x = a.hudX ?? p.x;
      b.z = a.hudZ ?? p.z;
      b.kind = a.friendly ? 'friend' : 'enemy';
      b.heading = 0;
      b.fade = a.hudFade ?? 1;
    }
    this._blipCount = n;
  }

  _buildCompassObjectives(pos) {
    const out = this._compassObjs;
    out.length = 0;
    for (const o of this._objectives) {
      if (!o.position) continue;
      const dx = o.position.x - pos.x;
      const dz = o.position.z - pos.z;
      const bearing = (Math.atan2(dx, -dz) * 180) / Math.PI;
      out.push(o._cmp ?? (o._cmp = { bearing: 0, label: o.label, color: o.color }));
      const last = out[out.length - 1];
      last.bearing = bearing;
      last.label = o.label;
      last.color = o.color;
    }
    return out;
  }

  resize(w, h) {
    this.vw = w;
    this.vh = h;
    this.k = clamp(h / 1080, 0.62, 2.4);
    this.root.style.setProperty('--k', this.k.toFixed(4));
    this.crosshair.setScale(this.k);
    this.compass.setScale(this.k);
    this.minimap.resize(this.k);
  }

  dispose() {
    for (const off of this._unsubs) off();
    this._unsubs.length = 0;
    this.crosshair.dispose();
    this.hit.dispose();
    this.arcs.dispose();
    this.health.dispose();
    this.ammo.dispose();
    this.killfeed.dispose();
    this.compass.dispose();
    this.scoreBar.dispose();
    this.minimap.dispose();
    this.markers.dispose();
    this.prompt.dispose();
    this.banner.dispose();
    this.menu.dispose();
    this.gameOver.dispose();
    this.shop.dispose();
    this.marketCountdown.dispose();
    this.radio.dispose();
    this.root.remove();
    removeStyles();
  }
}

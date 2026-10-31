import * as THREE from 'three';

import { bindingLabel } from '../core/bindings.ts';
import type { SystemId, EngineContext, EngineSystems } from '../core/context.ts';
import type { EngineEventMap, EngineEventName } from '../core/events.ts';
import type { WeaponMode } from '../weapons/defs.ts';
import { AmmoPanel } from './ammo.ts';
import { Compass, ScoreBar } from './compass.ts';
import { Crosshair } from './crosshair.ts';
import { DamageArcs } from './damage.ts';
import { GameOverScreen } from './gameover.ts';
import { HealthFx } from './health.ts';
import { Hitmarkers } from './hitmarkers.ts';
import { Killfeed } from './killfeed.ts';
import { MarketOverlay, MarketCountdown } from './market.ts';
import { PauseMenu } from './menu.ts';
import { Minimap } from './minimap.ts';
import type { PixiUiExperiment } from './pixi-experiment.ts';
import type { PixiHudSlice } from './pixi-hud.ts';
import { Prompt, Banner } from './prompts.ts';
import { RadioPanel } from './radio.ts';
import { StartGate } from './start.ts';
import { installStyles, removeStyles } from './style.ts';
import { el, clamp, clamp01, damp, setStyle } from './util.ts';

const MAX_BLIPS = 48;
const HEAL_KEY = bindingLabel('heal');

/**
 * ===========================================================================
 * HUD / UI subsystem
 * ===========================================================================
 *
 * A DOM+CSS overlay (see style.ts for the design system) driven entirely from
 * `lateUpdate`, after the camera has reached its final transform for the frame.
 * Nothing animates on a CSS keyframe or transition: every value is integrated
 * from `dt` here, which is what makes the capture harness deterministic and
 * lets the whole HUD freeze correctly when the game is paused.
 *
 * ---------------------------------------------------------------------------
 * PUBLIC API — `const ui = ctx.get('ui')`
 * ---------------------------------------------------------------------------
 *   ui.hitmarker(kind)                  'hit' | 'armour' | 'head' | 'kill'
 *   ui.hurt(amount, dirX, dirZ)         directional arc + flash + flinch
 *   ui.killfeed.push({attacker,victim,headshot,mine,attackerFriendly})
 *   ui.banner.show(title, sub, life)    kill / objective confirmation
 *   ui.setPrompt({key,text,sub,progress}, owner?) / ui.clearPrompt(owner?)
 *   ui.setHudVisible(bool)              hide everything (cinematics)
 *   ui.pause() / ui.resume() / ui.menu.toggle()
 *   ui.debugState('market')
 *
 * ---------------------------------------------------------------------------
 * WHAT THIS SUBSYSTEM READS FROM OTHERS (optional providers, complete snapshots)
 * ---------------------------------------------------------------------------
 *   weapons.getHudState() -> { name, mode, ammo, reserve, magSize, reloading,
 *                              reloadProgress, ads, spread, lethalCount }
 *   player.getHudState()  -> { health, maxHealth, armour, maxArmour,
 *                              bandages, healing, healProgress,
 *                              move, sprint, crouch, ads, airborne, position }
 *   ai.getHudActors()     -> [agent] (position, hudX, hudZ, hudFade)
 *   audio.playUi(id, gain) — hit ticks, heartbeat, warnings
 *
 * Events consumed: weapon:fire, weapon:reload, damage:dealt, damage:taken,
 * player:state, score:change, wave:start, wave:complete, explosion, hud:heard,
 * hud:search, intel:secured, intel:available, resize.
 * Events emitted:  ui:pause.
 */
interface HudState {
  health: number;
  maxHealth: number;
  armour: number;
  maxArmour: number;
  bandages: number;
  healing: boolean;
  healProgress: number;
  hurt: number;
  pulse: number;
  credits: number;
  marketIn: number;
  ammo: number;
  reserve: number;
  magSize: number;
  reloading: boolean;
  reloadProgress: number;
  weaponName: string;
  fireMode: WeaponMode;
  lethalCount: number;
  radioEquipped: boolean;
  carpetCount: number;
  cooking?: boolean;
  grenadeEquipped?: boolean;
  move: number;
  sprint: boolean;
  crouch: boolean;
  ads: boolean;
  airborne: boolean;
  baseSpread: number;
  score: number;
  wave: number;
  enemiesRemaining: number;
  waveTotal: number;
  waveIncoming: boolean;
  nextWaveIn: number;
  time: number;
}
interface Blip {
  x: number;
  z: number;
  kind: 'enemy' | 'friend';
  heading: number;
  fade?: number;
}
interface MinimapFrame {
  x: number;
  z: number;
  heading: number;
  fov: number;
  blips: Blip[] | null;
  pulses?: { x: number; z: number; y?: number; radius?: number }[] | null;
  pulseTime?: number;
  playerY?: number;
}
type UiContext = EngineContext;

export class UiSystem {
  static readonly id = 'ui';
  static readonly deps: SystemId[] = ['render', 'game', 'market'];
  ctx!: UiContext;
  rng!: import('../core/rng.ts').Rng;
  root!: HTMLElement;
  hurtLayer!: HTMLElement;
  centreLayer!: HTMLElement;
  chromeLayer!: HTMLElement;
  health!: HealthFx;
  arcs!: DamageArcs;
  crosshair!: Crosshair;
  hit!: Hitmarkers;
  minimap!: Minimap;
  compass!: Compass;
  scoreBar!: ScoreBar;
  killfeed!: Killfeed;
  ammo!: AmmoPanel;
  prompt!: Prompt;
  banner!: Banner;
  menu!: PauseMenu;
  startGate: StartGate | null = null;
  pixiExperiment: PixiUiExperiment | null = null;
  pixiHud: PixiHudSlice | null = null;
  gameOver!: GameOverScreen;
  shop!: MarketOverlay;
  marketCountdown!: MarketCountdown;
  radio!: RadioPanel;
  fps!: HTMLElement;
  _fpsSince: number | null = null;
  _fpsFrames = 0;
  state!: HudState;
  k!: number;
  vw!: number;
  vh!: number;
  hudVisible!: number;
  hudTarget!: number;
  _lastRaw!: number;
  _hadPointerLock!: boolean;
  _marketJustClosed!: boolean;
  _healPrompt!: boolean;
  _bakeFrame!: number;
  _pos!: THREE.Vector3;
  _tmp!: THREE.Vector3;
  _blips!: Blip[];
  _blipCount!: number;
  _blipView!: Blip[];
  _mmState?: MinimapFrame;
  _promptOwner?: unknown;
  _unsubs!: (() => void)[];

  async init(ctx: UiContext): Promise<void> {
    this.ctx = ctx;
    this.rng = ctx.rng.fork();
    installStyles();

    const host = document.getElementById('ui') ?? document.body;
    this.root = el('div', 'ow-hud', host);

    // Stacking order: hurt overlays sit under the HUD, the menu over everything.
    this.hurtLayer = el('div', 'ow-layer', this.root);
    this.centreLayer = el('div', 'ow-layer', this.root);
    this.chromeLayer = el('div', 'ow-layer', this.root);

    this.health = new HealthFx(this.hurtLayer, this.chromeLayer);
    this.rng.fork(); // Keep the minimap's noise stream unchanged after removing damage popups.
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
    this.gameOver = new GameOverScreen(this.root, ctx, (): void => {
      if (this.startGate) this.startGate.restart();
      else {
        ctx.events.emit('game:restart', { source: 'game-over' });
        ctx.input?.requestPointerLock?.();
      }
    });
    this.shop = new MarketOverlay(this.root, ctx);
    this.marketCountdown = new MarketCountdown(this.chromeLayer, ctx.get('market').delay);
    this.radio = new RadioPanel(this.chromeLayer, ctx);
    this.fps = el('div', 'ow-fps', this.chromeLayer, '— FPS');

    /** Single source of truth for everything the HUD draws. */
    this.state = {
      health: 100,
      maxHealth: 100,
      armour: 0,
      maxArmour: 150,
      bandages: 2,
      healing: false,
      healProgress: 0,
      hurt: 0,
      pulse: 0,
      credits: 0,
      marketIn: 0,
      ammo: 30,
      reserve: 210,
      magSize: 30,
      reloading: false,
      reloadProgress: 0,
      weaponName: 'M4A1',
      fireMode: 'auto',
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
    this._blips = new Array<Blip>(MAX_BLIPS);
    for (let i = 0; i < MAX_BLIPS; i++) this._blips[i] = { x: 0, z: 0, kind: 'enemy', heading: 0 };
    this._blipCount = 0;
    this._blipView = [];

    this._unsubs = [];
    const on = <K extends EngineEventName>(
      type: K,
      fn: (event: EngineEventMap[K]) => void
    ): number => this._unsubs.push(ctx.events.on(type, fn));

    on('weapon:fire', (e): void => {
      const recoil = 'recoil' in e && typeof e.recoil === 'number' ? e.recoil : 1;
      this.crosshair.onFire(recoil);
    });

    on('weapon:reload', (e): void => {
      const s = this.state;
      if (e?.phase === 'start') {
        s.reloading = true;
        s.reloadProgress = 0;
      } else if (e?.phase === 'end') {
        s.reloading = false;
      }
    });

    on('damage:dealt', (e): void => {
      if (!e) return;
      // The payload means "damage dealt TO e.target". `ai` uses it for enemy
      // rounds that connect with the player, which must not draw a hitmarker or
      // a "YOU killed" killfeed row — that arrives as `damage:taken` below.
      if (this._isPlayerTarget(e.target)) return;
      const armoured = ('armour' in e && e.armour === true) || e.part === 'armour';
      const kind = e.killed ? 'kill' : e.headshot ? 'head' : armoured ? 'armour' : 'hit';
      this.hitmarker(kind);
      if (e.killed) {
        this.killfeed.push({
          attacker: 'YOU',
          victim:
            e.target &&
            typeof e.target === 'object' &&
            'name' in e.target &&
            typeof e.target.name === 'string'
              ? e.target.name
              : 'name' in e && typeof e.name === 'string'
                ? e.name
                : 'ENEMY',
          headshot: !!e.headshot,
          mine: true,
        });
        const points = e.headshot ? 150 : 100;
        this.banner.show('Enemy Eliminated', e.headshot ? `+${points} · HEADSHOT` : `+${points}`);
      }
    });

    on('damage:taken', (e): void => {
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
      // HUD only: audio owns all health/armour sound layers from this event.
      const absorbed = e?.armourAbsorbed ?? 0;
      if (absorbed > 0) {
        this.health.onArmour(absorbed, e?.plateBreak);
      }
      if (amount > 0) this.hurt(amount, dx, dz);
    });

    on('score:change', (e): void => {
      if (e?.score !== undefined) this.state.score = e.score;
    });

    on('wave:start', (e): void => {
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

    on('wave:complete', (e): void => {
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

    on('engine:error', (): void => {
      this.shop.hide();
      this.pixiExperiment?.root.setAttribute('inert', '');
      this.ammo.pixi?.setVisible(false);
      this.pixiHud?.setVisible(false);
    });
    on('market:open', (e): void => {
      this.shop.show(e?.wave ?? 0);
      this.sfx('market_open', 0.85);
    });
    on('market:close', (): void => {
      this.shop.hide();
      this.sfx('market_close', 0.7);
      // The shop released the pointer and possibly consumed the Escape that
      // closed it — keep the pause machinery out of this frame entirely.
      this._hadPointerLock = false;
      this._marketJustClosed = true;
      this.ctx.input?.requestPointerLock?.();
    });

    on('explosion', (e): void => {
      if (!e?.position) return;
      this._tmp.copy(e.position).sub(this._playerPos());
      const d = this._tmp.length();
      if (d < (e.radius ?? 6) * 2.5) this.crosshair.onFlinch(0.6);
    });

    on('radio:strike', (): void => {
      this.banner.show('CARPET BOMB INBOUND', 'TAKE COVER', 4);
      this.sfx('radio_strike', 0.7);
    });

    on('hud:heard', (e): void => {
      if (!e) return;
      this.compass.ping(e.bearing);
      this.sfx('compass_ping', 0.4);
    });
    on('hud:search', (e): void => {
      if (!e) return;
      this.compass.ping(e.bearing);
      this.banner.show(
        `Search ${e.sector}`,
        `${e.remaining} ${e.remaining === 1 ? 'HOSTILE' : 'HOSTILES'}`,
        2.0
      );
      this.sfx('compass_ping', 0.45);
    });

    on('player:state', (e): void => {
      if (!e) return;
      const s = this.state;
      if (e.ads !== undefined) s.ads = !!e.ads;
      if (e.sprinting !== undefined) s.sprint = !!e.sprinting;
      if (e.stance !== undefined) s.crouch = e.stance === 'crouch' || e.stance === 'prone';
    });

    // Clear the combat chrome while the world camera cranes into the death
    // shot; leaving ammo, crosshair and minimap over it defeats the cinematic.
    on('player:death', (): void => {
      this.hudTarget = 0;
      this._hadPointerLock = false;
      const run = ctx.peek('game')?.getHudState?.() ?? this.state;
      this.gameOver.show(run, ctx.peek('market')?.credits ?? 0);
    });
    on('player:respawn', (): void => {
      this.hudTarget = 1;
      this.gameOver.hide();
    });
    on('player:heal', (e): void => {
      if (e?.phase === 'complete') {
        const amt = Math.round(e.amount ?? 0);
        this.banner.show('Bandage Applied', amt > 0 ? `+${amt} HP` : 'STABILISED', 1.6);
      }
    });
    on('ammo:pickup', (e): void => {
      this.banner.show('Ammunition Recovered', `+${e?.amount ?? 0} ROUNDS`, 1.5);
      this.sfx('objective', 0.45);
    });
    on('intel:available', (e): void => {
      const n = Math.max(1, e?.count ?? 1);
      this.banner.show(
        'Intel Cache Active',
        n > 1 ? `${n} SEARCH AREAS ON MINIMAP` : 'SEARCH THE AMBER AREA · LISTEN FOR THE SIGNAL',
        3.2
      );
      this.sfx('intel_call', 0.55);
    });
    on('intel:secured', (e): void => {
      const credits = e?.credits ?? 0;
      this.banner.show('Intel Secured', `+${credits} CREDITS`, 3);
      this.sfx('market_buy', 0.75);
    });

    on('game:restart', (): void => {
      this.state.score = 0;
      this.state.wave = 1;
      this.state.enemiesRemaining = 0;
      this.state.waveIncoming = false;
      this.state.nextWaveIn = 0;
      this.banner.clear();
      this.killfeed.clear();
      this.arcs.clear();
      this.hit.clear();
      this.clearPrompt();
    });

    this.resize(ctx.canvas.clientWidth || innerWidth, ctx.canvas.clientHeight || innerHeight, ctx);
    const pixiMode = new URLSearchParams(location.search).get('pixi');
    if (pixiMode === 'hud') {
      try {
        const { PixiHudSlice } = await import('./pixi-hud.ts');
        this.pixiHud = await PixiHudSlice.create(
          this.root,
          this.centreLayer,
          ctx.get('render').renderer,
          new URLSearchParams(location.search).get('underlays') !== 'html'
        );
        this.pixiHud.resize(this.vw, this.vh, this.k);
        this.root.classList.add('ow-hud-slice');
        this.ammo.presentReadout = false;
        this.hurtLayer.hidden = this.pixiHud.gpuUnderlays;
      } catch (error) {
        try {
          this.pixiHud?.dispose();
        } catch (cleanupError) {
          console.warn('[ui] Pixi HUD cleanup failed', cleanupError);
        } finally {
          this.pixiHud = null;
          this.root.classList.remove('ow-hud-slice');
          this.ammo.presentReadout = true;
          this.hurtLayer.hidden = false;
        }
        console.warn('[ui] Pixi HUD unavailable; using native HUD', error);
      }
    } else if (pixiMode === 'ammo') {
      try {
        const { PixiAmmoHud } = await import('./pixi-ammo.ts');
        this.ammo.pixi = await PixiAmmoHud.create(this.ammo.root, ctx.get('render').renderer);
      } catch (error) {
        console.warn('[ui] Pixi ammo unavailable; using native HUD', error);
      }
    } else if (pixiMode === '1') {
      const layout = this.menu.root.querySelector<HTMLElement>('.ow-menu-layout');
      const controls = this.menu.root.querySelector<HTMLElement>('.ow-controls');
      if (layout && controls) {
        try {
          const { PixiUiExperiment } = await import('./pixi-experiment.ts');
          this.pixiExperiment = await PixiUiExperiment.create(layout, ctx.get('render').renderer);
          controls.before(this.pixiExperiment.root);
          controls.style.gridColumn = '1 / -1';
        } catch (error) {
          const status = el(
            'p',
            null,
            layout,
            'Pixi experiment unavailable; native settings still work.'
          );
          status.setAttribute('role', 'status');
          console.warn('[ui] Pixi experiment unavailable', error);
        }
      }
    }
  }

  /* ------------------------------------------------------------- helpers -- */

  _weaponState(): ReturnType<EngineSystems['weapons']['getHudState']> | null {
    const w = this.ctx.peek('weapons');
    if (!w || typeof w.getHudState !== 'function') return null;
    return w.getHudState() ?? null;
  }

  /** True when a `damage:dealt` payload is aimed at the local player. */
  _isPlayerTarget(t: unknown): boolean {
    if (!t) return false;
    return (
      t === 'player' ||
      t === this.ctx.peek('player') ||
      (typeof t === 'object' && 'isPlayer' in t && t.isPlayer === true)
    );
  }

  _playerState(): ReturnType<EngineSystems['player']['getHudState']> | null {
    const p = this.ctx.peek('player');
    if (!p || typeof p.getHudState !== 'function') return null;
    return p.getHudState() ?? null;
  }

  _playerPos(): THREE.Vector3 {
    const p = this.ctx.peek('player');
    const pos = p?.position;
    if (pos && pos.isVector3) return this._pos.copy(pos);
    return this._pos.copy(this.ctx.camera.position);
  }

  /** Fire-and-forget audio; the audio subsystem may not exist yet. */
  sfx(id: string, gain = 1): void {
    const a = this.ctx.peek('audio');
    if (!a) return;
    try {
      a.playUi?.(id, gain);
    } catch {
      /* audio is optional feedback — never let it break the HUD */
    }
  }

  /* ---------------------------------------------------------------- api --- */

  hitmarker(kind: 'hit' | 'armour' | 'head' | 'kill' = 'hit'): void {
    // Audio consumes damage:dealt once; this adapter owns only HUD feedback.
    this.hit.spawn(kind);
    this.crosshair.onHit();
  }

  /** Incoming damage: arc toward the source, screen flash, reticle flinch. */
  hurt(amount = 10, dirX = 0, dirZ = 1): void {
    const i = clamp01(amount / 40);
    this.arcs.spawn(dirX, dirZ, 0.45 + i * 0.55);
    this.health.onDamage(i);
    this.crosshair.onFlinch(0.5 + i);
  }

  setPrompt(
    p: { key?: string; text?: string; sub?: string; progress?: number },
    owner: unknown = null
  ): void {
    // Cleanup must not erase a replacement prompt from another interaction.
    this._promptOwner = owner;
    this._healPrompt = false;
    this.prompt.set(p);
  }

  clearPrompt(owner: unknown = null): void {
    if (owner !== null && this._promptOwner !== owner) return;
    this._promptOwner = null;
    this._healPrompt = false;
    this.prompt.clear();
  }

  setHudVisible(v: boolean): void {
    this.hudTarget = v ? 1 : 0;
  }

  installStartGate(): void {
    this.startGate = new StartGate(this.ctx.engine);
  }

  pause(): void {
    if (this.ctx.engine.gameplaySuspended) return;
    this.menu.show();
  }

  resume(): void {
    if (this.ctx.engine.gameplaySuspended) return;
    this.menu.close();
  }

  /* --------------------------------------------------------------- debug -- */

  /** Prepare the market state for integration checks. */
  debugState(name: 'market'): { state: string } {
    if (name !== 'market') throw new Error('Unknown UI debug state');
    this.menu.close();
    this.killfeed.clear();
    this.clearPrompt();
    const rifle = this.ctx.peek('weapons')?.states?.get('rifle');
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

  /* -------------------------------------------------------------- frame --- */

  _updateFps(now = performance.now()): void {
    if (this._fpsSince === null) {
      this._fpsSince = now;
      return;
    }
    this._fpsFrames++;
    const elapsed = now - this._fpsSince;
    if (elapsed < 500) return;
    this.fps.textContent = `${Math.round((this._fpsFrames * 1000) / elapsed)} FPS`;
    this._fpsSince = now;
    this._fpsFrames = 0;
  }

  lateUpdate(dt: number, ctx: UiContext): void {
    // Wall time, not scaled/clamped gameplay time: accurate through pause and hitches.
    this._updateFps();
    const t = ctx.time;
    const rawDt = clamp(t.raw - this._lastRaw, 0, 0.1);
    this._lastRaw = t.raw;
    // The native Start dialog exclusively owns waiting input/presentation.
    // Resume happens between frames; reveal only after normal active pose hooks.
    if (this.startGate && !this.startGate.afterPose()) {
      this.pixiExperiment?.update(false, 0);
      this.ammo.pixi?.setVisible(false);
      this.pixiHud?.setVisible(false);
      this._hadPointerLock = false;
      return;
    }
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
    this.pixiExperiment?.update(this.menu.open && !ctx.engine.error, rawDt);
    this.gameOver.update(rawDt);
    this.shop.update(rawDt);

    // ---- external state --------------------------------------------------
    const ws = this._weaponState();
    if (ws) {
      if (ws.name) s.weaponName = ws.name;
      if (ws.mode) s.fireMode = ws.mode;
      s.ammo = ws.ammo;
      s.reserve = ws.reserve;
      s.magSize = ws.magSize;
      s.reloading = ws.reloading;
      s.reloadProgress = ws.reloadProgress;
      s.ads = ws.ads;
      s.baseSpread = 4 + ws.spread * 40;
      s.lethalCount = ws.lethalCount;
      s.cooking = ws.cooking;
      s.grenadeEquipped = ws.grenadeEquipped;
      s.radioEquipped = ws.radioEquipped;
      s.carpetCount = ws.carpetCount;
    }

    const gameState = ctx.peek('game')?.getHudState?.();
    if (gameState) {
      s.score = gameState.score;
      s.wave = gameState.wave;
      s.enemiesRemaining = gameState.enemiesRemaining;
      s.waveTotal = gameState.waveTotal;
      s.waveIncoming = gameState.waveIncoming;
      s.nextWaveIn = gameState.nextWaveIn;
    }

    const marketState = ctx.peek('market')?.getHudState?.();
    if (marketState) {
      s.credits = marketState.credits;
      s.marketIn = marketState.marketIn;
    }

    const ps = this._playerState();
    if (ps) {
      s.health = ps.health;
      s.maxHealth = ps.maxHealth;
      s.armour = ps.armour;
      s.bandages = ps.bandages;
      s.healing = ps.healing;
      s.healProgress = ps.healProgress;
      s.hurt = ps.hurt;
      s.pulse = ps.pulse;
      s.move = ps.move;
      s.sprint = ps.sprint;
      s.crouch = ps.crouch;
      s.ads = ps.ads;
      s.airborne = ps.airborne;
    }

    const pos = this._playerPos();

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
    setStyle(this.centreLayer, 'opacity', hudOp);

    this.crosshair.update(dt, s, !this.pixiHud);
    this.hit.update(dt);
    this.arcs.update(dt, rx, rz, fx, fz);
    this.health.update(dt, s, !this.pixiHud, !this.pixiHud?.gpuUnderlays);
    this.ammo.pixi?.setVisible(this.hudVisible >= 0.004 && !ctx.engine.error);
    this.ammo.update(dt, s);
    this.killfeed.update(dt);
    this.scoreBar.update(s);
    if (s.healing) {
      this.setPrompt({
        key: HEAL_KEY,
        text: 'BANDAGING',
        sub: `${Math.max(0, s.bandages | 0)} LEFT`,
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

    this.compass.update(heading, null, dt);

    // ---- minimap ---------------------------------------------------------
    if (!this.minimap.bakeDone && ++this._bakeFrame > 6 && this._bakeFrame % 20 === 0) {
      this.minimap.tryBake(ctx);
    }
    this._blipView.length = this._blipCount;
    for (let i = 0; i < this._blipCount; i++) this._blipView[i] = this._blips[i];
    this._mmState = this._mmState ?? {
      x: 0,
      z: 0,
      heading: 0,
      fov: 80,
      blips: null,
    };
    this._mmState.x = pos.x;
    this._mmState.z = pos.z;
    this._mmState.heading = heading;
    this._mmState.fov = ctx.camera.fov;
    this._mmState.blips = this._blipView;
    const intel = this.ctx.peek('intel');
    const intelHud = intel?.getHudState?.();
    this._mmState.pulses = intelHud?.pulses ?? null;
    this._mmState.pulseTime = intelHud?.pulseTime ?? 0;
    this._mmState.playerY = ctx.peek('player')?.feetPosition?.y ?? 0;
    if (this.pixiHud) {
      this.pixiHud.setVisible(!ctx.engine.error);
      this.pixiHud.update(
        dt,
        s,
        this.health,
        this.crosshair,
        this.minimap,
        this._mmState,
        this.hudVisible
      );
    } else this.minimap.draw(this._mmState);
  }

  _collectBlips(): void {
    const ai = this.ctx.peek('ai');
    const list = typeof ai?.getHudActors === 'function' ? ai.getHudActors() : null;
    if (!Array.isArray(list)) return;
    let n = 0;
    for (let i = 0; i < list.length && n < MAX_BLIPS; i++) {
      const a = list[i];
      const p = a?.position;
      if (!p || a.alive === false || ('dead' in a && a.dead === true)) continue;
      const b = this._blips[n++];
      b.x = a.hudX ?? p.x;
      b.z = a.hudZ ?? p.z;
      b.kind = a.friendly ? 'friend' : 'enemy';
      b.heading = 0;
      b.fade = a.hudFade ?? 1;
    }
    this._blipCount = n;
  }

  resize(w: number, h: number, _ctx: UiContext = this.ctx): void {
    void _ctx;
    this.vw = w;
    this.vh = h;
    // Fit the 16:9 reference in both axes; never stretch or retain a tall
    // window's oversized chrome after narrowing it.
    this.k = clamp(Math.min(w / 1920, h / 1080), 0.25, 2.4);
    this.root.style.setProperty('--k', this.k.toFixed(4));
    this.crosshair.setScale(this.k);
    this.compass.setScale(this.k);
    this.minimap.resize(this.k);
    this.pixiExperiment?.resize();
    this.ammo.pixi?.resize();
    this.pixiHud?.resize(w, h, this.k);
  }

  dispose(): void {
    // These trials are mutually exclusive. Clear ownership before cleanup so a
    // Pixi exception cannot skip the remaining native UI teardown or retry it.
    const pixi = this.pixiHud ?? this.pixiExperiment ?? this.ammo.pixi;
    this.pixiHud = null;
    this.pixiExperiment = null;
    this.ammo.pixi = null;
    try {
      pixi?.dispose();
    } finally {
      this.startGate?.dispose();
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
}

/**
 * AUDIO — recorded weapon fire/physical hits, spatialisation and mix
 *
 * Recorded assets are required. Synthesis supplies authored reinforcement,
 * casings/dry fire, voices, ambience and UI—not failed-load recovery.
 *
 * ───────────────────────────────────────────────────────────────────────────
 * PUBLIC API   const audio = ctx.get('audio')
 * ───────────────────────────────────────────────────────────────────────────
 *   audio.running                      graph is live (needs a user gesture)
 *   audio.start()                      force-start (returns Promise<boolean>)
 *   audio.deafness                     0..1 concussion; UI/post may read this
 *   audio.play(kind, position, opts)   one-shot; position null = head-locked
 *   audio.startAircraft(position)     tracked recorded loop handle: move/stop
 *   audio.bark(kind, position, opts)   enemy voice: 'spot' | 'reload' |
 *                                      'grenade' | 'flank' | 'suppress' |
 *                                      'advance' | 'hurt' | 'death' | 'copy'
 *   audio.ui(kind)                     'hitmarker'|'headshot'|'kill'|'damage'
 *   audio.setMasterVolume(v)  audio.setBusVolume(bus, v)
 *   audio.setAmbienceIntensity(v)      scales the distant-battle scheduler
 *   audio.report()                     diagnostics snapshot
 *
 * All of it is a no-op — never a throw — before the graph exists, so callers
 * never have to check whether audio started.
 *
 * Driven off the canonical events in ARCHITECTURE.md: weapon:fire,
 * weapon:reload, weapon:shell, bullet:impact, bullet:segment, damage:dealt,
 * damage:taken, actor:death, player:land, player:footstep, ai:footstep,
 * player:state, player:heartbeat, explosion. Optional `ai:bark` is picked up too.
 */

import { Vector3 } from 'three';

import type { EngineContext } from '../core/context.ts';
import type { EngineEventMap, EngineEventName, ReloadPhase } from '../core/events.ts';
import type { Rng } from '../core/rng.ts';
import { AircraftVoice, AIRCRAFT_MIX, type AircraftPosition } from './aircraft.ts';
import { Ambience, ONE_SHOTS, AMBIENT_EVENT_GAIN } from './ambience.ts';
import { NoiseBank, SPEED_OF_SOUND, clamp, gain as mkGain } from './dsp.ts';
import type { EnvironmentKind } from './environment.ts';
import { shellCasing, explosion, uiSound, heartbeat, intelSiren } from './foley.ts';
import { classifySpace, SPACE_KEYS } from './ir.ts';
import { Mixer } from './mixer.ts';
import { TentRadio } from './music.ts';
import { WeaponSampleBank } from './samples.ts';
import { SpatialField } from './spatial.ts';
import type { WeaponProfile } from './types.ts';
import { bark as voxBark, barkFor } from './vox.ts';
import {
  WEAPON_PROFILES,
  reportDistanceGain,
  resolveProfile,
  weaponShot,
  weaponPunch,
  bulletWhizz,
  dryFire,
} from './weapons.ts';

const PROBE_RAYS = 9;
const PROBE_DIST = 40;
// Private full-tail trial: full-tail player reports and compatibility SMG aliases can overlap.
const DRY_SLOTS = 80;
const GESTURES = ['pointerdown', 'mousedown', 'keydown', 'touchstart', 'wheel'];
/** An enemy boot is at the edge of the mix here, and gone by the fade below it. */
const AI_STEP_RANGE = 32;
const AI_STEP_FADE = 12;

type Vec3Like = { x: number; y: number; z: number };
interface AudioOptions {
  profile?: WeaponProfile;
  firstPerson?: boolean;
  miss?: number;
  gain?: number;
  surface?: string;
  energy?: number;
  amount?: number;
  armourAbsorbed?: number;
  plateBreak?: boolean;
  gait?: string;
  level?: number;
  gear?: number;
  flight?: number;
  phase?: ReloadPhase;
  reloadWeapon?: string;
  radius?: number;
  bark?: string;
  f0?: number;
  tract?: number;
  radio?: boolean;
  which?: string;
  send?: number;
  maxDist?: number;
  noDelay?: boolean;
  extraDelay?: number;
  occlusion?: number;
  tracked?: boolean;
  dist?: number;
  voice?: number;
  priority?: number;
  bus?: string;
  force?: boolean;
}
type AudioRuntimeContext = Pick<EngineContext, 'rng' | 'camera' | 'events' | 'peek'>;
interface SpaceMetrics {
  tight: number;
  room: number;
  street: number;
  tunnel: number;
  open: number;
  enclosure: number;
  meanFree: number;
  ceiling: number;
}
interface AudioStats {
  voices: number;
  dropped: number;
  stolen: number;
  rays: number;
  deafness: number;
  space: string;
  started: boolean;
  contextState: string;
  events: number;
  errors: number;
}
interface DryVoice {
  node: AudioNode | null;
  send: AudioNode | null;
  end: number;
}
interface AudioBudget {
  impact: number;
  step: number;
  aiStep: number;
  shell: number;
  whizz: number;
}
interface AmbienceApi {
  distantVolley(): void;
  distantBoom(): void;
  oneShot(): void;
}
declare global {
  interface Window {
    __AUDIO__?: AudioSystem;
  }
}

/** Names other subsystems already use, mapped onto our voices. */
const UI_ALIAS: Record<string, string> = {
  hit_flesh: 'hitmarker',
  hit: 'hitmarker',
  hit_head: 'headshot',
  headshot: 'headshot',
  hit_kill: 'kill',
  hit_armour: 'armour',
  player_hurt: 'damage',
  hurt: 'damage',
  weapon_fire_dry: 'dryfire',
  dry: 'dryfire',
  low_health: 'lowhealth',
};

/** Default bus per voice kind, so callers do not have to know the mix layout. */
const BUS_FOR: Record<string, string> = {
  shot: 'weapons',
  explosion: 'weapons',
  dryfire: 'weapons',
  hitmarker: 'ui',
  headshot: 'ui',
  kill: 'ui',
  armour: 'ui',
  damage: 'ui',
  armour_hit: 'ui',
  armour_break: 'ui',
  market_buy: 'ui',
  market_open: 'ui',
  market_close: 'ui',
  market_hover: 'ui',
  market_deny: 'ui',
  grenade_warn: 'ui',
  grenade_pin: 'ui',
  grenade_tick: 'ui',
  grenade_throw: 'ui',
  radio_open: 'ui',
  radio_denied: 'ui',
  radio_strike: 'ui',
  intel_beep: 'ui',
  intel_call: 'ui',
  bandage: 'ui',
  lowhealth: 'ui',
  bark: 'voice',
  ambient: 'ambience',
};

/** Finite Vector3-ish check — one NaN from any subsystem must not throw. */
function isVec(p: unknown): p is Vec3Like {
  if (!p || typeof p !== 'object') return false;
  return (
    'x' in p &&
    typeof p.x === 'number' &&
    Number.isFinite(p.x) &&
    'y' in p &&
    typeof p.y === 'number' &&
    Number.isFinite(p.y) &&
    'z' in p &&
    typeof p.z === 'number' &&
    Number.isFinite(p.z)
  );
}

function isPlayerHandle(handle: unknown): boolean {
  return (
    handle === 'player' ||
    (typeof handle === 'object' &&
      handle !== null &&
      'isPlayer' in handle &&
      handle.isPlayer === true)
  );
}

function actorVoice(actor: unknown): number {
  if (typeof actor !== 'object' || actor === null || !('id' in actor)) return 0;
  return typeof actor.id === 'number' || typeof actor.id === 'string' ? Number(actor.id) | 0 : 0;
}

export class AudioSystem {
  declare running: boolean;
  declare failed: boolean;
  declare actx: AudioContext | null;
  declare mixer: Mixer | null;
  declare field: SpatialField | null;
  declare ambience: Ambience | null;
  declare bank: NoiseBank | null;
  declare samples: WeaponSampleBank | null;
  declare tentRadio: TentRadio | null;
  declare _starting: Promise<boolean> | null;
  declare deafness: number;
  declare ctx: AudioRuntimeContext;
  declare rng: Rng;
  declare _probeDirs: Vec3Like[];
  declare _probeHits: Float64Array;
  declare _space: SpaceMetrics;
  declare _probeTimer: number;
  declare _lastProbe: Vec3Like;
  declare _origin: Vec3Like;
  declare _whizzShots: Float64Array;
  declare _whizzCursor: number;
  declare _dry: DryVoice[];
  declare _dryCursor: number;
  declare _intelOperating: boolean;
  declare _intelAlarm: ReturnType<typeof intelSiren> | null;
  declare _budget: AudioBudget;
  declare _lastBarkTime: number;
  declare _lastEnemyFire: number;
  declare _stance: string | null;
  declare _ads: boolean;
  declare stats: AudioStats;
  declare _offs: Array<() => void>;
  declare _gestureHandler: (() => void) | null;
  declare _ambienceApi: AmbienceApi | null;
  declare _aircraft: Set<AircraftVoice>;

  static id = 'audio';
  static deps = [];

  constructor() {
    this.running = false;
    this.failed = false;
    this.actx = null;
    this.mixer = null;
    this.field = null;
    this.ambience = null;
    this.bank = null;
    this.samples = null;
    this._starting = null;
    this.deafness = 0;

    /* preallocated scratch — update() allocates nothing */
    this._probeDirs = [];
    for (let i = 0; i < PROBE_RAYS - 1; i++) {
      const a = (i / (PROBE_RAYS - 1)) * Math.PI * 2;
      this._probeDirs.push({ x: Math.cos(a), y: 0.06, z: Math.sin(a) });
    }
    this._probeDirs.push({ x: 0, y: 1, z: 0 });
    this._probeHits = new Float64Array(PROBE_RAYS);
    this._space = {
      tight: 0,
      room: 0,
      street: 0.35,
      tunnel: 0,
      open: 0.65,
      enclosure: 0,
      meanFree: PROBE_DIST,
      ceiling: PROBE_DIST,
    };
    this._probeTimer = 0;
    this._lastProbe = { x: 1e9, y: 0, z: 0 };
    this._origin = { x: 0, y: 0, z: 0 };
    this._whizzShots = new Float64Array(64);
    this._whizzCursor = 0;

    /* dry (head-locked) voice bookkeeping */
    this._dry = [];
    for (let i = 0; i < DRY_SLOTS; i++) this._dry.push({ node: null, send: null, end: 0 });
    this._dryCursor = 0;
    this._intelOperating = false;
    this._intelAlarm = null;

    /* per-frame rate limits */
    this._budget = { impact: 0, step: 0, aiStep: 0, shell: 0, whizz: 0 };
    this._lastBarkTime = -99;
    this._lastEnemyFire = -99;

    this._stance = null;
    this._ads = false;

    this.stats = {
      voices: 0,
      dropped: 0,
      stolen: 0,
      rays: 0,
      deafness: 0,
      space: 'open',
      started: false,
      contextState: 'none',
      events: 0,
      errors: 0,
    };

    this._offs = [];
    this._gestureHandler = null;
    this._ambienceApi = null;
    this._aircraft = new Set();
  }

  /* ================================================================ */
  /* lifecycle                                                        */
  /* ================================================================ */

  async init(ctx: AudioRuntimeContext): Promise<void> {
    this.ctx = ctx;
    this.rng = ctx.rng.fork();
    this._wireEvents(ctx);

    // Web Audio needs a user gesture. Arm every plausible one; the first to
    // land builds the graph. Capture mode never gestures, so shots render in
    // silence and stay byte-identical.
    const kick = () => {
      this._disarmGesture();
      this.start().catch(() => {});
    };
    this._gestureHandler = kick;
    if (typeof addEventListener === 'function') {
      for (const ev of GESTURES) addEventListener(ev, kick, { passive: true });
    }
    if (typeof window !== 'undefined') window.__AUDIO__ = this;
  }

  _disarmGesture() {
    if (!this._gestureHandler) return;
    for (const ev of GESTURES) removeEventListener(ev, this._gestureHandler);
    this._gestureHandler = null;
  }

  /**
   * Build the graph. Safe to call repeatedly; resolves false when audio is
   * unavailable (no AudioContext, blocked autoplay, headless renderer, ...).
   */
  async start() {
    if (this.running) return true;
    if (this.failed) return false;
    // A pointer gesture and a menu/API call can land in the same task. Without
    // this guard both calls build complete graphs, doubling every ambience bed
    // and leaving one graph orphaned — exactly the kind of noisy, muddy mix that
    // is otherwise almost impossible to reproduce in diagnostics.
    if (this._starting) return this._starting;
    this._starting = this._startGraph();
    try {
      return await this._starting;
    } finally {
      this._starting = null;
    }
  }

  async _startGraph() {
    try {
      const AC = globalThis.AudioContext;
      if (!AC) throw new Error('no AudioContext');
      const actx = new AC({ latencyHint: 'interactive' });
      this.actx = actx;

      await Mixer.prepare(actx);

      // Preserve the shared deterministic noise used by finite synthesized events.
      this.bank = new NoiseBank(actx, this.rng.fork(), 9.6);
      const samples = (this.samples = new WeaponSampleBank(actx));
      await samples.load();
      const mixer = (this.mixer = new Mixer(actx, this.rng.fork(), {}));
      mixer.energyMix.onprocessorerror = () => {
        console.error('[audio] energy processor failed; disabling audio');
        this.stats.errors++;
        this.failed = true;
        this._teardown();
      };
      mixer.buildReverbs();
      this.field = new SpatialField(actx, mixer, this.ctx);
      const ambience = (this.ambience = new Ambience(this.rng.fork()));
      ambience.start();
      const tentRadio = (this.tentRadio = new TentRadio(actx, mixer, this.rng.fork()));
      void tentRadio.warm();
      mixer.setSpace(this._space, 0.001);

      if (actx.state === 'suspended') await actx.resume();
      this.running = true;
      this.stats.started = true;
      this.stats.contextState = actx.state;
      console.info(`[audio] online @ ${actx.sampleRate} Hz`);
      return true;
    } catch (err) {
      console.warn('[audio] disabled:', err instanceof Error ? err.message : err);
      this.failed = true;
      this._teardown();
      return false;
    }
  }

  _teardown() {
    this._onIntelOperation({ active: false });
    this._stopAircraft(true);
    try {
      this.tentRadio?.dispose();
      this.ambience?.dispose();
      this.field?.dispose();
      this.mixer?.dispose();
      this.samples?.dispose();
      this.bank?.dispose();
      if (this.actx && this.actx.state !== 'closed') void this.actx.close();
    } catch {
      /* nothing useful to do */
    }
    this.tentRadio = this.ambience = this.field = this.mixer = this.samples = this.bank = null;
    this.actx = null;
    this.running = false;
  }

  dispose() {
    this._disarmGesture();
    for (const off of this._offs) off();
    this._offs.length = 0;
    this._teardown();
    if (typeof window !== 'undefined' && window.__AUDIO__ === this) delete window.__AUDIO__;
  }

  /* ================================================================ */
  /* frame                                                            */
  /* ================================================================ */

  update(dt: number, ctx: AudioRuntimeContext): void {
    if (!this.running) return;
    try {
      const actx = this.actx!;
      if (actx.state === 'suspended') return; // tab hidden, or resume pending
      if (this._intelOperating && !this._intelAlarm) this._onIntelOperation({ active: true });

      /* ---- listener from the render camera ----------------------- */
      const cam = ctx.camera;
      cam.updateMatrixWorld();
      const e = cam.matrixWorld.elements;
      this.field!.setListener(e[12], e[13], e[14], -e[8], -e[9], -e[10], e[4], e[5], e[6]);

      /* ---- space probe ------------------------------------------- */
      this._probeTimer -= dt;
      const moved =
        Math.abs(e[12] - this._lastProbe.x) +
        Math.abs(e[13] - this._lastProbe.y) +
        Math.abs(e[14] - this._lastProbe.z);
      if (this._probeTimer <= 0 || moved > 1.6) {
        this._probeTimer = 0.45;
        this._lastProbe.x = e[12];
        this._lastProbe.y = e[13];
        this._lastProbe.z = e[14];
        this._probeSpace(ctx, e[12], e[13], e[14]);
      }

      /* ---- subsystems -------------------------------------------- */
      this.mixer!.update(dt);
      this.field!.update();
      for (const voice of this._aircraft) if (voice.ended) this._aircraft.delete(voice);
      this.deafness = this.mixer!.deafness;
      if (!this._ambienceApi) {
        this._ambienceApi = {
          distantVolley: () => this._distantVolley(),
          distantBoom: () => this._distantBoom(),
          oneShot: () => this._ambientOneShot(),
        };
      }
      this.ambience!.update(dt, this._ambienceApi);

      /* ---- head-locked voice teardown ---------------------------- */
      const now = actx.currentTime;
      for (let i = 0; i < this._dry.length; i++) {
        const d = this._dry[i];
        if (!d.node || now < d.end) continue;
        try {
          d.node.disconnect();
        } catch {
          /* already gone */
        }
        try {
          d.send?.disconnect();
        } catch {
          /* already gone */
        }
        d.node = null;
        d.send = null;
      }

      /* ---- reset per-frame budgets ------------------------------- */
      const b = this._budget;
      b.impact = 0;
      b.step = 0;
      b.aiStep = 0;
      b.shell = 0;
      b.whizz = 0;

      const s = this.stats;
      s.voices = this.field!.stats.active;
      s.dropped = this.field!.stats.dropped;
      s.stolen = this.field!.stats.stolen;
      s.rays = this.field!.stats.occlusionRays;
      s.deafness = this.deafness;
      s.contextState = actx.state;
    } catch (err) {
      this._error(err);
    }
  }

  _error(err: unknown): void {
    this.stats.errors++;
    if (this.stats.errors < 6) console.error('[audio]', err);
    if (this.stats.errors === 40) {
      console.error('[audio] too many errors — disabling audio');
      this.failed = true;
      this._teardown();
    }
  }

  /** Start one required recorded propeller loop in the existing tracked pool. */
  startAircraft(position: AircraftPosition): AircraftVoice | null {
    if (!this.running || this.actx?.state !== 'running' || !isVec(position)) return null;
    const field = this.field!;
    let emitter;
    try {
      const dist = field.distanceTo(position.x, position.y, position.z);
      emitter = field.acquire({
        x: position.x,
        y: position.y,
        z: position.z,
        bus: 'ambience',
        tracked: true,
        priority: AIRCRAFT_MIX.priority,
        gain: AIRCRAFT_MIX.gain,
        send: AIRCRAFT_MIX.send,
        endTime: Infinity,
      });
      if (!emitter) return null;
      const buffer = this.samples!.nextAircraft(this.rng);
      const voice = new AircraftVoice(
        this.actx,
        field,
        emitter,
        buffer,
        this.actx.currentTime + dist / SPEED_OF_SOUND
      );
      this._aircraft.add(voice);
      this.stats.events++;
      return voice;
    } catch (error) {
      emitter?.detach();
      this._error(error);
      return null;
    }
  }

  _stopAircraft(immediate = false): void {
    for (const voice of this._aircraft) {
      if (immediate) voice.dispose();
      else voice.stop();
    }
    if (immediate) this._aircraft.clear();
  }

  _pauseAircraft(): void {
    for (const voice of this._aircraft) voice.setPaused(true);
  }

  /* ================================================================ */
  /* environment probe                                                */
  /* ================================================================ */

  _probeSpace(ctx: AudioRuntimeContext, x: number, y: number, z: number): void {
    const phys = ctx.peek('physics');
    const hits = this._probeHits;
    if (phys?.raycast) {
      const mask = phys.MASK?.WORLD;
      const o = this._origin;
      o.x = x;
      o.y = y;
      o.z = z;
      for (let i = 0; i < PROBE_RAYS; i++) {
        const h = phys.raycast(o, this._probeDirs[i], PROBE_DIST, mask);
        hits[i] = h?.hit ? h.distance : PROBE_DIST;
      }
    } else {
      for (let i = 0; i < PROBE_RAYS; i++) hits[i] = PROBE_DIST;
    }
    classifySpace(hits, PROBE_DIST, this._space);
    this.mixer!.setSpace(this._space, 0.4);

    let best = 'open',
      bv = -1;
    for (const k of SPACE_KEYS) {
      if (this._space[k] > bv) {
        bv = this._space[k];
        best = k;
      }
    }
    this.stats.space = best;
  }

  /* ================================================================ */
  /* voice plumbing                                                   */
  /* ================================================================ */

  /**
   * Build a voice by name. `when` is absolute context time, `dist` is metres
   * from the listener — voices use it to rebalance their own layers.
   */
  _build(kind: string, when: number, dist: number, o: AudioOptions) {
    const actx = this.actx!,
      bank = this.bank!;
    const rng = this.rng;
    switch (kind) {
      case 'shot': {
        const profile: WeaponProfile = o.profile ?? WEAPON_PROFILES.rifle;
        // Complete authored reports carry their own decay. The sample bank selects
        // distant enemy perspectives; MCX/MPX retain suppressed sources at range.
        // Unmodified legacy profiles keep their procedural distant model.
        if (profile.sample && (o.firstPerson || dist <= 45 || profile.samplePunch === false)) {
          const recorded = this.samples!.shot(profile, rng, {
            when,
            distance: dist,
            firstPerson: o.firstPerson,
          });
          if (profile.samplePunch === false) return recorded;
          const punch = weaponPunch(actx, bank, rng, profile, {
            when,
            distance: dist,
            firstPerson: o.firstPerson,
          });
          const out = mkGain(actx, 1);
          recorded.node.connect(out);
          punch.node.connect(out);
          return {
            node: out,
            end: Math.max(recorded.end, punch.end),
            send: Math.max(recorded.send ?? 0, punch.send ?? 0),
          };
        }
        return weaponShot(actx, bank, rng, profile, {
          when,
          distance: dist,
          firstPerson: o.firstPerson,
          echoBoost:
            0.75 +
            this._space.street * 0.7 +
            this._space.tight * 0.35 +
            this._space.tunnel * 0.8 +
            this._space.open * 0.2,
        });
      }
      case 'whizz':
        return bulletWhizz(actx, bank, rng, { when, miss: o.miss, gain: o.gain });
      case 'dryfire':
        return dryFire(actx, bank, rng, { when });
      case 'damage':
        return this.samples!.damage(rng, {
          when,
          amount: o.amount ?? 25,
          armourAbsorbed: o.armourAbsorbed ?? 0,
          plateBreak: o.plateBreak ?? false,
          level: o.level,
        });
      case 'armour_hit':
      case 'armour_break':
        return this.samples!.hit(kind === 'armour_break' ? 'break' : 'armour', rng, {
          when,
          level: o.level,
        });
      case 'impact':
        if (o.surface === 'flesh')
          return this.samples!.hit('flesh', rng, { when, level: o.energy });
        return this.samples!.impact(rng, { when, surface: o.surface, level: o.energy });
      case 'step':
        return this.samples!.step(rng, {
          when,
          surface: o.surface,
          gait: o.gait,
          level: o.level,
          gear: o.gear,
        });
      case 'shell':
        return shellCasing(actx, bank, rng, {
          when,
          surface: o.surface,
          level: o.level,
          flight: o.flight,
        });
      case 'reload':
        return this.samples!.reload(o.reloadWeapon ?? '', o.phase, rng, { when });
      case 'explosion': {
        if (dist > 50)
          return explosion(actx, bank, rng, {
            when,
            distance: dist,
            radius: o.radius,
            level: o.level,
          });
        const recorded = this.samples!.explosion(rng, { when });
        const synthetic = explosion(actx, bank, rng, {
          when,
          distance: dist,
          radius: o.radius,
          // The required recording carries the blast; synthesis reinforces it.
          level: (o.level ?? 1) * 0.48,
        });
        const out = mkGain(actx, 1);
        recorded.node.connect(out);
        synthetic.node.connect(out);
        return { node: out, end: synthetic.end, send: synthetic.send };
      }
      case 'bodyfall':
        return this.samples!.fall(rng, { when, surface: o.surface, level: o.level });
      case 'cloth':
        return this.samples!.cloth(rng, { when, level: o.level });
      case 'heartbeat':
        return heartbeat(actx, { when, level: o.level, buffer: this.samples!.heartbeatBuffer! });
      case 'bark':
        return voxBark(actx, bank, rng, {
          when,
          bark: o.bark,
          f0: o.f0,
          tract: o.tract,
          level: o.level,
          radio: o.radio,
        });
      case 'ambient':
        return this.samples!.environment(o.which as EnvironmentKind, rng, { when, level: o.level });
      default:
        return uiSound(actx, bank, rng, kind, { when, level: o.level });
    }
  }

  /**
   * Spatialised one-shot: propagation delay, occlusion, air absorption and the
   * reverb send. Returns false when the voice budget refused it.
   */
  _playAt(
    kind: string,
    x: number,
    y: number,
    z: number,
    o: AudioOptions = {},
    bus = 'foley',
    priority = 0.5
  ): boolean {
    if (!this.running || this.actx!.state === 'suspended') return false;
    const actx = this.actx!,
      field = this.field!;
    if (!Number.isFinite(x + y + z)) return this._playDry(kind, o, bus, o.send ?? 0.15);
    try {
      const dist = field.distanceTo(x, y, z);
      if (dist > (o.maxDist ?? 320)) return false;
      const delay = o.noDelay ? 0 : dist / SPEED_OF_SOUND;
      const when = actx.currentTime + delay + (o.extraDelay ?? 0);
      const voice = this._build(kind, when, dist, o);
      const em = field.acquire({
        x,
        y,
        z,
        when,
        dist,
        bus,
        priority,
        // Selected presentation reference + fixed digital-bank energy matching.
        // The sample selector and correction share the same perspective rule.
        atten:
          kind === 'shot' && (o.profile ?? WEAPON_PROFILES.rifle).samplePunch === false
            ? reportDistanceGain(dist, o.profile ?? WEAPON_PROFILES.rifle, o.firstPerson)
            : undefined,
        send: o.send ?? voice.send ?? 0.3,
        gain: o.gain ?? 1,
        endTime: voice.end,
        occlusion: o.occlusion,
        tracked: o.tracked,
      });
      if (!em) {
        try {
          voice.node.disconnect();
        } catch {
          /* noop */
        }
        return false;
      }
      field.hold(em, voice.node, voice.end);
      this.stats.events++;
      return true;
    } catch (err) {
      this._error(err);
      return false;
    }
  }

  /** Head-locked one-shot: own weapon, UI, player grunts, heartbeat. */
  _playDry(kind: string, o: AudioOptions = {}, bus = 'foley', send = 0.15): boolean {
    if (!this.running || this.actx!.state === 'suspended') return false;
    const actx = this.actx!,
      mixer = this.mixer!;
    try {
      const when = actx.currentTime + (o.extraDelay ?? 0);
      const voice = this._build(kind, when, o.dist ?? 0, o);
      // Reuse the voice output at unity; it remains the teardown/steal handle.
      const level = o.gain ?? 1;
      const g = level === 1 ? voice.node : mkGain(actx, level);
      if (g !== voice.node) voice.node.connect(g);
      g.connect(mixer.bus(bus));
      let sendNode = null;
      const sendLevel = (o.send ?? send) * (voice.send ?? 1);
      if (sendLevel > 0.001) {
        sendNode = mkGain(actx, sendLevel);
        g.connect(sendNode);
        sendNode.connect(mixer.sendBus(bus));
      }
      // Claim a bookkeeping slot; steal the oldest if all are busy.
      let slot = null;
      for (let i = 0; i < this._dry.length; i++) {
        const idx = (this._dryCursor + i) % this._dry.length;
        if (!this._dry[idx].node) {
          slot = this._dry[idx];
          this._dryCursor = (idx + 1) % this._dry.length;
          break;
        }
      }
      if (!slot) {
        slot = this._dry[this._dryCursor];
        try {
          slot!.node!.disconnect();
          slot!.send?.disconnect();
        } catch {
          /* noop */
        }
        this._dryCursor = (this._dryCursor + 1) % this._dry.length;
      }
      slot!.node = g;
      slot!.send = sendNode;
      slot!.end = voice.end + 0.05;
      this.stats.events++;
      return true;
    } catch (err) {
      this._error(err);
      return false;
    }
  }

  /* ================================================================ */
  /* public helpers                                                   */
  /* ================================================================ */

  /**
   * Fire a one-shot. Tolerant on purpose: other subsystems call this with
   * several different conventions and audio must never be the thing that throws.
   *   play('impact', vec3, { surface })   play('hit_flesh', { gain: 0.7 })
   *   play('shell', vec3, 0.8)
   */
  play(
    kind: string,
    position: Vec3Like | AudioOptions | number | null = null,
    opts?: AudioOptions | number
  ): boolean {
    if (typeof opts === 'number') opts = { gain: opts };
    if (typeof position === 'number') {
      opts = { gain: position };
      position = null;
    }
    // A caller may have passed an options bag where a position goes.
    if (position && !isVec(position)) {
      opts = opts ?? position;
      position = null;
    }
    opts = opts ?? {};
    const k = UI_ALIAS[kind] ?? kind;
    if (position) {
      return this._playAt(
        k,
        position.x,
        position.y,
        position.z,
        opts,
        opts.bus ?? BUS_FOR[k] ?? 'foley',
        opts.priority ?? 0.5
      );
    }
    return this._playDry(k, opts, opts.bus ?? BUS_FOR[k] ?? 'foley', opts.send ?? 0.15);
  }

  ui(kind: string, level = 1): boolean {
    const k = UI_ALIAS[kind] ?? kind;
    return this._playDry(k, { level }, BUS_FOR[k] ?? 'ui', k === 'heartbeat' ? 0.1 : 0);
  }

  /** Adapter the `ui` subsystem probes for: playUi(id, gain). */
  playUi(id: string, gain = 1): boolean {
    return this.ui(id, gain);
  }

  /** Adapter the `fx` subsystem probes for: playShell(position, gain). */
  playShell(position: unknown, gain = 1): boolean {
    if (!isVec(position)) return false;
    return this._playAt(
      'shell',
      position.x,
      position.y,
      position.z,
      { level: gain, surface: 'concrete', flight: 0.02 },
      'foley',
      0.25
    );
  }

  /** Enemy vocalisation. `kind` is semantic — see barkFor() in vox.js. */
  bark(kind: string, position: Vec3Like | null = null, opts: AudioOptions = {}): boolean {
    if (!this.running) return false;
    const now = this.actx!.currentTime;
    if (now - this._lastBarkTime < 0.42 && !opts.force) return false; // no mush
    this._lastBarkTime = now;
    const seed = (opts.voice ?? 0) | 0;
    const o = {
      bark: barkFor(kind, this.rng),
      f0: 96 + ((seed * 37) % 41),
      tract: 0.95 + ((seed * 13) % 11) / 100,
      level: opts.level ?? 1,
      radio: opts.radio ?? false,
      send: opts.send,
    };
    if (position) return this._playAt('bark', position.x, position.y, position.z, o, 'voice', 0.85);
    return this._playDry('bark', o, 'voice', 0.25);
  }

  setMasterVolume(v: number): void {
    this.mixer?.setMasterVolume(v);
  }
  setBusVolume(bus: string, v: number): void {
    this.mixer?.setBusVolume(bus, v);
  }
  setAmbienceIntensity(v: number): void {
    if (this.ambience) this.ambience.intensity = clamp(v, 0, 3);
  }

  /* ================================================================ */
  /* events                                                           */
  /* ================================================================ */

  _onIntelOperation(e: { active?: boolean }): void {
    this._intelOperating = e.active === true;
    if (!this._intelOperating) {
      this._intelAlarm?.stop();
      this._intelAlarm = null;
      return;
    }
    const actx = this.actx!;
    if (this._intelAlarm || !this.running || actx.state === 'suspended') return;
    try {
      this._intelAlarm = intelSiren(actx);
      // Work is within arm's reach; keep the warning above gunfire/foley ducking.
      this._intelAlarm.node.connect(this.mixer!.bus('ui'));
    } catch (error) {
      this._error(error);
    }
  }

  _wireEvents(ctx: AudioRuntimeContext): void {
    const ev = ctx.events;
    const on = <K extends EngineEventName>(
      name: K,
      fn: (payload: EngineEventMap[K]) => void
    ): void => {
      this._offs.push(ev.on(name, fn));
    };

    on('weapon:fire', (p) => this._onFire(p));
    on('weapon:reload', (p) => this._onReload(p));
    on('weapon:shell', (p) => this._onShell(p));
    on('bullet:impact', (p) => this._onImpact(p));
    on('bullet:segment', (p) => this._onBulletSegment(p));
    on('explosion', (p) => this._onExplosion(p));
    on('player:footstep', (p) => this._onFootstep(p));
    on('ai:footstep', (p) => this._onAiFootstep(p));
    on('player:land', (p) => this._onLand(p));
    on('player:state', (p) => this._onPlayerState(p));
    on('damage:dealt', (p) => this._onDamageDealt(p));
    on('damage:taken', (p) => this._onDamageTaken(p));
    // Head-locked warning: keep it above the gunfire ducking on the foley bus.
    on('player:heartbeat', (p) =>
      this._playDry('heartbeat', { level: Math.min(1, 0.25 + p.strength * 1.3) }, 'ui', 0)
    );
    on('actor:death', (p) => this._onDeath(p));
    // Optional: emitted by `ai` if it wants scripted chatter.
    on('ai:bark', (p) => this.bark(p?.kind ?? 'spot', p?.position, { voice: p?.voice ?? 0 }));
    on('intel:operation', (e) => this._onIntelOperation(e));
    const stopIntel = () => this._onIntelOperation({ active: false });
    on('game:restart', () => {
      stopIntel();
      this._stopAircraft();
    });
    on('player:death', stopIntel);
    on('engine:error', () => {
      stopIntel();
      this._stopAircraft(true);
    });
    on('ui:pause', (e) => {
      if (e.paused) {
        stopIntel();
        this._pauseAircraft();
      }
    });
    on('market:open', () => {
      stopIntel();
      this._pauseAircraft();
      if (!this.running) return;
      this.tentRadio?.start()?.catch?.(() => {});
      this.mixer?.setBusVolume('ambience', 0.28);
      this.mixer?.setBusVolume('foley', 0.5);
    });
    on('market:close', () => {
      this.tentRadio?.stop();
      this.mixer?.setBusVolume('ambience', 1);
      this.mixer?.setBusVolume('foley', 1);
    });
  }

  _onFire(p: EngineEventMap['weapon:fire']): void {
    if (!this.running || !p) return;
    const field = this.field!,
      mixer = this.mixer!,
      actx = this.actx!;
    const w = p.weapon;
    const name = typeof w === 'string' ? w : (w?.audio ?? w?.id ?? w?.name ?? w?.kind);
    let profile = resolveProfile(name);
    // The real MPX definition deliberately retains its generic suppressed tag.
    // Select its dedicated 9mm report without changing unrelated suppressed guns.
    if (w && typeof w === 'object' && w.id === 'smg' && w.suppressed) profile = WEAPON_PROFILES.mpx;
    if (w && typeof w === 'object' && w.suppressed && !profile.suppressed)
      profile = WEAPON_PROFILES.suppressed;

    if (p.empty) {
      this._playDry('dryfire', {}, 'weapons', 0.15);
      return;
    }

    const o = p.origin;
    const lp = field.listenerPos;
    const x = o?.x ?? lp.x,
      y = o?.y ?? lp.y,
      z = o?.z ?? lp.z;
    const dist = field.distanceTo(x, y, z);
    const firstPerson = p.firstPerson ?? dist < 2.6;

    if (firstPerson) {
      // Complete reports already contain their decay: no extra room branch.
      // Legacy isolated takes retain their separately tuned environment send.
      const send =
        profile.samplePunch === false
          ? 0
          : (0.35 +
              this._space.tight * 0.5 +
              this._space.street * 0.9 +
              this._space.tunnel * 1.0 +
              this._space.room * 0.75) *
            0.6;
      this._playDry(
        'shot',
        {
          profile,
          firstPerson: true,
          gain: profile.samplePunch === false ? 1 : (profile.firstPersonGain ?? 1.18),
        },
        'weapons',
        send
      );
      mixer.duck(0.55, 0.1);
    } else {
      this._playAt('shot', x, y, z, { profile, firstPerson: false, gain: 1 }, 'weapons', 0.95);
      mixer.duck(clamp(0.5 - dist * 0.004, 0.12, 0.5), 0.08);
      // Enemies opening fire get occasional chatter, so firefights feel alive
      // even before `ai` grows its own bark logic.
      const now = actx.currentTime;
      if (now - this._lastEnemyFire > 4.5 && this.rng.float() < 0.45) {
        this._lastEnemyFire = now;
        this.bark(this.rng.float() < 0.6 ? 'spot' : 'suppress', p.origin, { level: 0.9 });
      }
    }
  }

  _onReload(p: EngineEventMap['weapon:reload']): void {
    if (!this.running) return;
    const w = p?.weapon;
    const options = {
      phase: p?.phase ?? 'end',
      reloadWeapon: typeof w === 'string' ? w : (w?.id ?? ''),
    };
    if (p?.position) {
      this._playAt('reload', p.position.x, p.position.y, p.position.z, options, 'foley', 0.6);
    } else {
      this._playDry('reload', options, 'foley', 0.22);
    }
  }

  _onShell(p: EngineEventMap['weapon:shell']): void {
    if (!this.running || !p) return;
    const field = this.field!;
    if (this._budget.shell++ > 2) return;
    const pos = p.position;
    const lp = field.listenerPos;
    const x = pos?.x ?? lp.x,
      y = pos?.y ?? lp.y,
      z = pos?.z ?? lp.z;
    const dist = field.distanceTo(x, y, z);
    if (dist > 22) return;
    // Find what it will land on, so brass on sand does not ring like concrete.
    let surface = 'concrete';
    const phys = this.ctx.peek('physics');
    if (phys?.raycast) {
      const h = phys.raycast(x, y + 0.2, z, 0, -1, 0, 6, phys.MASK?.WORLD);
      if (h?.hit) surface = h.surface;
    }
    this._playAt(
      'shell',
      x,
      y - 0.6,
      z,
      {
        surface,
        level: clamp(1 - dist * 0.02, 0.3, 1),
        flight: 0.25 + this.rng.range(0, 0.3),
      },
      'foley',
      0.25
    );
  }

  _onImpact(p: EngineEventMap['bullet:impact']): void {
    if (!this.running || !p) return;
    const field = this.field!;
    if (p.exit) return; // only the entry side gets a sound
    // Player contact precedes armour/health resolution. damage:taken owns the
    // immediate headlocked feedback, including armour-only hits; never double it.
    const player = this.ctx.peek('player');
    if (isPlayerHandle(p.actor) || (player != null && p.actor === player)) return;
    if (this._budget.impact++ > 4) return;
    const pt = p.point;
    if (!pt) return;
    const dist = field.distanceTo(pt.x, pt.y, pt.z);
    if (dist > 90) return;
    this._playAt(
      'impact',
      pt.x,
      pt.y,
      pt.z,
      {
        surface: p.surface ?? 'concrete',
        energy: clamp((p.damage ?? 30) / 34, 0.35, 1.5),
      },
      'foley',
      0.55
    );
    // Only reached bullet:segment flight owns the whizz, not a nearby wall
    // contact (including the player's own rounds). Never duplicate the pass.
  }

  _onBulletSegment(p: EngineEventMap['bullet:segment']): void {
    if (!this.running || !p?.from || !p?.to) return;
    const field = this.field!;
    if (isPlayerHandle(p.shooter)) return;
    if (p.shot && this._whizzShots.includes(p.shot)) return;
    // Closest approach of the trajectory to the listener.
    const lp = field.listenerPos;
    const ax = p.from.x,
      ay = p.from.y,
      az = p.from.z;
    const dx = p.to.x - ax,
      dy = p.to.y - ay,
      dz = p.to.z - az;
    const len2 = dx * dx + dy * dy + dz * dz;
    if (len2 < 1e-6) return;
    const t = clamp(((lp.x - ax) * dx + (lp.y - ay) * dy + (lp.z - az) * dz) / len2, 0, 1);
    const cx = ax + dx * t,
      cy = ay + dy * t,
      cz = az + dz * t;
    const miss = Math.hypot(lp.x - cx, lp.y - cy, lp.z - cz);
    if (miss > 5) return;
    if (Math.hypot(lp.x - ax, lp.y - ay, lp.z - az) < 3) return; // our own muzzle
    if (this._budget.whizz++ > 2) return;
    if (p.shot) this._whizzShots[this._whizzCursor++ % this._whizzShots.length] = p.shot;
    this._playAt('whizz', cx, cy, cz, { miss, noDelay: true }, 'foley', 0.75);
  }

  _onExplosion(p: EngineEventMap['explosion']): void {
    if (!this.running || !p?.position) return;
    const field = this.field!,
      mixer = this.mixer!;
    const pos = p.position;
    const dist = field.distanceTo(pos.x, pos.y, pos.z);
    this._playAt(
      'explosion',
      pos.x,
      pos.y,
      pos.z,
      {
        // 0.62 reverb send, not 1.0: a full send through the 1.6 s open-space IR
        // rang the tail past 3 s and read as a warehouse echo. The direct boom
        // carries the hit; the room only colours it.
        radius: p.radius ?? 6,
        level: 1,
        send: 0.62,
        // Calibrated below unity so ordinary blasts do not lean on the limiter.
        gain: 0.8,
      },
      'weapons',
      1
    );
    mixer.duck(0.85, 0.35);
    // Let the pressure crack arrive before hearing damage muffles the world.
    // Starting both together buried the explosion while the tinnitus bypassed it.
    const near = clamp(1 - dist / 22, 0, 1);
    if (near > 0.1) {
      mixer.concuss(Math.pow(near, 1.4), dist / SPEED_OF_SOUND + 0.2, 0.045);
    }
  }

  _onFootstep(p: EngineEventMap['player:footstep']): void {
    if (!this.running) return;
    const field = this.field!;
    if (this._budget.step++ > 3) return;
    const pos = p?.position;
    const lp = field.listenerPos;
    const x = pos?.x ?? lp.x,
      y = pos?.y ?? lp.y - 1.6,
      z = pos?.z ?? lp.z;
    const dist = field.distanceTo(x, y, z);
    if (dist > 45) return;
    const stance = p?.stance;
    const gait =
      p?.gait ??
      (stance === 'crouch' || stance === 'prone' ? 'crouch' : p?.running ? 'run' : 'walk');
    this._playAt(
      'step',
      x,
      y,
      z,
      {
        surface: p?.surface ?? 'concrete',
        gait,
        level: p?.level ?? (dist < 2 ? 0.72 : 1),
      },
      'foley',
      0.4
    );
  }

  /**
   * An enemy's boot: culled by distance before anything is built, faded out at
   * the far edge so a man walking away does not cut out mid-stride, and rationed
   * so a squad that starts walking together cannot eat the emitter pool.
   */
  _onAiFootstep(p: EngineEventMap['ai:footstep']): void {
    if (!this.running || !p?.position) return;
    const field = this.field!;
    const pos = p.position;
    const dist = field.distanceTo(pos.x, pos.y, pos.z);
    if (dist > AI_STEP_RANGE) return;
    if (this._budget.aiStep++ > 2) return;
    this._playAt(
      'step',
      pos.x,
      pos.y,
      pos.z,
      {
        surface: p.surface ?? 'concrete',
        gait: p.gait ?? 'walk',
        level: clamp((AI_STEP_RANGE - dist) / AI_STEP_FADE, 0, 1),
      },
      'foley',
      0.3
    );
  }

  _onLand(p: EngineEventMap['player:land']): void {
    if (!this.running) return;
    const lp = this.field!.listenerPos;
    const pos = p?.position;
    const v = Math.abs(p?.velocity ?? 4);
    this._playAt(
      'step',
      pos?.x ?? lp.x,
      pos?.y ?? lp.y - 1.6,
      pos?.z ?? lp.z,
      {
        surface: p?.surface ?? 'concrete',
        gait: 'land',
        level: clamp(v / 7, 0.35, 1.7),
        gear: 1,
      },
      'foley',
      0.7
    );
    // Landing gear is already part of this composite; do not add a second rustle.
  }

  _onPlayerState(p: EngineEventMap['player:state']): void {
    if (!this.running || !p) return;
    if (p.stance !== undefined && p.stance !== this._stance) {
      this._stance = p.stance;
      this._playDry('cloth', { level: 0.9 }, 'foley', 0.12);
    }
    if (p.ads !== undefined && p.ads !== this._ads) {
      this._ads = p.ads;
      this._playDry('cloth', { level: 0.45 }, 'foley', 0.1);
    }
  }

  _onDamageDealt(p: EngineEventMap['damage:dealt']): void {
    if (!this.running || !p) return;
    // "Damage dealt TO p.target" — `ai` also uses this for rounds that hit the
    // player, and a hitmarker tick for being shot at is backwards. Incoming
    // damage is handled by _onDamageTaken.
    const t = p.target;
    if (t === 'player' || isPlayerHandle(t) || t === this.ctx.peek('player')) return;
    const armoured = p.part === 'armour' || ('armour' in p && p.armour === true);
    this.ui(p.headshot ? 'headshot' : armoured ? 'armour' : 'hitmarker', 1);
    if (p.killed) this.ui('kill', 1);
    else if (p.point && p.target && this.rng.float() < 0.3) {
      this.bark('hurt', p.point, { level: 0.85 });
    }
  }

  _onDamageTaken(p: EngineEventMap['damage:taken']): void {
    if (!this.running || !p) return;
    const amount = Number.isFinite(p.amount) ? Math.max(0, p.amount) : 0;
    const armourAbsorbed = Number.isFinite(p.armourAbsorbed) ? Math.max(0, p.armourAbsorbed) : 0;
    if (amount === 0 && armourAbsorbed === 0) return;
    // Subjective bodily damage (also explosions), not another literal gunshot.
    // UI is deliberately unducked/unmuffled; one composite has no propagation
    // or room send. A break already includes its plate/gear contact.
    this._playDry('damage', { amount, armourAbsorbed, plateBreak: p.plateBreak }, 'ui', 0);
  }

  _onDeath(p: EngineEventMap['actor:death']): void {
    if (!this.running) return;
    const pt = p?.point;
    if (!pt) return;
    this.bark('death', pt, { level: 1, force: true, voice: actorVoice(p?.actor) });
    const phys = this.ctx.peek('physics');
    const ground = phys?.raycast?.(pt.x, pt.y + 0.5, pt.z, 0, -1, 0, 4, phys.MASK?.WORLD);
    this._playAt(
      'bodyfall',
      pt.x,
      pt.y,
      pt.z,
      {
        level: 1,
        surface: ground?.hit ? ground.surface : 'concrete',
        extraDelay: 0.45 + this.rng.range(0, 0.4),
      },
      'foley',
      0.6
    );
  }

  /* ================================================================ */
  /* ambience callbacks                                               */
  /* ================================================================ */

  /** A burst of gunfire a long way off, with correct propagation delay. */
  _distantVolley(): void {
    if (!this.running) return;
    const rng = this.rng;
    const lp = this.field!.listenerPos;
    const a = rng.range(0, Math.PI * 2);
    const d = rng.range(70, 240);
    const x = lp.x + Math.cos(a) * d;
    const z = lp.z + Math.sin(a) * d;
    const y = lp.y + rng.range(-2, 6);
    const profile = rng.pick([
      WEAPON_PROFILES.ak,
      WEAPON_PROFILES.rifle,
      WEAPON_PROFILES.lmg,
      WEAPON_PROFILES.sniper,
    ]);
    const rounds = 1 + ((rng.u32() % 6) | 0);
    const rate = rng.range(0.075, 0.13);
    for (let i = 0; i < rounds; i++) {
      this._playAt(
        'shot',
        x,
        y,
        z,
        {
          profile,
          extraDelay: i * rate * rng.range(0.9, 1.1),
          maxDist: 400,
          gain: 4.5,
          occlusion: 0, // it is over the rooftops, not through them
        },
        'weapons',
        0.2
      );
    }
  }

  _distantBoom(): void {
    if (!this.running) return;
    const rng = this.rng;
    const lp = this.field!.listenerPos;
    const a = rng.range(0, Math.PI * 2);
    const d = rng.range(120, 330);
    this._playAt(
      'explosion',
      lp.x + Math.cos(a) * d,
      lp.y + rng.range(0, 8),
      lp.z + Math.sin(a) * d,
      {
        radius: rng.range(6, 16),
        level: 1,
        maxDist: 400,
        occlusion: 0,
        // Distant environmental punctuation, not a second foreground blast.
        gain: 0.1,
      },
      'weapons',
      0.25
    );
  }

  _ambientOneShot(): void {
    if (!this.running) return;
    const rng = this.rng;
    const lp = this.field!.listenerPos;
    const which = rng.pick(ONE_SHOTS);
    const far = which === 'heli' || which === 'siren';
    const d = far ? rng.range(90, 260) : rng.range(14, 90);
    const a = rng.range(0, Math.PI * 2);
    this._playAt(
      'ambient',
      lp.x + Math.cos(a) * d,
      lp.y + rng.range(-1, which === 'heli' ? 28 : 5),
      lp.z + Math.sin(a) * d,
      {
        which,
        level: rng.range(0.55, 1),
        maxDist: 400,
        occlusion: far ? 0 : undefined,
        gain: far ? AMBIENT_EVENT_GAIN[which] : AMBIENT_EVENT_GAIN.near,
      },
      'ambience',
      0.15
    );
  }

  /* ================================================================ */
  /* debug                                                            */
  /* ================================================================ */

  /**
   * Fire one of everything, through the real event bus. Used by
   * src/audio/probe.mjs to prove the live graph runs without throwing; also
   * handy from the browser console.
   */
  debugStorm(): { error: string } | { ok: true; voices: number; errors: number } {
    if (!this.running) return { error: 'audio not running' };
    const lp = this.field!.listenerPos;
    const at = (dx: number, dy: number, dz: number) => new Vector3(lp.x + dx, lp.y + dy, lp.z + dz);
    const ev = this.ctx.events;
    ev.emit('weapon:fire', {
      weapon: 'rifle',
      origin: at(0.2, -0.1, -0.3),
      actor: null,
      dir: new Vector3(0, 0, -1),
      seed: 1,
    });
    ev.emit('weapon:fire', {
      weapon: 'ak',
      origin: at(14, 0, -22),
      actor: null,
      dir: new Vector3(0, 0, 1),
      seed: 2,
    });
    ev.emit('weapon:fire', {
      weapon: 'sniper',
      origin: at(-70, 3, 90),
      actor: null,
      dir: new Vector3(1, 0, 0),
      seed: 3,
    });
    ev.emit('weapon:fire', {
      weapon: 'shotgun',
      origin: at(3, 0, -4),
      actor: null,
      dir: new Vector3(0, 0, -1),
      seed: 4,
    });
    ev.emit('weapon:fire', {
      weapon: { id: 'mp5', suppressed: true },
      origin: at(-2, 0, -3),
      actor: null,
      dir: new Vector3(0, 0, -1),
      seed: 5,
    });
    ev.emit('weapon:fire', {
      weapon: 'rifle',
      actor: null,
      origin: at(0.2, -0.1, -0.3),
      dir: new Vector3(0, 0, -1),
      seed: 0,
      empty: true,
    });
    const surfaces = [
      'concrete',
      'metal',
      'wood',
      'dirt',
      'sand',
      'glass',
      'water',
      'foliage',
      'fabric',
      'flesh',
      'rubber',
      'plaster',
    ];
    for (const s of surfaces) {
      ev.emit('bullet:impact', {
        point: at(this.rng.range(-6, 6), this.rng.range(0, 2), this.rng.range(-8, -2)),
        normal: new Vector3(0, 1, 0),
        incident: new Vector3(0, 0, -1),
        surface: s,
        damage: 32,
        exit: false,
      });
      ev.emit('player:footstep', {
        position: at(0, -1.6, 0),
        surface: s,
        running: true,
        stance: 'stand',
      });
    }
    ev.emit('weapon:shell', { position: at(0.3, -0.2, -0.2), velocity: new Vector3(1, 1, 0) });
    for (const ph of ['start', 'magout', 'magin', 'end'] as const)
      ev.emit('weapon:reload', { weapon: 'rifle', phase: ph });
    ev.emit('bullet:segment', {
      from: at(-30, 0, -30),
      to: at(2, 0, 2),
      speed: 880,
      shooter: null,
      shot: 0,
      weapon: null,
      tracer: false,
    });
    ev.emit('player:land', { velocity: 9, surface: 'concrete' });
    ev.emit('player:state', { stance: 'crouch', sprinting: false, sliding: false, ads: true });
    ev.emit('damage:dealt', {
      target: { id: 3 },
      amount: 34,
      headshot: true,
      killed: false,
      point: at(4, 0, -9),
    });
    ev.emit('damage:taken', {
      amount: 28,
      from: at(4, 0, -9),
      health: 24,
      armourAbsorbed: 0,
      armour: 0,
      plateBreak: false,
    });
    ev.emit('actor:death', { actor: { id: 3 }, point: at(4, -1.2, -9), impulse: new Vector3() });
    for (const k of ['spot', 'reload', 'grenade', 'flank', 'suppress', 'advance', 'hurt', 'copy']) {
      this.bark(k, at(this.rng.range(-9, 9), 0, this.rng.range(-9, 9)), {
        force: true,
        voice: this.rng.int(0, 9),
      });
    }
    for (const w of ONE_SHOTS) {
      this._playAt(
        'ambient',
        lp.x + 20,
        lp.y + 2,
        lp.z - 20,
        { which: w, level: 0.6 },
        'ambience',
        0.1
      );
    }
    this._distantVolley();
    this._distantBoom();
    ev.emit('explosion', { position: at(6, 0, -7), radius: 8, damage: 120 });
    return { ok: true, voices: this.field!.stats.active, errors: this.stats.errors };
  }

  /** Snapshot for the dev overlay and the probe script. */
  report() {
    return {
      running: this.running,
      failed: this.failed,
      state: this.actx?.state ?? 'none',
      sampleRate: this.actx?.sampleRate ?? 0,
      firearmSamples: this.samples?.loaded ?? 0,
      voices: this.field?.stats.active ?? 0,
      dropped: this.field?.stats.dropped ?? 0,
      stolen: this.field?.stats.stolen ?? 0,
      occlusionRays: this.field?.stats.occlusionRays ?? 0,
      space: this.stats.space,
      spaceWeights: this.mixer ? { ...this.mixer.spaceWeights } : null,
      enclosure: this._space.enclosure,
      meanFree: this._space.meanFree,
      deafness: this.deafness,
      outputSafety: 'lookahead-peak-limiter',
      events: this.stats.events,
      errors: this.stats.errors,
    };
  }
}

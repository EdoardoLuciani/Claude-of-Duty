import type { AiCalloutKind, ReloadPhase } from '../core/events.ts';
import type { Rng } from '../core/rng.ts';
import { AIRCRAFT_URLS } from './aircraft.ts';
import { CALLOUT_URLS, CALLOUT_MIX, calloutBank } from './callouts.ts';
import { COMBAT_URLS, type CombatKind } from './combat.ts';
import { clamp, gain, series } from './dsp.ts';
import {
  ENVIRONMENT_URLS,
  ENVIRONMENT_GAIN,
  environmentBank,
  type EnvironmentKind,
} from './environment.ts';
import {
  EXPLOSION_URLS,
  EXPLOSION_MIX,
  explosionBlend,
  type ExplosionKind,
  type ExplosionBank,
} from './explosions.ts';
import { FOLEY_URLS } from './foley-urls.ts';
import { HIT_MIX, HIT_URLS, type DamageSoundOptions } from './hits.ts';
import { FALL_BANK, FOLEY_MIX, IMPACT_BANK, STEP_BANK, type FoleyOptions } from './physical.ts';
import { RADIO_URLS, RADIO_MIX, RADIO_PARTS, type RadioKind } from './radio.ts';
import { REACTION_URLS, REACTION_MIX, reactionBank, type ReactionKind } from './reactions.ts';
import { RELOAD_MIX, RELOAD_URLS, reloadKind, type ReloadKind } from './reloads.ts';
import type { AudioVoice, SampleKind, SampleOptions, WeaponProfile } from './types.ts';
import { REPORT_DISTANT_MATCH, reportDistantMix } from './weapons.ts';

/*
 * Legacy firearm bank: PRIVATE local-only review Opus delivery copies, bundled by Vite.
 * Float WAV masters remain offline authoring inputs, not runtime imports.
 * Operator authorized local commits; commercial derivatives are NOT cleared
 * for public Git distribution or upload.
 * See the private recovery recipe/provenance. Newly cleared contact/reload
 * recordings have separate provenance under samples/hits/ and samples/reloads/;
 * see the audio asset contract in ARCHITECTURE.md. The replacement AK reports
 * have separate owner-requested public provenance in samples/ak-provenance.json.
 */
const URLS = {
  mpx: [
    new URL('./samples/mpx-1.opus', import.meta.url).href,
    new URL('./samples/mpx-2.opus', import.meta.url).href,
    new URL('./samples/mpx-3.opus', import.meta.url).href,
  ],
  'rifle-distant': [
    new URL('./samples/rifle-distant-1.opus', import.meta.url).href,
    new URL('./samples/rifle-distant-2.opus', import.meta.url).href,
  ],
  'pistol-distant': [
    new URL('./samples/pistol-distant-1.opus', import.meta.url).href,
    new URL('./samples/pistol-distant-2.opus', import.meta.url).href,
  ],
  'lmg-distant': [
    new URL('./samples/lmg-distant-1.opus', import.meta.url).href,
    new URL('./samples/lmg-distant-2.opus', import.meta.url).href,
  ],
  'sniper-distant': [
    new URL('./samples/sniper-distant-1.opus', import.meta.url).href,
    new URL('./samples/sniper-distant-2.opus', import.meta.url).href,
  ],
  'shotgun-distant': [
    new URL('./samples/shotgun-distant-1.opus', import.meta.url).href,
    new URL('./samples/shotgun-distant-2.opus', import.meta.url).href,
  ],
  mcx: [
    new URL('./samples/mcx-1.opus', import.meta.url).href,
    new URL('./samples/mcx-2.opus', import.meta.url).href,
  ],
  rifle: [
    new URL('./samples/rifle-1.opus', import.meta.url).href,
    new URL('./samples/rifle-2.opus', import.meta.url).href,
    new URL('./samples/rifle-3.opus', import.meta.url).href,
  ],
  sniper: [
    new URL('./samples/sniper-1.opus', import.meta.url).href,
    new URL('./samples/sniper-2.opus', import.meta.url).href,
    new URL('./samples/sniper-3.opus', import.meta.url).href,
  ],
  ak: [
    new URL('./samples/ak-1.opus', import.meta.url).href,
    new URL('./samples/ak-2.opus', import.meta.url).href,
    new URL('./samples/ak-3.opus', import.meta.url).href,
  ],
  'ak-distant': [
    new URL('./samples/ak-distant-1.opus', import.meta.url).href,
    new URL('./samples/ak-distant-2.opus', import.meta.url).href,
  ],
  lmg: [
    new URL('./samples/lmg-1.opus', import.meta.url).href,
    new URL('./samples/lmg-2.opus', import.meta.url).href,
    new URL('./samples/lmg-3.opus', import.meta.url).href,
  ],
  smg: [
    new URL('./samples/smg-1.opus', import.meta.url).href,
    new URL('./samples/smg-2.opus', import.meta.url).href,
    new URL('./samples/smg-3.opus', import.meta.url).href,
  ],
  pistol: [
    new URL('./samples/pistol-1.opus', import.meta.url).href,
    new URL('./samples/pistol-2.opus', import.meta.url).href,
    new URL('./samples/pistol-3.opus', import.meta.url).href,
  ],
  shotgun: [
    new URL('./samples/shotgun-1.opus', import.meta.url).href,
    new URL('./samples/shotgun-2.opus', import.meta.url).href,
    new URL('./samples/shotgun-3.opus', import.meta.url).href,
  ],
} satisfies Record<SampleKind, string[]>;

const HEARTBEAT_URL = new URL('./samples/heartbeat.opus', import.meta.url).href;

/** Required decoded recordings. Any fetch/decode failure rejects the bank. */
const CONTACT_URLS = {
  ...HIT_URLS,
  ...FOLEY_URLS,
  ...COMBAT_URLS,
  ...REACTION_URLS,
  ...CALLOUT_URLS,
  ...ENVIRONMENT_URLS,
  ...RADIO_URLS,
  ...EXPLOSION_URLS,
};
type ContactKind = keyof typeof CONTACT_URLS;
type SpecialBufferKey = 'heartbeatBuffer';
export class WeaponSampleBank {
  actx: BaseAudioContext;
  buffers: Partial<Record<SampleKind, AudioBuffer[]>>;
  indices: Partial<Record<SampleKind, number>>;
  heartbeatBuffer: AudioBuffer | null;
  aircraftBuffers: AudioBuffer[];
  aircraftIndex: number;
  hitBuffers: Partial<Record<ContactKind, AudioBuffer[]>>;
  hitIndices: Partial<Record<ContactKind, number>>;
  reloadBuffers: Partial<Record<ReloadKind, AudioBuffer[]>>;
  reloadIndices: Partial<Record<ReloadKind, number>>;
  loaded: number;
  constructor(actx: BaseAudioContext) {
    this.actx = actx;
    this.buffers = {};
    this.indices = {};
    this.heartbeatBuffer = null;
    this.aircraftBuffers = [];
    this.aircraftIndex = -1;
    this.hitBuffers = {};
    this.hitIndices = {};
    this.reloadBuffers = {};
    this.reloadIndices = {};
    this.loaded = 0;
  }

  async load(): Promise<number> {
    const jobs = [];
    for (const kind of Object.keys(URLS) as SampleKind[]) {
      const urls = URLS[kind];
      this.buffers[kind] = new Array<AudioBuffer>(urls.length);
      this.indices[kind] = 0;
      urls.forEach((url, index): number =>
        jobs.push(this._loadInto(this.buffers[kind]!, index, url))
      );
    }
    jobs.push(this._loadSpecial('heartbeatBuffer', HEARTBEAT_URL));
    this.aircraftBuffers = new Array<AudioBuffer>(AIRCRAFT_URLS.length);
    this.aircraftIndex = -1;
    AIRCRAFT_URLS.forEach((url, index): number =>
      jobs.push(this._loadInto(this.aircraftBuffers, index, url))
    );
    for (const kind of Object.keys(CONTACT_URLS) as ContactKind[]) {
      this.hitBuffers[kind] = new Array<AudioBuffer>(CONTACT_URLS[kind].length);
      this.hitIndices[kind] = -1;
      CONTACT_URLS[kind].forEach((url, index): number =>
        jobs.push(this._loadInto(this.hitBuffers[kind]!, index, url))
      );
    }
    for (const kind of Object.keys(RELOAD_URLS) as ReloadKind[]) {
      this.reloadBuffers[kind] = new Array<AudioBuffer>(RELOAD_URLS[kind].length);
      this.reloadIndices[kind] = -1;
      RELOAD_URLS[kind].forEach((url, index): number =>
        jobs.push(this._loadInto(this.reloadBuffers[kind]!, index, url))
      );
    }
    // Finish all decodes before start() tears down a failed bank.
    for (const result of await Promise.allSettled(jobs))
      if (result.status === 'rejected') throw result.reason;
    return this.loaded;
  }

  async _loadBuffer(url: string): Promise<AudioBuffer> {
    const response = await fetch(url);
    if (!response.ok) throw new Error(`[audio] failed to load ${url}: HTTP ${response.status}`);
    const buffer = await this.actx.decodeAudioData(await response.arrayBuffer());
    this.loaded++;
    return buffer;
  }

  private async _loadInto(buffers: AudioBuffer[], index: number, url: string): Promise<void> {
    buffers[index] = await this._loadBuffer(url);
  }

  async _loadSpecial(field: SpecialBufferKey, url: string): Promise<void> {
    this[field] = await this._loadBuffer(url);
  }

  /** One RNG draw per cue; a one-take bank necessarily repeats its only take. */
  private _nextTake<K extends string>(
    kind: K,
    buffers: Partial<Record<K, AudioBuffer[]>>,
    indices: Partial<Record<K, number>>,
    rng: Rng,
    family = ''
  ): AudioBuffer {
    const choices = buffers[kind];
    if (!choices?.length) {
      const label = family ? `${kind} ${family}` : kind;
      throw new Error(`[audio] ${label} recordings are not loaded`);
    }
    const previous = indices[kind] ?? -1;
    const index =
      previous < 0
        ? rng.u32() % choices.length
        : (previous + 1 + (rng.u32() % Math.max(1, choices.length - 1))) % choices.length;
    indices[kind] = index;
    return choices[index];
  }

  nextAircraft(rng: Rng): AudioBuffer {
    if (!this.aircraftBuffers.length) throw new Error('[audio] aircraft recordings are not loaded');
    this.aircraftIndex =
      this.aircraftIndex < 0
        ? rng.u32() % this.aircraftBuffers.length
        : (this.aircraftIndex + 1) % this.aircraftBuffers.length;
    return this.aircraftBuffers[this.aircraftIndex];
  }

  /** Recorded handling only: unsupported cues and missing assets never synthesize. */
  reload(
    weapon: string,
    phase: ReloadPhase | undefined,
    rng: Rng,
    o: Pick<SampleOptions, 'when'> = {}
  ): AudioVoice {
    const kind = reloadKind(weapon, phase);
    if (!kind) throw new Error(`[audio] no recorded reload cue for ${weapon}/${phase}`);
    const buffer = this._nextTake(kind, this.reloadBuffers, this.reloadIndices, rng, 'reload');
    const src = this.actx.createBufferSource();
    src.buffer = buffer;
    // Preserve authored attack timing and action duration; vary takes, not pitch.
    const out = gain(this.actx, RELOAD_MIX.gain * rng.range(0.97, 1.03));
    src.connect(out);
    const when = o.when ?? this.actx.currentTime;
    src.start(when);
    return { node: out, end: when + src.buffer.duration + 0.02, send: RELOAD_MIX.send };
  }

  /** Stable recorded identity; no pitch shifting and no immediate repeated take. */
  reaction(
    kind: ReactionKind,
    voice: number,
    rng: Rng,
    o: { when?: number; level?: number } = {}
  ): AudioVoice {
    const buffer = this._nextTake(reactionBank(voice, kind), this.hitBuffers, this.hitIndices, rng);
    const src = this.actx.createBufferSource();
    src.buffer = buffer;
    const out = gain(this.actx, REACTION_MIX.gain * (o.level ?? 1));
    src.connect(out);
    const when = o.when ?? this.actx.currentTime;
    src.start(when);
    return { node: out, end: when + src.buffer.duration + 0.02, send: REACTION_MIX.send };
  }

  /** Local speech, natural rate and stable identity; caller owns interruption/cleanup. */
  callout(
    kind: AiCalloutKind,
    voice: number,
    rng: Rng,
    o: { when?: number; level?: number } = {}
  ): AudioVoice & { stop(): void } {
    const buffer = this._nextTake(calloutBank(voice, kind), this.hitBuffers, this.hitIndices, rng);
    const src = this.actx.createBufferSource();
    src.buffer = buffer;
    const out = gain(this.actx, CALLOUT_MIX.gain * (o.level ?? 1));
    src.connect(out);
    const when = o.when ?? this.actx.currentTime;
    src.start(when);
    let stopped = false;
    return {
      node: out,
      end: when + buffer.duration + 0.02,
      send: CALLOUT_MIX.send,
      stop(): void {
        if (stopped) return;
        stopped = true;
        src.stop();
        src.disconnect();
        out.disconnect();
      },
    };
  }

  /** Required finite background event; use recorded takes, not pitch-shifted pseudo-variants. */
  environment(
    kind: EnvironmentKind,
    rng: Rng,
    o: { when?: number; level?: number } = {}
  ): AudioVoice {
    const buffer = this._nextTake(environmentBank(kind), this.hitBuffers, this.hitIndices, rng);
    const src = this.actx.createBufferSource();
    src.buffer = buffer;
    const out = gain(this.actx, ENVIRONMENT_GAIN[kind] * (o.level ?? 1));
    src.connect(out);
    const when = o.when ?? this.actx.currentTime;
    src.start(when);
    return { node: out, end: when + src.buffer.duration + 0.02, send: 0.65 };
  }

  /** One finite click/static composite; receive-only intel never invents a button press. */
  radio(kind: RadioKind, rng: Rng, o: { when?: number; level?: number } = {}): AudioVoice {
    const when = o.when ?? this.actx.currentTime,
      out = gain(this.actx, 1);
    let end = when;
    for (const key of RADIO_PARTS[kind]) {
      const click = key === 'radio-click',
        start = when + (click ? 0 : RADIO_MIX.staticDelay);
      const buffer = this._nextTake(key, this.hitBuffers, this.hitIndices, rng);
      const src = this.actx.createBufferSource();
      src.buffer = buffer;
      const trim = gain(this.actx, (click ? RADIO_MIX.click : RADIO_MIX.static) * (o.level ?? 1));
      src.connect(trim);
      trim.connect(out);
      src.start(start);
      end = Math.max(end, start + src.buffer.duration + 0.02);
    }
    return { node: out, end, send: 0 };
  }

  /** No hot-path fetch/decode, and no immediate repeat within a contact family. */
  hit(kind: ContactKind, rng: Rng, o: { when?: number; level?: number } = {}): AudioVoice {
    const buffer = this._nextTake(kind, this.hitBuffers, this.hitIndices, rng, 'contact');
    const src = this.actx.createBufferSource();
    src.buffer = buffer;
    const rate = rng.range(HIT_MIX.rateMin, HIT_MIX.rateMax);
    src.playbackRate.value = rate;
    const out = gain(this.actx, (o.level ?? 1) * rng.range(HIT_MIX.gainMin, HIT_MIX.gainMax));
    src.connect(out);
    const when = o.when ?? this.actx.currentTime;
    src.start(when);
    return { node: out, end: when + src.buffer.duration / rate + 0.02, send: HIT_MIX.send };
  }

  /** One incoming event owns one voice, with only the intended physical layers. */
  damage(rng: Rng, o: DamageSoundOptions): AudioVoice {
    const when = o.when ?? this.actx.currentTime;
    const mixed = o.amount > 0 && o.armourAbsorbed > 0;
    // Severity belongs to the event total: splitting one hit across plates and
    // health must not attenuate both components twice and bury mixed hits.
    const severity = clamp((o.amount + o.armourAbsorbed) / 25, 0.45, 1.15);
    const out = gain(this.actx, HIT_MIX.player * (o.level ?? 1) * severity);
    let end = when;
    if (o.armourAbsorbed > 0) {
      const armour = this.hit(o.plateBreak ? 'break' : 'armour', rng, {
        when,
        level: mixed ? HIT_MIX.mixedArmour : 1,
      });
      armour.node.connect(out);
      end = Math.max(end, armour.end);
    }
    if (o.amount > 0) {
      const flesh = this.hit('flesh', rng, {
        when,
        level: mixed ? HIT_MIX.mixedHealth : 1,
      });
      flesh.node.connect(out);
      end = Math.max(end, flesh.end);
    }
    return { node: out, end, send: 0 };
  }

  impact(rng: Rng, o: FoleyOptions = {}): AudioVoice {
    const kind = IMPACT_BANK[o.surface ?? 'concrete'] ?? IMPACT_BANK.concrete;
    const voice = this.hit(kind, rng, {
      when: o.when,
      level: (o.level ?? 1) * FOLEY_MIX.impact * (o.surface === 'plaster' ? FOLEY_MIX.plaster : 1),
    });
    voice.send = FOLEY_MIX.impactSend;
    return voice;
  }

  /** A single emitter owns boot + optional water/gear layers, on the same clock. */
  step(rng: Rng, o: FoleyOptions = {}): AudioVoice {
    const when = o.when ?? this.actx.currentTime;
    const gait = o.gait ?? 'walk';
    const pair = STEP_BANK[o.surface ?? 'concrete'] ?? STEP_BANK.concrete;
    const fast = gait === 'run' || gait === 'sprint' || gait === 'land';
    const level = (o.level ?? 1) * (FOLEY_MIX.gait[gait] ?? FOLEY_MIX.gait.walk) * FOLEY_MIX.step;
    const out = gain(this.actx, level);
    const kind = fast ? pair.run : pair.walk;
    const boot = this.hit(kind, rng, { when, level: FOLEY_MIX.stepLevel[kind] ?? 1 });
    boot.node.connect(out);
    let end = boot.end;
    if (o.surface === 'water') {
      const splash = this.hit('splash', rng, { when, level: FOLEY_MIX.splashLevel });
      splash.node.connect(out);
      end = Math.max(end, splash.end);
    }
    const gearLevel = o.gear ?? FOLEY_MIX.gear[gait] ?? FOLEY_MIX.gear.walk;
    if (gearLevel > 0) {
      const gear = this.hit('gear', rng, { when, level: gearLevel * FOLEY_MIX.gearLevel });
      gear.node.connect(out);
      end = Math.max(end, gear.end);
    }
    return { node: out, end, send: FOLEY_MIX.stepSend };
  }

  fall(rng: Rng, o: FoleyOptions = {}): AudioVoice {
    const voice = this.hit(FALL_BANK[o.surface ?? 'concrete'] ?? FALL_BANK.concrete, rng, {
      when: o.when,
      level: (o.level ?? 1) * FOLEY_MIX.fall,
    });
    voice.send = FOLEY_MIX.fallSend;
    return voice;
  }

  cloth(rng: Rng, o: FoleyOptions = {}): AudioVoice {
    const voice = this.hit('cloth', rng, { when: o.when, level: (o.level ?? 1) * FOLEY_MIX.cloth });
    voice.send = FOLEY_MIX.clothSend;
    return voice;
  }

  /** Complete recorded reports at every range; no pitch/level jitter or repair layers. */
  shot(profile: WeaponProfile, _rng: Rng, o: SampleOptions = {}): AudioVoice {
    const mix = reportDistantMix(o.distance ?? 0, profile, o.firstPerson);
    const kind = mix === 1 ? profile.distantSample : profile.sample;
    if (!kind) throw new Error('[audio] profile has no recording');
    const choices = this.buffers[kind];
    if (!choices?.length) throw new Error(`[audio] ${kind} recordings are not loaded`);
    const index = this.indices[kind] ?? 0;
    this.indices[kind] = (index + 1) % choices.length;
    const buffer = choices[index];
    const actx = this.actx;
    const t0 = o.when ?? actx.currentTime;
    const src = actx.createBufferSource();
    src.buffer = buffer;
    src.playbackRate.value = 1;
    const out = gain(actx, 1);
    let duration = buffer.duration;
    // Head-locked reports retain stereo. Only positional emitters downmix.
    if (!o.firstPerson) {
      out.channelCount = 1;
      out.channelCountMode = 'explicit';
    }
    if (mix > 0 && mix < 1) {
      const farKind = profile.distantSample!;
      const farChoices = this.buffers[farKind];
      if (!farChoices?.length) throw new Error(`[audio] ${farKind} recordings are not loaded`);
      const farIndex = this.indices[farKind] ?? 0;
      this.indices[farKind] = (farIndex + 1) % farChoices.length;
      const far = actx.createBufferSource();
      far.buffer = farChoices[farIndex]!;
      far.playbackRate.value = 1;
      const closeWeight = Math.cos((mix * Math.PI) / 2);
      const farWeight = Math.sin((mix * Math.PI) / 2) * (REPORT_DISTANT_MATCH[farKind] ?? 1);
      const total = closeWeight + farWeight;
      series(src, gain(actx, closeWeight / total), out);
      series(far, gain(actx, farWeight / total), out);
      far.start(t0);
      duration = Math.max(duration, far.buffer.duration);
    } else {
      src.connect(out);
    }
    src.start(t0);
    return { node: out, end: t0 + duration + 0.04, send: 0 };
  }

  /** One required recorded physical cue, with source timing/identity left intact. */
  combat(
    kind: CombatKind,
    rng: Rng,
    o: { when?: number; level?: number; delay?: number; send?: number } = {}
  ): AudioVoice {
    const buffer = this._nextTake(kind, this.hitBuffers, this.hitIndices, rng, 'combat');
    const src = this.actx.createBufferSource();
    src.buffer = buffer;
    const out = gain(this.actx, o.level ?? 1);
    src.connect(out);
    const when = (o.when ?? this.actx.currentTime) + Math.max(0, o.delay ?? 0);
    src.start(when);
    return { node: out, end: when + buffer.duration + 0.02, send: o.send ?? 0 };
  }

  /** Required recorded blast at every distance, with no synthetic reinforcement. */
  explosion(
    kind: ExplosionKind,
    rng: Rng,
    o: { when?: number; distance?: number; level?: number } = {}
  ): AudioVoice {
    const { from, to, mix } = explosionBlend(o.distance ?? 0);
    const fromKey: ExplosionBank = `${kind}-${from}`;
    const toKey: ExplosionBank = `${kind}-${to}`;
    // Validate/select all required layers before creating or scheduling any nodes.
    const fromBuffer =
      mix < 1 ? this._nextTake(fromKey, this.hitBuffers, this.hitIndices, rng, 'explosion') : null;
    const toBuffer =
      mix > 0 ? this._nextTake(toKey, this.hitBuffers, this.hitIndices, rng, 'explosion') : null;
    const actx = this.actx;
    const when = o.when ?? actx.currentTime;
    const out = gain(actx, o.level ?? 1);
    let end = when;
    for (const [buffer, weight] of [
      [fromBuffer, 1 - mix],
      [toBuffer, mix],
    ] as const) {
      if (!buffer) continue;
      const src = actx.createBufferSource();
      src.buffer = buffer;
      // Linear complementary weights avoid a level boost during a perspective blend.
      const layer = gain(actx, weight);
      src.connect(layer);
      layer.connect(out);
      src.start(when);
      end = Math.max(end, when + buffer.duration);
    }
    return { node: out, end: end + 0.02, send: EXPLOSION_MIX.send };
  }

  dispose(): void {
    for (const key of Object.keys(this.buffers) as SampleKind[]) this.buffers[key]!.length = 0;
    this.buffers = {};
    this.indices = {};
    for (const key of Object.keys(this.hitBuffers) as ContactKind[])
      this.hitBuffers[key]!.length = 0;
    this.hitBuffers = {};
    this.hitIndices = {};
    for (const key of Object.keys(this.reloadBuffers) as ReloadKind[])
      this.reloadBuffers[key]!.length = 0;
    this.reloadBuffers = {};
    this.reloadIndices = {};
    this.heartbeatBuffer = null;
    this.aircraftBuffers.length = 0;
    this.aircraftIndex = -1;
    this.loaded = 0;
  }
}

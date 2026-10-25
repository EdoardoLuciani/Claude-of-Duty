import type { AiCalloutKind, ReloadPhase } from '../core/events.ts';
import type { Rng } from '../core/rng.ts';
import { AIRCRAFT_URLS } from './aircraft.ts';
import { CALLOUT_URLS, CALLOUT_MIX, calloutBank } from './callouts.ts';
import { biquad, clamp, gain, series } from './dsp.ts';
import {
  ENVIRONMENT_URLS,
  ENVIRONMENT_GAIN,
  environmentBank,
  type EnvironmentKind,
} from './environment.ts';
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
 * see the audio asset contract in ARCHITECTURE.md.
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
  suppressed: [
    new URL('./samples/suppressed-1.opus', import.meta.url).href,
    new URL('./samples/suppressed-2.opus', import.meta.url).href,
  ],
} satisfies Record<SampleKind, string[]>;

const ACTION_URL = new URL('./samples/action.opus', import.meta.url).href;
const EXPLOSION_URL = new URL('./samples/explosion.opus', import.meta.url).href;
const HEARTBEAT_URL = new URL('./samples/heartbeat.opus', import.meta.url).href;

/** Required decoded recordings. Any fetch/decode failure rejects the bank. */
const CONTACT_URLS = {
  ...HIT_URLS,
  ...FOLEY_URLS,
  ...REACTION_URLS,
  ...CALLOUT_URLS,
  ...ENVIRONMENT_URLS,
  ...RADIO_URLS,
};
type ContactKind = keyof typeof CONTACT_URLS;
type SpecialBufferKey = 'actionBuffer' | 'explosionBuffer' | 'heartbeatBuffer';
export class WeaponSampleBank {
  actx: BaseAudioContext;
  buffers: Partial<Record<SampleKind, AudioBuffer[]>>;
  indices: Partial<Record<SampleKind, number>>;
  actionBuffer: AudioBuffer | null;
  explosionBuffer: AudioBuffer | null;
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
    this.actionBuffer = null;
    this.explosionBuffer = null;
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
      urls.forEach((url, index) => jobs.push(this._loadInto(this.buffers[kind]!, index, url)));
    }
    jobs.push(this._loadSpecial('actionBuffer', ACTION_URL));
    jobs.push(this._loadSpecial('explosionBuffer', EXPLOSION_URL));
    jobs.push(this._loadSpecial('heartbeatBuffer', HEARTBEAT_URL));
    this.aircraftBuffers = new Array<AudioBuffer>(AIRCRAFT_URLS.length);
    this.aircraftIndex = -1;
    AIRCRAFT_URLS.forEach((url, index) =>
      jobs.push(this._loadInto(this.aircraftBuffers, index, url))
    );
    for (const kind of Object.keys(CONTACT_URLS) as ContactKind[]) {
      this.hitBuffers[kind] = new Array<AudioBuffer>(CONTACT_URLS[kind].length);
      this.hitIndices[kind] = -1;
      CONTACT_URLS[kind].forEach((url, index) =>
        jobs.push(this._loadInto(this.hitBuffers[kind]!, index, url))
      );
    }
    for (const kind of Object.keys(RELOAD_URLS) as ReloadKind[]) {
      this.reloadBuffers[kind] = new Array<AudioBuffer>(RELOAD_URLS[kind].length);
      this.reloadIndices[kind] = -1;
      RELOAD_URLS[kind].forEach((url, index) =>
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
      stop() {
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

  /**
   * Build a firearm voice from a predecoded report. Authored variants retain
   * their original rate, level differences and natural decay. Legacy isolated
   * recordings retain their existing reinforcement and variation.
   */
  shot(profile: WeaponProfile, rng: Rng, o: SampleOptions = {}): AudioVoice {
    const mix = reportDistantMix(o.distance ?? 0, profile, o.firstPerson);
    const distant = mix === 1;
    const kind = distant ? profile.distantSample : profile.sample;
    if (!kind) throw new Error('[audio] profile has no recording');
    const choices = this.buffers[kind];
    if (!choices?.length) throw new Error(`[audio] ${kind} recordings are not loaded`);
    const index = this.indices[kind] ?? 0;
    this.indices[kind] = (index + 1) % choices.length;
    const buffer = choices[index];

    const actx = this.actx;
    const t0 = o.when ?? actx.currentTime;
    const dist = Math.max(0, o.distance ?? 0);
    const completeReport = profile.samplePunch === false;
    const rate = completeReport ? 1 : clamp(rng.range(0.97, 1.03), 0.94, 1.06);
    const src = actx.createBufferSource();
    src.buffer = buffer;
    src.playbackRate.value = rate;

    const out = gain(
      actx,
      completeReport ? 1 : (profile.sampleGain ?? 2.2) * rng.range(0.95, 1.05)
    );
    let duration = buffer.duration / rate;
    // Complete designed reports already contain transient, body and action.
    // Do not apply the legacy repair EQ or double their mechanical/body layers.
    if (completeReport) {
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
        const closeGain = gain(actx, closeWeight / total);
        const farGain = gain(actx, farWeight / total);
        series(src, closeGain, out);
        series(far, farGain, out);
        far.start(t0);
        duration = Math.max(duration, far.buffer.duration);
      } else {
        src.connect(out);
      }
    } else {
      const hp = biquad(actx, 'highpass', 38, 0.7);
      // Only legacy AK/generic-suppressed takes need repair EQ; the shipped
      // pistol/SMG/shotgun reports bypass this branch entirely.
      const box = biquad(actx, 'peaking', rng.range(295, 345), 1.8, -4.2);
      const weight = biquad(actx, 'peaking', rng.range(115, 145), 1, 1.5);
      const air = biquad(actx, 'highshelf', 7600, 0.7, 1.8);
      series(src, hp, box, weight);

      // Suppressed .300 BLK uses a real firearm take, then removes the supersonic
      // top-end. Unsuppressed fire retains an airy pressure crack.
      if (profile.suppressed) {
        const lp = biquad(actx, 'lowpass', profile.sampleLowpass ?? 1750, 0.75);
        series(weight, lp, out);
      } else {
        series(weight, air, out);
      }
    }

    src.start(t0);
    let end = t0 + duration + 0.04;

    // Legacy isolated takes add one dark, quiet terrain reflection. A delayed copy
    // is a much clearer outdoor distance cue than washing the direct shot in a
    // long generic reverb, and remains localisable because it follows the same
    // emitter/panner as the direct report.
    if (!completeReport && dist > 8 && !o.firstPerson && !distant && !profile.suppressed) {
      const bounce = actx.createBufferSource();
      bounce.buffer = buffer;
      bounce.playbackRate.value = rate * rng.range(0.995, 1.005);
      const bounceHP = biquad(actx, 'highpass', 90, 0.7);
      const bounceLP = biquad(actx, 'lowpass', rng.range(1300, 1900), 0.65);
      const bounceGain = gain(actx, rng.range(0.13, 0.18));
      series(bounce, bounceHP, bounceLP, bounceGain, out);
      const bounceDelay = clamp(0.007 + dist * 0.00022, 0.008, 0.022);
      bounce.start(t0 + bounceDelay);
      end = Math.max(end, t0 + bounceDelay + buffer.duration / bounce.playbackRate.value + 0.04);
    }

    // Real dry action detail for the player's receiver/ejection-port side.
    if (dist < 4 && profile.sampleAction !== false) {
      const action = actx.createBufferSource();
      action.buffer = this.actionBuffer;
      action.playbackRate.value = rng.range(0.96, 1.04);
      const actionHP = biquad(actx, 'highpass', 220, 0.7);
      const actionCut = biquad(actx, 'peaking', 4000, 3, -2.5);
      const actionAir = biquad(actx, 'highshelf', 9000, 0.7, 2);
      const actionGain = gain(actx, rng.range(0.5, 0.65));
      const actionPan = actx.createStereoPanner();
      actionPan.pan.value = o.firstPerson ? 0.22 : 0;
      series(action, actionHP, actionCut, actionAir, actionGain, actionPan, out);
      const actionOffset = 0.05;
      const actionTime = t0 + rng.range(0.024, 0.031);
      action.start(actionTime, actionOffset);
      end = Math.max(
        end,
        actionTime + (this.actionBuffer!.duration - actionOffset) / action.playbackRate.value + 0.03
      );
    }

    return {
      node: out,
      end,
      // Authored profiles are dry: their complete recorded decay is the tail.
      // Legacy isolated takes retain their separately tuned environmental send.
      send: (profile.sampleSend ?? 0.2) * (1 + Math.min(dist, 100) * 0.004),
    };
  }

  /** Recorded close-range explosion, lightly shaped before procedural reinforcement. */
  explosion(rng: Rng, o: Pick<SampleOptions, 'when'> = {}): AudioVoice {
    if (!this.explosionBuffer) throw new Error('[audio] explosion recording is not loaded');
    const actx = this.actx;
    const t0 = o.when ?? actx.currentTime;
    const src = actx.createBufferSource();
    src.buffer = this.explosionBuffer;
    src.playbackRate.value = rng.range(0.97, 1.03);
    const hp = biquad(actx, 'highpass', 30, 0.7);
    const crack = biquad(actx, 'peaking', 4000, 1.0, 1.2);
    crack.gain.setTargetAtTime(0, t0 + 0.035, 0.008);
    const air = biquad(actx, 'highshelf', 4000, 0.7, 1.5);
    // Restore the take's thin power band after the initial crack has passed.
    const mid = biquad(actx, 'peaking', 350, 1.1, 2.8);
    mid.gain.setValueAtTime(0, t0);
    mid.gain.linearRampToValueAtTime(2.8, t0 + 0.006);
    mid.gain.setTargetAtTime(0, t0 + 0.21, 0.117);
    const low = biquad(actx, 'lowshelf', 130, 0.8, 1.5);
    const out = gain(actx, 2.45 * rng.range(0.96, 1.04));
    series(src, hp, crack, air, mid, low, out);
    src.start(t0);
    return {
      node: out,
      end: t0 + this.explosionBuffer.duration / src.playbackRate.value + 0.05,
      send: 0.7,
    };
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
    this.actionBuffer = null;
    this.explosionBuffer = null;
    this.heartbeatBuffer = null;
    this.aircraftBuffers.length = 0;
    this.aircraftIndex = -1;
    this.loaded = 0;
  }
}

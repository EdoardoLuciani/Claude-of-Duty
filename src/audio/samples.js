import { biquad, clamp, gain, series } from './dsp.js';

/*
 * Real firearm recordings from Still North Media's Free Firearm Sound Library.
 * The trimmed PCM files live beside this module and are bundled by Vite, so the
 * game remains completely offline. See samples/LICENSE.md for provenance.
 */
const URLS = {
  // Clean CC0 outdoor field take. Runtime pitch/EQ and independent body/action
  // layers provide variation without alternating back to the clipped near take.
  rifle: [new URL('./samples/rifle-field.wav', import.meta.url).href],
  ak: [
    new URL('./samples/ak-1.wav', import.meta.url).href,
    new URL('./samples/ak-2.wav', import.meta.url).href,
  ],
  // Two CC BY 3.0 machine-gun rounds; see samples/LICENSE.md.
  lmg: [
    new URL('./samples/lmg-1.wav', import.meta.url).href,
    new URL('./samples/lmg-2.wav', import.meta.url).href,
  ],
  smg: [
    new URL('./samples/smg-1.wav', import.meta.url).href,
    new URL('./samples/smg-2.wav', import.meta.url).href,
  ],
  pistol: [
    new URL('./samples/pistol-1.wav', import.meta.url).href,
    new URL('./samples/pistol-2.wav', import.meta.url).href,
  ],
  shotgun: [
    new URL('./samples/shotgun-1.wav', import.meta.url).href,
    new URL('./samples/shotgun-2.wav', import.meta.url).href,
  ],
  sniper: [
    new URL('./samples/sniper-1.wav', import.meta.url).href,
    new URL('./samples/sniper-2.wav', import.meta.url).href,
  ],
  suppressed: [
    new URL('./samples/suppressed-1.wav', import.meta.url).href,
    new URL('./samples/suppressed-2.wav', import.meta.url).href,
  ],
};

const ACTION_URL = new URL('./samples/action.wav', import.meta.url).href;
const EXPLOSION_URL = new URL('./samples/explosion.wav', import.meta.url).href;

/** Decoded, round-robin firearm recordings. Failed files simply use synthesis. */
export class WeaponSampleBank {
  constructor(actx) {
    this.actx = actx;
    this.buffers = {};
    this.indices = {};
    this.actionBuffer = null;
    this.explosionBuffer = null;
    this.loaded = 0;
  }

  async load() {
    const jobs = [];
    for (const [kind, urls] of Object.entries(URLS)) {
      this.buffers[kind] = new Array(urls.length).fill(null);
      this.indices[kind] = 0;
      urls.forEach((url, index) => jobs.push(this._loadOne(kind, index, url)));
    }
    jobs.push(this._loadSpecial('actionBuffer', ACTION_URL));
    jobs.push(this._loadSpecial('explosionBuffer', EXPLOSION_URL));
    await Promise.all(jobs);
    return this.loaded;
  }

  async _loadOne(kind, index, url) {
    try {
      const response = await fetch(url);
      if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
      const buffer = await this.actx.decodeAudioData(await response.arrayBuffer());
      this.buffers[kind][index] = buffer;
      this.loaded++;
    } catch (err) {
      console.warn(`[audio] firearm sample failed (${kind} ${index + 1}):`, err?.message ?? err);
    }
  }

  async _loadSpecial(field, url) {
    try {
      const response = await fetch(url);
      if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
      this[field] = await this.actx.decodeAudioData(await response.arrayBuffer());
      this.loaded++;
    } catch (err) {
      console.warn(`[audio] layered sample failed (${field}):`, err?.message ?? err);
    }
  }

  /**
   * Build a firearm voice from a real field recording. Small playback-rate and
   * EQ variation prevents automatic fire from repeating in phase without making
   * a real firearm sound conspicuously pitch-shifted.
   */
  shot(profile, rng, o = {}) {
    const kind = profile.sample ?? 'rifle';
    const choices = this.buffers[kind] ?? this.buffers.rifle;
    if (!choices?.some(Boolean)) return null;

    let index = this.indices[kind] ?? 0;
    let buffer = null;
    for (let i = 0; i < choices.length; i++) {
      index = (index + 1) % choices.length;
      if (choices[index]) { buffer = choices[index]; break; }
    }
    this.indices[kind] = index;
    if (!buffer) return null;

    const actx = this.actx;
    const t0 = o.when ?? actx.currentTime;
    const dist = Math.max(0, o.distance ?? 0);
    const rate = clamp(rng.range(0.97, 1.03), 0.94, 1.06);
    const src = actx.createBufferSource();
    src.buffer = buffer;
    src.playbackRate.value = rate;

    // Correct the close-mic take before layering it: remove infrasonic movement,
    // notch its cardboard resonance, restore shoulder/chest weight, then add a
    // little clean air above the clipped source transient.
    const isSmg = kind === 'smg';
    const isPistol = kind === 'pistol';
    const isShotgun = kind === 'shotgun';
    const hp = biquad(actx, 'highpass', isPistol ? 65 : isSmg ? 45 : isShotgun ? 42 : 38, 0.7);
    // PCC receiver/barrel resonance belongs around 250–320 Hz; the compact
    // pistol needs the opposite contour so the two 9 mm platforms cannot clone.
    const box = biquad(actx, 'peaking', isSmg ? rng.range(250, 300) : isShotgun ? rng.range(210, 260) : rng.range(295, 345),
      isSmg ? 1.25 : isShotgun ? 1.2 : 1.8, isSmg ? 2 : isPistol ? -5 : isShotgun ? -2.2 : -4.2);
    const weight = biquad(actx, 'peaking', rng.range(isShotgun ? 95 : 115, isShotgun ? 130 : 145), 1.0,
      isPistol ? -3 : isSmg ? 0.5 : isShotgun ? 1.8 : 1.5);
    const air = biquad(actx, 'highshelf', isPistol ? 3900 : isSmg ? 5200 : isShotgun ? 6200 : 7600,
      0.7, isPistol ? 3.6 : isSmg ? 2.2 : isShotgun ? 3.4 : 1.8);
    const out = gain(actx, (profile.sampleGain ?? 2.2) * rng.range(0.95, 1.05));
    series(src, hp, box, weight);

    // Suppressed .300 BLK uses a real firearm take, then removes the supersonic
    // top-end. Unsuppressed fire retains an airy pressure crack.
    if (profile.suppressed) {
      const lp = biquad(actx, 'lowpass', 1750, 0.75);
      series(weight, lp, out);
    } else {
      series(weight, air, out);
    }

    src.start(t0);
    const duration = buffer.duration / rate;
    let end = t0 + duration + 0.04;

    // Past a few metres, add one dark, quiet terrain reflection. A delayed copy
    // is a much clearer outdoor distance cue than washing the direct shot in a
    // long generic reverb, and remains localisable because it follows the same
    // emitter/panner as the direct report.
    if (dist > 8 && !profile.suppressed) {
      const bounce = actx.createBufferSource();
      bounce.buffer = buffer;
      bounce.playbackRate.value = rate * rng.range(0.995, 1.005);
      const bounceHP = biquad(actx, 'highpass', 90, 0.7);
      const bounceLP = biquad(actx, 'lowpass', rng.range(1300, 1900), 0.65);
      const bounceGain = gain(actx, rng.range(0.13, 0.18));
      series(bounce, bounceHP, bounceLP, bounceGain, out);
      const bounceDelay = clamp(0.007 + dist * 0.00022, 0.008, 0.022);
      bounce.start(t0 + bounceDelay);
      end = Math.max(end, t0 + bounceDelay + duration + 0.04);
    }

    // Real dry action detail for the player's receiver/ejection-port side.
    if (dist < 4 && this.actionBuffer) {
      const action = actx.createBufferSource();
      action.buffer = this.actionBuffer;
      action.playbackRate.value = isPistol ? rng.range(1.16, 1.24) :
        isSmg ? rng.range(0.86, 0.96) : isShotgun ? rng.range(0.78, 0.86) : rng.range(0.96, 1.04);
      const actionHP = biquad(actx, 'highpass', isPistol ? 700 : isSmg ? 180 : isShotgun ? 140 : 220, 0.7);
      const actionCut = biquad(actx, 'peaking', isPistol ? 3200 : isShotgun ? 2200 : 4000, 3, isPistol ? 1.5 : isShotgun ? 1.8 : -2.5);
      const actionAir = biquad(actx, 'highshelf', isPistol ? 6200 : isShotgun ? 5400 : 9000, 0.7, isPistol ? 3 : isShotgun ? 0.6 : 2);
      const actionGain = gain(actx, isPistol ? rng.range(0.9, 1.05) :
        isSmg ? rng.range(0.75, 0.9) : isShotgun ? rng.range(0.85, 1.05) : rng.range(0.5, 0.65));
      const actionPan = actx.createStereoPanner();
      actionPan.pan.value = o.firstPerson ? 0.22 : 0;
      series(action, actionHP, actionCut, actionAir, actionGain, actionPan, out);
      // Start at different sections of the multi-click recording: AR gets the
      // full carrier/return sequence, MPX a slower heavy pair, pistol a short,
      // bright slide-back/slide-forward pair.
      const actionOffset = isPistol ? 0.195 : isSmg ? 0.18 : isShotgun ? 0.08 : 0.05;
      const actionTime = t0 + (isPistol ? rng.range(0.011, 0.015) :
        isSmg ? rng.range(0.02, 0.026) : isShotgun ? rng.range(0.14, 0.2) : rng.range(0.024, 0.031));
      action.start(actionTime, actionOffset);
      end = Math.max(end, actionTime + (this.actionBuffer.duration - actionOffset) /
        action.playbackRate.value + 0.03);
    }

    return {
      node: out,
      end,
      // The isolated takes end quickly, so the local space must answer them.
      // The return itself is heavily trimmed in Mixer; this is still a subtle
      // environmental tail rather than a second, synthetic muzzle report.
      send: (profile.sampleSend ?? 0.2) * (1 + Math.min(dist, 100) * 0.004),
    };
  }

  /** Recorded close-range explosion, lightly shaped before procedural reinforcement. */
  explosion(rng, o = {}) {
    if (!this.explosionBuffer) return null;
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

  dispose() {
    for (const key in this.buffers) this.buffers[key].fill(null);
    this.buffers = {};
    this.indices = {};
    this.actionBuffer = null;
    this.explosionBuffer = null;
    this.loaded = 0;
  }
}

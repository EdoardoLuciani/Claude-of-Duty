import { biquad, clamp, gain, series } from './dsp.js';

/*
 * Real firearm recordings from Still North Media's Free Firearm Sound Library.
 * The trimmed PCM files live beside this module and are bundled by Vite, so the
 * game remains completely offline. See samples/LICENSE.md for provenance.
 */
const URLS = {
  rifle: [
    new URL('./samples/rifle-1.wav', import.meta.url).href,
    new URL('./samples/rifle-2.wav', import.meta.url).href,
  ],
  ak: [
    new URL('./samples/ak-1.wav', import.meta.url).href,
    new URL('./samples/ak-2.wav', import.meta.url).href,
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

/** Decoded, round-robin firearm recordings. Failed files simply use synthesis. */
export class WeaponSampleBank {
  constructor(actx) {
    this.actx = actx;
    this.buffers = {};
    this.indices = {};
    this.loaded = 0;
  }

  async load() {
    const jobs = [];
    for (const [kind, urls] of Object.entries(URLS)) {
      this.buffers[kind] = new Array(urls.length).fill(null);
      this.indices[kind] = 0;
      urls.forEach((url, index) => jobs.push(this._loadOne(kind, index, url)));
    }
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

  /**
   * Build a firearm voice from a real field recording. Variation is restricted
   * to a tiny playback-rate window: enough to stop automatic fire phasing, but
   * not enough to turn a real gun into a pitched sound effect.
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
    const rate = clamp(rng.range(0.985, 1.015), 0.95, 1.05);
    const src = actx.createBufferSource();
    src.buffer = buffer;
    src.playbackRate.value = rate;

    // Remove only infrasonic recorder movement. Distance/occlusion filtering is
    // handled later by SpatialField; preserving the recording here keeps the
    // muzzle crack and stereo pressure wave intact for the player's weapon.
    const hp = biquad(actx, 'highpass', 32, 0.65);
    const out = gain(actx, (profile.sampleGain ?? 2.2) * rng.range(0.97, 1.03));
    series(src, hp, out);

    // Suppressed .300 BLK uses a real firearm take, then removes the supersonic
    // top-end. The close mechanical report remains from the recording.
    if (profile.suppressed) {
      const lp = biquad(actx, 'lowpass', 1750, 0.75);
      hp.disconnect();
      hp.connect(lp);
      lp.connect(out);
    }

    src.start(t0);
    const duration = buffer.duration / rate;
    return {
      node: out,
      end: t0 + duration + 0.04,
      // Recordings already contain a natural outdoor tail. Keep convolution a
      // subtle localisation cue instead of laying a synthetic warehouse over it.
      send: (profile.sampleSend ?? 0.07) * (1 + Math.min(dist, 100) * 0.004),
    };
  }

  dispose() {
    for (const key in this.buffers) this.buffers[key].fill(null);
    this.buffers = {};
    this.indices = {};
    this.loaded = 0;
  }
}

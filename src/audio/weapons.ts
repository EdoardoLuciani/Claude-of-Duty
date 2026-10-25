/**
 * AUDIO / WEAPON FIRE
 *
 * Complete authored reports already contain their transient, body, action and
 * natural tail. SampleBank rotates unmodified reports without pitch/level jitter;
 * positional close/distant perspectives overlap only in the distance transition.
 * Enemy direction, distance, air and obstruction belong to SpatialField.
 *
 * The synthesis below remains for legacy AK/suppressed reports and ambient gunfire:
 * transient, body, crack, mid, tail, mechanism and distant boom. Those paths
 * still use their existing timbre variation and room/bounce treatment. They
 * are not additional processors on the complete authored reports.
 */

import type { Rng } from '../core/rng.ts';
import {
  ad,
  biquad,
  clamp,
  gain,
  hit,
  lerp,
  osc,
  saturationCurve,
  semis,
  series,
  shaper,
  struckResonator,
  sweep,
} from './dsp.ts';
import type { NoiseBank } from './dsp.ts';
import type {
  AudioVoice,
  SampleKind,
  WeaponProfile,
  LegacyWeaponProfile,
  WeaponSoundOptions,
} from './types.ts';

/** Approved +12 dB positional presentation vs the previous 0.5 reference.
 * Own reports bypass this gain. Not a measured microphone distance or SPL. */
export const REPORT_DISTANCE = {
  reference: 0.5 * 10 ** (12 / 20),
  blendStart: 20,
  blendEnd: 140,
} as const;

/** sqrt(mean close mono report energy / mean distant mono report energy).
 * Fixed bank-level reference matches, NOT per-take normalization or volume knobs.
 * Frozen full-tail bank energies live in samples/reference.json. */
export const REPORT_DISTANT_MATCH: Readonly<Partial<Record<SampleKind, number>>> = {
  'rifle-distant': 2.5059448946436964,
  'pistol-distant': 1.749320949339822,
  'lmg-distant': 2.5570276651449104,
  'sniper-distant': 1.5367612937080013,
  'shotgun-distant': 1.0058342240905216,
};

/** Equal-power perspective transition; own and same-source suppressed shots bypass it. */
export function reportDistantMix(
  distance: number,
  profile?: WeaponProfile,
  firstPerson = false
): number {
  if (firstPerson || !profile?.distantSample) return 0;
  return clamp(
    (distance - REPORT_DISTANCE.blendStart) /
      (REPORT_DISTANCE.blendEnd - REPORT_DISTANCE.blendStart),
    0,
    1
  );
}

export function reportDistanceGain(
  distance: number,
  profile?: WeaponProfile,
  firstPerson = false
): number {
  const mix = reportDistantMix(distance, profile, firstPerson);
  const match = profile?.distantSample ? (REPORT_DISTANT_MATCH[profile.distantSample] ?? 1) : 1;
  // Factor the crossfade's level into the existing distance node so the source
  // mix is convex, its output stays unity, and pure-bank routes stay unchanged.
  const reference =
    mix === 0
      ? 1
      : mix === 1
        ? match
        : Math.cos((mix * Math.PI) / 2) + match * Math.sin((mix * Math.PI) / 2);
  return (REPORT_DISTANCE.reference / Math.max(REPORT_DISTANCE.reference, distance)) * reference;
}

const SMG_PROFILE = {
  sample: 'smg',
  sampleSend: 0,
  sampleAction: false,
  samplePunch: false,
} as const;

/**
 * Per-weapon character. Frequencies in Hz, times in seconds.
 * `level` and body/tail parameters tune legacy synthesis, not authored playback.
 * Authored reports retain source level with unity voice output: no per-profile
 * playback trim. The mixer's single shared weapon level defaults to 1.
 */
export const WEAPON_PROFILES = {
  mcx: {
    // Private curated report: no duplicate synthesized body or generic action.
    sample: 'mcx',
    sampleSend: 0,
    sampleAction: false,
    samplePunch: false,
    suppressed: true,
  },
  rifle: {
    // Private curated report: no duplicate synthesized body or generic action.
    sample: 'rifle',
    distantSample: 'rifle-distant',
    sampleSend: 0,
    sampleAction: false,
    samplePunch: false,
  },
  ak: {
    sample: 'ak',
    sampleGain: 2.35,
    sampleSend: 0.52,
    level: 1.1,
    bodyF: 124,
    bodyF2: 46,
    bodyDecay: 0.105,
    subF: 52,
    subDecay: 0.15,
    crackF: 1780,
    crackQ: 0.9,
    crackDecay: 0.07,
    drive: 7.5,
    asym: 0.5,
    midF: 640,
    midDecay: 0.06,
    tailDecay: 0.42,
    tailF: 4200,
    tailEndF: 560,
    mechDelay: 0.034,
    mechLevel: 0.55,
    mechPartials: [1420, 2650, 4300],
    send: 0.34,
  },
  smg: SMG_PROFILE,
  mpx: {
    ...SMG_PROFILE,
    sample: 'mpx',
    suppressed: true,
  },
  pistol: {
    // Private curated report: no duplicate synthesized body or generic action.
    sample: 'pistol',
    distantSample: 'pistol-distant',
    sampleSend: 0,
    sampleAction: false,
    samplePunch: false,
  },
  shotgun: {
    // Private curated report: no duplicate synthesized body or generic action.
    sample: 'shotgun',
    distantSample: 'shotgun-distant',
    sampleSend: 0,
    sampleAction: false,
    samplePunch: false,
  },
  sniper: {
    // Private curated report: no duplicate synthesized body or generic action.
    sample: 'sniper',
    distantSample: 'sniper-distant',
    sampleSend: 0,
    sampleAction: false,
    samplePunch: false,
  },
  lmg: {
    // Private curated report: no duplicate synthesized body or generic action.
    sample: 'lmg',
    distantSample: 'lmg-distant',
    sampleSend: 0,
    sampleAction: false,
    samplePunch: false,
  },
  suppressed: {
    sample: 'suppressed',
    sampleGain: 1.15,
    sampleSend: 0.25,
    level: 0.5,
    bodyF: 132,
    bodyF2: 64,
    bodyDecay: 0.055,
    subF: 70,
    subDecay: 0.07,
    crackF: 900,
    crackQ: 0.6,
    crackDecay: 0.03,
    drive: 2.5,
    asym: 0.2,
    midF: 430,
    midDecay: 0.05,
    tailDecay: 0.1,
    tailF: 1800,
    tailEndF: 400,
    mechDelay: 0.019,
    mechLevel: 0.85,
    mechPartials: [2100, 3700, 5900],
    send: 0.18,
    suppressed: true,
  },
} satisfies Record<string, WeaponProfile>;

/** Map whatever the weapons subsystem calls its guns onto a profile. */
export function resolveProfile(name?: string | null): WeaponProfile {
  if (!name) return WEAPON_PROFILES.rifle;
  const k = String(name).toLowerCase();
  const profile = (WEAPON_PROFILES as Record<string, WeaponProfile>)[k];
  if (profile) return profile;
  if (/mcx|virtus/.test(k)) return WEAPON_PROFILES.mcx;
  if (/suppress|silenc/.test(k)) return WEAPON_PROFILES.suppressed;
  if (/ak|7\.?62|akm|scar/.test(k)) return WEAPON_PROFILES.ak;
  if (/mp5|mp7|smg|ump|vector|uzi/.test(k)) return WEAPON_PROFILES.smg;
  if (/pistol|glock|m19|deagle|handgun|sidearm/.test(k)) return WEAPON_PROFILES.pistol;
  if (/shot|pump|12g|benelli|spas/.test(k)) return WEAPON_PROFILES.shotgun;
  if (/snip|dmr|awp|barrett|338|intervention|marksman/.test(k)) return WEAPON_PROFILES.sniper;
  if (/lmg|mg4|m249|pkm|saw|minigun/.test(k)) return WEAPON_PROFILES.lmg;
  return WEAPON_PROFILES.rifle;
}

/* ------------------------------------------------------------------ */
/* Round robin                                                        */
/* ------------------------------------------------------------------ */

const RR_SLOTS = 6;

/** Build (once, lazily) the round-robin timbre table for a profile. */
function roundRobin(
  profile: LegacyWeaponProfile,
  rng: Rng
): NonNullable<LegacyWeaponProfile['_rr']> {
  if (profile._rr) return profile._rr;
  const rr = [];
  for (let i = 0; i < RR_SLOTS; i++) {
    rr.push({
      body: semis(rng.range(-1.1, 1.1)),
      crack: semis(rng.range(-1.7, 1.7)),
      crackQ: rng.range(0.85, 1.2),
      tail: rng.range(0.86, 1.18),
      drive: rng.range(0.85, 1.2),
      mid: semis(rng.range(-2, 2)),
      level: rng.range(0.93, 1.07),
      mech: rng.range(0.8, 1.25),
      // Slight per-slot spectral tilt: microphone/room position variance.
      tilt: rng.range(-2.5, 2.5),
    });
  }
  profile._rr = rr;
  profile._rrIndex = (rng.u32() % RR_SLOTS) | 0;
  return rr;
}

/**
 * Synthesize one shot.
 *
 * @param {BaseAudioContext} actx
 * @param {import('./dsp.ts').NoiseBank} bank
 * @param {import('../core/rng.ts').Rng} rng
 * @param {object} profile from WEAPON_PROFILES
 * @param {object} o { when, distance, indoor, firstPerson, echo }
 * @returns {{node: GainNode, end: number, send: number}}
 */
export function weaponShot(
  actx: BaseAudioContext,
  bank: NoiseBank,
  rng: Rng,
  profile: LegacyWeaponProfile,
  o: WeaponSoundOptions = {}
): AudioVoice {
  const t0 = o.when ?? actx.currentTime;
  const dist = Math.max(0, o.distance ?? 0);
  const fp = !!o.firstPerson;

  const rr = roundRobin(profile, rng);
  const rrIndex = profile._rrIndex!;
  profile._rrIndex = (rrIndex + 1) % RR_SLOTS;
  const v = rr[profile._rrIndex]!;

  // Per-shot jitter on top of the round-robin slot — the fine grain.
  const jB = v.body * semis(rng.range(-0.45, 0.45));
  const jC = v.crack * semis(rng.range(-0.8, 0.8));
  const jT = v.tail * rng.range(0.94, 1.07);
  const jL = v.level * rng.range(0.95, 1.05);

  // Distance mixing. Near = all crack and click; far = all boom and tail.
  const near = clamp(1 - dist / 42, 0, 1);
  const nearP = Math.pow(near, 0.7);
  const far = 1 - near;

  // VOICE TRIM — the gunshot is the loudest thing in the game and defines the
  // reference the rest of the mix is staged against.
  // 0.85, not 0.46: a single rifle shot through the master chain (bus trim
  // 1.35 x preGain 0.22 x master 0.95) peaks around -12 dBFS. The old 0.46
  // landed at -20 dBFS, which measured within 7 dB of the ambient bed peaks —
  // shots that read as buried background thumps.
  const out = gain(actx, 0.85);
  let end = t0 + 0.2;

  /* ---- 1. transient --------------------------------------------- */
  if (nearP > 0.05) {
    const tg = gain(actx, 0);
    const src = bank.source('white', rng, rng.range(0.9, 1.3));
    const hp = biquad(actx, 'highpass', 2600, 0.6);
    const pk = biquad(actx, 'peaking', 6200 * jC, 1.1, 8 + v.tilt);
    series(src, hp, pk, tg).connect(out);
    hit(tg.gain, t0, 0.9 * nearP * jL * (profile.suppressed ? 0.35 : 1), 0.0075);
    src.start(t0, src._offset, 0.05);
    // A single-cycle sine at the top of the click adds the "snap" that pure
    // noise cannot produce.
    const clk = osc(actx, 'triangle', 1750 * jC);
    const cg = gain(actx, 0);
    clk.connect(cg);
    cg.connect(out);
    hit(cg.gain, t0, 0.35 * nearP * jL, 0.004);
    clk.start(t0);
    clk.stop(t0 + 0.02);
  }

  /* ---- 2. body + sub -------------------------------------------- */
  {
    const bodyLevel = (0.85 + far * 0.5) * jL * profile.level;
    const b1 = osc(actx, 'sine', profile.bodyF * jB);
    const b2 = osc(actx, 'triangle', profile.bodyF * jB * 0.5);
    const bg = gain(actx, 0);
    const drv = shaper(actx, saturationCurve(profile.drive * v.drive * 0.5, profile.asym), '2x');
    const bodyLP = biquad(actx, 'lowpass', lerp(2200, 700, far), 0.9);
    b1.connect(bg);
    b2.connect(bg);
    series(bg, drv, bodyLP).connect(out);
    sweep(b1.frequency, t0, profile.bodyF * jB, profile.bodyF2 * jB, profile.bodyDecay * 1.4);
    sweep(
      b2.frequency,
      t0,
      profile.bodyF * jB * 0.5,
      profile.bodyF2 * jB * 0.55,
      profile.bodyDecay * 1.6
    );
    ad(bg.gain, t0, bodyLevel, 0.0012, profile.bodyDecay * rng.range(0.9, 1.15));
    b1.start(t0);
    b2.start(t0);
    const bEnd = t0 + profile.bodyDecay * 1.8 + 0.02;
    b1.stop(bEnd);
    b2.stop(bEnd);
    end = Math.max(end, bEnd);

    // Sub thump — this is the one that moves air; keep it out of the reverb.
    const s = osc(actx, 'sine', profile.subF * jB);
    const sg = gain(actx, 0);
    s.connect(sg);
    sg.connect(out);
    sweep(s.frequency, t0, profile.subF * jB * 1.5, profile.subF * jB * 0.8, profile.subDecay);
    ad(sg.gain, t0, (0.5 + far * 0.55) * profile.level, 0.004, profile.subDecay * 1.3);
    s.start(t0);
    s.stop(t0 + profile.subDecay * 2 + 0.05);
    end = Math.max(end, t0 + profile.subDecay * 2 + 0.05);
  }

  /* ---- 3. crack -------------------------------------------------- */
  if (nearP > 0.03) {
    const src = bank.source('white', rng, rng.range(0.85, 1.25));
    const bp = biquad(actx, 'bandpass', profile.crackF * jC, profile.crackQ * v.crackQ);
    const res = biquad(actx, 'peaking', profile.crackF * jC * 1.9, 1.6, 6 + v.tilt);
    const drv = shaper(actx, saturationCurve(profile.drive * v.drive, profile.asym * 0.6), '2x');
    const cg = gain(actx, 0);
    series(src, bp, res, drv, cg).connect(out);
    // The crack's own band sweeps down a little: the shock front decays.
    sweep(
      bp.frequency,
      t0,
      profile.crackF * jC * 1.35,
      profile.crackF * jC * 0.8,
      profile.crackDecay * 2
    );
    ad(
      cg.gain,
      t0,
      1.05 * nearP * jL * profile.level,
      0.0015,
      profile.crackDecay * rng.range(0.85, 1.2)
    );
    src.start(t0, src._offset, profile.crackDecay * 3 + 0.05);
    end = Math.max(end, t0 + profile.crackDecay * 3);
  }

  /* ---- 4. mid body ---------------------------------------------- */
  {
    const src = bank.source('pink', rng, rng.range(0.8, 1.25));
    const bp = biquad(actx, 'bandpass', profile.midF * v.mid, 1.1);
    const mg = gain(actx, 0);
    series(src, bp, mg).connect(out);
    ad(mg.gain, t0, (0.5 + far * 0.35) * jL * profile.level, 0.002, profile.midDecay * 1.4);
    src.start(t0, src._offset, profile.midDecay * 4 + 0.05);
  }

  /* ---- 5. tail --------------------------------------------------- */
  {
    const tailDur = profile.tailDecay * jT * (1 + far * 1.6);
    const src = bank.source('pink', rng, rng.range(0.7, 1.15));
    const lp = biquad(actx, 'lowpass', profile.tailF, 0.6);
    const hp = biquad(actx, 'highpass', lerp(160, 70, far), 0.7);
    const tg = gain(actx, 0);
    series(src, hp, lp, tg).connect(out);
    sweep(
      lp.frequency,
      t0,
      profile.tailF * lerp(1, 0.35, far),
      profile.tailEndF * lerp(1, 0.6, far),
      tailDur
    );
    ad(tg.gain, t0, (0.42 + far * 0.5) * jL * profile.level, 0.006, tailDur);
    src.start(t0, src._offset, tailDur * 1.3 + 0.05);
    end = Math.max(end, t0 + tailDur * 1.3);
  }

  /* ---- 6. mechanical / bolt ------------------------------------- */
  // Only audible close up — a rifle 40 m away has no audible action noise, and
  // spending nodes on it would be waste.
  if (dist < 14 && profile.mechLevel > 0) {
    const md = profile.mechDelay * rng.range(0.85, 1.2);
    const lvl = profile.mechLevel * v.mech * (fp ? 1 : 0.6) * clamp(1 - dist / 14, 0.15, 1);
    const partials = profile.mechPartials;
    const bolt = struckResonator(
      actx,
      bank,
      rng,
      t0 + md,
      [
        { f: partials[0] * rng.range(0.96, 1.05), q: 26, g: 0.5 * lvl, decay: 0.055 },
        { f: partials[1] * rng.range(0.96, 1.05), q: 20, g: 0.34 * lvl, decay: 0.035 },
        { f: partials[2] * rng.range(0.96, 1.05), q: 14, g: 0.2 * lvl, decay: 0.02 },
      ],
      0.0035
    );
    bolt.connect(out);
    // Return-to-battery: a second, softer clack a few ms later.
    const back = struckResonator(
      actx,
      bank,
      rng,
      t0 + md * 2.1,
      [
        { f: partials[0] * 0.88, q: 18, g: 0.3 * lvl, decay: 0.04 },
        { f: partials[1] * 1.12, q: 12, g: 0.16 * lvl, decay: 0.022 },
      ],
      0.003
    );
    back.connect(out);
    // Spring/gas hiss.
    const hs = bank.source('white', rng, rng.range(1, 1.4));
    const hbp = biquad(actx, 'bandpass', 4200 * rng.range(0.9, 1.1), 1.4);
    const hg = gain(actx, 0);
    series(hs, hbp, hg).connect(out);
    ad(hg.gain, t0 + md * 0.6, 0.12 * lvl, 0.006, 0.05);
    hs.start(t0 + md * 0.6, hs._offset, 0.12);
    end = Math.max(end, t0 + md * 2.1 + 0.1);
  }

  /* ---- 7. distant rolling boom ---------------------------------- */
  if (far > 0.12) {
    const boomDur = 0.28 + dist * 0.0055;
    const src = bank.source('brown', rng, rng.range(0.6, 1.0));
    const lp = biquad(actx, 'lowpass', 420, 0.8);
    const bg = gain(actx, 0);
    series(src, lp, bg).connect(out);
    sweep(lp.frequency, t0, 620, 190, boomDur);
    // 0.28, not 0.95: measured through the mix, a fully-distant shot (boom at
    // full envelope) peaked 3.4x hotter than the player's own rifle. Distant
    // enemy fire is the most common gunfire in a firefight; it must sit BELOW
    // the player's muzzle, not above it.
    ad(bg.gain, t0, 0.28 * far * far * profile.level, 0.012 + dist * 0.0004, boomDur);
    src.start(t0, src._offset, boomDur * 1.4 + 0.05);
    end = Math.max(end, t0 + boomDur * 1.4);

    // Ground/terrain bounce: one discrete slap after the direct sound. This is
    // the detail that makes long-range fire read as *outdoors*.
    const bounceT = t0 + clamp(dist * 0.0022, 0.012, 0.12);
    const b2 = bank.source('pink', rng, rng.range(0.6, 0.9));
    const blp = biquad(actx, 'lowpass', 900, 0.7);
    const b2g = gain(actx, 0);
    series(b2, blp, b2g).connect(out);
    ad(b2g.gain, bounceT, 0.15 * far, 0.004, 0.12 + dist * 0.001);
    b2.start(bounceT, b2._offset, 0.4);
  }

  const send = profile.send * (1 + far * 1.4) * (o.echoBoost ?? 1);
  return { node: out, end: end + 0.05, send };
}

/**
 * Low/body and action reinforcement for a recorded close firearm report.
 *
 * The source takes carry a convincing pressure crack but their short isolation
 * edits removed most of the chest hit and decay. This deliberately contributes
 * no broadband noise tail: adding another full synthetic shot beneath a field
 * recording sounds larger, but also creates the low-mid smear we are avoiding.
 */
export function weaponPunch(
  actx: BaseAudioContext,
  bank: NoiseBank,
  rng: Rng,
  profile: LegacyWeaponProfile,
  o: WeaponSoundOptions = {}
): AudioVoice {
  const t0 = o.when ?? actx.currentTime;
  const dist = Math.max(0, o.distance ?? 0);
  const fp = !!o.firstPerson;
  const near = clamp(1 - dist / 48, 0.12, 1);
  const level = profile.level * (profile.suppressed ? 0.62 : 1) * near;
  const pitch = semis(rng.range(-0.45, 0.45));
  const out = gain(actx, 0.95);

  // Clean shock-front snap above the rounded transient in the field take. It is
  // intentionally noise, not another saturated oscillator, so the limiter sees
  // a narrow micro-transient rather than a dense clipped block.
  if (!profile.suppressed) {
    const snap = bank.source('white', rng, rng.range(0.96, 1.05));
    const snapHP = biquad(actx, 'highpass', 3000, 0.65);
    const snapPeak = biquad(actx, 'peaking', 7500, 1.1, 4);
    const snapGain = gain(actx, 0);
    series(snap, snapHP, snapPeak, snapGain).connect(out);
    hit(snapGain.gain, t0, 1.2 * level, 0.0028);
    snap.start(t0, snap._offset, 0.025);
  }

  // Fast lower-mid pressure body. A 42 Hz high-pass is intentionally omitted:
  // these are oscillators, so there is no recorder/DC garbage to remove.
  const body = osc(actx, 'sine', profile.bodyF * pitch);
  const body2 = osc(actx, 'triangle', profile.bodyF * pitch * 0.52);
  const bg = gain(actx, 0);
  const drive = shaper(actx, saturationCurve(1.6, 0.2), '2x');
  const bodyLP = biquad(actx, 'lowpass', profile.suppressed ? 480 : 650, 0.72);
  body.connect(bg);
  body2.connect(bg);
  series(bg, drive, bodyLP).connect(out);
  sweep(
    body.frequency,
    t0,
    profile.bodyF * pitch * 1.15,
    profile.bodyF2 * pitch,
    profile.bodyDecay
  );
  sweep(
    body2.frequency,
    t0,
    profile.bodyF * pitch * 0.58,
    profile.bodyF2 * pitch * 0.48,
    profile.bodyDecay * 1.15
  );
  ad(bg.gain, t0, 0.52 * level, 0.001, profile.bodyDecay * 0.82);
  const bodyEnd = t0 + profile.bodyDecay * 1.5 + 0.025;
  body.start(t0);
  body2.start(t0);
  body.stop(bodyEnd);
  body2.stop(bodyEnd);

  // A separate sub pulse gives headphones/speakers weight without sustaining
  // enough 80–250 Hz energy to mask footsteps or the next automatic round.
  const subStart = clamp(profile.subF * 1.2, 68, 105) * pitch;
  const subAmount = profile.suppressed ? 0.18 : 0.62;
  const sub = osc(actx, 'sine', subStart);
  const sg = gain(actx, 0);
  sub.connect(sg);
  sg.connect(out);
  sweep(sub.frequency, t0, subStart, 40 * pitch, 0.06);
  ad(sg.gain, t0, subAmount * level, 0.002, 0.062);
  const subEnd = t0 + 0.115;
  sub.start(t0);
  sub.stop(subEnd);

  let end = Math.max(bodyEnd, subEnd);
  if (dist < 10 && profile.mechLevel > 0) {
    const mt = t0 + clamp(profile.mechDelay * 0.55, 0.012, 0.028) * rng.range(0.92, 1.08);
    const m = profile.mechPartials;
    const pan = actx.createStereoPanner();
    pan.pan.value = fp ? 0.25 : 0;
    pan.connect(out);
    struckResonator(
      actx,
      bank,
      rng,
      mt,
      [
        {
          f: m[0] * rng.range(0.96, 1.04),
          q: 24,
          g: 0.5 * profile.mechLevel * (fp ? 1 : 0.65),
          decay: 0.05,
        },
        { f: m[1] * rng.range(0.96, 1.04), q: 17, g: 0.28 * profile.mechLevel, decay: 0.027 },
        { f: m[2] * rng.range(0.97, 1.03), q: 12, g: 0.12 * profile.mechLevel, decay: 0.014 },
      ],
      0.0022
    ).connect(pan);
    struckResonator(
      actx,
      bank,
      rng,
      mt + rng.range(0.018, 0.027),
      [
        { f: m[0] * 0.84, q: 16, g: 0.24 * profile.mechLevel, decay: 0.038 },
        { f: m[1] * 1.08, q: 12, g: 0.1 * profile.mechLevel, decay: 0.018 },
      ],
      0.002
    ).connect(pan);
    end = Math.max(end, mt + 0.18);
  }

  return { node: out, end: end + 0.03, send: profile.sampleSend ?? 0.2 };
}

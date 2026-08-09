/**
 * AUDIO / WEAPON FIRE
 *
 * A gunshot is not one sound. Every layer below exists in real recordings and
 * removing any one of them is immediately audible:
 *
 *   1. TRANSIENT  sub-millisecond click — the pressure step. Gives the shot its
 *                 "instant" feel; without it the gun sounds like a firework.
 *   2. BODY       a fast downward-swept sine/triangle pair, saturated. This is
 *                 the chest thump, the layer people describe as "punch".
 *   3. CRACK      resonant band-passed noise around 1.5–3.5 kHz driven into
 *                 saturation. Calibre character lives here.
 *   4. MID        a short 500–900 Hz noise body that glues 2 and 3 together.
 *   5. TAIL       a broadband burst under a falling lowpass, fed hard into the
 *                 reverb send — this is what the *room* hears.
 *   6. MECH       the bolt/action: a separate, drier, later metallic layer. It
 *                 is what makes a weapon feel mechanical rather than sampled.
 *   7. BOOM       (distance only) a slow, dark, rolling low-frequency swell
 *                 plus a ground-bounce repeat.
 *
 * Variation: each profile owns a round-robin table of 6 timbre variants, and on
 * top of that every shot gets fresh pitch/level/decay jitter from ctx.rng. Two
 * consecutive rounds are never the same waveform, which is the single biggest
 * difference between "synthesized game audio" and "a looping sample".
 */

import {
  ad, biquad, clamp, gain, hit, lerp, osc, saturationCurve, semis, series, shaper,
  struckResonator, sweep,
} from './dsp.js';

/**
 * Per-weapon character. Frequencies in Hz, times in seconds.
 * `level` is a linear trim; the mix expects ~1.0 for a 5.56 rifle.
 */
export const WEAPON_PROFILES = {
  rifle: {
    sample: 'rifle', sampleGain: 1.9, sampleSend: 0.5, firstPersonGain: 1.18,
    level: 1.0, bodyF: 148, bodyF2: 56, bodyDecay: 0.085, subF: 62, subDecay: 0.12,
    crackF: 2450, crackQ: 0.95, crackDecay: 0.055, drive: 6, asym: 0.35,
    midF: 780, midDecay: 0.05, tailDecay: 0.3, tailF: 5200, tailEndF: 700,
    mechDelay: 0.028, mechLevel: 0.42, mechPartials: [1880, 3260, 5400], send: 0.3,
  },
  ak: {
    sample: 'ak', sampleGain: 2.35, sampleSend: 0.52,
    level: 1.1, bodyF: 124, bodyF2: 46, bodyDecay: 0.105, subF: 52, subDecay: 0.15,
    crackF: 1780, crackQ: 0.9, crackDecay: 0.07, drive: 7.5, asym: 0.5,
    midF: 640, midDecay: 0.06, tailDecay: 0.42, tailF: 4200, tailEndF: 560,
    mechDelay: 0.034, mechLevel: 0.55, mechPartials: [1420, 2650, 4300], send: 0.34,
  },
  smg: {
    sample: 'smg', sampleGain: 1.6, sampleSend: 0.38, firstPersonGain: 2.96,
    level: 0.84, bodyF: 172, bodyF2: 72, bodyDecay: 0.06, subF: 78, subDecay: 0.08,
    crackF: 3050, crackQ: 1.05, crackDecay: 0.04, drive: 5, asym: 0.3,
    midF: 900, midDecay: 0.035, tailDecay: 0.19, tailF: 6200, tailEndF: 900,
    mechDelay: 0.021, mechLevel: 0.5, mechPartials: [2200, 3900, 6300], send: 0.26,
  },
  pistol: {
    sample: 'pistol', sampleGain: 1.45, sampleSend: 0.2, firstPersonGain: 2.64,
    level: 0.74, bodyF: 186, bodyF2: 84, bodyDecay: 0.05, subF: 92, subDecay: 0.07,
    crackF: 2750, crackQ: 1.15, crackDecay: 0.035, drive: 4.5, asym: 0.28,
    midF: 950, midDecay: 0.03, tailDecay: 0.16, tailF: 6800, tailEndF: 1000,
    mechDelay: 0.038, mechLevel: 0.46, mechPartials: [2450, 4200, 6900], send: 0.24,
  },
  shotgun: {
    sample: 'shotgun', sampleGain: 2.8, sampleSend: 0.58,
    level: 1.18, bodyF: 108, bodyF2: 40, bodyDecay: 0.13, subF: 44, subDecay: 0.19,
    crackF: 1450, crackQ: 0.7, crackDecay: 0.09, drive: 9, asym: 0.6,
    midF: 520, midDecay: 0.08, tailDecay: 0.5, tailF: 3600, tailEndF: 460,
    mechDelay: 0.16, mechLevel: 0.7, mechPartials: [980, 1760, 3050], send: 0.36,
    pellets: 6,
  },
  sniper: {
    sample: 'sniper', sampleGain: 2.65, sampleSend: 0.6,
    level: 1.3, bodyF: 96, bodyF2: 34, bodyDecay: 0.16, subF: 38, subDecay: 0.24,
    crackF: 1320, crackQ: 0.8, crackDecay: 0.11, drive: 10, asym: 0.55,
    midF: 470, midDecay: 0.1, tailDecay: 0.95, tailF: 3300, tailEndF: 380,
    mechDelay: 0.19, mechLevel: 0.65, mechPartials: [1150, 2050, 3400], send: 0.42,
  },
  lmg: {
    /* 7.62x51 EVOLYS. Tuned against the MEASURED spectrum of the shipped
     * field take (lmg-1.wav): the real round's body peaks at ~75 Hz with a
     * strong 30-80 Hz sub band, the crack peaks at ~1.9 kHz, and the air
     * stays broadband to 16 kHz. bodyF/crackF below mirror that analysis;
     * the 42 ms bolt slap is the long-stroke action's own signature. */
    sample: 'lmg', sampleGain: 2.4, sampleSend: 0.5, firstPersonGain: 2.3,
    level: 1.22, bodyF: 88, bodyF2: 38, bodyDecay: 0.12, subF: 42, subDecay: 0.18,
    crackF: 1900, crackQ: 0.9, crackDecay: 0.085, drive: 9, asym: 0.55,
    midF: 560, midDecay: 0.075, tailDecay: 0.55, tailF: 3800, tailEndF: 480,
    mechDelay: 0.042, mechLevel: 0.65, mechPartials: [1250, 2200, 3700], send: 0.36,
  },
  suppressed: {
    sample: 'suppressed', sampleGain: 1.15, sampleSend: 0.25,
    level: 0.5, bodyF: 132, bodyF2: 64, bodyDecay: 0.055, subF: 70, subDecay: 0.07,
    crackF: 900, crackQ: 0.6, crackDecay: 0.03, drive: 2.5, asym: 0.2,
    midF: 430, midDecay: 0.05, tailDecay: 0.1, tailF: 1800, tailEndF: 400,
    mechDelay: 0.019, mechLevel: 0.85, mechPartials: [2100, 3700, 5900], send: 0.18,
    suppressed: true,
  },
};

/** Map whatever the weapons subsystem calls its guns onto a profile. */
export function resolveProfile(name) {
  if (!name) return WEAPON_PROFILES.rifle;
  const k = String(name).toLowerCase();
  if (WEAPON_PROFILES[k]) return WEAPON_PROFILES[k];
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
function roundRobin(profile, rng) {
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
 * @param {import('./dsp.js').NoiseBank} bank
 * @param {import('../core/rng.js').Rng} rng
 * @param {object} profile from WEAPON_PROFILES
 * @param {object} o { when, distance, indoor, firstPerson, echo }
 * @returns {{node: GainNode, end: number, send: number}}
 */
export function weaponShot(actx, bank, rng, profile, o = {}) {
  const t0 = o.when ?? actx.currentTime;
  const dist = Math.max(0, o.distance ?? 0);
  const fp = !!o.firstPerson;

  const rr = roundRobin(profile, rng);
  profile._rrIndex = (profile._rrIndex + 1) % RR_SLOTS;
  const v = rr[profile._rrIndex];

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
    clk.connect(cg); cg.connect(out);
    hit(cg.gain, t0, 0.35 * nearP * jL, 0.004);
    clk.start(t0); clk.stop(t0 + 0.02);
  }

  /* ---- 2. body + sub -------------------------------------------- */
  {
    const bodyLevel = (0.85 + far * 0.5) * jL * profile.level;
    const b1 = osc(actx, 'sine', profile.bodyF * jB);
    const b2 = osc(actx, 'triangle', profile.bodyF * jB * 0.5);
    const bg = gain(actx, 0);
    const drv = shaper(actx, saturationCurve(profile.drive * v.drive * 0.5, profile.asym), '2x');
    const bodyLP = biquad(actx, 'lowpass', lerp(2200, 700, far), 0.9);
    b1.connect(bg); b2.connect(bg);
    series(bg, drv, bodyLP).connect(out);
    sweep(b1.frequency, t0, profile.bodyF * jB, profile.bodyF2 * jB, profile.bodyDecay * 1.4);
    sweep(b2.frequency, t0, profile.bodyF * jB * 0.5, profile.bodyF2 * jB * 0.55, profile.bodyDecay * 1.6);
    ad(bg.gain, t0, bodyLevel, 0.0012, profile.bodyDecay * rng.range(0.9, 1.15));
    b1.start(t0); b2.start(t0);
    const bEnd = t0 + profile.bodyDecay * 1.8 + 0.02;
    b1.stop(bEnd); b2.stop(bEnd);
    end = Math.max(end, bEnd);

    // Sub thump — this is the one that moves air; keep it out of the reverb.
    const s = osc(actx, 'sine', profile.subF * jB);
    const sg = gain(actx, 0);
    s.connect(sg); sg.connect(out);
    sweep(s.frequency, t0, profile.subF * jB * 1.5, profile.subF * jB * 0.8, profile.subDecay);
    ad(sg.gain, t0, (0.5 + far * 0.55) * profile.level, 0.004, profile.subDecay * 1.3);
    s.start(t0); s.stop(t0 + profile.subDecay * 2 + 0.05);
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
    sweep(bp.frequency, t0, profile.crackF * jC * 1.35, profile.crackF * jC * 0.8, profile.crackDecay * 2);
    ad(cg.gain, t0, 1.05 * nearP * jL * profile.level, 0.0015, profile.crackDecay * rng.range(0.85, 1.2));
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
    sweep(lp.frequency, t0, profile.tailF * lerp(1, 0.35, far), profile.tailEndF * lerp(1, 0.6, far), tailDur);
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
    const bolt = struckResonator(actx, bank, rng, t0 + md, [
      { f: partials[0] * rng.range(0.96, 1.05), q: 26, g: 0.5 * lvl, decay: 0.055 },
      { f: partials[1] * rng.range(0.96, 1.05), q: 20, g: 0.34 * lvl, decay: 0.035 },
      { f: partials[2] * rng.range(0.96, 1.05), q: 14, g: 0.2 * lvl, decay: 0.02 },
    ], 0.0035);
    bolt.connect(out);
    // Return-to-battery: a second, softer clack a few ms later.
    const back = struckResonator(actx, bank, rng, t0 + md * 2.1, [
      { f: partials[0] * 0.88, q: 18, g: 0.3 * lvl, decay: 0.04 },
      { f: partials[1] * 1.12, q: 12, g: 0.16 * lvl, decay: 0.022 },
    ], 0.003);
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

  /* ---- shotgun pellet spatter ----------------------------------- */
  if (profile.pellets && nearP > 0.2) {
    for (let i = 0; i < profile.pellets; i++) {
      const pt = t0 + rng.range(0.0004, 0.006);
      const src = bank.source('white', rng, rng.range(0.9, 1.4));
      const bp = biquad(actx, 'bandpass', rng.range(2600, 6200), 1.8);
      const g = gain(actx, 0);
      series(src, bp, g).connect(out);
      hit(g.gain, pt, 0.1 * nearP, rng.range(0.004, 0.014));
      src.start(pt, src._offset, 0.05);
    }
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
export function weaponPunch(actx, bank, rng, profile, o = {}) {
  const t0 = o.when ?? actx.currentTime;
  const dist = Math.max(0, o.distance ?? 0);
  const fp = !!o.firstPerson;
  const near = clamp(1 - dist / 48, 0.12, 1);
  const level = profile.level * (profile.suppressed ? 0.62 : 1) * near;
  const pitch = semis(rng.range(-0.45, 0.45));
  const out = gain(actx, 0.95);
  const isSmg = profile === WEAPON_PROFILES.smg;
  const isPistol = profile === WEAPON_PROFILES.pistol;

  // Clean shock-front snap above the rounded transient in the field take. It is
  // intentionally noise, not another saturated oscillator, so the limiter sees
  // a narrow micro-transient rather than a dense clipped block.
  if (!profile.suppressed) {
    const snap = bank.source('white', rng, rng.range(0.96, 1.05));
    const snapHP = biquad(actx, 'highpass', isSmg || isPistol ? 2600 : 3000, 0.65);
    const snapPeak = biquad(actx, 'peaking', isSmg || isPistol ? 5200 : 7500, 1.1, isSmg || isPistol ? 2.5 : 4);
    const snapGain = gain(actx, 0);
    series(snap, snapHP, snapPeak, snapGain).connect(out);
    hit(snapGain.gain, t0, (isSmg || isPistol ? 0.9 : 1.2) * level, 0.0028);
    snap.start(t0, snap._offset, 0.025);
  }

  // Fast lower-mid pressure body. A 42 Hz high-pass is intentionally omitted:
  // these are oscillators, so there is no recorder/DC garbage to remove.
  const body = osc(actx, 'sine', profile.bodyF * pitch);
  const body2 = osc(actx, 'triangle', profile.bodyF * pitch * 0.52);
  const bg = gain(actx, 0);
  const drive = shaper(actx, saturationCurve(1.6, 0.2), '2x');
  const bodyLP = biquad(actx, 'lowpass', profile.suppressed ? 480 : 650, 0.72);
  body.connect(bg); body2.connect(bg);
  series(bg, drive, bodyLP).connect(out);
  sweep(body.frequency, t0, profile.bodyF * pitch * 1.15, profile.bodyF2 * pitch, profile.bodyDecay);
  sweep(body2.frequency, t0, profile.bodyF * pitch * 0.58, profile.bodyF2 * pitch * 0.48, profile.bodyDecay * 1.15);
  ad(bg.gain, t0, (isSmg || isPistol ? 0.3 : 0.52) * level, 0.001, profile.bodyDecay * 0.82);
  const bodyEnd = t0 + profile.bodyDecay * 1.5 + 0.025;
  body.start(t0); body2.start(t0); body.stop(bodyEnd); body2.stop(bodyEnd);

  // A separate sub pulse gives headphones/speakers weight without sustaining
  // enough 80–250 Hz energy to mask footsteps or the next automatic round.
  const subStart = clamp(profile.subF * 1.2, 68, 105) * pitch;
  const subAmount = profile.suppressed ? 0.18 : isPistol ? 0.14 : isSmg ? 0.2 :
    profile === WEAPON_PROFILES.rifle ? 0.42 : 0.62;
  const subEndHz = isPistol || isSmg ? 58 : profile === WEAPON_PROFILES.rifle ? 46 : 40;
  const sub = osc(actx, 'sine', subStart);
  const sg = gain(actx, 0);
  sub.connect(sg); sg.connect(out);
  sweep(sub.frequency, t0, subStart, subEndHz * pitch, 0.06);
  ad(sg.gain, t0, subAmount * level, 0.002, 0.062);
  const subEnd = t0 + 0.115;
  sub.start(t0); sub.stop(subEnd);

  let end = Math.max(bodyEnd, subEnd);
  // Long rolling tail for the LMG's recorded path. weaponShot (the distant
  // fallback) synthesizes a tail from tailF/tailEndF/tailDecay, but the
  // recorded path (sample + punch) had none — and a short close-mic take
  // leaves a near-silent hole once the master compressor's release window
  // (140 ms) passes: the EVOLYS report ended in a crack while the carbine's
  // long field take kept booming.
  if (profile.sample === 'lmg') {
    const tDecay = profile.tailDecay ?? 0.55;
    const tail = bank.source('white', rng, tDecay + 0.05);
    const tl = biquad(actx, 'lowpass', profile.tailF ?? 3800, 0.6);
    const tg = gain(actx, 0);
    series(tail, tl, tg).connect(out);
    sweep(tl.frequency, t0, profile.tailF ?? 3800, profile.tailEndF ?? 480, tDecay);
    ad(tg.gain, t0, 0.34 * level, 0.004, tDecay);
    tail.start(t0, tail._offset, tDecay + 0.05);
    end = Math.max(end, t0 + tDecay + 0.05);
  }
  if (dist < 10 && profile.mechLevel > 0) {
    const mt = t0 + clamp(profile.mechDelay * 0.55, 0.012, 0.028) * rng.range(0.92, 1.08);
    const m = profile.mechPartials;
    const pan = actx.createStereoPanner();
    pan.pan.value = fp ? 0.25 : 0;
    pan.connect(out);
    struckResonator(actx, bank, rng, mt, [
      { f: m[0] * rng.range(0.96, 1.04), q: 24, g: 0.5 * profile.mechLevel * (fp ? 1 : 0.65), decay: 0.05 },
      { f: m[1] * rng.range(0.96, 1.04), q: 17, g: 0.28 * profile.mechLevel, decay: 0.027 },
      { f: m[2] * rng.range(0.97, 1.03), q: 12, g: 0.12 * profile.mechLevel, decay: 0.014 },
    ], 0.0022).connect(pan);
    struckResonator(actx, bank, rng, mt + rng.range(0.018, 0.027), [
      { f: m[0] * 0.84, q: 16, g: 0.24 * profile.mechLevel, decay: 0.038 },
      { f: m[1] * 1.08, q: 12, g: 0.1 * profile.mechLevel, decay: 0.018 },
    ], 0.002).connect(pan);
    if (profile === WEAPON_PROFILES.rifle) {
      // AR buffer tube spring: a quiet, high-Q metallic twang following carrier
      // unlock. This near-ear signature differentiates it from both 9 mm guns.
      struckResonator(actx, bank, rng, mt + 0.032, [
        { f: rng.range(1180, 1380), q: 52, g: 0.11, decay: 0.14 },
        { f: rng.range(2350, 2700), q: 38, g: 0.055, decay: 0.09 },
      ], 0.0018).connect(pan);
    }
    end = Math.max(end, mt + 0.18);
  }

  return { node: out, end: end + 0.03, send: profile.sampleSend ?? 0.2 };
}

/**
 * Supersonic round passing near the listener. Tiny, cheap, and enormously
 * effective at making incoming fire feel dangerous.
 */
export function bulletWhizz(actx, bank, rng, o = {}) {
  const t0 = o.when ?? actx.currentTime;
  const miss = clamp(o.miss ?? 1.5, 0.15, 6); // metres from the ear
  const level = clamp(1.1 - miss / 6, 0.1, 1) * (o.gain ?? 1);
  const out = gain(actx, 7.0); // close N-wave must dominate minor foley
  const src = bank.source('white', rng, rng.range(0.9, 1.2));
  const bp = biquad(actx, 'bandpass', 2400, 3.2);
  const g = gain(actx, 0);
  series(src, bp, g).connect(out);
  // The N-wave's apparent pitch drops sharply as the round passes — Doppler on
  // a Mach 2.5 projectile is violent.
  const dur = 0.075 + miss * 0.014;
  sweep(bp.frequency, t0, rng.range(4800, 6800), rng.range(950, 1550), dur);
  ad(g.gain, t0 + 0.0025, 1.8 * level, 0.0015, dur);
  src.start(t0, src._offset, dur * 2);
  // Snap of the shock front.
  const s2 = bank.source('white', rng, 1.2);
  const hp = biquad(actx, 'highpass', 2600, 0.7);
  const g2 = gain(actx, 0);
  series(s2, hp, g2).connect(out);
  hit(g2.gain, t0, 1.6 * level, 0.0025);
  s2.start(t0, s2._offset, 0.025);

  // Local air-displacement pressure: short enough not to become a kick drum,
  // but essential when a projectile passes within a metre of the listener.
  const pressure = osc(actx, 'sine', 190);
  const pg = gain(actx, 0);
  pressure.connect(pg); pg.connect(out);
  sweep(pressure.frequency, t0, 210, 72, 0.03);
  ad(pg.gain, t0, 0.42 * level, 0.001, 0.035);
  pressure.start(t0); pressure.stop(t0 + 0.06);

  return { node: out, end: t0 + dur * 2 + 0.06, send: 0.12 };
}

/** Dry-fire click when the magazine is empty. */
export function dryFire(actx, bank, rng, o = {}) {
  const t0 = o.when ?? actx.currentTime;
  const out = gain(actx, 1);
  const r = struckResonator(actx, bank, rng, t0, [
    { f: 2600 * rng.range(0.95, 1.05), q: 24, g: 1.2, decay: 0.035 },
    { f: 4700, q: 16, g: 0.66, decay: 0.02 },
    { f: 860, q: 10, g: 0.5, decay: 0.05 },
  ], 0.0025);
  r.connect(out);
  return { node: out, end: t0 + 0.14, send: 0.2 };
}

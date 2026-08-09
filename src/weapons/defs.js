import { DEG } from './mathx.js';

/**
 * Weapon data.
 *
 * Ballistics are real: 5.56x45 leaves a 14.5" barrel at ~880 m/s, 9x19 from a
 * 4.5" barrel at ~360 m/s, and both drop under gravity on the way to the
 * target. Rates of fire, magazine capacities and ADS times are the real ones
 * too (an M4A1 is 800 rpm and reaches the optic in about 220 ms).
 *
 * Recoil is split into the same layers as a modern shooter:
 *   - `pattern`  deterministic vertical/horizontal sightline movement a player
 *                can memorise and counter. Generated once from a fixed seed.
 *   - sightline  every shot adds its pattern amount to the player's look and
 *                holds until countered. ADS/stance brace this layer.
 *   - `spread`   a random cone that grows with sustained fire and shrinks when
 *                aiming, crouched or still. This is the part you cannot learn.
 */

export const WEAPON_DEFS = {
  rifle: {
    id: 'rifle',
    label: 'M4A1',
    class: 'carbine',
    caliber: '5.56x45',
    /* --- fire control --- */
    rpm: 800,
    modes: ['auto', 'burst', 'semi'],
    burstCount: 3,
    burstRpm: 950,
    burstDelay: 0.16,
    /* --- ammunition --- */
    magSize: 30,
    reserve: 210,
    /* --- terminal ballistics --- */
    muzzleVelocity: 880,
    damage: 33,
    penetration: 1.0,
    dropoff: 0.62,
    maxRange: 420,
    dragK: 0.28,
    tracerEvery: 3,
    /* --- accuracy (degrees) --- */
    spreadHip: 2.05,
    spreadAds: 0.24,
    spreadPerShot: 0.3,
    spreadMax: 3.4,
    spreadDecay: 3.6,
    /* --- recoil --- */
    recoil: {
      // 5.56 has a sharp carrier/buffer impulse followed by a controlled climb.
      // The camera values are deliberately separate from spread: recoil moves
      // the player's actual sightline and can be countered with the mouse.
      pitch: 0.0132, // radians of sightline movement per shot (0.76 deg)
      yaw: 0.0027,
      kickBack: 0.021, // metres the viewmodel travels rearward
      kickUp: 0.0082,
      roll: 0.032,
      punch: 0.38,
      freq: 8.5,
      damping: 0.42,
      // ADS/crouch brace the shoulder and scale sightline movement.
      adsScale: 0.78,
      crouchScale: 0.88,
      patternLength: 30,
      patternSeed: 0x4d34a1,
      climbShape: [1.45, 1.3, 1.15, 1.05, 1.0], // first-shots multiplier
      drift: 0.55, // how much the pattern wanders horizontally
    },
    /* --- handling (seconds) --- */
    adsTime: 0.22,
    adsFov: 0.74,
    viewFov: 0.86,
    reloadTac: 2.1,
    reloadEmpty: 2.9,
    inspectTime: 3.2,
    drawTime: 0.62,
    holsterTime: 0.4,
    /* --- pose ---
     * Weapon-local origin is the web of the shooting hand (top of the grip).
     * The butt pad is at z=+0.245, the muzzle crown at z=-0.502, the optic
     * ocular at (0, 0.142, +0.006) and the mag floorplate ~150 mm below origin.
     *
     * SOLVED FROM THE BORE AXIS, not from where the optic happens to land.
     *
     * The previous pose (hipPos [0.081,-0.192,-0.215], hipRot [-0.026,0.076,
     * 0.055]) was derived by putting the OPTIC at a chosen screen position, and
     * that is the wrong constraint: it left the bore 1.5 deg nose-down with the
     * weapon only 215 mm from the eye, so the whole barrel forward of the
     * receiver ran off the top-left of the frame and the muzzle crown — where
     * the flash spawns — projected onto empty street. What reads as "the gun
     * points at the crosshair" is the MUZZLE being visible, up-left of the
     * receiver, on the way to the centre of the screen.
     *
     * Constraints, in order:
     *   1. bore axis 4.0 deg LEFT of view-forward (converging on the crosshair)
     *      and 2.9 deg nose-down:  rx = -0.050, ry = +0.070
     *   2. rolled 7.7 deg so the LEFT flank of the receiver (the side that
     *      carries the rollmark, the bolt catch and the port) faces the camera
     *      and the rail deck turns edge-on instead of presenting its lit top
     *      face:  rz = -0.135
     *   3. muzzle crown inside x 1050-1300, y 620-780 at 1920x1080
     *   4. optic ocular below and right of screen centre
     *   5. magazine + pistol grip in the lower-right frame
     *
     * With the rotation above the muzzle offset is (-0.025, +0.049, -0.505) and
     * the ocular offset (+0.019, +0.141, -0.003), so at a 60 deg vertical view
     * FOV (half-height 0.5774|z|, half-width 1.0264|z|):
     *   muzzle -> (1064, 698)   ocular -> (1374, 677)   magwell mouth -> (1268, 870)
     * i.e. the muzzle is 300 px up-LEFT of the optic and heading for the middle
     * of the frame, which is the read that was missing.
     *
     * z = -0.30 (was -0.215) is what makes the weapon small enough for the mag
     * and grip to enter the frame at all: the gun's vertical extent from optic
     * to floorplate is 291 mm, and at 215 mm from the eye that is 93% of the
     * frame height. It is also the limit — the support hand is then 620 mm
     * downrange of a shoulder 200 mm off the eye, and a 572 mm arm has nothing
     * left. The butt pad ends up 60 mm in FRONT of the eye but 140 mm off axis,
     * so it is outside the frustum rather than clipped by the near plane. */
    hipPos: [0.118, -0.185, -0.3],
    hipRot: [-0.05, 0.081, -0.135],
    adsCant: [0, 0, 0.004],
    /* Eye to the rear lens.
     *
     * MEASURED FROM THE ADS FRAME, not chosen for realism. Two numbers have to
     * come out right and they pull in opposite directions:
     *
     *   housing size     the 31 mm tube's outer rim subtends rOuter/relief. At
     *                    0.078 that was 256 px of radius — a 512 px ring, HALF
     *                    the frame height, and every critic called the optic
     *                    oversized. 0.115 puts it at 168 px (336 px across,
     *                    31% of frame height), which is where a modern shooter
     *                    frames a tube sight.
     *   sight picture    is stopped by the objective bore at (relief + len), so a
     *                    LONGER relief improves the picture-to-housing ratio:
     *                    (relief)/(relief+len) goes from 0.53 to 0.69.
     *
     * So both wanted the same thing and the old value was simply too close. With
     * the 52 mm tube and the flared bore (see parts.js buildOptic) this lands the
     * clear aperture at 115 px against a 168 px housing. */
    eyeRelief: 0.115,
    /* Sprint: gun dropped and angled across the body, muzzle down-left.
     * Carried over by the same delta as the hip pose so the blend does not
     * translate the weapon 90 mm sideways on the way into a sprint. */
    sprintPos: [0.09, -0.262, -0.275],
    sprintRot: [-0.4, 0.6, 0.2],
    lowReadyPos: [0.112, -0.28, -0.289],
    lowReadyRot: [-0.46, 0.125, -0.09],
    swayScale: 1,
    bobScale: 1,
    magLen: 0.212,
  },

  smg: {
    id: 'smg',
    label: 'MPX-9',
    class: 'smg',
    caliber: '9x19',
    rpm: 950,
    modes: ['auto', 'semi'],
    burstCount: 2,
    burstRpm: 1100,
    burstDelay: 0.14,
    magSize: 32,
    reserve: 224,
    muzzleVelocity: 400,
    damage: 24,
    penetration: 0.45,
    dropoff: 0.48,
    maxRange: 240,
    dragK: 0.42,
    tracerEvery: 4,
    spreadHip: 2.5,
    spreadAds: 0.4,
    spreadPerShot: 0.26,
    spreadMax: 3.9,
    spreadDecay: 4.4,
    recoil: {
      // The short 9 mm action cycles quickly: less vertical impulse than the
      // carbine, more side-to-side movement, and a quicker return to target.
      pitch: 0.0085,
      yaw: 0.0031,
      kickBack: 0.015,
      kickUp: 0.006,
      roll: 0.026,
      punch: 0.27,
      freq: 10.5,
      damping: 0.4,
      adsScale: 0.74,
      crouchScale: 0.86,
      patternLength: 32,
      patternSeed: 0x9ac31f,
      climbShape: [1.3, 1.18, 1.08, 1.0],
      drift: 0.8,
    },
    adsTime: 0.185,
    adsFov: 0.78,
    viewFov: 0.88,
    reloadTac: 1.85,
    reloadEmpty: 2.5,
    inspectTime: 2.9,
    drawTime: 0.52,
    holsterTime: 0.34,
    /* Solved from the bore axis exactly as the rifle's is (see there): 4.1 deg of
     * convergence, 2.9 deg nose-down, 7.5 deg of outboard roll, and far enough
     * out that the muzzle of a 210 mm barrel is on screen up-left of the optic. */
    hipPos: [0.111, -0.163, -0.288],
    hipRot: [-0.05, 0.072, -0.131],
    adsCant: [0, 0, 0.005],
    /* Same aperture-budget derivation as the rifle (see there): the 27.6 mm tube's
     * outer rim wants to land near 165 px of radius and the 44 mm bore wants the
     * eye far enough back that the objective is not the stop. */
    eyeRelief: 0.104,
    sprintPos: [0.088, -0.24, -0.262],
    sprintRot: [-0.38, 0.58, 0.19],
    lowReadyPos: [0.108, -0.252, -0.276],
    lowReadyRot: [-0.44, 0.125, -0.085],
    swayScale: 0.92,
    bobScale: 0.95,
    magLen: 0.192,
  },

  lmg: {
    id: 'lmg',
    label: 'EVOLYS-7.62',
    class: 'lmg',
    caliber: '7.62x51',
    /* --- fire control ---
     * A belt-fed LMG has exactly one job. Single-mode: the fire-mode key
     * no-ops and the HUD sits on AUTO, which is the honest read. */
    rpm: 660,
    modes: ['auto'],
    burstCount: 1,
    burstRpm: 660,
    burstDelay: 0.1,
    /* --- ammunition --- */
    magSize: 75,
    reserve: 225,
    /* --- terminal ballistics ---
     * 7.62x51 from a 16" barrel at ~780 m/s. Three hits kill a 100 HP
     * agent where the M4A1 needs four — the LMG is the only 3-shot weapon
     * in the game, and the recoil is the price (see below).
     *
     * Heavier bullet: lower drag, holds damage further out, and punches
     * through cover the carbine's 5.56 stops on. */
    muzzleVelocity: 780,
    damage: 48,
    penetration: 1.35,
    dropoff: 0.68,
    maxRange: 520,
    dragK: 0.22,
    tracerEvery: 2,
    /* --- accuracy (degrees) --- */
    spreadHip: 2.6,
    spreadAds: 0.34,
    spreadPerShot: 0.32,
    spreadMax: 3.8,
    spreadDecay: 3.2,
    /* --- recoil ---
     * ENDLESS CLIMB: no first-shot spike, no taper. `climbShape: [1.0]`
     * means every one of the 40 pattern shots adds the same pitch, so
     * uncountered fire walks up ~9 deg/s until the bipod (bipodScale) or
     * the trigger finger brings it back. The bipod is not a bonus — it is
     * the designed way to hold this gun on target. */
    recoil: {
      pitch: 0.0145,
      yaw: 0.0032,
      kickBack: 0.028, // heavy bolt: the gun shoves rearward hard
      kickUp: 0.01,
      roll: 0.04,
      punch: 0.5,
      freq: 7.5,
      damping: 0.4,
      adsScale: 0.8,
      crouchScale: 0.88,
      bipodScale: 0.6, // legs out + still: the gun stops climbing
      patternLength: 40,
      patternSeed: 0x3a9e17,
      climbShape: [1.0],
      drift: 0.5,
    },
    /* --- handling (seconds) ---
     * Slowest in the game: 0.32 s to shoulder, 3.4/4.8 s reloads for a
     * 75-round box, 0.75 s draw. The 3-hit kill is paid for in seconds. */
    adsTime: 0.32,
    adsFov: 0.7,
    viewFov: 0.84,
    reloadTac: 3.4,
    reloadEmpty: 4.8,
    inspectTime: 3.6,
    drawTime: 0.75,
    holsterTime: 0.5,
    /* --- pose ---
     * Solved from the bore axis with the same constraint set as the rifle
     * (see there): 4 deg of convergence, ~2.9 deg nose-down, outboard roll,
     * muzzle crown inside x 1050-1300 / y 620-780 at 1920x1080. The 75-rd
     * box hangs ~75 mm deeper than the carbine's 30-rd stick, so the weapon
     * sits 10 mm higher and 12 mm further out than the rifle pose; the
     * magwell-to-mid-box reads lower-right instead of the floorplate. */
    hipPos: [0.118, -0.185, -0.3],
    hipRot: [-0.074, 0.081, -0.135],
    adsCant: [0, 0, 0.004],
    /* Eye to the mini-reflex rear lens. The reflex is a low, short optic
     * (44 mm), so the relief can close up without the housing eating the
     * frame — 0.10 m puts the window at a comfortable apparent size. */
    eyeRelief: 0.1,
    /* Sprint: carried low and angled across the body like a heavy tool. */
    sprintPos: [0.09, -0.29, -0.285],
    sprintRot: [-0.42, 0.62, 0.22],
    lowReadyPos: [0.108, -0.305, -0.295],
    lowReadyRot: [-0.48, 0.12, -0.09],
    swayScale: 0.9,
    bobScale: 0.95,
    magLen: 0.26,
    /* Bipod deploy animation length; firing is blocked until the legs are
     * out (see weapons/index.js). */
    bipodTime: 0.45,
  },

  pistol: {
    id: 'pistol',
    label: 'P-19',
    class: 'pistol',
    caliber: '9x19',
    rpm: 460,
    modes: ['semi'],
    burstCount: 1,
    burstRpm: 460,
    burstDelay: 0.1,
    magSize: 17,
    reserve: 68,
    muzzleVelocity: 360,
    damage: 28,
    penetration: 0.35,
    dropoff: 0.42,
    maxRange: 180,
    dragK: 0.46,
    tracerEvery: 5,
    spreadHip: 3.1,
    spreadAds: 0.5,
    spreadPerShot: 0.42,
    spreadMax: 4.6,
    spreadDecay: 5.2,
    recoil: {
      // With no stock, the pistol rotates around the wrists. It has the largest
      // single-shot muzzle flip, but its low cyclic rate prevents rifle-like
      // sustained climb unless the trigger is tapped very quickly.
      pitch: 0.021,
      yaw: 0.0042,
      kickBack: 0.014,
      kickUp: 0.014,
      roll: 0.022,
      punch: 0.34,
      freq: 8.2,
      damping: 0.43,
      adsScale: 0.72,
      crouchScale: 0.9,
      patternLength: 17,
      patternSeed: 0x1f77bc,
      climbShape: [1.0],
      drift: 1.2,
    },
    adsTime: 0.16,
    adsFov: 0.86,
    viewFov: 0.92,
    reloadTac: 1.6,
    reloadEmpty: 2.2,
    inspectTime: 2.6,
    drawTime: 0.42,
    holsterTime: 0.3,
    /* A pistol is held out on the arms rather than braced on the shoulder, so
     * the hip pose is FURTHER from the eye than a carbine's and the ADS eye
     * relief is most of an arm's length. 0.34 m keeps both elbows visibly bent;
     * past ~0.40 m the two-bone solve hits full extension and they lock. */
    hipPos: [0.115, -0.15, -0.34],
    hipRot: [-0.05, 0.066, -0.115],
    adsCant: [0, 0, 0.003],
    eyeRelief: 0.34,
    sprintPos: [0.09, -0.25, -0.28],
    sprintRot: [-0.42, 0.5, 0.14],
    lowReadyPos: [0.1, -0.26, -0.32],
    lowReadyRot: [-0.44, 0.105, -0.07],
    swayScale: 1.15,
    bobScale: 1.1,
    magLen: 0.108,
  },
};

/**
 * Generate the deterministic recoil pattern for a weapon.
 *
 * The shape is what a player learns: a strong vertical climb for the first few
 * shots, then the vertical settles while the muzzle starts to wander sideways
 * in a smooth, repeatable S. Everything comes from one fixed seed so the same
 * weapon always kicks the same way — including in capture mode.
 *
 * @returns {Float32Array} pairs of [pitch, yaw] in radians, length n*2.
 */
export function buildRecoilPattern(def, Rng) {
  const r = def.recoil;
  const n = r.patternLength;
  const rng = new Rng(r.patternSeed);
  const out = new Float32Array(n * 2);
  // Two out-of-phase wanders make the horizontal read as a learnable snake
  // rather than as noise.
  const phase = rng.float() * Math.PI * 2;
  const phase2 = rng.float() * Math.PI * 2;
  const bias = rng.signed() * 0.35;
  for (let i = 0; i < n; i++) {
    const shot = i;
    const climb = r.climbShape[Math.min(shot, r.climbShape.length - 1)];
    // Vertical: strong early, tapering, with a per-shot signature bump.
    const sig = 0.88 + rng.float() * 0.24;
    out[i * 2] = r.pitch * climb * sig;
    // Horizontal: a smooth snake plus a fixed per-shot signature.
    const t = i / Math.max(1, n - 1);
    const snake =
      Math.sin(phase + t * Math.PI * 2.6) * 0.75 + Math.sin(phase2 + t * Math.PI * 5.1) * 0.35;
    out[i * 2 + 1] = r.yaw * (snake * r.drift * 3.2 + bias + rng.signed() * 0.25);
  }
  return out;
}

export const SPREAD_MODS = {
  crouch: 0.78,
  prone: 0.6,
  still: 0.82,
  walking: 1.15,
  sprinting: 2.2,
  airborne: 2.0,
  hipfire: 1,
  /** Bipod deployed AND still/crouched/prone — the gun is a machine rest. */
  bipod: 0.55,
};

export const DEG2RAD = DEG;

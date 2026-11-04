import { P } from './atlas.ts';
import { resetSpawn, setSpawnColorRamp, setSpawnPosition, setSpawnVelocity } from './particles.ts';
import { V, C, C2, basis, blackbody, clampCone, cone, towardHemi, COS55 } from './util.ts';

/** Muzzle flash layers a small incandescent core, asymmetric tongues, gas jet, grains and smoke.
 * FLASH_LOBE is a one-sided tongue rooted at -X, never a radial star. Independently roll
 * lobes about the bore and pitch them 23-49 degrees; keep surrounding gas dimmer than the core.
 * Burning lasts 40-62 ms; the light/haze are brief and smoke persists.
 */

interface Vec3Like {
  x: number;
  y: number;
  z: number;
}
interface CameraLike {
  updateMatrixWorld(): void;
  matrixWorldInverse: { elements: ArrayLike<number> };
}
interface MuzzleProfile {
  scale: number;
  lobes: number;
  jet: number;
  light: number;
  smoke: number;
  temp: number;
  sparks: number;
}
interface MuzzleWeapon {
  id?: string;
  suppressed?: boolean;
  class?: string;
  kind?: string;
  name?: string;
}
interface MuzzleFx {
  rng: {
    float(): number;
    signed(): number;
    int(min: number, max: number): number;
    range(min: number, max: number): number;
  };
  pScale: number;
  ctx: { camera?: CameraLike; viewCamera?: CameraLike };
  emitAdd(this: void, spawn: object): void;
  emitViewAdd(this: void, spawn: object): void;
  emitLit(this: void, spawn: object): void;
  emitViewLit(this: void, spawn: object): void;
  lights?: { flash(...args: number[]): void };
  viewFlash(...args: number[]): void;
  _fromView(position: Vec3Like): Vec3Like;
  haze(...args: number[]): void;
}
interface MuzzleOptions {
  position: Vec3Like;
  direction: Vec3Like;
  weapon?: string | MuzzleWeapon | undefined;
  intensity?: number | undefined;
  scale?: number | undefined;
  light?: number | undefined;
  view?: boolean;
  lightPos?: Vec3Like;
}

const TWO_PI = Math.PI * 2;

/** Bore-axis frame + the lobe direction, reused every shot (never allocate). */
const BORE = { tx: 0, ty: 0, tz: 0, bx: 0, by: 0, bz: 0 };
const LOBE = { x: 0, y: 0, z: 0 };

/** FLASH_LOBE runs root(-X) to tip(+X) in texture space. As a screen-space billboard,
 * it needs the view-space angle of its world direction, including roll about the bore.
 */
export function screenAngle(
  fx: Pick<MuzzleFx, 'ctx'>,
  view: boolean,
  dx: number,
  dy: number,
  dz: number
): number {
  const cam = view ? fx.ctx.viewCamera : fx.ctx.camera;
  if (!cam) return 0;
  cam.updateMatrixWorld();
  const m = cam.matrixWorldInverse.elements;
  const vx = m[0] * dx + m[4] * dy + m[8] * dz;
  const vy = m[1] * dx + m[5] * dy + m[9] * dz;
  return Math.atan2(vy, vx);
}

/** Per-class signature; unknown weapons use rifle. `light` is reference peak candela.
 * World spill applies a separate gain and cutoff; the view flash scales against REF_LIGHT.
 */
export const MUZZLE_PROFILES: Record<string, MuzzleProfile> = {
  rifle: { scale: 1.0, lobes: 3, jet: 1.0, light: 200, smoke: 1.0, temp: 1.0, sparks: 8 },
  carbine: { scale: 0.92, lobes: 3, jet: 0.9, light: 175, smoke: 0.9, temp: 1.02, sparks: 7 },
  smg: { scale: 0.78, lobes: 3, jet: 0.75, light: 135, smoke: 0.7, temp: 1.05, sparks: 6 },
  pistol: { scale: 0.66, lobes: 2, jet: 0.6, light: 100, smoke: 0.55, temp: 1.06, sparks: 5 },
  shotgun: { scale: 1.5, lobes: 4, jet: 1.35, light: 330, smoke: 1.8, temp: 0.92, sparks: 14 },
  sniper: { scale: 1.35, lobes: 3, jet: 1.6, light: 290, smoke: 1.4, temp: 0.95, sparks: 10 },
  lmg: { scale: 1.15, lobes: 4, jet: 1.1, light: 235, smoke: 1.2, temp: 0.98, sparks: 9 },
  suppressed: { scale: 0.34, lobes: 2, jet: 0.4, light: 36, smoke: 1.6, temp: 1.1, sparks: 2 },
};

/** The `light` a rifle carries, i.e. the reference the view flash is scaled on. */
const REF_LIGHT = MUZZLE_PROFILES.rifle.light;

function profileFor(weapon?: string | MuzzleWeapon): MuzzleProfile {
  if (!weapon) return MUZZLE_PROFILES.rifle;
  if (typeof weapon !== 'string' && weapon.suppressed) return MUZZLE_PROFILES.suppressed;
  const key =
    typeof weapon === 'string' ? weapon : (weapon.class ?? weapon.id ?? weapon.kind ?? weapon.name);
  if (!key) return MUZZLE_PROFILES.rifle;
  const k = String(key).toLowerCase();
  for (const name in MUZZLE_PROFILES) if (k.includes(name)) return MUZZLE_PROFILES[name];
  return MUZZLE_PROFILES.rifle;
}

/** Muzzle crown is world-space; bore direction is unit length. view selects first-person layers.
 * Keep geometric scale, sprite intensity and light gain independent: distant flashes must stay
 * legible without over-lighting the shooter's nearby chest.
 */
export function muzzleFlash(fx: MuzzleFx, o: MuzzleOptions): MuzzleProfile {
  const rng = fx.rng;
  const prof = profileFor(o.weapon);
  const p = o.position;
  const d = o.direction;
  const gain = (o.intensity ?? 1) * (0.86 + rng.float() * 0.28); // shot-to-shot
  const lightGain = gain * (o.light ?? 1);
  // Scale enemy embers with flash gain instead of retaining player-strength streaks.
  const emberGain = 0.22 + 0.78 * Math.min(1, gain);
  // Roll size jitter once, independently of radiance jitter in `gain`.
  const sc = prof.scale * (o.scale ?? o.intensity ?? 1) * (0.88 + rng.float() * 0.24);
  const view = o.view === true;
  const emitAdd = view ? fx.emitViewAdd : fx.emitAdd;
  const emitLit = view ? fx.emitViewLit : fx.emitLit;
  const temp = prof.temp * (0.96 + rng.float() * 0.09);
  // Blackbody ramp: 3800-4400 K at the crown, cooling to 2200 K at the lobe tips.
  // Per-shot temperature variation keeps automatic fire from repeating.
  const coreK = 3800 + rng.float() * 600;
  blackbody(C, coreK * temp);
  const cr = C.r;
  const cg = C.g;
  const cb = C.b;
  blackbody(C, coreK * 0.62 * temp); // ~2400 K: the choked gas around the core
  const gr = C.r;
  const gg = C.g;
  const gb = C.b;
  blackbody(C2, 2200); // the shredding, burnt-out lobe tips
  const tr = C2.r;
  const tg = C2.g;
  const tb = C2.b;

  // Nested crown sprites: 20-60 radiance drives bloom without bleaching the lobes.
  let s = resetSpawn();
  // No lead offset: even centimetres separate the flash visibly from the crown.
  setSpawnPosition(s, p.x, p.y, p.z);
  s.tile = P.FLASH_CORE;
  // Core diameter in metres, large enough to read as the source of the light spill.
  s.size0 = 0.085 * sc;
  s.size1 = 0.135 * sc;
  s.sizeCurve = 0.35;
  // Extend the physical ~2 ms flash across several frames so it is reliably visible.
  s.life = 0.062;
  s.drag = 10;
  setSpawnColorRamp(s, gr, gg, gb, tr, tg, tb);
  s.i0 = 17 * gain;
  // A nonzero tail keeps cooling gas visible between automatic-fire rounds.
  s.i1 = 4.5 * gain;
  s.alphaCurve = 0.7;
  s.soft = 0.15;
  s.rot = rng.float() * TWO_PI; // per-shot roll: the churn never repeats
  s.spin = rng.signed() * 3.0;
  s.seed = rng.float();
  emitAdd(s);
  // the white-hot heart: a third of the diameter, twice the radiance, gone first
  s = resetSpawn();
  setSpawnPosition(s, p.x, p.y, p.z);
  s.tile = P.FLASH_CORE;
  s.size0 = 0.036 * sc;
  s.size1 = 0.056 * sc;
  s.sizeCurve = 0.4;
  s.life = 0.046;
  s.drag = 12;
  setSpawnColorRamp(s, cr, cg, cb, gr, gg, gb);
  s.i0 = 38 * gain;
  s.i1 = 6 * gain;
  s.alphaCurve = 0.6;
  s.soft = 0.12;
  s.rot = rng.float() * TWO_PI;
  s.spin = rng.signed() * 4.0;
  s.seed = rng.float();
  emitAdd(s);

  // Petal count, roll and choke vary per shot to avoid a symmetric starburst.
  basis(BORE, d.x, d.y, d.z);
  // Keep 3-4 unevenly spaced tongues.
  const ports = Math.min(4, Math.max(3, prof.lobes + (rng.float() < 0.45 ? 1 : 0)));
  const rollBase = rng.float() * TWO_PI;
  const weak = rng.int(0, ports - 1); // one port always gets less gas
  const big = rng.int(0, ports - 1); // and one always gets the long tongue
  for (let i = 0; i < ports; i++) {
    const roll = rollBase + (i / ports) * TWO_PI + rng.signed() * 0.55;
    const pitch = rng.range(0.4, 0.85); // 23-49 degrees off the bore
    const cp = Math.cos(pitch);
    const sp = Math.sin(pitch);
    const rc = Math.cos(roll) * sp;
    const rs = Math.sin(roll) * sp;
    LOBE.x = d.x * cp + BORE.tx * rc + BORE.bx * rs;
    LOBE.y = d.y * cp + BORE.ty * rc + BORE.by * rs;
    LOBE.z = d.z * cp + BORE.tz * rc + BORE.bz * rs;
    const choke =
      i === weak ? rng.range(0.4, 0.62) : i === big ? rng.range(1.1, 1.35) : rng.range(0.78, 1.0);
    const push = rng.range(0.6, 2.2) * choke;
    s = resetSpawn();
    s.tile = P.FLASH_LOBE;
    s.size0 = (0.06 + 0.05 * rng.float()) * sc * choke;
    // 0.18-0.32 m, skewed toward mid-length with occasional long tongues.
    s.size1 = (0.18 + 0.14 * Math.pow(rng.float(), 1.5)) * sc * choke;
    // The sprite's root is at its -X edge, so slide the centre out along the
    // petal direction to sit that root exactly on the crown.
    const off = 0.34 * s.size1;
    setSpawnPosition(s, p.x + LOBE.x * off, p.y + LOBE.y * off, p.z + LOBE.z * off);
    setSpawnVelocity(s, LOBE.x * push, LOBE.y * push, LOBE.z * push);
    s.sizeCurve = 0.35;
    s.life = 0.04 + rng.float() * 0.02; // 2.5-3.5 frames at 60 Hz
    s.drag = 12;
    s.rot = screenAngle(fx, view, LOBE.x, LOBE.y, LOBE.z) + rng.signed() * 0.1;
    s.spin = rng.signed() * 1.6; // a lazy curl, not a spinning pinwheel
    // Deep orange and an order of magnitude under the core: the core owns the
    // white, the gas around it stays fire-coloured. Only a strong channel
    // *ratio* survives the tone curve as amber rather than as more white.
    setSpawnColorRamp(s, gr, gg, gb, tr, tg, tb);
    s.i0 = (8 + rng.float() * 6) * gain * choke;
    s.i1 = 1.6 * gain * choke;
    s.alphaCurve = 0.75;
    s.soft = 0.15;
    s.seed = rng.float();
    emitAdd(s);
  }

  // forward gas jet: velocity-aligned, so it stretches down the bore
  s = resetSpawn();
  setSpawnPosition(s, p.x + d.x * 0.04, p.y + d.y * 0.04, p.z + d.z * 0.04);
  setSpawnVelocity(s, d.x * 7, d.y * 7, d.z * 7);
  s.tile = P.STREAK;
  s.size0 = 0.045 * sc * prof.jet;
  s.size1 = 0.018 * sc * prof.jet;
  // Short: a long velocity-aligned streak off the crown reads as a hard spike.
  s.stretch = 0.28 * prof.jet;
  s.life = 0.044;
  s.drag = 14;
  setSpawnColorRamp(s, 1, 0.8, 0.5, 1, 0.4, 0.1);
  s.i0 = 9 * gain;
  s.i1 = 0;
  s.alphaCurve = 0.6;
  s.soft = 0.12;
  s.seed = rng.float();
  emitAdd(s);

  // Forward-constrained powder cools from ~2600 K to 1200 K; velocity controls
  // streak length so fast grains streak and slower ones remain specks.
  const nSpark = Math.round(prof.sparks * fx.pScale);
  blackbody(C, 2600 * temp);
  blackbody(C2, 1200);
  for (let i = 0; i < nSpark; i++) {
    cone(V, rng, d.x, d.y, d.z, 0.55, 1.4);
    towardHemi(V, d.x, d.y, d.z, 0.25);
    // Hard +-55 deg cone about the BORE: burning powder leaves the crown with the
    // gas, so a grain heading sideways past the shooter's face is a bug.
    clampCone(V, d.x, d.y, d.z, COS55);
    const sp = rng.range(2.5, 8.5);
    s = resetSpawn();
    setSpawnPosition(s, p.x + d.x * 0.012, p.y + d.y * 0.012, p.z + d.z * 0.012);
    setSpawnVelocity(s, V.x * sp, V.y * sp, V.z * sp);
    s.tile = P.STREAK;
    s.size0 = rng.range(0.005, 0.011);
    s.size1 = s.size0 * 0.4;
    // Length ∝ velocity (the shader multiplies by |view velocity|), with a
    // slightly super-linear coefficient so a fast grain reads as a streak and a
    // slow one as an ember rather than everything being the same capsule.
    s.stretch = 0.16 + sp * 0.045;
    s.life = rng.range(0.1, 0.4);
    s.drag = 3.2;
    s.gravity = -11;
    setSpawnColorRamp(s, C.r, C.g, C.b, C2.r, C2.g, C2.b);
    s.i0 = rng.range(5, 11) * emberGain;
    s.i1 = 0.15;
    s.flags = 1;
    s.alphaCurve = 0.5;
    s.soft = 0.05;
    s.seed = rng.float();
    emitAdd(s);
  }

  // Delay the small crown-smoke puff so fire reads before smoke, not as one beige cloud.
  const nPuff = Math.max(2, Math.round(3 * fx.pScale));
  for (let i = 0; i < nPuff; i++) {
    cone(V, rng, d.x, d.y, d.z, 0.7, 0.9);
    towardHemi(V, d.x, d.y, d.z, 0.1);
    const sp = rng.range(0.6, 1.9);
    const px = p.x + d.x * 0.018 + V.x * 0.008;
    const py = p.y + d.y * 0.018 + V.y * 0.008;
    const pz = p.z + d.z * 0.018 + V.z * 0.008;
    const vx = V.x * sp;
    const vy = V.y * sp + 0.12;
    const vz = V.z * sp;
    const size0 = (0.018 + 0.016 * rng.float()) * sc;
    const size1 = (0.075 + 0.07 * rng.float()) * sc * (0.7 + prof.smoke * 0.5);
    const tile = i % 2 ? P.SMOKE_B : P.WISP;
    const rot = rng.float() * TWO_PI;
    const spin = rng.signed() * 2.2;
    const seed = rng.float();
    const delay = 0.012 + rng.float() * 0.022;

    s = resetSpawn();
    setSpawnPosition(s, px, py, pz);
    setSpawnVelocity(s, vx, vy, vz);
    s.tile = tile;
    s.size0 = size0 * 0.9;
    s.size1 = size1 * 0.75;
    s.sizeCurve = 0.5;
    s.life = 0.05 + rng.float() * 0.03;
    s.drag = 7;
    s.rot = rot;
    s.spin = spin;
    setSpawnColorRamp(s, 1, 0.5, 0.17, 1, 0.26, 0.05);
    s.i0 = (0.5 + rng.float() * 0.7) * gain;
    s.i1 = 0;
    s.alphaCurve = 1.1;
    s.soft = 0.2;
    s.seed = seed;
    emitAdd(s);

    s = resetSpawn();
    setSpawnPosition(s, px, py, pz);
    setSpawnVelocity(s, vx, vy, vz);
    s.tile = tile;
    s.size0 = size0;
    s.size1 = size1;
    s.sizeCurve = 0.5;
    s.life = rng.range(0.3, 0.55) * (0.7 + prof.smoke * 0.5);
    s.delay = delay;
    s.drag = 7;
    s.gravity = 0.5;
    s.rot = rot;
    s.spin = spin;
    // warm, lit by its own flash while it is still hot -> plain grey as it cools
    setSpawnColorRamp(s, 0.62, 0.57, 0.52, 0.44, 0.44, 0.44);
    s.alpha = rng.range(0.26, 0.44) * (0.7 + prof.smoke * 0.4) * emberGain;
    s.alphaCurve = 1.35;
    s.soft = 0.22;
    s.turb = 0.05;
    s.turbFreq = 2.4;
    s.seed = seed;
    emitLit(s);
  }

  // barrel smoke: rolls off the crown and lingers
  const nSmoke = Math.round((2 + prof.smoke * 3) * fx.pScale * (0.4 + 0.6 * Math.min(1, gain)));
  for (let i = 0; i < nSmoke; i++) {
    cone(V, rng, d.x, d.y, d.z, 1.0, 0.7);
    const sp = rng.range(0.4, 2.2) * prof.smoke;
    s = resetSpawn();
    s.x = p.x + d.x * rng.range(0.0, 0.09);
    s.y = p.y + d.y * rng.range(0.0, 0.09);
    s.z = p.z + d.z * rng.range(0.0, 0.09);
    setSpawnVelocity(s, V.x * sp, V.y * sp + 0.28, V.z * sp);
    s.tile = i % 2 ? P.WISP : P.SMOKE_A;
    s.size0 = rng.range(0.03, 0.055) * prof.smoke;
    s.size1 = rng.range(0.16, 0.32) * prof.smoke;
    s.sizeCurve = 0.55;
    s.life = rng.range(0.5, 1.15) * (0.6 + prof.smoke * 0.6);
    s.delay = rng.range(0, 0.05);
    s.drag = 2.6;
    s.gravity = 0.36;
    s.rot = rng.float() * TWO_PI;
    s.spin = rng.signed() * 1.6;
    setSpawnColorRamp(s, 0.5, 0.49, 0.47, 0.42, 0.41, 0.4);
    s.alpha = rng.range(0.1, 0.2) * (0.6 + prof.smoke * 0.5) * emberGain;
    s.alphaCurve = 1.8;
    s.soft = 0.25;
    s.turb = 0.06;
    s.turbFreq = 1.6;
    s.seed = rng.float();
    emitLit(s);
  }

  // World spill belongs to ctx.scene, separate from the first-person light.
  // Rifle reference peak is 36 cd before lightGain, with a 5*sc metre cutoff: Three's window
  // (1-(d/cutoff)^4)^2 / d^2 confines the warm pool without bleaching distant walls.
  // A 0.09 s lifetime and 16/s decay retain spill across successive frames.
  if (fx.lights) {
    const lp = o.lightPos ?? p;
    fx.lights.flash(
      lp.x + d.x * 0.1,
      lp.y + d.y * 0.1,
      lp.z + d.z * 0.1,
      cr,
      cg,
      cb,
      prof.light * lightGain * 0.18,
      0.09,
      16,
      5 * sc,
      2
    );
  }

  // The weapon lives in viewScene and needs its own light; world spill cannot reach it.
  if (view) {
    fx.viewFlash(
      p.x + d.x * 0.03,
      p.y + d.y * 0.03,
      p.z + d.z * 0.03,
      cr,
      cg,
      cb,
      lightGain * (prof.light / REF_LIGHT)
    );
  }

  // hot gas refraction
  // Refraction is depth-tested in the world, even when the flash is in view space.
  V.x = p.x + d.x * 0.1;
  V.y = p.y + d.y * 0.1;
  V.z = p.z + d.z * 0.1;
  const gas = view ? fx._fromView(V) : V;
  fx.haze(gas.x, gas.y, gas.z, 0.1 * sc, 3.0, 0.1, 0.7 * sc, P.SMOKE_B);

  return prof;
}

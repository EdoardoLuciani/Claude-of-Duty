import * as THREE from 'three';
import { clamp01, lerp, smootherstep, easeOutCubic } from './mathx.js';

/** Cloth roll for the right palm and the wound bandage on the left forearm.
 *
 * The wrap is a flat cloth ribbon wound in a helix around the forearm's own
 * axis (forePivot-local +Z points at the elbow, -Z at the wrist). It grows
 * turn by turn from the wrist side up the arm as the right hand winds it, so
 * the band is always laid exactly where the hand is working: `wrapFrame()`
 * gives that contact point and `setWind()` reveals the ribbon up to it.
 */

const clothMat = new THREE.MeshStandardMaterial({
  color: 0xcbb892,
  roughness: 0.9,
  metalness: 0.04,
  envMapIntensity: 0.35,
  side: THREE.DoubleSide,
});
// Darker than the roll's canvas and shaded per-vertex: the wrap's seam relief
// alone is millimetres and washes out in full sun, so the band carries its own
// wrap-to-wrap falloff (ridge crest to the edge tucked under the next turn).
const wrapMat = new THREE.MeshStandardMaterial({
  color: 0x8f7e58,
  roughness: 0.95,
  metalness: 0.03,
  envMapIntensity: 0.3,
  side: THREE.DoubleSide,
  vertexColors: true,
});
const coreMat = new THREE.MeshStandardMaterial({
  color: 0x8d7a52,
  roughness: 0.86,
  metalness: 0.05,
  envMapIntensity: 0.3,
});

/** Winding path. All forePivot-local metres; z0 is the first turn's centre.
 * Width over pitch leaves each turn's seam edge proud of the next turn's body,
 * so the wrap reads as wound layers rather than one shell. */
const WRAP = {
  winds: 2.75, // turns of band laid over the hold
  z0: -0.185, // start centre (wrist side); winding runs toward the elbow
  pitch: 0.028, // axial travel per turn == visible band per turn (seam to seam)
  width: 0.038, // band width along the arm
  radius: 0.035, // band radius on the first turn (sleeve peaks at ~0.036)
  buildup: 0.0022, // radius added per turn (layers stacking up)
  steps: 30, // ribbon segments per turn
};
const STEPS = Math.round(WRAP.winds * WRAP.steps);

/** Where the wrist sits relative to band contact: the palm mount (and the roll
 * it presses) lands on the contact point, the wrist trails behind the travel. */
export const WRAP_CONTACT = { finger: 0.05, back: 0.041 };

const _rollGeo = new THREE.CylinderGeometry(0.015, 0.015, 0.052, 12, 1, false);
const _coreGeo = new THREE.CylinderGeometry(0.007, 0.007, 0.054, 8, 1, false);
const _tailGeo = new THREE.BoxGeometry(0.018, 0.0022, 0.046);

/** Cross-section of the band, seam crest to the edge under the next turn. */
const WRAP_EDGE_Z = [-0.5, -0.5 + 0.16, 0.1, 0.5]; // in widths
const WRAP_EDGE_R = [0.0032, 0.0012, 0.0008, 0.0];
const WRAP_EDGE_C = [1.0, 0.93, 0.8, 0.64];

export function bandageMesh() {
  const group = new THREE.Group();
  group.name = 'ow-bandage';

  // The roll spins about its own axis (hand +X) as the band pays out; the tail
  // rides the spin so the loose end turns with it.
  const spin = new THREE.Group();
  group.add(spin);

  const roll = new THREE.Mesh(_rollGeo, clothMat);
  roll.rotation.z = Math.PI / 2;
  roll.position.set(0.0, -0.014, -0.030);
  roll.castShadow = true;
  spin.add(roll);

  const core = new THREE.Mesh(_coreGeo, coreMat);
  core.rotation.z = Math.PI / 2;
  core.position.set(0.0, -0.014, -0.030);
  spin.add(core);

  const tail = new THREE.Mesh(_tailGeo, clothMat);
  tail.position.set(0.012, -0.018, -0.052);
  tail.rotation.y = 0.35;
  spin.add(tail);

  group.userData.spin = spin;
  group.userData.roll = roll;
  group.visible = false;
  return group;
}

/** The wound band: a cloth ribbon spiralling around the forearm axis. */
export function bandageWrapRibbon() {
  const steps = STEPS + 1;
  const cols = WRAP_EDGE_Z.length;
  const pos = new Float32Array(steps * cols * 3);
  const col = new Float32Array(steps * cols * 3);
  const idx = new Uint16Array(STEPS * (cols - 1) * 6);
  for (let i = 0; i <= STEPS; i++) {
    const turns = (i / STEPS) * WRAP.winds;
    const th = turns * Math.PI * 2;
    const zc = WRAP.z0 + WRAP.pitch * turns;
    const ripple = 0.0006 * Math.sin(th * 3.7 + turns * 5.1);
    const c = Math.cos(th);
    const s = Math.sin(th);
    // Cloth never lies perfectly flat: a slow weave shimmer along the band.
    const weave = 1 + 0.08 * Math.sin(th * 5.3 + turns * 2.9);
    for (let k = 0; k < cols; k++) {
      const r = WRAP.radius + WRAP.buildup * turns + ripple + WRAP_EDGE_R[k];
      const o = (i * cols + k) * 3;
      pos[o] = r * c;
      pos[o + 1] = r * s;
      pos[o + 2] = zc + WRAP_EDGE_Z[k] * WRAP.width;
      const shade = WRAP_EDGE_C[k] * weave;
      col[o] = shade;
      col[o + 1] = shade;
      col[o + 2] = shade;
    }
    if (i === STEPS) break;
    const v = i * cols;
    const n = v + cols;
    for (let k = 0; k < cols - 1; k++) {
      const t = i * (cols - 1) * 6 + k * 6;
      idx[t] = v + k;
      idx[t + 1] = n + k;
      idx[t + 2] = v + k + 1;
      idx[t + 3] = v + k + 1;
      idx[t + 4] = n + k;
      idx[t + 5] = n + k + 1;
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  geo.setIndex(new THREE.BufferAttribute(idx, 1));
  geo.computeVertexNormals();
  const mesh = new THREE.Mesh(geo, wrapMat);
  mesh.name = 'ow-bandage-wrap';
  mesh.castShadow = true;
  mesh.visible = false;
  return {
    mesh,
    /** Reveal the band up to wind fraction `w` (0..1 of the turns laid). */
    setWind(w) {
      const segs = Math.floor(clamp01(w) * STEPS + 1e-6);
      geo.setDrawRange(0, segs * (cols - 1) * 6);
      mesh.visible = segs > 0;
    },
  };
}

const _tf = new THREE.Vector3();

/**
 * Contact frame at wind fraction `w`, forePivot-local. `pos` is the point on
 * the band being laid, `finger` the direction of travel (the winding hand
 * points along it) and `back` the outward radial (the back of that hand).
 */
export function wrapFrame(w, out) {
  const turns = clamp01(w) * WRAP.winds;
  const th = turns * Math.PI * 2;
  const r = WRAP.radius + WRAP.buildup * turns;
  const c = Math.cos(th);
  const s = Math.sin(th);
  out.pos[0] = r * c;
  out.pos[1] = r * s;
  out.pos[2] = WRAP.z0 + WRAP.pitch * turns;
  out.back[0] = c;
  out.back[1] = s;
  out.back[2] = 0;
  // Direction of travel along the helix: tangent of the contact point.
  _tf.set(-r * s, r * c, WRAP.pitch / (Math.PI * 2)).normalize();
  out.finger[0] = _tf.x;
  out.finger[1] = _tf.y;
  out.finger[2] = _tf.z;
  return out;
}

export function makeWrapFrame() {
  return { pos: [0, 0, 0], finger: [0, 0, 0], back: [0, 0, 0] };
}

/* ========================================================================== */
/*  winding choreography — keyframed in the clips.js idiom                    */
/* ========================================================================== */

const WIND_EASE = {
  linear: (t) => t,
  smooth: (t) => smootherstep(0, 1, t),
  out: (t) => easeOutCubic(t),
};

/**
 * How the right hand works the roll over the hold. `a` is the fraction of the
 * band laid (drives both the hand's contact point and the ribbon's growth),
 * `pull` lifts the palm off the band between beats, `pose` the finger pose.
 * As in clips.js, a key's `ease` shapes the segment that ends on it.
 */
export const WIND_KEYS = [
  { t: 0.0, a: 0, pull: 0.085 }, // roll lifted toward the presented arm
  { t: 0.1, a: 0.02, pull: 0.012, ease: 'out' }, // press the loose end on
  { t: 0.3, a: 0.3, pull: 0, ease: 'smooth' }, // wind, up to speed
  { t: 0.58, a: 0.64, pull: 0, ease: 'linear' }, // steady
  { t: 0.84, a: 0.95, pull: 0, ease: 'smooth' }, // slowing toward the end
  { t: 0.93, a: 1, pull: 0.01, ease: 'out' }, // last wrap laid
  { t: 1.0, a: 1, pull: 0.03, ease: 'smooth', pose: 'pinch' }, // tuck the end
];

export function sampleWind(t, out) {
  const c = clamp01(t);
  let i = 0;
  while (i < WIND_KEYS.length - 2 && WIND_KEYS[i + 1].t <= c) i++;
  const a = WIND_KEYS[i];
  const b = WIND_KEYS[i + 1];
  const span = b.t - a.t;
  let w = span > 1e-6 ? clamp01((c - a.t) / span) : 1;
  w = (WIND_EASE[b.ease] ?? WIND_EASE.smooth)(w);
  out.a = lerp(a.a, b.a, w);
  out.pull = lerp(a.pull ?? 0, b.pull ?? 0, w);
  out.pose = w < 0.5 ? a.pose ?? 'cup' : b.pose ?? 'cup';
  return out;
}

export function makeWindSample() {
  return { a: 0, pull: 0, pose: 'cup' };
}

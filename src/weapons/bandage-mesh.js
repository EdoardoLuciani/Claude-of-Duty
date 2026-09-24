import * as THREE from 'three';
import { clamp01 } from './mathx.js';

/**
 * Field bandage: the cloth roll the right hand holds, and the band it lays down.
 *
 * The band is authored in the LEFT FOREARM's own space — the space of
 * `forePivot` in the rig — rather than in rig space. That is what keeps it on
 * the arm: it is bound to the same bone the sleeve is, so the IK stretch that
 * lengthens the forearm lengthens the band with it, and no arm pose can slide
 * it off the sleeve. Its radius comes from the sleeve the band is wrapped
 * around (see below), not from a torus radius that is guessed and ends up
 * buried inside the arm.
 *
 * Local space matches the arm's Blender authoring space with the origin moved to
 * the elbow: -Z runs down the forearm toward the wrist, +Y is dorsal, and the
 * distances below are metres measured from the elbow.
 */

/* ---- the left sleeve, as authored in tools/blender/player_arms.py --------- */

// The sleeve is a loft; these are its control points, in metres from the wrist.
const SLEEVE_Z = [0.01, 0.055, 0.18, 0.30];
const SLEEVE_R = [0.024, 0.028, 0.034, 0.036];
// Its cross-section is 10% narrower dorsal-to-palmar than it is across.
const SLEEVE_FLAT = 0.9;

/** Sleeve surface radius `z` metres from the wrist. */
function sleeveRadius(z) {
  let i = 1;
  while (i < SLEEVE_Z.length - 1 && z > SLEEVE_Z[i]) i++;
  const t = clamp01((z - SLEEVE_Z[i - 1]) / (SLEEVE_Z[i] - SLEEVE_Z[i - 1]));
  return SLEEVE_R[i - 1] + (SLEEVE_R[i] - SLEEVE_R[i - 1]) * t;
}

/* ---- the band ------------------------------------------------------------ */

/**
 * The wound cloth: a helix of `turns` turns laid from `from` to `to` metres up
 * the forearm from the elbow. Each turn advances 33 mm and is 31 mm wide, so the
 * turns nearly touch and a hairline of sleeve shows between them: that groove,
 * not a solid sleeve of cloth, is what reads as a wrap. `lift` is the gap over
 * the sleeve — its wrinkle harmonics stay under 4 mm in this span, so the band
 * clears them. `layers` is how far each turn stands proud of the one below it;
 * without that step the turns are coplanar and the wrap reads as one flat sheet.
 * `phase` is the local angle the first turn starts at, aimed at the side of the
 * arm that faces the camera so the first second of the hold is the visible part.
 */
const WRAP = {
  turns: 3,
  from: 0.10,
  to: 0.20,
  width: 0.031,
  lift: 0.004,
  thickness: 0.003,
  layers: 0.0026,
  ripple: 0.0011,
  ripplePitch: 0.016,
  phase: 0.5,
  segments: 144,
  taper: 7,
};

/** Radius of the band's outer face `z` metres from the wrist, `t` into the hold,
 *  `along` metres up the forearm. The ripple is the cloth's own transverse
 *  creasing; the sleeve's wrinkles are under the band and no longer show. */
function bandRadius(z, t, extra, along) {
  return sleeveRadius(z) + WRAP.lift + extra + WRAP.layers * t * WRAP.turns
    + WRAP.ripple * Math.sin((along / WRAP.ripplePitch) * Math.PI * 2);
}

/** Roll centre in hand space: down the palm (side) and out along the fingers. */
export const BANDAGE_ROLL = { side: -0.028, ahead: 0.062, radius: 0.015 };

/**
 * Where the roll is pressing at progress `u`: writes the point on the cloth it
 * has just laid, the outward surface normal, and the winding tangent, all in the
 * arm's own space. The hand is placed from the cloth it is laying, so the roll
 * and the band's leading edge cannot disagree.
 */
export function bandageWrapFrame(u, point, normal, tangent, from = WRAP.from, to = WRAP.to) {
  const t = clamp01(u);
  const a = WRAP.phase + t * WRAP.turns * Math.PI * 2;
  const d = from + t * (to - from);
  const ca = Math.cos(a);
  const sa = Math.sin(a);
  const r = bandRadius(0.3 - d, t, WRAP.thickness, d);
  point.set(r * ca, SLEEVE_FLAT * r * sa, -d);
  // Outward normal of the elliptical cross-section, not the radius direction.
  normal.set(SLEEVE_FLAT * ca, sa, 0).normalize();
  const da = WRAP.turns * Math.PI * 2;
  const dd = to - from;
  tangent.set(-r * da * sa, SLEEVE_FLAT * r * da * ca, -dd).normalize();
}

const clothMat = new THREE.MeshStandardMaterial({
  color: 0xb7a381,
  roughness: 0.92,
  metalness: 0.04,
  envMapIntensity: 0.35,
  vertexColors: true,
});
const coreMat = new THREE.MeshStandardMaterial({
  color: 0x8d7a52,
  roughness: 0.86,
  metalness: 0.05,
  envMapIntensity: 0.3,
});

/** White vertex colours, so the roll can share the band's toned material. */
function whiteGeo(geo) {
  const n = geo.getAttribute('position').count;
  geo.setAttribute('color', new THREE.BufferAttribute(new Float32Array(n * 3).fill(1), 3));
  return geo;
}

const _rollGeo = whiteGeo(new THREE.CylinderGeometry(BANDAGE_ROLL.radius, BANDAGE_ROLL.radius, 0.048, 18, 1, false));
const _coreGeo = new THREE.CylinderGeometry(0.0068, 0.0068, 0.052, 10, 1, false);
// The loose end of the roll: one seam is enough for the eye to see it turn. A
// bare cylinder is rotationally symmetric, so an unmarked roll cannot be seen to
// rotate at all.
const _seamGeo = new THREE.BoxGeometry(0.003, 0.048, 0.0022);

/**
 * A single mesh whose drawn index count is the length of the cloth laid down, so
 * progress reveals the wrap continuously instead of popping rings into place.
 * The geometry is shared, so the mesh owns nothing to dispose.
 */
function wrapGeometry() {
  const { turns, from, to, width, thickness, segments, taper } = WRAP;
  const verts = new Float32Array((segments + 1) * 4 * 3);
  // Grey per-vertex tone, not a texture: the long edges of the band are 3 mm
  // walls and are the only thing that shows where one turn crosses the next.
  const tone = new Float32Array((segments + 1) * 4 * 3);
  const TONE = [0.5, 0.5, 1, 1]; // inner face, then outer face
  // Four long edges per station: inner and outer face at the two band edges.
  const index = [];
  let v = 0;
  for (let i = 0; i <= segments; i++) {
    const t = i / segments;
    const a = WRAP.phase + t * turns * Math.PI * 2;
    const d = from + t * (to - from);
    const ca = Math.cos(a);
    const sa = Math.sin(a);
    // The cloth thins to nothing at the leading edge and at the first turn, so
    // the slab has no open ends to see through.
    const thin = thickness * Math.min(1, i / taper, (segments - i) / taper);
    const edge = [[-width / 2, 0], [width / 2, 0], [-width / 2, thin], [width / 2, thin]];
    for (let k = 0; k < 4; k++) {
      const r = bandRadius(0.3 - (d + edge[k][0]), t, edge[k][1], d + edge[k][0]);
      verts[v] = r * ca;
      verts[v + 1] = SLEEVE_FLAT * r * sa;
      verts[v + 2] = -(d + edge[k][0]);
      tone[v] = TONE[k];
      tone[v + 1] = TONE[k];
      tone[v + 2] = TONE[k];
      v += 3;
    }
  }
  for (let i = 0; i < segments; i++) {
    const a = i * 4;
    const b = a + 4;
    // Winding: outer out, inner in, each long edge out.
    index.push(
      a + 2, a + 3, b + 3, a + 2, b + 3, b + 2,
      a + 0, b + 1, a + 1, a + 0, b + 0, b + 1,
      a + 0, b + 2, b + 0, a + 0, a + 2, b + 2,
      a + 1, b + 1, b + 3, a + 1, b + 3, a + 3
    );
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(verts, 3));
  geo.setAttribute('color', new THREE.BufferAttribute(tone, 3));
  geo.setIndex(index);
  geo.computeVertexNormals();
  geo.setDrawRange(0, 0);
  return geo;
}

let _wrapGeo = null;

/** The wound cloth for the left forearm. Nothing is drawn until `u` advances. */
export function bandageWrapMesh() {
  if (!_wrapGeo) _wrapGeo = wrapGeometry();
  const mesh = new THREE.Mesh(_wrapGeo, clothMat);
  mesh.name = 'ow-bandage-wrap';
  mesh.receiveShadow = true;
  mesh.frustumCulled = false;
  mesh.visible = false;
  return mesh;
}

/** Index count for the cloth laid at progress `u` (whole stations only). */
export function bandageWrapCount(u) {
  return Math.floor(clamp01(u) * WRAP.segments) * 24; // 4 quads per station
}

/**
 * The roll itself, in the right palm: the spin group turns with the cloth it
 * feeds and shrinks as it is used up.
 */
export function bandageMesh() {
  const group = new THREE.Group();
  group.name = 'ow-bandage';
  group.position.set(0, BANDAGE_ROLL.side, -BANDAGE_ROLL.ahead);
  group.rotation.z = Math.PI / 2;

  // Local +Y is the roll's axis, which the group lays along the hand's X — the
  // axis the fingers curl around, and so the axis that ends up down the forearm.
  const spin = new THREE.Group();
  spin.name = 'ow-bandage-roll';
  group.add(spin);

  // Like the arm skins it sits on, the prop receives shadows but casts none:
  // the view light rig is not the one the world shadow map was fitted to.
  const roll = new THREE.Mesh(_rollGeo, clothMat);
  roll.receiveShadow = true;
  spin.add(roll);

  const seam = new THREE.Mesh(_seamGeo, coreMat);
  seam.position.set(0, 0, BANDAGE_ROLL.radius);
  spin.add(seam);

  const core = new THREE.Mesh(_coreGeo, coreMat);
  spin.add(core);

  group.visible = false;
  group.userData.spin = spin;
  return group;
}

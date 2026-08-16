import * as THREE from 'three';
import { box, latheZ, rodZ, ring, extrude, mergeAll } from './geometry.js';

/**
 * M67 fragmentation grenade.
 *
 * Shared geometry + materials, one group per instance — the same pattern as
 * `radio-mesh.js`. Authored at the historical viewmodel scale (body ~90 mm
 * across) so the existing palm seat still closes around it; the real M67 is
 * 64 mm and would leave daylight in the fist.
 *
 * Local space: origin at the body centre, fuze along +Y, spoon wrapping
 * +Y → −X (the visible 3/4 after the viewmodel's π flip), pull-ring on −X.
 * Thrown copies keep +Y up.
 */

const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _e = new THREE.Euler();
const _p = new THREE.Vector3();
const _s = new THREE.Vector3(1, 1, 1);

function xf(geo, x, y, z, rx = 0, ry = 0, rz = 0) {
  const g = geo.clone();
  _e.set(rx, ry, rz, 'XYZ');
  _q.setFromEuler(_e);
  _p.set(x, y, z);
  _m.compose(_p, _q, _s);
  g.applyMatrix4(_m);
  return g;
}

/**
 * Olive-drab body / fuze. Same dark metal the placeholder used — a light
 * dielectric under the viewmodel IBL blows out to cream on a sphere facing
 * the sky.
 */
const bodyMat = new THREE.MeshStandardMaterial({
  color: 0x2c3226,
  roughness: 0.62,
  metalness: 0.85,
});
/** Stamped spoon — lighter, shinier olive so the lever separates from the body. */
const spoonMat = new THREE.MeshStandardMaterial({
  color: 0x4a5140,
  roughness: 0.32,
  metalness: 0.92,
});
/** Bare pin and safety clip. */
const steelMat = new THREE.MeshStandardMaterial({
  color: 0x6a6e64,
  roughness: 0.42,
  metalness: 0.86,
});
/** Pull-ring wire. */
const ringMat = new THREE.MeshStandardMaterial({
  color: 0x9aa090,
  roughness: 0.38,
  metalness: 0.9,
});
/** HE identification band around the fuze well. */
const bandMat = new THREE.MeshStandardMaterial({
  color: 0xc4a22a,
  roughness: 0.7,
  metalness: 0.16,
});

/**
 * Safety lever as one stamped L: a thin plate on the fuze, a neck down the
 * well, then a polar crescent over the crown.
 *
 * A strip down the −X meridian sits on the camera-facing flank and reads
 * as a crease. A circular hoop around the origin is what actually changes
 * the silhouette — a real M67 spoon is a stamped arc, so it stands a mill
 * or two off the ovoid shoulder. Inner radius hugs the equator so it does
 * not float as a second shell.
 */
function spoonOutline() {
  const pts = [];
  const n = 16;
  const a0 = 0.32;
  const a1 = 1.68;
  const rIn = 0.0484;
  const rOut = 0.0550;
  const ox = (a, r) => -Math.sin(a) * r;
  const oy = (a, r) => Math.cos(a) * r;

  // Head plate on the fuze. After the viewmodel π flip this +Y face is
  // what the hold looks at. ~3.2 mm thick so it reads as sheet, not a block.
  pts.push([0.010, 0.0864]);
  pts.push([-0.015, 0.0864]);
  pts.push([-0.019, 0.0836]);
  // Neck down the fuze, landing on the crescent start so they join.
  pts.push([ox(a0, rOut) * 0.55 - 0.008, 0.070]);
  pts.push([ox(a0, rOut), oy(a0, rOut)]);

  for (let i = 1; i <= n; i++) {
    const t = i / n;
    const a = a0 + t * (a1 - a0);
    const kick = t > 0.88 ? ((t - 0.88) / 0.12) * 0.0016 : 0;
    pts.push([ox(a, rOut + kick), oy(a, rOut + kick)]);
  }
  for (let i = n; i >= 0; i--) {
    const t = i / n;
    const a = a0 + t * (a1 - a0);
    pts.push([ox(a, rIn), oy(a, rIn)]);
  }

  // Neck inner, back under the head.
  pts.push([ox(a0, rIn) * 0.55 - 0.006, 0.070]);
  pts.push([-0.011, 0.0832]);
  pts.push([0.010, 0.0832]);
  return pts;
}

// ---- body: slightly flattened sphere + equatorial weld --------------------
const bodyGeo = (() => {
  const shell = latheZ(
    [
      [-0.040, 0.0001],
      [-0.038, 0.016],
      [-0.030, 0.034],
      [-0.016, 0.043],
      [0.000, 0.045],
      [0.014, 0.043],
      [0.026, 0.034],
      [0.032, 0.020],
      [0.034, 0.016],
      [0.036, 0.015],
      [0.036, 0.0001],
    ],
    28
  );
  shell.rotateX(-Math.PI / 2);
  const seam = latheZ(
    [
      [-0.0016, 0.0444],
      [-0.0016, 0.0466],
      [0.0016, 0.0466],
      [0.0016, 0.0444],
    ],
    28
  );
  seam.rotateX(-Math.PI / 2);
  return mergeAll([shell, seam]);
})();

// ---- fuze -----------------------------------------------------------------
const fuzeGeo = (() => {
  const fuze = latheZ(
    [
      [0.000, 0.0001],
      [0.000, 0.0146],
      [0.0024, 0.0146],
      [0.0034, 0.0132],
      [0.020, 0.0130],
      [0.022, 0.0104],
      [0.036, 0.0100],
      [0.038, 0.0088],
      [0.044, 0.0086],
      [0.046, 0.0068],
      [0.046, 0.0001],
    ],
    18
  );
  fuze.rotateX(-Math.PI / 2);
  fuze.translate(0, 0.036, 0);
  return fuze;
})();

const spoonGeo = extrude(spoonOutline(), 0.026, {
  bevel: 0.0009,
  bevelSegments: 2,
  curveSegments: 6,
});

// ---- yellow HE band around the well ---------------------------------------
const bandGeo = (() => {
  const g = latheZ(
    [
      [0.0326, 0.0148],
      [0.0326, 0.0186],
      [0.0362, 0.0186],
      [0.0362, 0.0148],
    ],
    20
  );
  g.rotateX(-Math.PI / 2);
  return g;
})();

// ---- bare metal: cotter pin + safety clip ---------------------------------
const steelGeo = (() => {
  const parts = [];
  const pin = rodZ(0.0018, 0.0018, 0.028, 8, 0.0003);
  pin.rotateY(Math.PI / 2);
  pin.translate(-0.004, 0.0880, 0);
  parts.push(pin);
  parts.push(xf(box(0.0044, 0.0044, 0.0026, 0.0004), -0.019, 0.0880, 0));
  parts.push(xf(box(0.010, 0.0024, 0.006, 0.0004), -0.015, 0.080, 0, 0, 0, 0.32));
  return mergeAll(parts);
})();

// ---- pull ring, standing off the pin --------------------------------------
const ringGeo = (() => {
  const g = ring(0.0134, 0.0019, 18, 8);
  g.rotateZ(Math.PI / 2);
  g.translate(-0.029, 0.097, 0);
  return g;
})();

function prep(mesh) {
  mesh.castShadow = false;
  mesh.receiveShadow = true;
  mesh.frustumCulled = false;
  return mesh;
}

/** A fresh grenade group with shared geometry and materials. */
export function grenadeMesh() {
  const g = new THREE.Group();
  g.add(prep(new THREE.Mesh(bodyGeo, bodyMat)));
  g.add(prep(new THREE.Mesh(fuzeGeo, bodyMat)));
  g.add(prep(new THREE.Mesh(spoonGeo, spoonMat)));
  g.add(prep(new THREE.Mesh(bandGeo, bandMat)));
  g.add(prep(new THREE.Mesh(steelGeo, steelMat)));
  g.add(prep(new THREE.Mesh(ringGeo, ringMat)));
  return g;
}

/** Body material — kept for the existing AI prewarm call site. */
export function grenadeMaterial() {
  return bodyMat;
}

/** Every material the mesh uses, so prewarm can compile them all. */
export function grenadeMaterials() {
  return [bodyMat, spoonMat, steelMat, ringMat, bandMat];
}

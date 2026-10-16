import * as THREE from 'three';

import {
  box,
  blob,
  latheZ,
  tubeZ,
  rodZ,
  dome,
  extrude,
  ring,
  screw,
  mergeAll,
  Assembly,
} from './geometry.ts';

/**
 * Reusable firearm components.
 *
 * Each function bolts a real mechanical assembly onto an `Assembly` at a given
 * offset. Components use weapon-local metres; proportion is what the eye
 * checks first, before surface detail.
 *
 * Weapon-local space: +X right, +Y up, -Z toward the muzzle. The origin is the
 * shooting hand's anchor (the web of the thumb, top-rear of the pistol grip),
 * which is also what the viewmodel rig positions.
 */

const TAU = Math.PI * 2;

type Axis = 'x' | 'y' | 'z';
interface Rotation {
  rx?: number;
  ry?: number;
  rz?: number;
}
interface CarbineStockOptions extends PartOptions {
  bore: number;
  zRear: number;
  zFront: number;
}
interface PartOptions {
  angle?: number;
  count?: number;
  depth?: number;
  h?: number;
  len?: number;
  pattern?: readonly number[];
  pitch?: number;
  stroke?: number;
  sx?: number;
  w?: number;
  x?: number;
  y?: number;
  z?: number;
}

/* -------------------------------------------------------------------------- */
/*  small hardware                                                            */
/* -------------------------------------------------------------------------- */

/** Cross pin with a domed head (takedown pins, trigger/hammer pins). */
export function addPin(
  asm: Assembly,
  mat: string,
  x: number,
  y: number,
  z: number,
  r = 0.0022,
  len = 0.02
): void {
  asm.add(rodZ(r, r, len, 12, 0.0004), mat, { x, y, z, ry: Math.PI / 2 });
  asm.add(dome(r * 1.25, 10, 0.5), mat, { x: x + len / 2, y, z, ry: -Math.PI / 2 });
  asm.add(dome(r * 1.25, 10, 0.5), mat, { x: x - len / 2, y, z, ry: Math.PI / 2 });
}

/** Hex-socket screw, head facing +axis. */
export function addScrew(
  asm: Assembly,
  mat: string,
  x: number,
  y: number,
  z: number,
  rHead = 0.0022,
  axis: Axis = 'y',
  len = 0.008
): void {
  const g = screw(rHead, rHead * 0.55, rHead * 0.5, len, 10);
  const rot = axis === 'y' ? { rx: Math.PI / 2 } : axis === 'x' ? { ry: -Math.PI / 2 } : {};
  asm.add(g, mat, { x, y, z, ...rot });
  g.dispose();
}

/** QD sling swivel socket: a countersunk cup with a steel insert. */
export function addQdSocket(
  asm: Assembly,
  matBody: string,
  matSteel: string,
  x: number,
  y: number,
  z: number,
  axis: Axis = 'x',
  r = 0.0055
): void {
  const cup = latheZ(
    [
      [0, r * 0.55],
      [0, r * 1.5],
      [0.0012, r * 1.62],
      [0.006, r * 1.62],
      [0.006, r * 0.9],
    ],
    14
  );
  const inner = latheZ(
    [
      [0.004, 0],
      [0.004, r * 0.55],
      [0, r * 0.55],
    ],
    12
  );
  const rot = axis === 'x' ? { ry: Math.PI / 2 } : axis === 'y' ? { rx: -Math.PI / 2 } : {};
  asm.add(cup, matBody, { x, y, z, ...rot });
  asm.add(inner, matSteel, { x, y, z, ...rot });
  cup.dispose();
  inner.dispose();
}

/** Fixed sling loop — a flat steel eye. */
export function addSlingLoop(
  asm: Assembly,
  mat: string,
  x: number,
  y: number,
  z: number,
  radius = 0.008,
  rot: Rotation = {}
): void {
  const g = ring(radius, 0.0016, 14, 6);
  asm.add(g, mat, { x, y, z, ...rot });
  g.dispose();
}

/** A live cartridge: brass case, shoulder, neck, copper FMJ tip. */
export function cartridge(
  caseLen = 0.0446,
  rimR = 0.00495,
  bulletLen = 0.019
): { brass: THREE.BufferGeometry; bullet: THREE.BufferGeometry; length: number } {
  const neckR = rimR * 0.72;
  const brass = latheZ(
    [
      [0, 0],
      [0, rimR],
      [0.0012, rimR * 0.97],
      [caseLen * 0.62, rimR * 0.965],
      [caseLen * 0.78, neckR],
      [caseLen, neckR],
    ],
    16
  );
  const bullet = latheZ(
    [
      [caseLen - 0.004, neckR * 0.98],
      [caseLen + bulletLen * 0.45, neckR * 0.98],
      [caseLen + bulletLen * 0.8, neckR * 0.62],
      [caseLen + bulletLen, neckR * 0.16],
      [caseLen + bulletLen + 0.0004, 0],
    ],
    16
  );
  return { brass, bullet, length: caseLen + bulletLen };
}

/**
 * Curved trigger blade with a serrated face; pivots about its pin.
 *
 * The outline is a SIDE view: +X is rearward (the face the finger presses),
 * -Y is down. The whole blade is rotated at the end so that outline-X becomes
 * +Z and the 7 mm extrusion becomes the blade's width across the receiver —
 * without that the blade is a plate standing across the trigger guard.
 */
export function triggerPart(matSteel: string): { geo: THREE.BufferGeometry; mat: string } {
  const blade = extrude(
    [
      [-0.0045, 0.0045],
      [0.0048, 0.0045],
      [0.0056, -0.008],
      [0.0044, -0.0158],
      [0.0016, -0.0202],
      [-0.0032, -0.0192],
      [-0.0055, -0.011],
      [-0.006, -0.002],
    ],
    0.0072,
    { bevel: 0.0007, bevelSegments: 2 }
  );
  const parts = [blade];
  // Serrations across the face the finger pad sits on.
  for (let i = 0; i < 6; i++) {
    const g = box(0.0015, 0.0011, 0.0066, 0.0003, 1);
    // Spin in place first, THEN place: rotating after the translate would swing
    // the serration around the blade's pivot instead of tilting it.
    g.rotateZ(-0.2 - i * 0.05);
    g.translate(0.0049 - i * 0.0004, -0.0045 - i * 0.0026, 0);
    parts.push(g);
  }
  const geo = mergeAll(parts)!;
  geo.rotateY(-Math.PI / 2); // outline-X -> +Z (rearward), extrusion -> across
  return { geo, mat: matSteel };
}

/* -------------------------------------------------------------------------- */
/*  grip / stock                                                              */
/* -------------------------------------------------------------------------- */

/**
 * Pistol grip with a palm swell, finger grooves, a beavertail and moulded
 * texture panels. Built along its own axis then rotated by `angle`.
 */
export function addPistolGrip(
  asm: Assembly,
  matPoly: string,
  matRubber: string,
  o: PartOptions
): void {
  const len = o.len ?? 0.108;
  const w = o.w ?? 0.031;
  const angle = o.angle ?? 0.38; // rake: positive tilts the BOTTOM rearward
  const oy = o.y ?? 0;
  const oz = o.z ?? 0;

  // Side profile in (z, y), authored as one closed outline and extruded across
  // the grip's width. A single solid cannot develop the seams a lofted stack of
  // slices does, and the outline is where the shape actually lives: a swept
  // front strap with finger relief, a straight back strap, a beavertail.
  const zf = -0.0155; // front strap
  const zb = 0.0155; // back strap
  const profile = [
    [zb + 0.004, 0.008],
    [zf - 0.002, 0.007],
    [zf - 0.0035, -0.006],
    [zf - 0.0015, -0.02],
    [zf - 0.003, -0.034],
    [zf - 0.0005, -0.05],
    [zf - 0.002, -0.064],
    [zf + 0.001, -0.08],
    [zf + 0.0035, -len + 0.004],
    [zf + 0.008, -len],
    [zb - 0.006, -len],
    [zb - 0.001, -len + 0.006],
    [zb + 0.001, -0.06],
    [zb + 0.0025, -0.03],
    [zb + 0.006, -0.012],
  ];
  const core = extrude(profile, w, { bevel: 0.0035, bevelSegments: 3, curveSegments: 4 });
  core.rotateY(Math.PI / 2);
  asm.add(core, matPoly, { y: oy, z: oz, rx: -angle });
  core.dispose();

  // Palm swell on both flanks so the grip is not a slab.
  const swell = blob(0.008, len * 0.62, 0.03, 0.006, 3);
  for (const sx of [-1, 1]) {
    asm.add(swell, matPoly, {
      x: sx * (w * 0.5 - 0.0015),
      y: oy - len * 0.42,
      z: oz + 0.0035,
      rx: -angle,
    });
  }
  swell.dispose();

  // Beavertail behind the trigger, blending into the receiver.
  const beaver = blob(w * 0.96, 0.02, 0.024, 0.006, 3);
  asm.add(beaver, matPoly, { y: oy + 0.005, z: oz + 0.012, rx: -angle * 0.6 });
  beaver.dispose();

  // Rubberised over-mould: side panels plus the front-strap finger swells.
  const panel = blob(w * 1.03, len * 0.58, 0.019, 0.005, 3);
  asm.add(panel, matRubber, { y: oy - len * 0.44, z: oz + 0.0025, rx: -angle });
  panel.dispose();
  // Finger swells on the front strap: shallow cross-wise ridges, not rings.
  for (let i = 0; i < 4; i++) {
    const t = 0.15 + i * 0.2;
    const ridge = blob(w * 0.9, 0.011, 0.007, 0.003, 3);
    const yy = oy - t * len;
    const zz = oz + zf + 0.001 + Math.sin(t * Math.PI) * 0.001;
    // Rotate into the raked frame by hand so the ridge hugs the strap.
    const cs = Math.cos(-angle);
    const sn = Math.sin(-angle);
    asm.add(ridge, matRubber, {
      y: oy + (yy - oy) * cs - (zz - oz) * sn,
      z: oz + (yy - oy) * sn + (zz - oz) * cs,
      rx: -angle,
    });
    ridge.dispose();
  }

  // Grip cap with its screw.
  const capY = oy - Math.cos(angle) * len;
  const capZ = oz + Math.sin(angle) * len;
  const cap = blob(w * 0.92, 0.007, 0.031, 0.0025, 2);
  asm.add(cap, matPoly, { y: capY + 0.001, z: capZ, rx: -angle });
  cap.dispose();
  addScrew(asm, matRubber, 0, capY - 0.0015, capZ, 0.0026, 'y', 0.006);
}

/**
 * Collapsible carbine stock on a mil-spec receiver extension: 6 detent
 * positions, cheek weld, sling loop, adjustment lever and a rubber butt pad.
 */
export function addCarbineStock(
  asm: Assembly,
  matAlu: string,
  matPoly: string,
  matRubber: string,
  o: CarbineStockOptions
): void {
  const bore = o.bore;
  const zRear = o.zRear; // butt
  const zFront = o.zFront; // receiver face
  const yAxis = o.y ?? bore - 0.012;
  const tubeR = 0.0146;
  const len = zRear - zFront;

  // receiver extension
  const ext = tubeZ(tubeR, tubeR - 0.0022, len - 0.004, 18, 0.0004);
  asm.add(ext, matAlu, { y: yAxis, z: (zRear + zFront) / 2 });
  ext.dispose();
  // castle nut + end plate
  const nut = latheZ(
    [
      [0, tubeR],
      [0, tubeR + 0.0034],
      [0.0016, tubeR + 0.0038],
      [0.0085, tubeR + 0.0038],
      [0.01, tubeR + 0.003],
      [0.01, tubeR],
    ],
    18
  );
  asm.add(nut, matAlu, { y: yAxis, z: zFront });
  nut.dispose();
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * TAU;
    const notch = box(0.0022, 0.0034, 0.006, 0.0004, 1);
    notch.translate(0, tubeR + 0.0032, 0);
    notch.rotateZ(a);
    notch.translate(0, yAxis, zFront + 0.005);
    asm.add(notch, matAlu, {});
    notch.dispose();
  }
  // detent notches along the bottom of the tube
  for (let i = 0; i < 6; i++) {
    const z = zFront + 0.026 + i * 0.018;
    if (z > zRear - 0.02) break;
    const n = box(0.0075, 0.0032, 0.0075, 0.0006, 1);
    asm.add(n, matAlu, { y: yAxis - tubeR + 0.0008, z });
    n.dispose();
  }

  // Stock body: a side profile extruded across the width, so the comb slopes
  // and the toe kicks down the way a collapsible carbine stock actually does.
  const bodyLen = 0.104;
  const bz = zRear - bodyLen / 2;
  const combY = yAxis + 0.026;
  const toeY = yAxis - 0.042;
  const outline = [
    [-bodyLen * 0.5, yAxis + 0.004],
    [-bodyLen * 0.5 + 0.012, yAxis + 0.017],
    [-bodyLen * 0.5 + 0.03, combY - 0.002],
    [bodyLen * 0.5 - 0.012, combY],
    [bodyLen * 0.5, combY - 0.006],
    [bodyLen * 0.5, toeY + 0.008],
    [bodyLen * 0.5 - 0.008, toeY],
    [-bodyLen * 0.5 + 0.028, toeY + 0.006],
    [-bodyLen * 0.5 + 0.008, yAxis - 0.02],
    [-bodyLen * 0.5, yAxis - 0.009],
  ];
  const shellParts = [];
  const shell = extrude(outline, 0.043, { bevel: 0.0035, bevelSegments: 2 });
  shell.rotateY(Math.PI / 2);
  shellParts.push(shell);
  // Cheek weld ridge along the comb.
  const cheek = blob(0.047, 0.012, bodyLen * 0.66, 0.005, 3);
  cheek.translate(0, combY - 0.002, -0.006);
  shellParts.push(cheek);
  // Lightening scallops on both flanks.
  for (const sx of [-1, 1]) {
    const sc = blob(0.005, 0.024, 0.052, 0.005, 3);
    sc.translate(sx * 0.0205, yAxis - 0.012, 0.004);
    shellParts.push(sc);
  }
  const body = mergeAll(shellParts)!;
  asm.add(body, matPoly, { z: bz });
  body.dispose();

  // adjustment lever under the stock
  const lever = extrude(
    [
      [-0.014, 0],
      [0.016, 0],
      [0.018, -0.007],
      [0.012, -0.011],
      [-0.012, -0.011],
      [-0.016, -0.005],
    ],
    0.014,
    { bevel: 0.0008 }
  );
  asm.add(lever, matPoly, { y: yAxis - 0.036, z: bz + 0.012 });
  lever.dispose();

  // Butt pad — rubber, with real grooves, following the comb-to-toe rake.
  const pad = blob(0.045, 0.072, 0.013, 0.0045, 3);
  asm.add(pad, matRubber, { y: yAxis - 0.008, z: zRear - 0.004, rx: 0.06 });
  pad.dispose();
  for (let i = 0; i < 5; i++) {
    const g = box(0.043, 0.0035, 0.005, 0.0012, 2);
    asm.add(g, matRubber, { y: yAxis + 0.02 - i * 0.0125, z: zRear + 0.0026, rx: 0.06 });
    g.dispose();
  }

  // sling loop + QD socket
  addSlingLoop(asm, matAlu, 0.0225, yAxis - 0.026, bz - 0.03, 0.0075, { ry: Math.PI / 2 });
  addQdSocket(asm, matPoly, matAlu, -0.0215, yAxis - 0.014, bz - 0.026, 'x', 0.005);
}

/**
 * Engraved rollmark / calibre stamp.
 *
 * A machined receiver always carries one, and it is one of the very few cues that
 * tells the eye the surface is metal that has been through a press rather than a
 * moulded shell. It is modelled as real recessed strokes in the part's own local
 * space — not a projected decal — precisely because the viewmodel translates and
 * rotates every frame: anything sampled in world space swims across the receiver.
 *
 * At 0.35 m a 4 mm rollmark is ~12 px tall, so what has to be right is the RHYTHM
 * of the strokes and the underline, not the letterforms. The pattern is fixed, so
 * the mark is byte-identical every boot (capture reproducibility).
 */
export function addRollmark(asm: Assembly, mat: string, o: PartOptions): void {
  const h = o.h ?? 0.0036;
  const stroke = o.stroke ?? 0.0006;
  const depth = o.depth ?? 0.0008;
  const pitch = o.pitch ?? 0.0017;
  const pat = o.pattern ?? [3, 2, 3, 3, 1, 0, 2, 3, 2, 3, 0, 3, 1, 2, 3, 2, 0, 3, 3, 2];
  const n = o.count ?? pat.length;
  const parts = [];
  for (let i = 0; i < n; i++) {
    const p = pat[i % pat.length];
    if (p === 0) continue;
    const bh = h * (0.52 + p * 0.16);
    const b = box(depth, bh, stroke, 0.00008, 1);
    b.translate(0, (h - bh) * 0.5, -i * pitch);
    parts.push(b);
    if (p === 3) {
      // a crossbar, so a run of strokes reads as letters and not as a comb
      const c = box(depth, stroke * 0.85, pitch * 0.72, 0.00008, 1);
      c.translate(0, (h - bh) * 0.5 + bh * 0.16, -i * pitch - pitch * 0.3);
      parts.push(c);
    }
  }
  const line = box(depth, stroke * 0.9, (n - 1) * pitch, 0.00008, 1);
  line.translate(0, -h * 0.55, -(n - 1) * pitch * 0.5);
  parts.push(line);
  const g = mergeAll(parts)!;
  if (o.sx) g.scale(o.sx, 1, 1);
  asm.add(g, mat, { x: o.x, y: o.y, z: o.z });
  g.dispose();
}

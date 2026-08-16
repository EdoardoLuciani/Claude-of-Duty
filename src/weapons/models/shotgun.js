import { Assembly, box, blob, extrude, roundRect, latheZ, rodZ, tubeZ, dome, knurlBand } from '../geometry.js';
import {
  addPistolGrip,
  addCarbineStock,
  addPin,
  addScrew,
  addSlingLoop,
  addQdSocket,
  addRollmark,
  triggerPart,
} from '../parts.js';

/**
 * The shotgun — a Mossberg 590A1 12-gauge pump, authored against a left-side
 * photo of the mil-spec 18.5" / 6+1 / ghost-ring / SureFire-forend / M4-stock
 * configuration (Wikimedia File:Mossberg_M590A1.JPG) and Mossberg's published
 * numbers (39.5" OAL, 18.5" heavy-walled barrel, 6+1, ~7 lb).
 *
 * Reads that have to land or it is just "a black tube":
 *   - a LONG, flat-sided receiver with a rounded top, ejection port on the
 *     right, loading port on the belly, tang safety on the rear deck
 *   - a HEAVY-WALLED barrel sitting well above a magazine tube of almost the
 *     same length, the two joined by a barrel lug near the cap
 *   - a SureFire dedicated forend: angular light housing under a ribbed slide,
 *     switch on the left, lamp hanging ahead of the grip
 *   - twin action bars running back into the receiver
 *   - a near-vertical pistol grip and an M4-style 6-position stock
 *   - ghost-ring rear on the receiver deck, blade/bead up front
 *
 * Layout (weapon-local metres, origin at the shooting hand's thumb web):
 *   bore axis        y = +0.068
 *   receiver         z = +0.055 .. -0.165
 *   barrel           z = -0.10  .. -0.545  (18.5")
 *   muzzle crown     z = -0.545
 *   mag tube         y = +0.037, z = -0.165 .. -0.505
 *   pump forend      z = -0.205 .. -0.385  (at rest)
 *   butt pad         z = +0.255
 */
export function buildShotgun() {
  const bore = 0.068;
  const recW = 0.029;
  const recH = 0.046;
  const recY = bore - 0.004;
  const recTop = recY + recH / 2;
  const recBot = recY - recH / 2;
  const zRecRear = 0.055;
  const zRecFront = -0.165;
  const recLen = zRecRear - zRecFront;
  const recC = (zRecRear + zRecFront) / 2;
  const portZ = -0.072;
  const zBreech = -0.1;
  const zBarrelEnd = -0.545;
  const rBarrel = 0.0112; // heavy-walled 12g, ~22 mm OD
  const rBore = 0.0093; // 18.5 mm / 2
  // Real 590: tube sits just under the barrel, both leave through the front face.
  const tubeY = bore - rBarrel - 0.0104 - 0.0018;
  const tubeR = 0.0104;
  const zTubeFront = -0.505;
  const zForendRear = -0.205;
  const zForendFront = -0.385;
  const forendC = (zForendRear + zForendFront) / 2;
  const forendLen = zForendRear - zForendFront;
  const caseRadius = 0.01105; // 12g rim ~22.1 mm
  const caseLen = 0.07;

  const body = new Assembly('shotgun-body');

  // Mesh is deeper than the attachment datum so the mag tube is INSIDE the
  // front face. Top stays put; the extra height is all belly.
  const recMeshBot = tubeY - 0.0104 - 0.005;
  const recMeshH = recTop - recMeshBot;
  const recMeshY = (recTop + recMeshBot) / 2;
  const rec = box(recW, recMeshH, recLen, 0.0032, 2);
  body.add(rec, 'steel', { y: recMeshY, z: recC });
  rec.dispose();
  // Rounded top strap — the 500 receiver is not a square extrusion.
  const recCrown = blob(recW * 0.92, 0.014, recLen - 0.01, 0.006, 3);
  body.add(recCrown, 'steel', { y: recTop + 0.002, z: recC });
  recCrown.dispose();
  // Rear tang: the receiver steps down into the stock adapter.
  const tang = box(recW * 0.86, 0.018, 0.028, 0.002, 2);
  body.add(tang, 'steel', { y: recY + 0.006, z: zRecRear + 0.012 });
  tang.dispose();
  // Tang safety — Mossberg's signature, on top of the rear deck, left of centre.
  const safety = box(0.009, 0.0055, 0.018, 0.0012, 2);
  body.add(safety, 'steel', { x: -0.004, y: recTop + 0.004, z: zRecRear - 0.01 });
  safety.dispose();
  const safetyKnob = blob(0.007, 0.004, 0.008, 0.0014, 2);
  body.add(safetyKnob, 'steel', { x: -0.004, y: recTop + 0.007, z: zRecRear - 0.004 });
  safetyKnob.dispose();

  // Right-side ejection window — a shallow dark recess, flush with the wall.
  const portW = 0.052;
  const portH = 0.016;
  const cav = box(0.003, portH, portW, 0.0004, 1);
  body.add(cav, 'cavity', { x: recW / 2 - 0.0004, y: bore + 0.001, z: portZ, ry: Math.PI / 2 });
  cav.dispose();


  // Loading port on the belly, just ahead of the trigger guard.
  const loadW = 0.022;
  const loadD = 0.048;
  const loadZ = -0.055;
  const loadCav = box(loadW, 0.008, loadD, 0.001, 1);
  body.add(loadCav, 'cavity', { y: recY - recH / 2 + 0.003, z: loadZ });
  loadCav.dispose();
  const loadLip = extrude(roundRect(loadD + 0.004, loadW + 0.003, 0.0016, 3), 0.0018, {
    bevel: 0.0004,
    holes: [roundRect(loadD, loadW, 0.0012, 3)],
  });
  body.add(loadLip, 'steel', {
    y: recY - recH / 2 + 0.0006,
    z: loadZ,
    rx: Math.PI / 2,
  });
  loadLip.dispose();

  // Trigger-plate pins through the receiver (two, mid-height).
  addPin(body, 'steel', 0, recY + 0.002, -0.018, 0.0026, recW + 0.004);
  addPin(body, 'steel', 0, recY + 0.002, 0.022, 0.0026, recW + 0.004);
  // Shell-stop / action-release buttons on the right-rear receiver wall.
  const stop = blob(0.006, 0.008, 0.01, 0.002, 2);
  body.add(stop, 'steel', { x: recW / 2 + 0.001, y: recY - 0.004, z: 0.018 });
  stop.dispose();
  const release = blob(0.005, 0.007, 0.009, 0.0018, 2);
  body.add(release, 'steel', { x: recW / 2 + 0.001, y: recY - 0.01, z: -0.008 });
  release.dispose();

  // M590A1 rollmark on the left flank — the side the hip-fire camera sees.
  addRollmark(body, 'cavity', { x: -recW / 2 + 0.0016, y: recY + 0.006, z: 0.008, h: 0.0034 });
  addRollmark(body, 'cavity', {
    x: -recW / 2 + 0.0016,
    y: recY - 0.004,
    z: 0.004,
    h: 0.0022,
    pitch: 0.0013,
    pattern: [2, 3, 1, 0, 3, 2, 0, 3, 1],
  });

  /* ---- lower: metal trigger guard + near-vertical grip ------------------- */
  const guardOuter = [
    [-0.022, 0],
    [0.028, 0],
    [0.031, -0.006],
    [0.026, -0.022],
    [0.012, -0.028],
    [-0.014, -0.028],
    [-0.022, -0.02],
  ];
  const guardInner = [
    [-0.016, -0.004],
    [0.022, -0.004],
    [0.024, -0.009],
    [0.02, -0.02],
    [0.01, -0.0235],
    [-0.01, -0.0235],
    [-0.016, -0.018],
  ];
  const guard = extrude(guardOuter, 0.0135, { bevel: 0.0009, holes: [guardInner] });
  // Outline is drawn in XY (forward/down). Spin it so X becomes -Z (muzzle)
  // and the extrusion sits across the gun — same convention as triggerPart.
  guard.rotateY(Math.PI / 2);
  body.add(guard, 'steel', { y: recMeshBot + 0.004, z: 0.016 });
  guard.dispose();

  addPistolGrip(body, 'polymer', 'rubber', {
    y: recMeshBot + 0.006,
    z: 0.022,
    angle: 0.22,
    len: 0.112,
    w: 0.033,
  });

  /* ---- barrel: heavy-walled 12-gauge, no muzzle device ------------------- */
  const barrelLen = zBreech - zBarrelEnd;
  const barrel = latheZ(
    [
      [0, 0],
      [0, rBarrel + 0.0016],
      [0.006, rBarrel + 0.002],
      [0.018, rBarrel + 0.002],
      [0.022, rBarrel],
      [barrelLen - 0.01, rBarrel],
      [barrelLen - 0.004, rBarrel + 0.0006],
      [barrelLen, rBarrel * 0.78],
      [barrelLen, 0],
    ],
    22
  );
  body.add(barrel, 'steel', { y: bore, z: zBreech, ry: Math.PI });
  barrel.dispose();
  const boreTube = tubeZ(rBore * 0.78, rBore * 0.55, barrelLen * 0.45, 14, 0.0003);
  body.add(boreTube, 'cavity', { y: bore, z: zBarrelEnd + barrelLen * 0.22 });
  boreTube.dispose();
  // Parkerized crown ring.
  const crownRing = latheZ(
    [
      [0, rBore * 0.7],
      [0, rBarrel + 0.0004],
      [0.004, rBarrel + 0.0004],
      [0.004, rBore * 0.7],
    ],
    16
  );
  body.add(crownRing, 'steel_soot', { y: bore, z: zBarrelEnd, ry: Math.PI });
  crownRing.dispose();

  /* ---- magazine tube under the barrel ----------------------------------- */
  // Tube runs into the taller front face — no air gap, no separate collar.
  const zTubeRear = zRecFront + 0.028;
  const tubeLen = zTubeRear - zTubeFront;
  const magTube = tubeZ(tubeR, tubeR - 0.0024, tubeLen, 18, 0.0005);
  body.add(magTube, 'steel', { y: tubeY, z: (zTubeRear + zTubeFront) / 2 });
  magTube.dispose();
  // Clean-out cap: the 590A1's threaded magazine nut.
  const cap = latheZ(
    [
      [0, tubeR - 0.001],
      [0, tubeR + 0.0028],
      [0.004, tubeR + 0.0034],
      [0.014, tubeR + 0.0034],
      [0.016, tubeR + 0.0016],
      [0.016, 0],
      [0, 0],
    ],
    18
  );
  body.add(cap, 'steel', { y: tubeY, z: zTubeFront, ry: Math.PI });
  cap.dispose();

  // Barrel lug: the clamp that ties barrel and tube together near the cap.
  const lug = box(0.016, 0.018, 0.022, 0.0016, 2);
  body.add(lug, 'steel', {
    y: (bore + tubeY) / 2,
    z: zTubeFront + 0.028,
  });
  lug.dispose();
  addScrew(body, 'steel', 0, (bore + tubeY) / 2, zTubeFront + 0.028, 0.0024, 'x', 0.01);


  /* ---- ghost-ring rear + front blade ------------------------------------ */
  // Rear aperture on the receiver deck, just behind the barrel root.
  const rearBase = box(0.02, 0.006, 0.018, 0.001, 2);
  body.add(rearBase, 'steel', { y: recTop + 0.003, z: zRecFront + 0.028 });
  rearBase.dispose();
  const ringOuter = [
    [-0.0075, 0],
    [0.0075, 0],
    [0.0075, 0.013],
    [0.005, 0.016],
    [-0.005, 0.016],
    [-0.0075, 0.013],
  ];
  const ringHole = [];
  for (let i = 0; i < 10; i++) {
    const a = (i / 10) * Math.PI * 2;
    ringHole.push([Math.cos(a) * 0.0034, 0.0092 + Math.sin(a) * 0.0034]);
  }
  const ghost = extrude(ringOuter, 0.0055, { bevel: 0.0005, holes: [ringHole] });
  body.add(ghost, 'steel', { y: recTop + 0.006, z: zRecFront + 0.028 });
  ghost.dispose();

  // Front blade + protective ears on the barrel, 20 mm short of the crown.
  const frontZ = zBarrelEnd + 0.022;
  const frontBase = box(0.012, 0.004, 0.014, 0.0007, 1);
  body.add(frontBase, 'steel', { y: bore + rBarrel + 0.002, z: frontZ });
  frontBase.dispose();
  const blade = extrude(
    [
      [-0.0014, 0],
      [0.0014, 0],
      [0.0011, 0.009],
      [0, 0.011],
      [-0.0011, 0.009],
    ],
    0.0032,
    { bevel: 0.0003 }
  );
  body.add(blade, 'steel', { y: bore + rBarrel + 0.004, z: frontZ });
  blade.dispose();
  for (const sx of [-1, 1]) {
    const ear = extrude(
      [
        [-0.0012, 0],
        [0.0012, 0],
        [0.0012, 0.01],
        [0, 0.012],
        [-0.0012, 0.01],
      ],
      0.004,
      { bevel: 0.0003 }
    );
    body.add(ear, 'steel', {
      x: sx * 0.0052,
      y: bore + rBarrel + 0.004,
      z: frontZ,
    });
    ear.dispose();
  }

  /* ---- stock adapter + M4-style 6-position stock ------------------------ */
  const adapter = box(0.028, 0.032, 0.022, 0.0022, 2);
  body.add(adapter, 'polymer', { y: recY + 0.002, z: zRecRear + 0.022 });
  adapter.dispose();
  addCarbineStock(body, 'alu', 'polymer', 'rubber', {
    bore,
    zFront: zRecRear + 0.03,
    zRear: 0.255,
    y: recY + 0.004,
  });
  addQdSocket(body, 'polymer', 'steel', -0.014, recY - 0.01, zRecRear + 0.018, 'x', 0.005);
  addSlingLoop(body, 'steel', 0, tubeY - 0.004, zRecFront + 0.012, 0.007, {
    rx: Math.PI / 2,
    ry: Math.PI / 2,
  });

  /* ---- moving: pump / SureFire forend ----------------------------------- */
  const charging = new Assembly('shotgun-charging');
  // Ribbed polymer slide around the magazine tube.
  const slideR = 0.019;
  const slide = latheZ(
    [
      [0, tubeR + 0.001],
      [0, slideR - 0.002],
      [0.008, slideR],
      [forendLen - 0.01, slideR],
      [forendLen - 0.003, slideR - 0.003],
      [forendLen, tubeR + 0.002],
      [forendLen, tubeR + 0.001],
    ],
    18
  );
  charging.add(slide, 'polymer', { y: tubeY, z: zForendRear, ry: Math.PI });
  slide.dispose();
  // Twin action bars ride with the forend back into the receiver.
  for (const sx of [-1, 1]) {
    const bar = box(0.0042, 0.0065, zRecFront - zForendFront + 0.028, 0.0007, 1);
    charging.add(bar, 'steel', {
      x: sx * (recW * 0.38),
      y: tubeY + 0.006,
      z: (zRecFront + zForendFront) / 2 + 0.006,
    });
    bar.dispose();
  }
  // Finger ribs along the sides — the 590 / SureFire grip section.
  for (let i = 0; i < 5; i++) {
    const z = zForendRear - 0.034 - i * 0.026;
    const rib = blob(0.04, 0.018, 0.016, 0.0045, 2);
    charging.add(rib, 'rubber', { y: tubeY - 0.001, z });
    rib.dispose();
  }
  // Heat-shield scallops on the top of the slide, matching the photo.
  for (let i = 0; i < 3; i++) {
    const scallop = box(0.018, 0.004, 0.022, 0.0012, 1);
    charging.add(scallop, 'polymer', {
      y: tubeY + slideR - 0.002,
      z: zForendRear - 0.04 - i * 0.028,
    });
    scallop.dispose();
  }
  // SureFire dedicated-forend lamp: a single housing under the slide, lamp
  // head flush with the front of the forend — not a second cylinder hanging
  // in space ahead of the tube cap.
  const lampY = tubeY - 0.022;
  const lampZ = forendC - 0.008;
  const lampBody = blob(0.028, 0.024, 0.078, 0.004, 2);
  charging.add(lampBody, 'polymer', { y: lampY, z: lampZ });
  lampBody.dispose();
  const bezel = latheZ(
    [
      [0, 0.007],
      [0, 0.0115],
      [0.004, 0.0125],
      [0.016, 0.0125],
      [0.018, 0.01],
      [0.018, 0],
      [0, 0],
    ],
    16
  );
  charging.add(bezel, 'steel', { y: lampY - 0.002, z: lampZ - 0.038, ry: Math.PI });
  bezel.dispose();
  const lens = dome(0.008, 12, 0.55);
  charging.add(lens, 'glass', { y: lampY - 0.002, z: lampZ - 0.054, ry: Math.PI });
  lens.dispose();
  const pad = blob(0.006, 0.012, 0.018, 0.002, 2);
  charging.add(pad, 'rubber', { x: -0.014, y: lampY + 0.002, z: lampZ + 0.01 });
  pad.dispose();

  /* ---- moving: bolt / elevator (travels with the pump) ------------------ */
  const bolt = new Assembly('shotgun-bolt');
  const boltBody = box(0.016, 0.014, 0.048, 0.0014, 2);
  bolt.add(boltBody, 'steel', {});
  boltBody.dispose();
  const boltFace = latheZ(
    [
      [0, 0],
      [0, 0.0088],
      [0.004, 0.0088],
      [0.004, 0],
    ],
    14
  );
  bolt.add(boltFace, 'steel', { z: -0.028, ry: Math.PI });
  boltFace.dispose();

  /* ---- moving: the hull the support hand inserts ------------------------ */
  const magazine = new Assembly('shotgun-mag');
  const hull = latheZ(
    [
      [0, 0],
      [0, caseRadius],
      [0.003, caseRadius],
      [0.0032, caseRadius * 0.92],
      [0.012, caseRadius * 0.9],
      [0.014, caseRadius * 0.82],
      [caseLen - 0.006, caseRadius * 0.82],
      [caseLen - 0.002, caseRadius * 0.8],
      [caseLen, caseRadius * 0.62],
      [caseLen, 0],
    ],
    16
  );
  magazine.add(hull, 'polymer', {});
  hull.dispose();
  const head = latheZ(
    [
      [0, 0],
      [0, caseRadius],
      [0.0012, caseRadius],
      [0.0014, caseRadius * 0.92],
      [0.012, caseRadius * 0.9],
      [0.012, 0],
    ],
    16
  );
  magazine.add(head, 'brass', {});
  head.dispose();

  const trigger = new Assembly('shotgun-trigger');
  const trg = triggerPart('steel');
  trigger.add(trg.geo, 'steel', {});
  trg.geo.dispose();

  const opticY = recTop + 0.015;
  const opticZ = zRecFront + 0.028;

  return {
    id: 'shotgun',
    label: 'M-590',
    fxClass: 'shotgun',
    body,
    moving: { magazine, charging, bolt, trigger },
    nodes: {
      muzzle: [0, bore, zBarrelEnd],
      chamber: [0, bore, portZ],
      eject: [recW / 2 + 0.006, bore + 0.003, portZ],
      ejectDir: [0.84, 0.42, 0.28],
      sight: [0, opticY, opticZ],
      sightAxis: [0, 0, -1],
      ironSight: [0, bore + rBarrel + 0.013, frontZ],
      /**
       * Shooting hand: knuckles on the front strap of the near-vertical grip.
       * Wrist pulled back so the index pad sits on the trigger blade.
       */
      gripR: {
        pos: [0.036, 0.018, 0.118],
        finger: [0.04, -0.88, -0.47],
        back: [0.98, 0.04, -0.18],
      },
      /** Support hand wrapped around the SureFire forend. */
      gripL: {
        pos: [-0.022, tubeY - 0.004, forendC],
        finger: [0.82, -0.28, -0.5],
        back: [-0.22, -0.72, 0.66],
      },
      handguard: {
        axis: [0, tubeY, 0],
        dir: [0, 0, 1],
        r: slideR,
        z0: zForendRear,
        z1: zForendFront,
      },
      magSeat: { pos: [0, recY - recH / 2 - 0.08, loadZ], rot: [1.2, 0, 0] },
      magDrop: [0, -0.45, 0.04],
      chargeRest: { pos: [0, 0, 0], rot: [0, 0, 0] },
      chargePull: [0, 0, 0.072],
      boltRest: { pos: [0, bore, portZ + 0.055], rot: [0, 0, 0] },
      boltTravel: [0, 0, 0.055],
      triggerPivot: { pos: [0, recMeshBot + 0.003, 0.016], rot: [0, 0, 0] },
      triggerPull: -0.28,
    },
    shell: { caseLen, rimR: caseRadius },
    magSize: { len: caseLen, w: caseRadius * 2, d: caseRadius * 2 },
  };
}

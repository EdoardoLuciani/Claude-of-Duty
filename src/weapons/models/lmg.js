import { Assembly, box, blob, extrude, roundRect, latheZ, tubeZ } from '../geometry.js';
import {
  addBarrel,
  addGasBlock,
  addRail,
  addPistolGrip,
  addSlingLoop,
  addPin,
  addRollmark,
  buildMiniReflex,
  selectorPart,
  triggerPart,
  cartridge,
  addBoltCarrier,
} from '../parts.js';

/**
 * The light machine gun — an FN EVOLYS-flavoured 7.62x51 support weapon,
 * rebuilt against the manufacturer's own photo (left + right views) and
 * technical data sheet (406 mm barrel, ~700 rpm, belt-fed, 6.3 kg):
 *
 *   - a BOXY, flat-sided receiver in FDE (tan) with a full-length rail —
 *     the rail strip sits low on the receiver top, NOT on a round tube;
 *   - an angular TRUSS handguard: a row of seven inverted triangles over
 *     three horizontal slots, open and skeletal, ending well short of the
 *     muzzle so a long thin barrel + slotted flash hider protrude;
 *   - an A-FRAME skeleton stock with a large triangular void, cantilevered
 *     off a black buffer tube behind the receiver;
 *   - the 50-round belt BOX on the LEFT receiver wall (the black FN box),
 *     with the ejection port on the flat right wall;
 *   - a near-vertical pistol grip and a flush feed-housing block under the
 *     trigger area.
 *
 * Layout (weapon-local metres, origin at the shooting hand's thumb web):
 *   bore axis        y = +0.075
 *   receiver         y = +0.055 .. +0.095, x = ±0.0135, z = +0.06 .. -0.16
 *   rail deck        y = +0.100
 *   handguard        z = -0.16  .. -0.365  (truss, angular cutouts)
 *   barrel           z = -0.09  .. -0.45, exposed -0.365 .. -0.45
 *   muzzle crown     z = -0.505
 *   belt box (left)  x = -0.0355, y = +0.026 .. +0.078, z = -0.1125 .. +0.0025
 *   stock            z = +0.125 .. +0.27, top below the rail line
 */
export function buildLmg() {
  const bore = 0.075;
  const recW = 0.027; // boxy, not round
  const recH = 0.04;
  const recY = bore + 0.002; // 0.055 .. 0.095
  const recTop = recY + recH / 2;
  const railTop = recTop + 0.005; // low rail strip
  const zRecRear = 0.06;
  const zRecFront = -0.16;
  const portZ = -0.05;
  const hgZ1 = -0.365;
  const zBreech = -0.09;
  const zBarrelEnd = -0.45;
  const hiderLen = 0.055;
  const opticZ = -0.02;
  // Left-wall belt box (the FN 50-rd box).
  const boxX = -0.0355;
  const boxY = 0.07;
  const boxZ = -0.06;
  const boxW = 0.045; // thickness (x)
  const boxH = 0.058;
  const boxD = 0.135; // depth (z)

  const body = new Assembly('lmg-body');

  /* ---- receiver: a flat-sided FDE block, not a tube ------------------- */
  const rec = box(recW, recH, zRecRear - zRecFront, 0.0025, 2);
  body.add(rec, 'polymer_tan', { y: recY, z: (zRecRear + zRecFront) / 2 });
  rec.dispose();
  // Rear cap: the receiver steps down into the buffer tube.
  const rearCap = box(recW, recH - 0.006, 0.008, 0.002, 2);
  body.add(rearCap, 'polymer_tan', { y: recY - 0.003, z: zRecRear + 0.004 });
  rearCap.dispose();
  // Full-length low rail over receiver AND handguard.
  addRail(body, 'alu', hgZ1 + 0.004, zRecRear - 0.004, railTop);

  // Ejection port on the flat RIGHT wall (the left wall carries the box).
  const portW = 0.034;
  const portH = 0.018;
  const cav = box(0.01, portH, portW, 0.0008, 1);
  body.add(cav, 'cavity', { x: recW / 2 - 0.005, y: bore + 0.003, z: portZ, ry: Math.PI / 2 });
  cav.dispose();
  const lip = extrude(roundRect(portW + 0.004, portH + 0.004, 0.002, 3), 0.002, {
    bevel: 0.0005,
    holes: [roundRect(portW, portH, 0.0016, 3)],
  });
  body.add(lip, 'polymer_tan', { x: recW / 2 - 0.001, y: bore + 0.003, z: portZ, ry: Math.PI / 2 });
  lip.dispose();

  // Calibre stamp on the receiver's left flank, behind the belt box.
  addRollmark(body, 'cavity', { x: -recW / 2 + 0.0018, y: bore + 0.008, z: 0.012, h: 0.003 });

  /* ---- lower: flush feed housing, trigger guard, near-vertical grip --- */
  const lower = box(0.024, 0.02, 0.1, 0.0016, 2);
  body.add(lower, 'polymer', { y: bore - 0.035, z: -0.028 });
  lower.dispose();
  const guardOuter = [
    [-0.024, 0],
    [0.026, 0],
    [0.028, -0.007],
    [0.024, -0.02],
    [0.015, -0.025],
    [-0.017, -0.025],
    [-0.024, -0.019],
  ];
  const guardInner = [
    [-0.019, -0.003],
    [0.021, -0.003],
    [0.022, -0.009],
    [0.019, -0.018],
    [0.012, -0.0215],
    [-0.014, -0.0215],
    [-0.019, -0.017],
  ];
  const guard = extrude(guardOuter, 0.0145, { bevel: 0.0009, holes: [guardInner] });
  body.add(guard, 'polymer', { y: bore - 0.031, z: -0.006 });
  guard.dispose();
  // The EVOLYS grip is slim, straight and near-vertical — a custom profile,
  // NOT the AR pattern grip (the last AR tell the reference pass flagged).
  const gripProfile = [
    [-0.013, 0],
    [0.013, 0],
    [0.013, -0.02],
    [0.011, -0.095],
    [0.008, -0.108],
    [-0.008, -0.108],
    [-0.011, -0.095],
    [-0.013, -0.02],
  ];
  const grip = extrude(gripProfile, 0.028, { bevel: 0.001 });
  body.add(grip, 'polymer', { y: bore - 0.028, z: 0.018, rx: 0.2 });
  grip.dispose();
  const gripPad = extrude(
    [
      [-0.001, -0.02],
      [0.004, -0.02],
      [0.004, -0.098],
      [0.0015, -0.106],
      [-0.001, -0.106],
      [-0.001, -0.02],
    ],
    0.02,
    { bevel: 0.0006 }
  );
  body.add(gripPad, 'rubber', { x: 0.0155, y: bore - 0.028, z: 0.018, rx: 0.2 });
  gripPad.dispose();
  addPin(body, 'steel', 0, bore - 0.024, -0.075, 0.0028, 0.026);

  /* ---- barrel, gas block, slotted hider -------------------------------- */
  addBarrel(body, 'steel', 'cavity', {
    y: bore,
    zBreech,
    zMuzzle: zBarrelEnd,
    rChamber: 0.0115,
    rBarrel: 0.0075, // long, thin — exposed over the last third
    rGas: 0.0095,
    gasAt: -0.3,
    knurl: false,
  });
  addGasBlock(body, 'steel_soot', {
    y: bore,
    z: -0.3,
    rBarrel: 0.0075,
    tubeTo: -0.18,
    w: 0.021,
    h: 0.019,
  });
  // Slotted flash hider: a stepped cylinder with three longitudinal slots.
  const hider = latheZ(
    [
      [0, 0.0098],
      [0.006, 0.0098],
      [0.006, 0.0086],
      [0.045, 0.0086],
      [0.045, 0.0092],
      [hiderLen, 0.0092],
      [hiderLen, 0],
      [0, 0],
    ],
    18
  );
  body.add(hider, 'steel_soot', { y: bore, z: zBarrelEnd, ry: Math.PI });
  hider.dispose();
  for (const a of [0, 1, 2]) {
    const slot = box(0.0035, 0.0055, 0.036, 0.0004, 1);
    const ang = (a / 3) * Math.PI;
    body.add(slot, 'cavity', {
      x: Math.sin(ang) * 0.007,
      y: bore + Math.cos(ang) * 0.007,
      z: zBarrelEnd - 0.026,
      rz: ang,
    });
    slot.dispose();
  }
  const crownZ = zBarrelEnd - hiderLen;

  /* ---- angular truss handguard ---------------------------------------- */
  // Two side plates with the EVOLYS cutout pattern: seven inverted
  // triangles over three horizontal slots, joined by top/bottom bars.
  const hgLen = zRecFront - hgZ1; // 0.205
  const hgC = (zRecFront + hgZ1) / 2; // -0.2625
  const hgY0 = recY - recH / 2 + 0.008; // 0.065
  const hgY1 = recTop - 0.004; // 0.093
  const hgMidY = (hgY0 + hgY1) / 2; // profile centre — holes are RELATIVE
  const outer = roundRect(hgLen, hgY1 - hgY0, 0.004, 4);
  const holes = [];
  for (let i = 0; i < 7; i++) {
    const zc = -0.176 - i * 0.027 - hgC;
    holes.push([
      [zc - 0.01, hgY1 - 0.005 - hgMidY],
      [zc + 0.01, hgY1 - 0.005 - hgMidY],
      [zc, hgY1 - 0.031 - hgMidY],
    ]);
  }
  for (const zc of [-0.202, -0.262, -0.322]) {
    holes.push([
      [zc - 0.011 - hgC, hgY0 + 0.005 - hgMidY],
      [zc + 0.011 - hgC, hgY0 + 0.005 - hgMidY],
      [zc + 0.011 - hgC, hgY0 + 0.021 - hgMidY],
      [zc - 0.011 - hgC, hgY0 + 0.021 - hgMidY],
    ]);
  }
  for (const sx of [-1, 1]) {
    const plate = extrude(outer, 0.0026, { bevel: 0.0006, holes });
    plate.rotateY(Math.PI / 2);
    plate.translate(sx * (recW / 2 - 0.001), 0, 0);
    body.add(plate, 'polymer_tan', { y: hgMidY, z: hgC });
    plate.dispose();
  }
  const topBar = box(recW + 0.004, 0.005, hgLen, 0.001, 1);
  body.add(topBar, 'polymer_tan', { y: hgY1 + 0.0025, z: hgC });
  topBar.dispose();
  const botBar = box(0.022, 0.005, hgLen, 0.001, 1);
  body.add(botBar, 'polymer_tan', { y: hgY0 - 0.0025, z: hgC });
  botBar.dispose();
  const endCap = box(recW + 0.004, hgY1 - hgY0 + 0.005, 0.005, 0.001, 1);
  body.add(endCap, 'polymer_tan', { y: (hgY0 + hgY1) / 2, z: hgZ1 - 0.0025 });
  endCap.dispose();
  addSlingLoop(body, 'steel', 0, hgY0 - 0.012, hgZ1 + 0.02, 0.007, {
    rx: Math.PI / 2,
    ry: Math.PI / 2,
  });

  /* ---- A-frame skeleton stock on a buffer tube ------------------------ */
  const tube = tubeZ(0.0105, 0.008, 0.065, 14, 0.0006);
  body.add(tube, 'alu', { y: 0.052, z: zRecRear + 0.0625 });
  tube.dispose();
  const nut = latheZ(
    [
      [0, 0.0115],
      [0.004, 0.0115],
      [0.004, 0.0095],
      [0.009, 0.0095],
      [0.009, 0],
      [0, 0],
    ],
    14
  );
  body.add(nut, 'alu', { y: 0.052, z: zRecRear + 0.012, ry: Math.PI });
  nut.dispose();
  // Skeleton body: a rounded profile with a large triangular void — the
  // diagonal strut runs from the tube (top-front) to the butt heel.
  const stockLen = 0.145;
  const stockC = 0.1975;
  const sY0 = 0.01;
  const sY1 = 0.085;
  const stockOuter = roundRect(stockLen, sY1 - sY0, 0.006, 4);
  const sMidY = (sY0 + sY1) / 2;
  // Void is RELATIVE to the profile centre; the diagonal strut runs from
  // the tube end (top-front) down to the butt heel (bottom-rear).
  const stockVoid = [
    [0.045 - stockLen / 2, 0.066 - sMidY],
    [stockLen / 2 - 0.008, 0.012 - sMidY],
    [0.05 - stockLen / 2, 0.012 - sMidY],
  ];
  const stockBody = extrude(stockOuter, 0.02, { bevel: 0.0012, holes: [stockVoid] });
  body.add(stockBody, 'polymer', { y: sMidY, z: stockC });
  stockBody.dispose();
  const buttPlate = extrude(roundRect(0.032, 0.062, 0.006, 4), 0.009, { bevel: 0.0012 });
  body.add(buttPlate, 'polymer', { y: 0.047, z: 0.264, rx: 0.05 });
  buttPlate.dispose();
  const pad = blob(0.03, 0.056, 0.009, 0.004, 3);
  body.add(pad, 'rubber', { y: 0.047, z: 0.27, rx: 0.05 });
  pad.dispose();
  // Small cheek piece at the stock front.
  const cheek = blob(0.018, 0.013, 0.055, 0.004, 3);
  body.add(cheek, 'polymer', { y: 0.082, z: 0.145 });
  cheek.dispose();

  /* ---- sights --------------------------------------------------------- */
  // Clean rail: just the reflex on a low riser, no iron sights (a front
  // post would sit on this optic's sight line — measured in ADS captures).
  const riser = box(0.02, 0.014, 0.042, 0.0012, 2);
  body.add(riser, 'alu', { y: railTop + 0.007, z: opticZ });
  riser.dispose();
  const optic = buildMiniReflex(body, {
    y: railTop + 0.014,
    z: opticZ,
    matBody: 'alu_fine',
    emitter: false,
  });

  // Feed chute: bridges the box top to the receiver wall so the box does
  // not read as floating off the gun.
  const chute = box(0.032, 0.01, 0.036, 0.001, 1);
  body.add(chute, 'polymer', { x: -0.026, y: boxY + boxH / 2 + 0.005, z: boxZ + 0.012 });
  chute.dispose();

  /* ---- moving parts --------------------------------------------------- */
  // The 50-round belt box (left wall): a black rigid box with a lid seam,
  // a front lip (where the support hand grips) and the FN-style latch.
  const magazine = new Assembly('lmg-mag');
  // Profile in (z, y) = (boxD, boxH), extruded boxW along x — after
  // rotateY(pi/2) the depth lands on X and the profile spans z/y.
  const magBody = extrude(roundRect(boxD, boxH, 0.004, 4), boxW, { bevel: 0.0012 });
  magBody.rotateY(Math.PI / 2);
  magazine.add(magBody, 'polymer', {});
  magBody.dispose();
  const seam = box(0.044, 0.0018, boxD + 0.002, 0.0004, 1);
  magazine.add(seam, 'cavity', { y: boxH * 0.34 });
  seam.dispose();
  const latch = box(0.008, 0.016, 0.008, 0.001, 2);
  magazine.add(latch, 'polymer', { x: boxW / 2 - 0.001, y: boxH * 0.5, z: boxD / 2 - 0.006 });
  latch.dispose();
  const boxLip = box(0.006, 0.024, 0.02, 0.001, 2);
  magazine.add(boxLip, 'rubber', { x: 0, y: -boxH * 0.32, z: boxD / 2 + 0.009 });
  boxLip.dispose();

  // Right-side charging handle: a slim slide bar on the flat wall.
  const charging = new Assembly('lmg-charging');
  const chBar = box(0.0055, 0.009, 0.075, 0.001, 1);
  charging.add(chBar, 'steel_bright', {});
  chBar.dispose();
  const chKnob = blob(0.006, 0.006, 0.009, 0.0012, 2);
  charging.add(chKnob, 'steel_bright', { x: 0.0045, z: -0.04 });
  chKnob.dispose();

  const bolt = new Assembly('lmg-bolt');
  addBoltCarrier(bolt, 'steel_bright', { r: 0.0155, len: 0.095, z: 0 });
  const chamberRound = cartridge(0.051, 0.0056, 0.026);
  bolt.add(chamberRound.brass, 'brass', { z: -0.09, ry: Math.PI, y: 0 });
  chamberRound.brass.dispose();
  chamberRound.bullet.dispose();

  const trigger = new Assembly('lmg-trigger');
  const trg = triggerPart('steel_bright');
  trigger.add(trg.geo, 'steel_bright', {});
  trg.geo.dispose();

  const selector = new Assembly('lmg-selector');
  const sel = selectorPart('alu', 'steel');
  selector.add(sel.geo, 'alu', {});
  sel.geo.dispose();
  const selR = selectorPart('alu', 'steel');
  selector.add(selR.geo, 'alu', { sx: -1 });
  selR.geo.dispose();

  return {
    id: 'lmg',
    label: 'EVOLYS-7.62',
    fxClass: 'lmg',
    body,
    moving: { magazine, charging, bolt, trigger, selector },
    nodes: {
      muzzle: [0, bore, crownZ],
      chamber: [0, bore, portZ],
      eject: [recW / 2 + 0.006, bore + 0.004, portZ],
      ejectDir: [0.86, 0.44, 0.26],
      // The sight point the ADS solve aligns is the WINDOW (see buildMiniReflex).
      sight: [0, optic.center[1], optic.center[2]],
      sightAxis: [0, 0, -1],
      ironSight: [0, railTop + 0.012, 0.04],
      /**
       * Shooting hand: same convention as the rifle (targets are WRISTS) —
       * knuckles on the front strap, web at the top-rear of the grip tang.
       */
      gripR: {
        pos: [0.024, 0.05, 0.1],
        finger: [0.05, -0.55, -0.833],
        back: [1, 0.03, 0.04],
      },
      /**
       * Support hand on the BELT BOX's front-lower corner — how the EVOLYS
       * is actually driven with the left-side box. The wrist sits below-left
       * of the box; the hand wraps up over its front face. No handguard
       * profile: the box is not a cylinder, so the fingertip solve is skipped.
       */
      gripL: {
        pos: [-0.098, -0.004, -0.06],
        finger: [0.32, 0.4, -0.86],
        back: [-0.6, -0.68, 0.42],
      },
      magSeat: { pos: [boxX, boxY, boxZ], rot: [0, 0, 0] },
      magDrop: [-0.5, -0.2, 0.03],
      chargeRest: { pos: [recW / 2 + 0.002, bore + 0.008, -0.085], rot: [0, 0, 0] },
      chargePull: [0, 0, 0.06],
      boltRest: { pos: [0, bore, 0.02], rot: [0, 0, 0] },
      boltTravel: [0, 0, 0.065],
      triggerPivot: { pos: [0, bore - 0.026, -0.001], rot: [0, 0, 0] },
      triggerPull: -0.34,
      selectorPivot: { pos: [0, bore - 0.02, 0.024], rot: [0, 0, 0] },
      opticGlass: optic,
    },
    shell: { caseLen: 0.051, rimR: 0.0056 },
    magSize: { len: boxD, w: boxW, d: boxH },
  };
}

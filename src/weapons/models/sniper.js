import { Assembly, box, blob, extrude, roundRect, latheZ, rodZ } from '../geometry.js';
import {
  addBarrel,
  addMuzzleDevice,
  addRail,
  addPistolGrip,
  addChassisStock,
  addRollmark,
  addPin,
  addSlingLoop,
  buildScope,
  triggerPart,
  cartridge,
} from '../parts.js';

/**
 * AX-338 — Accuracy International AX338-style .338 Lapua Magnum chassis rifle.
 *
 * Built against official side-profile photos (AI AX338 / AXMC): a long flat-
 * bottomed steel action, FDE polymer folding A-frame stock with a raised cheek
 * piece, a double-stack 10-rd box, a KeySlot forend that stops well short of
 * the muzzle, a 27" heavy barrel and a fat dual-baffle brake. No iron sights;
 * a 56 mm tube scope sits on the integral rail.
 *
 * Layout (weapon-local metres, origin at the shooting hand's thumb web):
 *   bore axis        y = +0.075
 *   receiver         z = +0.072 .. -0.175, 36 mm across
 *   rail deck        y = +0.108
 *   forend           z = -0.175 .. -0.495
 *   muzzle crown     z ≈ -0.778
 *   butt pad         z = +0.305
 */
export function buildSniper() {
  const bore = 0.075;
  const recW = 0.036;
  const recH = 0.046;
  const recY = bore + 0.002;
  const recTop = recY + recH / 2;
  const railTop = recTop + 0.0045;
  const zRecRear = 0.072;
  const zRecFront = -0.175;
  const portZ = -0.042;
  // Forward of the trigger guard so the 10-rd box is not glued to the grip.
  const magZ = -0.058;
  const hgZ1 = -0.495;
  const zBreech = -0.11;
  const zBarrelEnd = -0.70;
  const caseLen = 0.0697;
  const caseRadius = 0.0074;
  const bulletLen = 0.035;

  const body = new Assembly('sniper-body');

  /* ---- receiver: flat-bottomed steel action, wider than an AR ------------ */
  const rec = box(recW, recH, zRecRear - zRecFront, 0.0022, 2);
  body.add(rec, 'alu', { y: recY, z: (zRecRear + zRecFront) / 2 });
  rec.dispose();
  const recBelly = box(recW - 0.004, 0.012, 0.11, 0.0016, 2);
  body.add(recBelly, 'alu', { y: recY - recH / 2 - 0.004, z: -0.02 });
  recBelly.dispose();
  addRail(body, 'alu', hgZ1 + 0.006, zRecRear - 0.006, railTop);

  // Right-side ejection port — long enough to clear a 70 mm case.
  const portW = 0.052;
  const portH = 0.02;
  const cav = box(0.012, portH, portW, 0.0008, 1);
  body.add(cav, 'cavity', { x: recW / 2 - 0.005, y: bore + 0.004, z: portZ, ry: Math.PI / 2 });
  cav.dispose();
  const lip = extrude(roundRect(portW + 0.005, portH + 0.004, 0.002, 3), 0.0022, {
    bevel: 0.0005,
    holes: [roundRect(portW, portH, 0.0016, 3)],
  });
  body.add(lip, 'alu', { x: recW / 2 - 0.001, y: bore + 0.004, z: portZ, ry: Math.PI / 2 });
  lip.dispose();
  addRollmark(body, 'cavity', { x: -recW / 2 + 0.0016, y: bore + 0.01, z: 0.018, h: 0.0032 });
  addPin(body, 'steel', 0, recY - 0.01, zRecRear - 0.012, 0.003, 0.038);
  addPin(body, 'steel', 0, recY - 0.01, zRecFront + 0.018, 0.003, 0.038);

  /* ---- lower / trigger housing / magwell -------------------------------- */
  const lower = box(0.032, 0.03, 0.128, 0.0018, 2);
  body.add(lower, 'polymer_tan', { y: recY - recH / 2 - 0.012, z: 0.0 });
  lower.dispose();
  const well = box(0.034, 0.038, 0.07, 0.0016, 2);
  body.add(well, 'polymer_tan', { y: recY - recH / 2 - 0.034, z: magZ });
  well.dispose();
  const gripRoot = box(0.03, 0.02, 0.036, 0.002, 2);
  body.add(gripRoot, 'polymer_tan', { y: recY - recH / 2 - 0.026, z: 0.042 });
  gripRoot.dispose();
  const guardOuter = [
    [-0.022, 0],
    [0.028, 0],
    [0.03, -0.008],
    [0.024, -0.022],
    [0.012, -0.028],
    [-0.016, -0.028],
    [-0.024, -0.02],
  ];
  const guardInner = [
    [-0.016, -0.004],
    [0.022, -0.004],
    [0.023, -0.01],
    [0.018, -0.02],
    [0.01, -0.023],
    [-0.012, -0.023],
    [-0.018, -0.016],
  ];
  const guard = extrude(guardOuter, 0.016, { bevel: 0.001, holes: [guardInner] });
  body.add(guard, 'polymer_tan', { y: bore - 0.038, z: 0.018 });
  guard.dispose();
  addPistolGrip(body, 'polymer_tan', 'rubber', {
    y: recY - recH / 2 - 0.02,
    z: 0.048,
    angle: 0.22,
    len: 0.108,
    w: 0.034,
  });

  /* ---- KeySlot forend: flat FDE chassis with diamond cutouts ------------- */
  const hgLen = zRecFront - hgZ1;
  const hgC = (zRecFront + hgZ1) / 2;
  const hgY0 = recY - recH / 2 + 0.006;
  const hgY1 = recTop - 0.002;
  const hgMidY = (hgY0 + hgY1) / 2;
  const outer = roundRect(hgLen, hgY1 - hgY0, 0.0035, 4);
  const holes = [];
  for (let row = 0; row < 2; row++) {
    const y = (row === 0 ? 0.008 : -0.01);
    for (let i = 0; i < 8; i++) {
      const zc = -hgLen / 2 + 0.028 + i * 0.028;
      holes.push([
        [zc, y + 0.007],
        [zc + 0.008, y],
        [zc, y - 0.007],
        [zc - 0.008, y],
      ]);
    }
  }
  for (const sx of [-1, 1]) {
    const plate = extrude(outer, 0.0032, { bevel: 0.0006, holes });
    plate.rotateY(Math.PI / 2);
    plate.translate(sx * (recW / 2 - 0.001), 0, 0);
    body.add(plate, 'polymer_tan', { y: hgMidY, z: hgC });
    plate.dispose();
  }
  const topBar = box(recW + 0.002, 0.006, hgLen, 0.001, 1);
  body.add(topBar, 'polymer_tan', { y: hgY1 + 0.002, z: hgC });
  topBar.dispose();
  const botBar = box(0.028, 0.006, hgLen, 0.001, 1);
  body.add(botBar, 'polymer_tan', { y: hgY0 - 0.003, z: hgC });
  botBar.dispose();
  const endCap = box(recW + 0.004, hgY1 - hgY0 + 0.008, 0.01, 0.0014, 2);
  body.add(endCap, 'polymer_tan', { y: hgMidY, z: hgZ1 - 0.004 });
  endCap.dispose();
  addSlingLoop(body, 'steel', 0, hgY0 - 0.012, hgZ1 + 0.03, 0.007, {
    rx: Math.PI / 2,
    ry: Math.PI / 2,
  });

  /* ---- barrel + magnum brake -------------------------------------------- */
  addBarrel(body, 'steel', 'cavity', {
    y: bore,
    zBreech,
    zMuzzle: zBarrelEnd,
    rChamber: 0.0135,
    rBarrel: 0.0096,
    rGas: 0.011,
    gasAt: -0.42,
    knurl: false,
    seg: 24,
  });
  const muzzle = addMuzzleDevice(body, 'steel_soot', 'cavity', 'brake_338', zBarrelEnd, 0.0096, bore);

  /* ---- folding chassis stock -------------------------------------------- */
  addChassisStock(body, 'polymer_tan', 'rubber', 'steel', {
    y: 0.054,
    zFront: zRecRear - 0.004,
    zRear: 0.305,
  });

  /* ---- scope ------------------------------------------------------------ */
  const optic = buildScope(body, {
    y: railTop + 0.034,
    z: -0.03,
    railTop,
    matBody: 'alu_fine',
    matSteel: 'steel',
    magnification: 4,
  });

  /* ---- moving parts ----------------------------------------------------- */
  // Double-stack 10-rd box — a short, fat AICS, not a curved STANAG.
  const magazine = new Assembly('sniper-mag');
  const magW = 0.03;
  const magD = 0.082;
  const magLen = 0.092;
  const magBody = extrude(roundRect(magW, magD, 0.004, 4), magLen, { bevel: 0.0014 });
  magBody.rotateX(Math.PI / 2);
  magazine.add(magBody, 'polymer', { y: -magLen * 0.5 });
  magBody.dispose();
  const floor = extrude(roundRect(magW + 0.003, magD + 0.002, 0.003, 3), 0.008, { bevel: 0.001 });
  floor.rotateX(Math.PI / 2);
  magazine.add(floor, 'rubber', { y: -magLen - 0.002 });
  floor.dispose();
  const mag = { len: magLen, w: magW, d: magD };

  // AI bolt handle: a short stem out of the rear-right of the action, swept
  // back and down to a fat polymer knob. The chrome T-bar was a rod lathed
  // across +X through the receiver.
  const charging = new Assembly('sniper-charging');
  const stem = latheZ(
    [
      [0, 0],
      [0, 0.0038],
      [0.006, 0.0042],
      [0.028, 0.0036],
      [0.034, 0.0032],
      [0.034, 0],
    ],
    12
  );
  charging.add(stem, 'steel_soot', { x: 0.006, y: -0.002, z: 0.004, rz: -0.85, ry: 0.35 });
  stem.dispose();
  const knob = blob(0.013, 0.013, 0.018, 0.004, 3);
  charging.add(knob, 'polymer', { x: 0.032, y: -0.024, z: 0.018 });
  knob.dispose();

  // Short rear shroud only — a 90 mm bright BCG was the chrome tube sticking
  // out the back of the action in hipfire.
  const bolt = new Assembly('sniper-bolt');
  const shroud = latheZ(
    [
      [0, 0],
      [0, 0.011],
      [0.004, 0.0125],
      [0.022, 0.0125],
      [0.026, 0.009],
      [0.026, 0],
    ],
    16
  );
  bolt.add(shroud, 'steel_soot', {});
  shroud.dispose();
  const chamberRound = cartridge(caseLen, caseRadius, bulletLen);
  bolt.add(chamberRound.brass, 'brass', { z: -0.085, ry: Math.PI, y: 0 });
  chamberRound.brass.dispose();
  chamberRound.bullet.dispose();

  const trigger = new Assembly('sniper-trigger');
  const trg = triggerPart('steel_bright');
  trigger.add(trg.geo, 'steel_bright', {});
  trg.geo.dispose();

  const selector = new Assembly('sniper-selector');
  const safe = box(0.004, 0.01, 0.018, 0.0008, 1);
  selector.add(safe, 'alu', {});
  safe.dispose();

  const handZ = -0.28;

  return {
    id: 'sniper',
    label: 'AX-338',
    fxClass: 'sniper',
    body,
    moving: { magazine, charging, bolt, trigger, selector },
    nodes: {
      muzzle: [0, bore, muzzle.crownZ],
      chamber: [0, bore, portZ],
      eject: [recW / 2 + 0.01, bore + 0.004, portZ],
      ejectDir: [0.88, 0.4, 0.22],
      sight: [0, optic.center[1], optic.center[2]],
      sightAxis: [0, 0, -1],
      ironSight: [0, railTop + 0.012, 0.04],
      gripR: {
        pos: [0.038, 0.05, 0.154],
        finger: [0.12, -0.32, -0.94],
        back: [1, 0.03, 0.04],
      },
      gripL: {
        pos: [-0.092, 0.07, handZ + 0.02],
        finger: [0.88, -0.33, -0.34],
        back: [-0.28, -0.74, 0.61],
      },
      handguard: {
        axis: [0, bore, 0],
        dir: [0, 0, 1],
        r: 0.022,
        z0: zRecFront,
        z1: hgZ1,
      },
      magSeat: { pos: [0, recY - recH / 2 - 0.018, magZ], rot: [0, 0, 0] },
      magDrop: [0, -0.45, 0.02],
      chargeRest: { pos: [recW / 2 - 0.002, bore + 0.004, zRecRear - 0.012], rot: [0, 0, 0] },
      chargePull: [0, 0.006, 0.08],
      boltRest: { pos: [0, bore, zRecRear - 0.008], rot: [0, 0, 0] },
      boltTravel: [0, 0, 0.055],
      triggerPivot: { pos: [0, bore - 0.03, 0.016], rot: [0, 0, 0] },
      triggerPull: -0.34,
      selectorPivot: { pos: [0, bore - 0.018, 0.038], rot: [0, 0, 0] },
      opticGlass: optic,
    },
    shell: { caseLen, rimR: caseRadius },
    magSize: { len: mag.len, w: mag.w, d: mag.d },
  };
}

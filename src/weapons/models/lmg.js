import { Assembly, box, blob, dome, extrude, roundRect, latheZ, rodZ, mergeAll } from '../geometry.js';
import {
  addBarrel,
  addGasBlock,
  addHandguard,
  addRail,
  addPistolGrip,
  addQdSocket,
  addSlingLoop,
  addPin,
  addRollmark,
  buildBoxMagazine,
  buildMiniReflex,
  selectorPart,
  triggerPart,
  cartridge,
  addBoltCarrier,
} from '../parts.js';

/**
 * The light machine gun — an FN EVOLYS-flavoured 7.62x51 support weapon.
 *
 * The EVOLYS reads by its SILHOUETTE, and every line below exists to make
 * that read unmistakable next to the AR-pattern rifle:
 *
 *   - a slim ROUND monoblock receiver with a narrow machined deck — no
 *     flat-side upper, no carry handle, no forward assist;
 *   - a full-length top rail running receiver AND handguard as one line;
 *   - a slim ventilated handguard that is a CONTINUATION of the receiver
 *     tube, with long cooling slots and a short exposed barrel ahead of it;
 *   - a slim stepped flash hider instead of the AR birdcage;
 *   - a STRAIGHT-LINE stock: its top edge continues the receiver's line and
 *     its slim body carries a raised cheek at the front — no buffer tube,
 *     no collapsible skeleton;
 *   - a nearly straight 75-round box magazine and a vertical-ish grip.
 *
 * Layout (weapon-local metres, origin at the shooting hand's thumb web):
 *   bore axis        y = +0.075
 *   rail deck        y = +0.0995   (24.5 mm over bore)
 *   receiver         z = +0.055 .. -0.155, 32 mm tube
 *   handguard        z = -0.16  .. -0.435, 38 mm tube
 *   muzzle crown     z = -0.525
 *   butt pad         z = +0.26
 *   box magazine     z = -0.062, hangs 260 mm below the magwell
 */
export function buildLmg() {
  const bore = 0.075;
  const rRec = 0.016; // slim 32 mm monoblock tube
  const railTop = bore + 0.0245;
  const zRecRear = 0.055;
  const zRecFront = -0.155;
  const portZ = -0.05;
  const magZ = -0.062;
  const magTilt = 0.05;
  const hgZ0 = -0.16;
  const hgZ1 = -0.435;
  const hgR = 0.019; // 38 mm — reads as one tube with the receiver
  const zBreech = -0.11;
  const zBarrelEnd = -0.475;
  const hiderLen = 0.05;
  const opticZ = -0.02;

  const body = new Assembly('lmg-body');

  /* ---- receiver: a slim round tube with a narrow machined deck -------- */
  const rec = latheZ(
    [
      [0, rRec * 0.55],
      [0, rRec * 0.99],
      [0.002, rRec],
      [zRecRear - zRecFront - 0.004, rRec],
      [zRecRear - zRecFront - 0.002, rRec * 0.96],
      [zRecRear - zRecFront, rRec * 0.6],
    ],
    22
  );
  body.add(rec, 'alu', { y: bore, z: zRecRear, ry: Math.PI });
  rec.dispose();
  const deck = box(0.02, 0.008, zRecRear - zRecFront, 0.0009, 1);
  body.add(deck, 'alu', { y: bore + rRec - 0.003, z: (zRecRear + zRecFront) / 2 });
  deck.dispose();
  // Full-length rail over receiver AND handguard — one continuous line.
  addRail(body, 'alu', hgZ1 + 0.004, zRecRear - 0.004, railTop);

  // Ejection port, right side — long enough for a 51 mm case to clear.
  const portW = 0.034;
  const portH = 0.019;
  const cav = box(0.01, portH, portW, 0.0008, 1);
  body.add(cav, 'cavity', { x: rRec - 0.006, y: bore + 0.002, z: portZ, ry: Math.PI / 2 });
  cav.dispose();
  const lip = extrude(roundRect(portW + 0.004, portH + 0.004, 0.002, 3), 0.002, {
    bevel: 0.0005,
    holes: [roundRect(portW, portH, 0.0016, 3)],
  });
  body.add(lip, 'alu', { x: rRec - 0.0012, y: bore + 0.002, z: portZ, ry: Math.PI / 2 });
  lip.dispose();

  // Rollmark + calibre stamp on the receiver's left flank (the side the
  // hipfire camera sees).
  addRollmark(body, 'cavity', { x: -rRec + 0.0015, y: bore + 0.005, z: -0.042, h: 0.0032 });
  addRollmark(body, 'cavity', {
    x: -rRec + 0.0015,
    y: bore - 0.001,
    z: -0.052,
    h: 0.0022,
    pitch: 0.0014,
    pattern: [2, 3, 1, 0, 2, 2, 3, 0, 3, 2],
  });

  /* ---- lower: slim polymer housing, big magwell, vertical grip -------- */
  const magW = 0.033;
  const magD = 0.082;
  const lowerBody = box(0.023, 0.028, 0.15, 0.0016, 2);
  body.add(lowerBody, 'polymer', { y: bore - 0.02, z: -0.03 });
  lowerBody.dispose();

  const wellH = 0.038;
  const well = extrude(roundRect(magW + 0.003, magD + 0.003, 0.005, 4), wellH, {
    bevel: 0.0011,
    holes: [roundRect(magW - 0.002, magD - 0.002, 0.004, 4)],
  });
  body.add(well, 'polymer', { y: bore - 0.04, z: magZ, rx: Math.PI / 2 + magTilt });
  well.dispose();
  const flare = extrude(roundRect(magW + 0.008, magD + 0.009, 0.006, 4), 0.008, {
    bevel: 0.0012,
    holes: [roundRect(magW + 0.001, magD + 0.002, 0.004, 4)],
  });
  body.add(flare, 'polymer', { y: bore - 0.058, z: magZ + 0.0016, rx: Math.PI / 2 + magTilt });
  flare.dispose();

  // Slim integrated trigger guard — one polymer mass with the lower.
  const guardOuter = [
    [-0.026, 0],
    [0.028, 0],
    [0.03, -0.007],
    [0.026, -0.022],
    [0.016, -0.027],
    [-0.018, -0.027],
    [-0.026, -0.021],
  ];
  const guardInner = [
    [-0.021, -0.003],
    [0.0225, -0.003],
    [0.0235, -0.009],
    [0.02, -0.02],
    [0.013, -0.0235],
    [-0.015, -0.0235],
    [-0.0205, -0.019],
  ];
  const guard = extrude(guardOuter, 0.0155, { bevel: 0.0009, holes: [guardInner] });
  body.add(guard, 'polymer', { y: bore - 0.031, z: -0.008 });
  guard.dispose();

  // Ambi mag release paddles + pivot pin.
  for (const sx of [-1, 1]) {
    const paddle = extrude(
      [
        [-0.008, -0.004],
        [0.009, -0.005],
        [0.01, 0.004],
        [-0.008, 0.005],
      ],
      0.004,
      { bevel: 0.0006 }
    );
    body.add(paddle, 'alu', { x: sx * 0.0142, y: bore - 0.026, z: -0.032, ry: Math.PI / 2 });
    paddle.dispose();
  }
  addPin(body, 'steel', 0, bore - 0.026, -0.076, 0.0028, 0.026); // pivot pin

  // The EVOLYS grip is slim and near-vertical, not AR-raked.
  addPistolGrip(body, 'polymer', 'rubber', { y: 0.033, z: 0.018, angle: 0.3, len: 0.108, w: 0.03 });

  /* ---- barrel, gas system, muzzle ------------------------------------- */
  addBarrel(body, 'steel', 'cavity', {
    y: bore,
    zBreech,
    zMuzzle: zBarrelEnd,
    rChamber: 0.012,
    rBarrel: 0.0085,
    rGas: 0.0105,
    gasAt: -0.33,
    knurl: false,
  });
  addGasBlock(body, 'steel_soot', {
    y: bore,
    z: -0.33,
    rBarrel: 0.0085,
    tubeTo: -0.19,
    w: 0.023,
    h: 0.021,
  });
  // Slim stepped flash hider — a lathe, deliberately NOT the AR birdcage.
  const hider = latheZ(
    [
      [0, 0.0096],
      [0.005, 0.0096],
      [0.005, 0.0084],
      [0.036, 0.0084],
      [0.036, 0.0076],
      [hiderLen, 0.0076],
      [hiderLen, 0],
      [0, 0],
    ],
    18
  );
  body.add(hider, 'steel_soot', { y: bore, z: zBarrelEnd, ry: Math.PI });
  hider.dispose();
  const crownZ = zBarrelEnd - hiderLen;

  /* ---- ventilated handguard: a continuation of the receiver tube ------ */
  addHandguard(body, 'alu', {
    y: bore,
    z0: hgZ0,
    z1: hgZ1,
    r: hgR,
    sides: 8,
    slatW: 0.013,
    slatT: 0.003,
    slots: 4,
    braces: 2,
  });
  addQdSocket(body, 'alu', 'steel', -hgR + 0.001, bore - 0.008, hgZ0 - 0.03, 'x', 0.005);

  /* ---- straight-line stock -------------------------------------------- */
  // Top edge continues the receiver's line; slim body, raised cheek at the
  // front, angled butt pad — the EVOLYS stock, not a buffer-tube look.
  const stockBody = box(0.026, 0.048, 0.205, 0.0024, 2);
  body.add(stockBody, 'polymer', { y: bore - 0.012, z: zRecRear + 0.105 });
  stockBody.dispose();
  const cheek = blob(0.016, 0.012, 0.07, 0.004, 3);
  body.add(cheek, 'polymer', { y: bore + 0.01, z: zRecRear + 0.048 });
  cheek.dispose();
  const buttPlate = extrude(roundRect(0.03, 0.052, 0.006, 4), 0.009, { bevel: 0.0012 });
  body.add(buttPlate, 'polymer', { y: bore - 0.014, z: 0.252, rx: 0.035 });
  buttPlate.dispose();
  const pad = blob(0.028, 0.046, 0.009, 0.004, 3);
  body.add(pad, 'rubber', { y: bore - 0.014, z: 0.258, rx: 0.035 });
  pad.dispose();
  addSlingLoop(body, 'steel', 0.0165, bore - 0.03, zRecRear + 0.028, 0.007, { ry: Math.PI / 2 });

  /* ---- sights --------------------------------------------------------- */
  // Clean rail: just the reflex on a low riser, no iron sights. (A front
  // post would sit exactly on this optic's sight line — measured in ADS
  // captures; the riser keeps the window clear.)
  const riser = box(0.02, 0.014, 0.042, 0.0012, 2);
  body.add(riser, 'alu', { y: railTop + 0.007, z: opticZ });
  riser.dispose();
  const optic = buildMiniReflex(body, {
    y: railTop + 0.014,
    z: opticZ,
    matBody: 'alu_fine',
    emitter: false,
  });

  /* ---- moving parts --------------------------------------------------- */
  // Nearly straight 75-round box — the EVOLYS magazine, not a curved stick.
  const magazine = new Assembly('lmg-mag');
  const mag = buildBoxMagazine(magazine, {
    w: 0.031,
    d: 0.078,
    len: 0.26,
    curve: 0.02,
    segs: 9,
    witness: 5,
  });

  // Non-reciprocating charging handle on the LEFT side of the receiver, the
  // EVOLYS layout (the hipfire camera sees it).
  const charging = new Assembly('lmg-charging');
  const chParts = [];
  const chShaft = rodZ(0.0042, 0.0042, 0.1, 12, 0.0004);
  chParts.push(chShaft);
  const chPaddle = extrude(
    [
      [0, -0.006],
      [0.02, -0.008],
      [0.022, 0],
      [0.02, 0.007],
      [0, 0.006],
    ],
    0.005,
    { bevel: 0.0007 }
  );
  chPaddle.rotateY(-Math.PI / 2);
  chPaddle.translate(-0.008, 0, -0.045);
  chParts.push(chPaddle);
  const chKnob = dome(0.005, 12, 0.6);
  chKnob.rotateY(-Math.PI / 2);
  chKnob.translate(-0.026, 0, -0.045);
  chParts.push(chKnob);
  const chG = mergeAll(chParts);
  charging.add(chG, 'steel_bright', {});
  chG.dispose();

  const bolt = new Assembly('lmg-bolt');
  addBoltCarrier(bolt, 'steel_bright', { r: 0.016, len: 0.1, z: 0 });
  // A 7.62x51 round in the chamber (only the case head shows in the port).
  const chamberRound = cartridge(0.051, 0.0056, 0.026);
  bolt.add(chamberRound.brass, 'brass', { z: -0.095, ry: Math.PI, y: 0 });
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
      eject: [rRec + 0.007, bore + 0.003, portZ],
      ejectDir: [0.86, 0.44, 0.26],
      // The sight point the ADS solve aligns is the WINDOW, not the base:
      // the mini-reflex's glass sits h*0.56 above its base plate (see
      // buildMiniReflex), so `optic.center` is the optical axis.
      sight: [0, optic.center[1], optic.center[2]],
      sightAxis: [0, 0, -1],
      ironSight: [0, railTop + 0.012, 0.04],
      /**
       * Shooting hand: same convention as the rifle (targets are WRISTS) —
       * knuckles on the front strap, web at the top-rear of the grip tang.
       */
      gripR: {
        pos: [0.0251, 0.06, 0.1223],
        finger: [0.05, -0.55, -0.833],
        back: [1, 0.03, 0.04],
      },
      /**
       * Support hand on the BOX MAGAZINE's front-left corner — how an EVOLYS
       * is actually driven. The wrist sits under the receiver; the hand
       * extends forward-down onto the box spine and wraps its front face.
       * No handguard profile: the mag is not a cylinder, so the build-time
       * fingertip solve is skipped.
       */
      gripL: {
        pos: [-0.05, -0.055, -0.05],
        finger: [0.6, 0.3, -0.74],
        back: [-0.3, -0.7, 0.65],
      },
      magSeat: { pos: [0, bore - 0.042, magZ], rot: [magTilt, 0, 0] },
      magDrop: [0, -0.4, 0.02],
      chargeRest: { pos: [-rRec - 0.0065, bore + 0.002, -0.088], rot: [0, 0, 0] },
      chargePull: [0, 0, 0.07],
      boltRest: { pos: [0, bore, 0.021], rot: [0, 0, 0] },
      boltTravel: [0, 0, 0.07],
      triggerPivot: { pos: [0, bore - 0.024, -0.002], rot: [0, 0, 0] },
      triggerPull: -0.34,
      selectorPivot: { pos: [0, bore - 0.019, 0.024], rot: [0, 0, 0] },
      opticGlass: optic,
    },
    shell: { caseLen: 0.051, rimR: 0.0056 },
    magSize: { len: mag.len, w: mag.w, d: mag.d },
  };
}

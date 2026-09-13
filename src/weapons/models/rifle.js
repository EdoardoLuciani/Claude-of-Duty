import { Assembly, blob, extrude, latheZ } from '../geometry.js';
import {
  addBarrel,
  addGasBlock,
  addMuzzleDevice,
  addHandguard,
  addUpperReceiver,
  addLowerReceiver,
  addBoltCarrier,
  addRail,
  addPistolGrip,
  addCarbineStock,
  addFrontSight,
  addRearSight,
  addRollmark,
  addQdSocket,
  addSlingLoop,
  addPin,
  buildMagazine,
  buildOptic,
  chargingHandlePart,
  selectorPart,
  triggerPart,
  cartridge,
} from '../parts.js';

/**
 * The assault rifle — an AR-15/M4 pattern carbine with a free-float handguard,
 * a 14.5" barrel, a three-port brake, a collapsible stock and a tube red dot
 * on a cantilever mount.
 *
 * Layout (weapon-local metres, origin at the shooting hand's thumb web):
 *   bore axis        y = +0.075
 *   rail deck        y = +0.1036   (28.6 mm over bore, as on a real flat-top)
 *   optic centre     y = +0.142    (67 mm over bore, absolute co-witness)
 *   receiver         z = +0.055 .. -0.143
 *   handguard        z = -0.145 .. -0.385
 *   muzzle crown     z = -0.502
 *   butt pad         z = +0.245
 */
export function buildRifle() {
  const bore = 0.075;
  const rUpper = 0.0192;
  const railTop = bore + 0.0286;
  const zUpperRear = 0.055;
  const zUpperFront = -0.143;
  const portZ = -0.052;
  const magZ = -0.078;
  const magTilt = 0.08;
  const hgZ0 = -0.145;
  const hgZ1 = -0.385;
  const hgR = 0.0235;
  const zBreech = -0.1;
  const zBarrelEnd = -0.44;
  const opticY = bore + 0.067;
  const opticZ = -0.022;

  const body = new Assembly('rifle-body');

  // ---- receivers -----------------------------------------------------------
  addUpperReceiver(body, 'alu', 'steel', 'cavity', {
    zRear: zUpperRear,
    zFront: zUpperFront,
    bore,
    r: rUpper,
    portZ,
    railTop,
  });

  addLowerReceiver(body, 'alu', 'steel', {
    bore,
    zRear: zUpperRear + 0.004,
    zFront: -0.088,
    w: 0.0245,
    magW: 0.0292,
    magD: 0.0672,
    magTop: 0.049,
    magBottom: 0.008,
    magZ,
    magTilt,
    triggerZ: -0.012,
    gripAngle: 0.38,
  });

  // Bolt catch (left), magazine release in its fence (right), takedown pins.
  const catchPaddle = extrude(
    [
      [-0.012, -0.0035],
      [0.012, -0.0045],
      [0.014, 0.0035],
      [-0.012, 0.0045],
    ],
    0.0042,
    { bevel: 0.0007 }
  );
  body.add(catchPaddle, 'steel', { x: -0.0135, y: 0.0545, z: -0.018, ry: Math.PI / 2 });
  catchPaddle.dispose();
  const catchBoss = blob(0.006, 0.011, 0.014, 0.0018, 2);
  body.add(catchBoss, 'alu', { x: -0.0128, y: 0.0555, z: -0.0085 });
  catchBoss.dispose();

  const relFence = blob(0.0075, 0.016, 0.019, 0.0022, 2);
  body.add(relFence, 'alu', { x: 0.0132, y: 0.0505, z: -0.0295 });
  relFence.dispose();
  const relButton = latheZ(
    [
      [0, 0],
      [0, 0.0048],
      [0.0016, 0.0052],
      [0.0042, 0.0052],
      [0.0042, 0],
    ],
    14
  );
  body.add(relButton, 'steel', { x: 0.0158, y: 0.0505, z: -0.0295, ry: Math.PI / 2 });
  relButton.dispose();
  addPin(body, 'steel', 0, 0.0555, -0.083, 0.0028, 0.0252); // front takedown
  addPin(body, 'steel', 0, 0.0555, 0.0455, 0.0028, 0.0252); // rear takedown

  // Rollmark + calibre stamp on the left of the magwell — the side that faces the
  // camera in the hipfire pose, engraved as geometry so it cannot swim.
  addRollmark(body, 'cavity', { x: -0.0149, y: 0.0355, z: -0.031, h: 0.0036 });
  addRollmark(body, 'cavity', {
    x: -0.0149,
    y: 0.0272,
    z: -0.033,
    h: 0.0024,
    pitch: 0.0014,
    pattern: [2, 3, 1, 0, 2, 2, 3, 0, 3, 2],
  });

  // ---- barrel, gas system, muzzle -----------------------------------------
  addBarrel(body, 'steel', 'cavity', {
    y: bore,
    zBreech,
    zMuzzle: zBarrelEnd,
    rChamber: 0.0112,
    rBarrel: 0.0077,
    rGas: 0.0098,
    gasAt: -0.3,
  });
  // Soot: the gas block vents combustion products by design and the brake is
  // 20 mm from the crown. See `steel_soot` in materials.js.
  addGasBlock(body, 'steel_soot', {
    y: bore,
    z: -0.3,
    rBarrel: 0.0077,
    tubeTo: -0.15,
    w: 0.021,
    h: 0.0195,
  });
  const muzzle = addMuzzleDevice(body, 'steel_soot', 'cavity', 'brake', zBarrelEnd, 0.0077, bore);

  // ---- handguard + rails ---------------------------------------------------
  /**
   * The handguard is an aluminium chassis (barrel nut, braces, end cap) carrying
   * POLYMER panels. That is what gives the gun its second material class: a warm,
   * 0.023-albedo, 0.65-rough moulded shell bolted to a cool, 0.033-albedo,
   * 0.40-rough anodised receiver, with phosphate steel forward of both.
   *
   * `topFrom/topTo` closes the top of the handguard over the section the support
   * hand grips, and the top rail is split around it — see gripL below. A hand
   * cannot close over a Picatinny rail without the fingers passing through the
   * teeth, and a support hand that does not close is the reason the glove read as
   * detached slabs floating beside the gun.
   */
  // Where the support hand's knuckles cross the handguard. Moved 10 mm rearward
  // (was -0.245) when the hipfire pose pushed the weapon out to 300 mm: the
  // support arm is reach-limited, and every 10 mm off the contact is elbow bend
  // recovered. 150 mm of handguard remains ahead of the hand.
  const handZ = -0.235;
  addHandguard(body, 'alu', {
    matPanel: 'polymer',
    y: bore,
    z0: hgZ0,
    z1: hgZ1,
    r: hgR,
    sides: 8,
    slatW: 0.0166,
    slatT: 0.0036,
    slots: 4,
    braces: 3,
    topFrom: handZ + 0.048,
    topTo: hgZ1 + 0.056,
  });
  // ONE continuous top rail over the whole handguard, as a free-float tube
  // actually has. It used to be split around the support hand's knuckles,
  // because a hand cannot close over Picatinny teeth without the fingers passing
  // through them — but the hand now grips UNDER the handguard (see gripL), so the
  // split left a 138 mm bare gap in the middle of the deck for no reason.
  addRail(body, 'alu', hgZ1 + 0.004, hgZ0 - 0.002, railTop);
  addQdSocket(body, 'alu', 'steel', -hgR + 0.001, bore - 0.008, hgZ0 - 0.035, 'x', 0.005);
  addSlingLoop(body, 'steel', 0, bore - hgR - 0.0015, hgZ1 + 0.03, 0.0075, {
    rx: Math.PI / 2,
    ry: Math.PI / 2,
  });

  // ---- furniture -----------------------------------------------------------
  addPistolGrip(body, 'polymer', 'rubber', { y: 0.035, z: 0.015, angle: 0.38, len: 0.108, w: 0.031 });
  // Buffer tube stays aluminium (it is a machined extrusion); the cheek riser and
  // butt stock are the polymer class, the pad is rubber. Three classes, one part.
  addCarbineStock(body, 'alu', 'polymer', 'rubber', {
    bore,
    zFront: zUpperRear + 0.003,
    zRear: 0.245,
    y: bore - 0.012,
  });

  // ---- sights --------------------------------------------------------------
  /**
   * 31 mm tube, 52 mm long, a 33 mm belled objective with a 7 mm shade.
   *
   * The length is the number that matters and 70 mm was the wrong one. The
   * visible sight picture in ADS is the objective bore subtended at
   * (eyeRelief + len), so every millimetre of tube shrinks it; at 70 mm the
   * objective stopped the train down to 34% of the housing radius and the ADS
   * frame was a quarter-height ring of dark tube wall — "a length of drainpipe",
   * measured. 52 mm plus the flared bore in buildOptic gets it to 69%.
   */
  const optic = buildOptic(body, {
    rTube: 0.0155,
    len: 0.052,
    hood: 0.007,
    y: opticY,
    z: opticZ,
    railTop,
    matBody: 'alu_fine',
    matSteel: 'steel',
  });
  /**
   * BACK-UP IRON SIGHTS IN POLYMER, not steel.
   *
   * MEASURED: as `steel`/`steel_black` the folded leaves and the windage drum
   * rendered at L=188-192 — the brightest objects on the front half of the weapon
   * and the last of the "bright cream blocky bits". They are METALS, so
   * `specularIntensity` does not apply to them (three folds the albedo into F0 at
   * metalness 1) and halving F0 twice moved the display value by a fifth of a stop.
   *
   * A folding BUIS is a Magpul MBUS or a Troy: glass-filled polymer or black
   * anodised aluminium, never bright phosphate. `polymer` is both the honest
   * material and a DIELECTRIC, so it takes the 0.13 specular clamp with the rest of
   * the gun and carries the moulding stipple as well.
   */
  addFrontSight(body, 'polymer', 'alu', 0, railTop, -0.358, false);
  /**
   * BACK-UP REAR SIGHT — MOVED, and the move is a composition fix, not a taste one.
   *
   * At z = +0.038 (the classic flat-top position, right at the back of the upper)
   * the folded BUIS sits 75 mm from the eye in ADS. That is closer than any other
   * part of the weapon — closer than the optic itself — so it rendered as a pale
   * cream slab with a chrome drum filling the bottom 180 px of the ADS frame at
   * L=207-224, the brightest object on screen. Measured by raycasting the ADS
   * frame: every one of those pixels came back `rifle-body-steel` at d=0.072-0.076.
   *
   * No material change fixes an object that large and that close (the F0 was
   * already halved twice and it moved the display value by 0.15 of a stop — it is
   * sitting flat on the tone curve's shoulder). Mounting the BUIS forward of the
   * optic on the free-float rail is both a completely standard configuration with
   * a cantilever mount and puts it 224 mm out instead of 75, i.e. a ninth of the
   * screen area, behind and below the sight picture where it belongs. Its steel
   * also becomes nitride black rather than bright phosphate, which is what a
   * folding BUIS is actually finished in.
   */
  addRearSight(body, 'polymer', 'alu', 0, railTop, -0.112, false);

  // ---- moving parts --------------------------------------------------------
  const magazine = new Assembly('rifle-mag');
  const mag = buildMagazine(magazine, null, {
    w: 0.0255,
    d: 0.0655,
    len: 0.212,
    curve: 0.03,
    segs: 8,
    witness: 4,
    poly: 'polymer',
  });

  const charging = new Assembly('rifle-charging');
  const chG = chargingHandlePart();
  // An AR charging handle is a black-anodised ALUMINIUM extrusion, not bright
  // steel. Measured as `steel_bright` it was a 30 x 15 px cream plate at L=170-184
  // sitting on the receiver flank in hipfire — one of the "untextured white
  // blocks". As `alu` it is the same class as the receiver it slides in, which is
  // correct, and it picks up the specular clamp and the anodising grain.
  charging.add(chG, 'alu', {});
  chG.dispose();

  const bolt = new Assembly('rifle-bolt');
  addBoltCarrier(bolt, 'steel_bright', { r: 0.0152, len: 0.092, z: 0 });
  // A round in the chamber. It lies ALONG the bore (the cartridge is authored
  // base-at-0 running +Z, so ry=PI turns it muzzle-forward) and is pushed far
  // enough forward that only the case head shows in the ejection port. Left
  // where it is easy to put it, a chambered round spears out through the
  // receiver wall and reads as a bug.
  const chamberRound = cartridge(0.0446, 0.00495, 0.019);
  bolt.add(chamberRound.brass, 'brass', { z: -0.09, ry: Math.PI, y: 0 });
  chamberRound.brass.dispose();
  chamberRound.bullet.dispose();

  const trigger = new Assembly('rifle-trigger');
  const trg = triggerPart('steel_bright');
  trigger.add(trg.geo, 'steel_bright', {});
  trg.geo.dispose();

  const selector = new Assembly('rifle-selector');
  const sel = selectorPart('alu', 'steel');
  selector.add(sel.geo, 'alu', {});
  sel.geo.dispose();
  const selR = selectorPart('alu', 'steel');
  selector.add(selR.geo, 'alu', { sx: -1 });
  selR.geo.dispose();

  return {
    id: 'rifle',
    label: 'M4A1',
    fxClass: 'carbine',
    body,
    moving: { magazine, charging, bolt, trigger, selector },
    nodes: {
      muzzle: [0, bore, muzzle.crownZ],
      chamber: [0, bore, portZ],
      eject: [rUpper + 0.008, bore + 0.003, portZ],
      ejectDir: [0.86, 0.44, 0.26],
      sight: [0, opticY, optic.lensZ],
      // Wrist, not palm, targets. The firing palm rises from the sleeve toward
      // the knuckles. Finger curls/spread and thumb opposition are fitted
      // separately to the gun; pointing this axis down folded the wrist back.
      gripR: {
        pos: [0.0351, -0.007, 0.1223],
        finger: [0.15, 0.35, -0.92],
        back: [1, 0.03, 0.04],
      },
      // Rear-handguard hold: the palm points forward rather than across the
      // forearm. The cylinder fit closes the fingers; grip-contacts.js seats
      // the opposed thumb without forcing the wrist to follow the old tangent.
      gripL: {
        pos: [-0.072, 0.047, handZ + 0.049],
        finger: [0.70, -0.10, -0.71],
        back: [-0.14, -0.985, 0.001],
      },
      /**
       * The handguard's collision profile, for the build-time fingertip contact
       * solve (Arm.fitToCylinder). The handguard is genuinely a cylinder on the
       * bore axis, so the profile is exact — `r` is the outer radius of the
       * POLYMER panels (the slats stand 3.6 mm off the 23.5 mm chassis), which is
       * the surface a hand actually touches.
       */
      handguard: {
        axis: [0, bore, 0],
        dir: [0, 0, 1],
        r: hgR + 0.0036,
        z0: hgZ0,
        z1: hgZ1,
      },
      magSeat: { pos: [0, 0.061, magZ], rot: [magTilt, 0, 0] },
      chargeRest: { pos: [0, bore + rUpper - 0.0075, zUpperRear - 0.024], rot: [0, 0, 0] },
      chargePull: [0, 0, 0.082],
      boltRest: { pos: [0, bore, 0.021], rot: [0, 0, 0] },
      boltTravel: [0, 0, 0.062],
      triggerPivot: { pos: [0, 0.0455, -0.0055], rot: [0, 0, 0] },
      triggerPull: -0.34,
      selectorPivot: { pos: [0, 0.0525, 0.0205], rot: [0, 0, 0] },
      opticGlass: optic,
    },
    shell: { caseLen: 0.0446, rimR: 0.00495 },
    magSize: { len: mag.len },
  };
}

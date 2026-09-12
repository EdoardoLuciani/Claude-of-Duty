import * as THREE from 'three';
import { createArmControls } from './arm-controls.js';
import { bindArmAsset } from './arm-asset.js';
import { HAND_POSES, HAND_POSE_EASE } from './hand-poses.js';
export { HAND_POSES } from './hand-poses.js';

// Gameplay owns contact/IK; Blender owns the skin and authored contact poses.
const THUMB = { l0: .05, l1: .032, r0: .0115, r1: .0102, r2: .0078 };
const _t = new THREE.Vector3();
const _dir = new THREE.Vector3();
const _perp = new THREE.Vector3();
const _elbow = new THREE.Vector3();
const _up = new THREE.Vector3();
const _pole = new THREE.Vector3();
const _hp = new THREE.Vector3();
const _upperDir = new THREE.Vector3();
const _foreDir = new THREE.Vector3();
const _transport = new THREE.Quaternion();
const _circleSide = new THREE.Vector3();
const _idealElbow = new THREE.Vector3();
const ELBOW_SAMPLES = 64;
const _circleCost = new Float64Array(ELBOW_SAMPLES);
const _circleCos = new Float64Array(ELBOW_SAMPLES);
const _circleSin = new Float64Array(ELBOW_SAMPLES);
for (let i = 0; i < ELBOW_SAMPLES; i++) {
  _circleCos[i] = Math.cos(i * Math.PI * 2 / ELBOW_SAMPLES);
  _circleSin[i] = Math.sin(i * Math.PI * 2 / ELBOW_SAMPLES);
}
const _bx = new THREE.Vector3();
const _by = new THREE.Vector3();
const _bz = new THREE.Vector3();
const _bm = new THREE.Matrix4();
// contact-fit scratch (build time only, but the no-allocation rule holds anyway)
const _fitInv = new THREE.Matrix4();
const _fitP = new THREE.Vector3();
const _fitD = new THREE.Vector3();
const _fitAxis = new THREE.Vector3();
const _fitAx0 = new THREE.Vector3();

/**
 * Orient a bone whose geometry runs along its local -Z so that -Z points along
 * `dir`, with local +Y rolled toward `up`.
 *
 * This deliberately does NOT use Object3D.lookAt(): for non-camera objects
 * lookAt aims local **+Z** at the target (so a -Z bone would point backwards),
 * and it interprets the target in WORLD space, which is wrong here because
 * every joint position is authored in the rig's local space.
 */
function aimBone(quat, dir, up) {
  _bz.copy(dir).multiplyScalar(-1).normalize(); // local +Z is opposite the bone
  _by.copy(up);
  _by.addScaledVector(_bz, -_by.dot(_bz));
  if (_by.lengthSq() < 1e-9) {
    // Degenerate roll reference: pick any axis that is not parallel to the bone.
    _by.set(0, 1, 0).addScaledVector(_bz, -_bz.y);
    if (_by.lengthSq() < 1e-9) _by.set(1, 0, 0).addScaledVector(_bz, -_bz.x);
  }
  _by.normalize();
  _bx.crossVectors(_by, _bz).normalize();
  _bm.makeBasis(_bx, _by, _bz);
  return quat.setFromRotationMatrix(_bm);
}

export class Arm {
  constructor(side, materials, opts = {}) {
    this.side = side;
    this.scale = opts.scale ?? 1;
    this.l1 = (opts.upper ?? .33) * this.scale;
    this.l2 = (opts.fore ?? .3) * this.scale;
    this.root = new THREE.Object3D();
    this.root.name = side < 0 ? 'arm-left' : 'arm-right';
    this.shoulder = new THREE.Vector3(side * (opts.shoulderX ?? .19), opts.shoulderY ?? -.19, opts.shoulderZ ?? .12);
    this.pole = new THREE.Vector3(side * .46, -.86, .22).normalize();
    this.bodyUp = new THREE.Vector3(0, 1, 0);
    this.bodyRight = new THREE.Vector3(1, 0, 0);
    this.poses = {};
    createArmControls(this);
    this.setPose(opts.pose ?? 'wrap');
  }

  attachAsset(asset) { bindArmAsset(this, asset); }

  fitToCylinder(handPos, handQuat, axisPoint, axisDir, radius, opts = {}) {
    const clearance = opts.clearance ?? 0.001;
    const poseName = opts.poseName ?? this.pose;
    const base = this.poses[poseName] ?? HAND_POSES[poseName] ?? HAND_POSES.clamp;

    this.hand.position.copy(handPos);
    this.hand.quaternion.copy(handQuat);
    this.root.updateMatrixWorld(true);
    // Everything is measured in the ARM ROOT's space, so the result is
    // independent of wherever the rig happens to be this frame.
    _fitInv.copy(this.root.matrixWorld).invert();
    _fitAxis.set(axisDir[0], axisDir[1], axisDir[2]).normalize();
    const ax0 = _fitAx0.set(axisPoint[0], axisPoint[1], axisPoint[2]);

    /** Signed distance from a joint-local point to the cylinder surface. */
    const gapAt = (joint, lx, ly, lz, out) => {
      joint.updateWorldMatrix(true, true);
      _fitP.set(lx, ly, lz).applyMatrix4(joint.matrixWorld).applyMatrix4(_fitInv);
      if (out) out.copy(_fitP);
      _fitD.copy(_fitP).sub(ax0);
      _fitD.addScaledVector(_fitAxis, -_fitD.dot(_fitAxis));
      return _fitD.length() - radius;
    };

    /**
     * Scan a joint's flexion for the angle that puts `local` on the surface.
     *
     * A scan, not a bisection: the gap is not monotonic in curl (past ~110 deg
     * the tip starts coming back OUT the far side of the tube), so a bisection
     * can converge on the wrong root. 40 samples over the anatomical range is
     * 2.5 deg of resolution, which is 0.4 mm at the fingertip.
     */
    const fitJoint = (joint, local, lo, hi, standoff = 0) => {
      let best = joint.rotation.x;
      let bestCost = Infinity;
      for (let i = 0; i <= 48; i++) {
        const a = lo + ((hi - lo) * i) / 48;
        joint.rotation.x = a;
        const g = gapAt(joint, local[0], local[1], local[2]) - standoff;
        // Target: on the surface, up to `clearance` proud, at most 1.5 mm buried.
        const cost = Math.abs(g - clearance * 0.5) + (g < -0.0015 ? (-g - 0.0015) * 8 : 0);
        if (cost < bestCost) {
          bestCost = cost;
          best = a;
        }
      }
      joint.rotation.x = best;
      return best;
    };

    /**
     * Wrap all three joints, PROXIMAL FIRST.
     *
     * Fitting only the distal joint cannot wrap a cylinder: if the MCP and PIP
     * are authored for a different contact clock angle the finger traces the
     * wrong spiral, and the distal joint is then asked to close a gap it is 22 mm
     * long and physically cannot reach. Solving the chain outward — each joint
     * placing the NEXT joint's origin one finger-radius off the surface, then the
     * distal joint placing the actual contact patch on it — is what a finger does,
     * and it is stable because each stage only has one degree of freedom.
     */
    const fingers = [];
    const contacts = [];
    for (let i = 0; i < 4; i++) {
      const f = this.fingers[i];
      const curl = base.fingers[i].slice();
      for (let j = 0; j < 3; j++) f.joints[j].rotation.x = -curl[j];
      const rr = this._segRadius?.[i] ?? [0.01, 0.0094, 0.0084, 0.006];
      const ll = this._segLength?.[i] ?? [0.046, 0.029, 0.022];
      for (let j = 0; j < 2; j++) {
        // The next joint's origin sits ON the finger's own axis, so it wants to
        // be one segment-radius clear of the surface, not on it.
        const a = fitJoint(f.joints[j], [0, 0, -ll[j]], -1.75, -0.05, rr[j + 1] * 0.92);
        curl[j] = -a;
      }
      // The fingertip grip patch: palmar side, one radius below the axis, half
      // way along the distal segment — the same numbers as the `tip` blob in
      // buildFinger, so the mask and the mesh agree.
      const local = [0, -rr[3] * 1.05, -ll[2] * 0.5];
      const a2 = fitJoint(f.joints[2], local, -1.95, -0.1, 0);
      curl[2] = -a2;
      fingers.push(curl);
      const p = new THREE.Vector3();
      gapAt(f.joints[2], local[0], local[1], local[2], p);
      contacts.push(p);
    }

    /**
     * ---- thumb: over the top and down the FAR side --------------------------
     *
     * THE THUMB BASE IS SOLVED TOO, and it has to be.
     *
     * MEASURED on the shipped build by walking the real transform chain: the four
     * fingertips landed 0.4-0.7 mm off the handguard — a genuine grip — and the
     * THUMB TIP was 13.5 mm clear of it. The thumb is the part of the support hand
     * that lies across the top of the handguard and therefore the part the camera
     * sees most of in the hipfire pose, so that 13.5 mm was most of "fingers do not
     * wrap the grip, they float beside it with a visible gap".
     *
     * The cause is that the two flexion joints were being fitted against a base
     * rotation that was AUTHORED, not solved. The thumb's carpometacarpal joint is
     * a saddle with two useful degrees of freedom and the authored abduction was
     * aimed for a different contact clock angle; with the metacarpal pointing past
     * the tube, 68 mm of thumb flexing on two hinges cannot reach it, and the scan
     * just parks both joints at their limits.
     *
     * So the base's Y (abduction — the axis that swings the thumb across the palm)
     * is scanned first, coarsely, for the value that brings the tip closest, and
     * only then are the two flexion joints fitted. One extra degree of freedom,
     * 24 samples, build time only.
     */
    const thumbBase = (base.thumbBase ?? [0, 0, 0]).slice();
    const thumb = (base.thumb ?? [0.3, 0.24]).slice();
    this.thumb.root.rotation.fromArray(thumbBase);
    this.thumb.joints[0].rotation.x = -thumb[0];
    this.thumb.joints[1].rotation.x = -thumb[1];
    const tr = THUMB.r2 * this.scale;
    const tlen = THUMB.l1 * this.scale;
    const tLocal = [0, -tr * 1.05, -tlen * 0.55];
    {
      // Mid-flex the two hinges while the base is searched, so the scan measures
      // where a naturally curled thumb would land rather than where a straight
      // one would.
      this.thumb.joints[0].rotation.x = -0.55;
      this.thumb.joints[1].rotation.x = -0.45;
      const y0 = thumbBase[1];
      const z0 = thumbBase[2];
      let bestY = y0;
      let bestZ = z0;
      let bestCost = Infinity;
      // Two axes, not one. MEASURED: scanning abduction alone still left the tip
      // 13.2 mm clear, because from a metacarpal root sitting 40-55 mm off a 54 mm
      // tube a 68 mm thumb only reaches if it is aimed at the surface in BOTH the
      // across-the-palm and the up-off-the-palm sense. 21 x 15 samples, build time.
      for (let i = 0; i <= 20; i++) {
        const yy = y0 - 1.3 + (2.6 * i) / 20;
        for (let k = 0; k <= 14; k++) {
          const zz = z0 - 0.9 + (1.8 * k) / 14;
          this.thumb.root.rotation.y = yy;
          this.thumb.root.rotation.z = zz;
          const g = gapAt(this.thumb.joints[1], tLocal[0], tLocal[1], tLocal[2]);
          // Prefer just-touching; punish burying much harder than standing off, and
          // add a small pull toward the authored pose so the solve stays plausible.
          const cost =
            Math.abs(g - clearance) +
            (g < -0.002 ? (-g - 0.002) * 10 : 0) +
            (Math.abs(yy - y0) + Math.abs(zz - z0)) * 0.0009;
          if (cost < bestCost) {
            bestCost = cost;
            bestY = yy;
            bestZ = zz;
          }
        }
      }
      this.thumb.root.rotation.y = bestY;
      this.thumb.root.rotation.z = bestZ;
      thumbBase[1] = bestY;
      thumbBase[2] = bestZ;
    }
    const a0 = fitJoint(
      this.thumb.joints[0],
      [0, 0, -THUMB.l0 * this.scale],
      -1.45,
      -0.02,
      THUMB.r1 * this.scale
    );
    thumb[0] = -a0;
    const a1 = fitJoint(this.thumb.joints[1], tLocal, -1.6, -0.05, 0);
    thumb[1] = -a1;
    const tp = new THREE.Vector3();
    gapAt(this.thumb.joints[1], tLocal[0], tLocal[1], tLocal[2], tp);
    contacts.push(tp);

    this.poses[poseName] = { fingers, thumb, thumbBase };
    this.pose = poseName;
    return contacts;
  }

  /** Build-time contact refinement on top of a Blender pose. No runtime IK
   * allocations: the resulting curls are ordinary cached pose data. */
  fitGrip(name, {thumb, thumbPole = [0, 0, 1], index, fingers, spread} = {}) {
    const base = this.poses[this.pose] ?? HAND_POSES[this.pose];
    const pose = {...base, fingers:(fingers ?? base.fingers).map(a => a.slice()), fingerSpread:(spread ?? base.fingerSpread ?? this.fingerSpread).slice()};
    this.poses[name] = pose;
    this.setPose(name);
    this.root.updateWorldMatrix(true, true);
    const local = new THREE.Matrix4().copy(this.handInner.matrixWorld).invert().multiply(this.root.matrixWorld);
    if (index) {
      const target = new THREE.Vector3().fromArray(index).applyMatrix4(local);
      const point = new THREE.Vector3();
      const inv = new THREE.Matrix4().copy(this.handInner.matrixWorld).invert();
      const joints = this.fingers[0].joints;
      for (let pass = 0; pass < 12; pass++) for (let j = 0; j < 4; j++) {
        const rotation = j < 3 ? joints[j].rotation : this.fingers[0].root.rotation;
        const axis = j < 3 ? 'x' : 'y';
        let best = rotation[axis];
        let cost = Infinity;
        const centre = best;
        const steps = pass < 8 ? 64 : 16;
        const radius = .05 * Math.pow(.4, pass - 8);
        for (let step = 0; step <= steps; step++) {
          const angle = pass < 8
            ? (j < 3 ? .20 - step * 1.95 / steps : -.75 + step * 1.8 / steps)
            : THREE.MathUtils.clamp(centre + (2 * step / steps - 1) * radius, j < 3 ? -1.75 : -.75, j < 3 ? .20 : 1.05);
          rotation[axis] = angle;
          joints[2].updateWorldMatrix(true, false);
          point.set(0, -.006 * this.scale, -.013 * this.scale).applyMatrix4(joints[2].matrixWorld).applyMatrix4(inv);
          const c = point.distanceToSquared(target);
          if (c < cost) { cost = c; best = angle; }
        }
        rotation[axis] = best;
        if (j < 3) pose.fingers[0][j] = -best;
        else pose.fingerSpread[0] = best;
      }
    }
    if (thumb) {
      const root = this.thumb.root.position;
      const target = new THREE.Vector3().fromArray(thumb).applyMatrix4(local);
      const dir = target.clone().sub(root);
      const l0 = THUMB.l0 * this.scale;
      const l1 = .026 * this.scale; // centre of the distal contact pad
      const d = THREE.MathUtils.clamp(dir.length(), Math.abs(l0 - l1) + .0001, (l0 + l1) * .999);
      dir.normalize();
      const pole = new THREE.Vector3().fromArray(thumbPole).transformDirection(local);
      pole.addScaledVector(dir, -pole.dot(dir));
      if (pole.lengthSq() < 1e-8) pole.set(0, 1, 0).addScaledVector(dir, -dir.y);
      pole.normalize();
      const a = (l0 * l0 + d * d - l1 * l1) / (2 * d);
      const elbow = root.clone().addScaledVector(dir, a).addScaledVector(pole, Math.sqrt(Math.max(0, l0 * l0 - a * a)));
      const first = elbow.clone().sub(root).normalize();
      const second = root.clone().addScaledVector(dir, d).sub(elbow).normalize();
      const dorsal = second.clone().addScaledVector(first, -second.dot(first)).negate().normalize();
      const q = aimBone(new THREE.Quaternion(), first, dorsal);
      pose.thumbBase = new THREE.Euler().setFromQuaternion(q).toArray().slice(0, 3);
      pose.thumb = [0, Math.acos(THREE.MathUtils.clamp(first.dot(second), -1, 1))];
    }
    this.setPose(name);
    return pose;
  }

  /** Immediate for build-time fitting; eased for live animation transitions. */
  setPose(name, duration = 0) {
    const p = this.poses[name] ?? HAND_POSES[name] ?? HAND_POSES.wrap;
    for (let i = 0; i < 4; i++) {
      this._spreadFrom[i] = this.fingers[i].root.rotation.y;
      this._spreadTo[i] = p.fingerSpread?.[i] ?? this.fingerSpread[i];
    }
    let n = 0;
    for (let i = 0; i < 4; i++) for (let j = 0; j < 3; j++) {
      const joint = this.fingers[i].joints[j];
      this._poseFrom[n] = joint.rotation.x;
      this._poseTo[n++] = -p.fingers[i][j];
    }
    for (let j = 0; j < 2; j++) {
      this._poseFrom[n] = this.thumb.joints[j].rotation.x;
      this._poseTo[n++] = -p.thumb[j];
    }
    this._thumbFrom.copy(this.thumb.root.quaternion);
    this.thumb.root.rotation.fromArray(p.thumbBase ?? [0, 0, 0]);
    this._thumbTo.copy(this.thumb.root.quaternion);
    this.thumb.root.quaternion.copy(this._thumbFrom);
    this._poseTime = 0;
    this._poseDuration = duration;
    this.pose = name;
    this.updatePose(0);
    return this;
  }

  updatePose(dt) {
    this._poseTime += dt;
    const t = this._poseDuration > 0 ? Math.min(1, this._poseTime / this._poseDuration) : 1;
    const sample = t * (HAND_POSE_EASE.length - 1);
    const i = Math.floor(sample);
    const u = THREE.MathUtils.lerp(HAND_POSE_EASE[i], HAND_POSE_EASE[Math.min(i + 1, HAND_POSE_EASE.length - 1)], sample - i);
    this._poseBlend = u;
    for (let i = 0; i < 4; i++) this.fingers[i].root.rotation.y = THREE.MathUtils.lerp(this._spreadFrom[i], this._spreadTo[i], u);
    let n = 0;
    for (let i = 0; i < 4; i++) for (let j = 0; j < 3; j++) {
      this.fingers[i].joints[j].rotation.x = THREE.MathUtils.lerp(this._poseFrom[n], this._poseTo[n], u);
      n++;
    }
    for (let j = 0; j < 2; j++) {
      this.thumb.joints[j].rotation.x = THREE.MathUtils.lerp(this._poseFrom[n], this._poseTo[n], u);
      n++;
    }
    this.thumb.root.quaternion.slerpQuaternions(this._thumbFrom, this._thumbTo, u);
    this.updateFlex();
  }

  // Half-angle skin controls preserve knuckle volume under linear skinning.
  // Blender authors these same controls; no dual-quaternion-only deformation.
  updateFlex() {
    for (const joint of this.flexJoints) joint.bone.rotation.x = joint.source.rotation.x * .5;
  }

  setTrigger(t) {
    // Only the firing grip owns the trigger. Reload/pinch/utility poses must
    // retain their authored index pose rather than being overwritten each frame.
    if (!this.pose.startsWith('grip')) return;
    const f = this.fingers[0];
    t = THREE.MathUtils.clamp(t, 0, 1);
    for (let j = 0; j < 3; j++) {
      const rest = THREE.MathUtils.lerp(this._poseFrom[j], this._poseTo[j], this._poseBlend);
      f.joints[j].rotation.x = rest - t * (j === 0 ? .03 : j === 1 ? .08 : .04);
    }
    this.updateFlex();
  }

  solve(targetPos, targetQuat, dt = 0) {
    if (dt > 0) this.updatePose(dt);
    this.hand.position.copy(targetPos);
    this.hand.quaternion.copy(targetQuat);

    _t.copy(targetPos).sub(this.shoulder);
    let d = _t.length();
    const maxD = (this.l1 + this.l2) * 0.995;
    const minD = Math.abs(this.l1 - this.l2) * 1.05 + 1e-4;
    if (d > maxD) {
      _t.multiplyScalar(maxD / d);
      d = maxD;
    } else if (d < minD) {
      if (d < 1e-5) _t.set(0, 0, -minD);
      else _t.multiplyScalar(minD / d);
      d = minD;
    }
    _dir.copy(_t).divideScalar(d);

    // Circle of possible elbow positions; pick the point toward the pole.
    const a = (this.l1 * this.l1 - this.l2 * this.l2 + d * d) / (2 * d);
    const h = Math.sqrt(Math.max(0, this.l1 * this.l1 - a * a));
    // Prefer an elbow behind the wrist, with a modest down/outward bias.
    // A fixed downward pole folded the firing wrist back by >100 degrees.
    _pole.set(0, 0, 1).applyQuaternion(targetQuat).addScaledVector(this.pole, 0.85);
    _perp.copy(_pole).addScaledVector(_dir, -_pole.dot(_dir));
    if (_perp.lengthSq() < 1e-8) {
      _perp.set(this.side, -1, 0).addScaledVector(_dir, 0);
      _perp.addScaledVector(_dir, -_perp.dot(_dir));
    }
    _perp.normalize();
    // Choose wrist alignment subject to body-space elbow clearance. Solving
    // wrist angle alone lifts sleeves across the sight; a downward pole alone
    // folds the wrist backwards. A small bounded circle search handles both
    // inequalities, including poses where exact clearance is unreachable.
    _elbow.copy(this.shoulder).addScaledVector(_dir, a);
    _circleSide.crossVectors(_dir, _perp).normalize();
    _idealElbow.set(0, 0, 1).applyQuaternion(targetQuat).multiplyScalar(this.l2).add(targetPos);
    const ceiling = targetPos.dot(this.bodyUp) - .12;
    const outside = targetPos.dot(this.bodyRight) * this.side + .045;
    let best = 0;
    for (let i = 0; i < ELBOW_SAMPLES; i++) {
      _hp.copy(_elbow).addScaledVector(_perp, h * _circleCos[i]).addScaledVector(_circleSide, h * _circleSin[i]);
      const high = Math.max(0, _hp.dot(this.bodyUp) - ceiling);
      const crossed = Math.max(0, outside - _hp.dot(this.bodyRight) * this.side);
      _circleCost[i] = _hp.distanceToSquared(_idealElbow) + 100 * (high * high + crossed * crossed);
      if (_circleCost[i] < _circleCost[best]) best = i;
    }
    // Sub-sample the minimum, avoiding visible 64-step elbow snapping.
    const prev = _circleCost[(best + ELBOW_SAMPLES - 1) % ELBOW_SAMPLES];
    const next = _circleCost[(best + 1) % ELBOW_SAMPLES];
    const curvature = prev - 2 * _circleCost[best] + next;
    const offset = curvature > 1e-12 ? THREE.MathUtils.clamp((prev - next) / (2 * curvature), -.5, .5) : 0;
    const angle = (best + offset) * Math.PI * 2 / ELBOW_SAMPLES;
    _elbow.addScaledVector(_perp, h * Math.cos(angle)).addScaledVector(_circleSide, h * Math.sin(angle));

    this.upperPivot.position.copy(this.shoulder);
    _upperDir.copy(_elbow).sub(this.shoulder).normalize();

    // Forearm: elbow -> wrist, rolled with the back of the hand so the cuff and
    // the wrist line up with the glove.
    this.forePivot.position.copy(_elbow);
    _up.set(0, 1, 0).applyQuaternion(targetQuat);
    _hp.copy(targetPos).sub(_elbow);
    if (_hp.lengthSq() > 1e-12) aimBone(this.forePivot.quaternion, _hp, _up);
    this.forePivot.scale.z = _hp.length() / this.l2;
    // Parallel-transport the forearm's roll through the elbow. Independently
    // aiming the upper sleeve at the pole twisted the continuous skin inside
    // out at the elbow even though both bone positions were correct.
    _foreDir.copy(_hp).normalize();
    _transport.setFromUnitVectors(_foreDir, _upperDir);
    _up.set(0, 1, 0).applyQuaternion(this.forePivot.quaternion).applyQuaternion(_transport);
    aimBone(this.upperPivot.quaternion, _upperDir, _up);
    return this;
  }

  dispose() {
    for (const mesh of this.skins) {
      mesh.geometry.dispose();
      mesh.removeFromParent();
    }
    this.skins.length = 0;
    this.skeleton?.dispose();
    this.skeleton = null;
  }
}

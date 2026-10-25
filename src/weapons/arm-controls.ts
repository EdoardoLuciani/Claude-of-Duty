import * as THREE from 'three';

import type { ArmRig } from './arm-asset.ts';

/** Named controls shared by Blender's skin weights and the gameplay IK. */
export function createArmControls(
  arm: ArmRig & {
    flexJoints: Array<{ bone: THREE.Object3D; source: THREE.Object3D }>;
    handInner: THREE.Object3D;
    upperPivot: THREE.Object3D;
    forePivot: THREE.Object3D;
    hand: THREE.Object3D;
    _segLength: number[][];
    _segRadius: number[][];
    fingerSpread: number[];
    _spreadFrom: Float32Array;
    _spreadTo: Float32Array;
    fingers: Array<{ root: THREE.Object3D; joints: THREE.Object3D[] }>;
    thumbWeb: THREE.Object3D;
    thumbRest: THREE.Quaternion;
    _poseFrom: Float32Array;
    _poseTo: Float32Array;
    _thumbFrom: THREE.Quaternion;
    _thumbTo: THREE.Quaternion;
    _poseTime: number;
    _poseDuration: number;
  }
): void {
  const s = arm.scale;
  arm.controls = {};
  arm.flexJoints = [];
  const bone = (name: string, parent: THREE.Object3D, x = 0, y = 0, z = 0): THREE.Bone => {
    const b = new THREE.Bone();
    b.name = name;
    b.position.set(x * s, y * s, z * s);
    parent.add(b);
    arm.controls[name] = b;
    return b;
  };
  arm.upperPivot = bone('upper', arm.root, 0, 0, 0.63);
  arm.forePivot = bone('fore', arm.root, 0, 0, 0.3);
  arm.hand = bone('hand', arm.root);
  arm.handInner = new THREE.Object3D();
  arm.handInner.scale.x = arm.side < 0 ? 1 : -1;
  arm.hand.add(arm.handInner);
  arm._segLength = [
    [0.045, 0.028, 0.022],
    [0.049, 0.031, 0.023],
    [0.046, 0.029, 0.022],
    [0.038, 0.024, 0.02],
  ].map((a): number[] => a.map((v): number => v * s));
  arm._segRadius = [
    [0.0102, 0.0096, 0.0086, 0.0062],
    [0.0104, 0.0098, 0.0088, 0.0064],
    [0.01, 0.0094, 0.0084, 0.006],
    [0.0092, 0.0086, 0.0078, 0.0056],
  ].map((a): number[] => a.map((v): number => v * s * 0.86));
  const xs = [0.0298, 0.0102, -0.0104, -0.0298];
  arm.fingerSpread = xs.map((x): number => -x * 2.2);
  arm._spreadFrom = new Float32Array(4);
  arm._spreadTo = new Float32Array(4);
  arm.fingers = xs.map((x, i): { root: THREE.Object3D; joints: THREE.Object3D[] } => {
    const root = new THREE.Object3D();
    root.position.set(x * s, -0.006 * s, -0.096 * s);
    root.rotation.y = -x * 2.2;
    arm.handInner.add(root);
    const joints: THREE.Object3D[] = [];
    let parent = root;
    for (let j = 0; j < 3; j++) {
      const b = bone(`finger_${i}_${j}`, parent);
      if (j) {
        b.position.z = -arm._segLength[i][j - 1];
        const flex = bone(`finger_${i}_${j}_flex`, parent);
        flex.position.copy(b.position);
        arm.flexJoints.push({ bone: flex, source: b });
      }
      joints.push(b);
      parent = b;
    }
    return { root, joints };
  });
  const root = bone('thumb_base', arm.handInner, 0.037, -0.009, -0.04);
  arm.thumbWeb = bone('thumb_web', arm.handInner, 0.037, -0.009, -0.04);
  arm.thumbRest = new THREE.Quaternion(0, Math.sin(-0.95 / 2), 0, Math.cos(-0.95 / 2));
  const j0 = bone('thumb_0', root);
  const j1 = bone('thumb_1', j0, 0, 0, -0.05);
  const thumbFlex = bone('thumb_1_flex', j0, 0, 0, -0.05);
  arm.flexJoints.push({ bone: thumbFlex, source: j1 });
  arm.thumb = { root, joints: [j0, j1] };
  arm.skins = [];
  arm._poseFrom = new Float32Array(14);
  arm._poseTo = new Float32Array(14);
  arm._thumbFrom = new THREE.Quaternion();
  arm._thumbTo = new THREE.Quaternion();
  arm._poseTime = 0;
  arm._poseDuration = 0;
}

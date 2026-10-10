import * as THREE from 'three';
import type { ArmRig } from './arm-asset.ts';

/** Named controls shared by Blender's skin weights and the gameplay IK. */
export function createArmControls(arm: ArmRig & {
  flexJoints: Array<{ bone: THREE.Object3D; source: THREE.Object3D }>;
  handInner: THREE.Object3D; upperPivot: THREE.Object3D; forePivot: THREE.Object3D; hand: THREE.Object3D;
  _segLength: number[][]; _segRadius: number[][]; fingerSpread: number[];
  _spreadFrom: Float32Array; _spreadTo: Float32Array;
  fingers: Array<{ root: THREE.Object3D; joints: THREE.Object3D[] }>;
  thumbWeb: THREE.Object3D; thumbRest: THREE.Quaternion;
  _poseFrom: Float32Array; _poseTo: Float32Array; _thumbFrom: THREE.Quaternion; _thumbTo: THREE.Quaternion;
  _poseTime: number; _poseDuration: number;
}): void {
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
  arm.upperPivot = bone('upper', arm.root, 0, 0, .63);
  arm.forePivot = bone('fore', arm.root, 0, 0, .3);
  arm.hand = bone('hand', arm.root);
  arm.handInner = new THREE.Object3D();
  arm.handInner.scale.x = arm.side < 0 ? 1 : -1;
  arm.hand.add(arm.handInner);
  arm._segLength = [[.045,.028,.022],[.049,.031,.023],[.046,.029,.022],[.038,.024,.020]].map(a => a.map(v => v*s));
  arm._segRadius = [[.0102,.0096,.0086,.0062],[.0104,.0098,.0088,.0064],[.010,.0094,.0084,.006],[.0092,.0086,.0078,.0056]].map(a => a.map(v => v*s*.86));
  const xs = [.0298,.0102,-.0104,-.0298];
  arm.fingerSpread = xs.map(x => -x * 2.2);
  arm._spreadFrom = new Float32Array(4);
  arm._spreadTo = new Float32Array(4);
  arm.fingers = xs.map((x, i) => {
    const root = new THREE.Object3D();
    root.position.set(x*s, -.006*s, -.096*s);
    root.rotation.y = -x*2.2;
    arm.handInner.add(root);
    const joints: THREE.Object3D[] = [];
    let parent = root;
    for (let j = 0; j < 3; j++) {
      const b = bone(`finger_${i}_${j}`, parent);
      if (j) {
        b.position.z = -arm._segLength[i][j-1];
        const flex = bone(`finger_${i}_${j}_flex`, parent);
        flex.position.copy(b.position);
        arm.flexJoints.push({bone:flex, source:b});
      }
      joints.push(b);
      parent = b;
    }
    return {root, joints};
  });
  const root = bone('thumb_base', arm.handInner, .037, -.009, -.040);
  arm.thumbWeb = bone('thumb_web', arm.handInner, .037, -.009, -.040);
  arm.thumbRest = new THREE.Quaternion(0, Math.sin(-.95/2), 0, Math.cos(-.95/2));
  const j0 = bone('thumb_0', root);
  const j1 = bone('thumb_1', j0, 0, 0, -.05);
  const thumbFlex = bone('thumb_1_flex', j0, 0, 0, -.05);
  arm.flexJoints.push({bone:thumbFlex, source:j1});
  arm.thumb = {root, joints:[j0,j1]};
  arm.skins = [];
  arm._poseFrom = new Float32Array(14);
  arm._poseTo = new Float32Array(14);
  arm._thumbFrom = new THREE.Quaternion();
  arm._thumbTo = new THREE.Quaternion();
  arm._poseTime = 0;
  arm._poseDuration = 0;
}

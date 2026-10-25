import * as THREE from 'three';
import { clone } from 'three/examples/jsm/utils/SkeletonUtils.js';

import { createWeaponAnimation } from './authored-animation.ts';
import type { WeaponEntry } from './runtime-types.ts';

/** Independent transforms, skeletons and mixers; geometry/maps remain weapon-owned. */
export function createWeaponInspection(entry: WeaponEntry) {
  const scene = clone(entry.model.scene);
  if (!(scene instanceof THREE.Group)) throw new Error('[weapons] inspection scene missing');
  const root = scene.getObjectByName(entry.model.root.name);
  if (!root) throw new Error('[weapons] inspection rig missing');
  const model = {
    ...entry.model,
    scene,
    root,
    materials: new Set<THREE.Material>(),
    textures: new Set<THREE.Texture>(),
  };
  const animation = createWeaponAnimation(model, entry.def);
  animation.update(0, null, 0, false, true, entry.def.magSize);
  scene.updateMatrixWorld(true);
  return {
    scene,
    dispose() {
      scene.removeFromParent();
      animation.dispose();
      scene.traverse((node) => {
        if (node instanceof THREE.SkinnedMesh) node.skeleton.dispose();
      });
    },
  };
}

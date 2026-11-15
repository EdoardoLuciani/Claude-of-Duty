import * as THREE from 'three';
import { clone } from 'three/examples/jsm/utils/SkeletonUtils.js';

import { isGroup } from '../core/three-guards.ts';
import {
  mountAttachments,
  releaseAttachmentMounts,
  releaseClonedMounts,
  type AttachmentAssets,
  type AttachmentConfig,
} from './attachments.ts';
import { createWeaponAnimation } from './authored-animation.ts';
import type { WeaponEntry } from './runtime-types.ts';

/** Independent transforms, skeletons and mixers; geometry/maps remain weapon-owned. */
export function createWeaponInspection(
  entry: WeaponEntry,
  config: AttachmentConfig,
  assets: AttachmentAssets
): {
  scene: THREE.Group;
  dispose(): void;
} {
  const cloned: unknown = clone(entry.model.scene);
  if (!isGroup(cloned)) throw new Error('[weapons] inspection scene missing');
  const scene = cloned;
  const root = scene.getObjectByName(entry.model.root.name);
  if (!root) throw new Error('[weapons] inspection rig missing');
  const model = {
    ...entry.model,
    scene,
    root,
    materials: new Set<THREE.Material>(),
    textures: new Set<THREE.Texture>(),
  };
  // The gameplay scene may contain mounted instances; replace the cloned mounts.
  releaseClonedMounts(root);
  const mounted = mountAttachments(model, config, assets);
  const animation = createWeaponAnimation(model, entry.def);
  animation.update(0, null, 0, false, true, entry.def.magSize);
  scene.updateMatrixWorld(true);
  return {
    scene,
    dispose(): void {
      scene.removeFromParent();
      releaseAttachmentMounts(mounted);
      // The authored animation owns its cloned skeletons (as it does in gameplay).
      animation.dispose();
      scene.traverse((node): void => {
        // Release renderer-side records, not the borrowed geometry/materials/maps.
        node.dispose();
      });
    },
  };
}

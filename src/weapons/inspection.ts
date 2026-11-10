import * as THREE from 'three';
import { clone } from 'three/examples/jsm/utils/SkeletonUtils.js';

import { isGroup } from '../core/three-guards.ts';
import {
  mountAttachments,
  releaseAttachmentMount,
  type AttachmentConfig,
  type RMRModel,
} from './attachments.ts';
import { createWeaponAnimation } from './authored-animation.ts';
import type { WeaponEntry } from './runtime-types.ts';

/** Independent transforms, skeletons and mixers; geometry/maps remain weapon-owned. */
export function createWeaponInspection(
  entry: WeaponEntry,
  config: AttachmentConfig = entry.attachments,
  rmr: RMRModel | null = null
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
  // The gameplay scene may contain a mounted instance; replace the cloned mount.
  const previous = root.getObjectByName('attachments');
  if (isGroup(previous)) releaseAttachmentMount(previous);
  const mounted = mountAttachments(model, config, rmr);
  root.add(mounted.group);
  const animation = createWeaponAnimation(model, entry.def);
  animation.update(0, null, 0, false, true, entry.def.magSize);
  scene.updateMatrixWorld(true);
  return {
    scene,
    dispose(): void {
      scene.removeFromParent();
      releaseAttachmentMount(mounted.group);
      // The authored animation owns its cloned skeletons (as it does in gameplay).
      animation.dispose();
      scene.traverse((node): void => {
        // Release renderer-side records, not the borrowed geometry/materials/maps.
        node.dispose();
      });
    },
  };
}

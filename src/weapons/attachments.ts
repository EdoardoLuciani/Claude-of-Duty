import * as THREE from 'three';
import type { GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js';
import type { Renderer } from 'three/webgpu';

import { isMesh } from '../core/three-guards.ts';
import { loadWeaponGLTF } from './asset-loader.ts';
import { convertWeaponScene, disposeWeaponMaterials } from './asset-material.ts';
import { requiredNode } from './authored-model.ts';
import { WEAPON_DEFS, type WeaponId } from './defs.ts';
import type { OpticData, WeaponEntry, WeaponModelRecord } from './runtime-types.ts';

/** Null means the authored base weapon, not a separately purchasable component.
 * Muzzle/rail catalogs are intentionally empty until their assets are implemented. */
export interface AttachmentConfig {
  readonly optic: 'rmr' | null;
  readonly muzzle: null;
  readonly rail: null;
}
export const BASE_ATTACHMENTS: AttachmentConfig = Object.freeze({
  optic: null,
  muzzle: null,
  rail: null,
});

/** Narrow URL/debug input once; reject unsupported slots and incompatible weapons. */
export function isAttachmentConfig(value: unknown, id: WeaponId): value is AttachmentConfig {
  if (typeof value !== 'object' || value === null) return false;
  return (
    'optic' in value &&
    (value.optic === null || (value.optic === 'rmr' && id === 'rifle')) &&
    'muzzle' in value &&
    value.muzzle === null &&
    'rail' in value &&
    value.rail === null
  );
}

const RMR = {
  eyeRelief: 0.125,
  adsFovScale: 0.62,
  adsSensScale: 0.62,
  optic: { apertureR: 0.0055, dotMoa: 3.25, minDotPixels: 5, dotOpacity: 0.9 },
};

/** One owned asset; mounted/inspection instances borrow its geometry and finishes. */
export function makeRMRModel(gltf: GLTF): {
  scene: THREE.Group;
  mount: THREE.Vector3;
  sight: THREE.Vector3;
  dispose(): void;
} {
  const scene = gltf.scene;
  scene.updateMatrixWorld(true);
  const mount = requiredNode(scene, 'MOUNT_base').getWorldPosition(new THREE.Vector3());
  const sight = requiredNode(scene, 'SOCKET_sight').getWorldPosition(new THREE.Vector3());
  const finishes = convertWeaponScene(scene, (source, material): void => {
    if (source.name.startsWith('10 |')) {
      material.transparent = true;
      material.opacity = 0.13;
      material.depthWrite = false;
      material.side = THREE.DoubleSide;
    }
  });
  return {
    scene,
    mount,
    sight,
    dispose(): void {
      scene.removeFromParent();
      const geometries = new Set<THREE.BufferGeometry>();
      scene.traverse((node): void => {
        node.dispose();
        if (isMesh(node)) geometries.add(node.geometry);
      });
      for (const geometry of geometries) geometry.dispose();
      disposeWeaponMaterials(finishes);
    },
  };
}
export type RMRModel = ReturnType<typeof makeRMRModel>;

export async function loadRMR(renderer: Pick<Renderer, 'hasFeature'>): Promise<RMRModel> {
  return makeRMRModel(await loadWeaponGLTF(renderer, '/models/attachments/rmr.runtime.glb'));
}

export function releaseAttachmentMount(group: THREE.Group): void {
  group.removeFromParent();
  group.traverse((node): void => node.dispose());
  group.clear();
}

/** Shared gameplay/inspection mount solver, run only when configuration changes. */
export function mountAttachments(
  model: WeaponModelRecord,
  config: AttachmentConfig,
  rmr: RMRModel | null
): {
  group: THREE.Group;
  sight: THREE.Vector3;
  optic: OpticData | null;
} {
  if (!isAttachmentConfig(config, model.id))
    throw new Error(`[weapons] incompatible attachments: ${model.id}`);
  const group = new THREE.Group();
  group.name = 'attachments';
  const sight = new THREE.Vector3().fromArray(model.nodes.sight);
  let optic: OpticData | null = 'opticGlass' in model.nodes ? model.nodes.opticGlass : null;
  if (config.optic === 'rmr') {
    if (!rmr) throw new Error('[weapons] RMR asset unavailable');
    const mount = requiredNode(model.scene, 'MOUNT_optic');
    // Full authored mount transform, including orientation; asset mount is its origin.
    model.scene.updateMatrixWorld(true);
    const transform = new THREE.Matrix4()
      .copy(model.root.matrixWorld)
      .invert()
      .multiply(mount.matrixWorld);
    const instance = rmr.scene.clone(true);
    instance.position.sub(rmr.mount);
    instance.updateMatrix();
    instance.applyMatrix4(transform);
    group.add(instance);
    sight.copy(rmr.sight).sub(rmr.mount).applyMatrix4(transform);
    optic = { ...RMR.optic, center: sight.toArray() };
  }
  return { group, sight, optic };
}

/** Commit a fully staged mount atomically. The effective definition is shared by
 * handling, FOV/sensitivity and fire events (audio/FX suppression). */
export function configureWeaponAttachments(
  entry: WeaponEntry,
  config: AttachmentConfig,
  rmr: RMRModel | null
): void {
  const mounted = mountAttachments(entry.model, config, rmr);
  releaseAttachmentMount(entry.attachmentGroup);
  entry.attachmentGroup = mounted.group;
  entry.model.root.add(mounted.group);
  entry.attachments = Object.freeze({ ...config });
  entry.sight.copy(mounted.sight);
  entry.optic = mounted.optic;
  entry.muzzle.fromArray(entry.model.nodes.muzzle);
  const base = WEAPON_DEFS[entry.id];
  entry.def.eyeRelief = config.optic === 'rmr' ? RMR.eyeRelief : base.eyeRelief;
  entry.def.suppressed = base.suppressed ?? false;
  const fov = config.optic === 'rmr' ? RMR.adsFovScale : base.adsFovScale;
  const sensitivity = config.optic === 'rmr' ? RMR.adsSensScale : base.adsSensScale;
  if (fov === undefined) delete entry.def.adsFovScale;
  else entry.def.adsFovScale = fov;
  if (sensitivity === undefined) delete entry.def.adsSensScale;
  else entry.def.adsSensScale = sensitivity;
}

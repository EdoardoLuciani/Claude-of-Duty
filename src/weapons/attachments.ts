import * as THREE from 'three';
import type { GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js';
import type { Renderer } from 'three/webgpu';

import { isMesh } from '../core/three-guards.ts';
import { loadWeaponGLTF } from './asset-loader.ts';
import { convertWeaponScene, disposeWeaponMaterials } from './asset-material.ts';
import { requiredNode } from './authored-model.ts';
import { WEAPON_DEFS, type WeaponId } from './defs.ts';
import type { OpticData, WeaponEntry, WeaponModelRecord } from './runtime-types.ts';

export type OpticId = 'rmr' | 'acog' | 'scope';

/** Null means the authored base weapon, not a separately purchasable component.
 * Muzzle/rail catalogs are intentionally empty until their assets are implemented. */
export interface AttachmentConfig {
  readonly optic: OpticId | null;
  readonly ironSights: boolean;
  readonly muzzle: null;
  readonly rail: null;
}
export const BASE_ATTACHMENTS: AttachmentConfig = Object.freeze({
  optic: null,
  ironSights: true,
  muzzle: null,
  rail: null,
});

/** Narrow URL/debug input once; reject unsupported slots and incompatible weapons. */
export function isAttachmentConfig(value: unknown, id: WeaponId): value is AttachmentConfig {
  if (typeof value !== 'object' || value === null) return false;
  return (
    'optic' in value &&
    (value.optic === null ||
      ((value.optic === 'rmr' || value.optic === 'acog' || value.optic === 'scope') &&
        WEAPON_DEFS[id].opticEyeRelief?.[value.optic] !== undefined)) &&
    'ironSights' in value &&
    typeof value.ironSights === 'boolean' &&
    (value.ironSights || WEAPON_DEFS[id].removableIrons === true) &&
    !(
      value.ironSights &&
      value.optic !== null &&
      WEAPON_DEFS[id].opticsWithoutIrons?.includes(value.optic) === true
    ) &&
    'muzzle' in value &&
    value.muzzle === null &&
    'rail' in value &&
    value.rail === null
  );
}

const OPTICS: Record<
  OpticId,
  {
    adsFovScale: number;
    adsSensScale: number;
    optic: Omit<OpticData, 'center'>;
  }
> = {
  rmr: {
    adsFovScale: 0.62,
    adsSensScale: 0.62,
    optic: { apertureR: 0.0055, dotMoa: 3.25, minDotPixels: 5, dotOpacity: 0.9 },
  },
  acog: {
    adsFovScale: 0.28,
    adsSensScale: 0.28,
    optic: { kind: 'scope', reticle: 'chevron', apertureR: 0.0137 },
  },
  scope: {
    adsFovScale: 0.25,
    adsSensScale: 0.25,
    optic: { kind: 'scope', reticle: 'p4fl' },
  },
};

/** One owned asset; mounted/inspection instances borrow its geometry and finishes. */
export function makeOpticModel(
  gltf: GLTF,
  id: OpticId
): {
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
    if (source.name.startsWith(id === 'acog' ? '11 |' : '10 |')) {
      // The overlay owns the magnified picture: retain thin alpha, never a
      // second full-scene transmission pass through attachment glass.
      material.transmission = 0;
      material.transparent = true;
      material.opacity = id === 'acog' ? 0.1 : 0.13;
      material.depthWrite = false;
      material.side = THREE.DoubleSide;
      if (id === 'acog') {
        material.color.setRGB(0.035, 0.075, 0.085);
        material.metalness = 0;
        material.roughness = 0.12;
        material.specularIntensity = 0.25;
      }
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
export type OpticModel = ReturnType<typeof makeOpticModel>;
export type OpticModels = Partial<Record<OpticId, OpticModel>>;

export async function loadOptic(
  renderer: Pick<Renderer, 'hasFeature'>,
  id: OpticId
): Promise<OpticModel> {
  return makeOpticModel(
    await loadWeaponGLTF(renderer, `/models/attachments/${id}.runtime.glb`),
    id
  );
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
  optics: OpticModels
): {
  group: THREE.Group;
  sight: THREE.Vector3;
  optic: OpticData | null;
} {
  const { optic: opticId, ironSights } = config;
  if (!isAttachmentConfig(config, model.id))
    throw new Error(
      `[weapons] incompatible attachments: ${model.id}, optic=${opticId}, ironSights=${ironSights}`
    );
  const removable = WEAPON_DEFS[model.id].removableIrons === true;
  const irons = removable ? requiredNode(model.scene, 'IRON_sights') : null;
  const replacement = irons ? model.scene.getObjectByName('IRON_sights_removed') : undefined;
  const group = new THREE.Group();
  group.name = 'attachments';
  const sight = new THREE.Vector3().fromArray(model.nodes.sight);
  let optic: OpticData | null = 'opticGlass' in model.nodes ? model.nodes.opticGlass : null;
  if (opticId !== null) {
    const asset = optics[opticId];
    if (!asset) throw new Error(`[weapons] ${opticId} asset unavailable`);
    const mount = requiredNode(model.scene, 'MOUNT_optic');
    // Full authored mount transform, including orientation; asset mount is its origin.
    model.scene.updateMatrixWorld(true);
    const transform = new THREE.Matrix4()
      .copy(model.root.matrixWorld)
      .invert()
      .multiply(mount.matrixWorld);
    const instance = asset.scene.clone(true);
    instance.position.sub(asset.mount);
    instance.updateMatrix();
    instance.applyMatrix4(transform);
    group.add(instance);
    sight.copy(asset.sight).sub(asset.mount).applyMatrix4(transform);
    optic = { ...OPTICS[opticId].optic, center: sight.toArray() };
  }
  if (irons) irons.visible = ironSights;
  if (replacement) replacement.visible = !ironSights;
  return { group, sight, optic };
}

/** Commit a fully staged mount atomically. The effective definition is shared by
 * handling, FOV/sensitivity and fire events (audio/FX suppression). */
export function configureWeaponAttachments(
  entry: WeaponEntry,
  config: AttachmentConfig,
  optics: OpticModels
): void {
  const mounted = mountAttachments(entry.model, config, optics);
  releaseAttachmentMount(entry.attachmentGroup);
  entry.attachmentGroup = mounted.group;
  entry.model.root.add(mounted.group);
  entry.attachments = Object.freeze({ ...config });
  entry.sight.copy(mounted.sight);
  entry.optic = mounted.optic;
  entry.muzzle.fromArray(entry.model.nodes.muzzle);
  const base = WEAPON_DEFS[entry.id];
  const attached = config.optic === null ? null : OPTICS[config.optic];
  entry.def.eyeRelief =
    config.optic === null
      ? base.eyeRelief
      : (base.opticEyeRelief?.[config.optic] ?? base.eyeRelief);
  entry.def.suppressed = base.suppressed ?? false;
  const fov = attached ? attached.adsFovScale : base.adsFovScale;
  const sensitivity = attached ? attached.adsSensScale : base.adsSensScale;
  if (fov === undefined) delete entry.def.adsFovScale;
  else entry.def.adsFovScale = fov;
  if (sensitivity === undefined) delete entry.def.adsSensScale;
  else entry.def.adsSensScale = sensitivity;
}

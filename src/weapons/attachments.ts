import * as THREE from 'three';
import type { GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js';
import type { Renderer } from 'three/webgpu';

import { hasOwn, isRecord } from '../core/guards.ts';
import { isMesh } from '../core/three-guards.ts';
import { loadWeaponGLTF } from './asset-loader.ts';
import { convertWeaponScene, disposeWeaponMaterials } from './asset-material.ts';
import { requiredNode } from './authored-model.ts';
import { WEAPON_DEFS, type WeaponId } from './defs.ts';
import type { OpticData, WeaponEntry, WeaponModelRecord } from './runtime-types.ts';

export const OPTIC_IDS = ['rmr', 'acog', 'scope'] as const;
export type OpticId = (typeof OPTIC_IDS)[number];
export type RailId = 'laser';
export type MuzzleId = 'suppressor';

/** Null means the authored base weapon, not a separately purchasable component. */
export interface AttachmentConfig {
  readonly optic: OpticId | null;
  readonly ironSights: boolean;
  readonly muzzle: MuzzleId | null;
  readonly rail: RailId | null;
}
export const BASE_ATTACHMENTS: AttachmentConfig = Object.freeze({
  optic: null,
  ironSights: true,
  muzzle: null,
  rail: null,
});

/** One rule for every slot: null keeps the base weapon; an id needs a fit record entry. */
function hasFit(fits: object | undefined, value: unknown): boolean {
  return value === null || (typeof value === 'string' && fits !== undefined && hasOwn(fits, value));
}

/** Narrow URL/debug input once; reject unsupported slots and incompatible weapons. */
export function isAttachmentConfig(value: unknown, id: WeaponId): value is AttachmentConfig {
  // A missing slot reads as undefined, which every check below rejects.
  if (!isRecord(value)) return false;
  const { optic, ironSights, muzzle, rail } = value;
  const { fits, removableIrons } = WEAPON_DEFS[id];
  return (
    hasFit(fits?.optic, optic) &&
    hasFit(fits?.rail, rail) &&
    hasFit(fits?.muzzle, muzzle) &&
    typeof ironSights === 'boolean' &&
    (ironSights || removableIrons !== undefined) &&
    !(ironSights && removableIrons?.opticClashes.some((clash): boolean => clash === optic))
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

/** Owned rigid attachment; instances borrow its geometry and converted finishes. */
function makeRigidAttachment(
  gltf: GLTF,
  output: string
): {
  scene: THREE.Group;
  mount: THREE.Vector3;
  dispose(): void;
} {
  const scene = gltf.scene;
  scene.updateMatrixWorld(true);
  const mount = requiredNode(scene, 'SOCKET_mount').getWorldPosition(new THREE.Vector3());
  requiredNode(scene, output);
  const finishes = convertWeaponScene(scene);
  return {
    scene,
    mount,
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
export type LaserModel = ReturnType<typeof makeRigidAttachment>;
export type SuppressorModel = ReturnType<typeof makeRigidAttachment>;

export function makeLaserModel(gltf: GLTF): LaserModel {
  return makeRigidAttachment(gltf, 'SOCKET_laser');
}

export function makeSuppressorModel(gltf: GLTF): SuppressorModel {
  return makeRigidAttachment(gltf, 'SOCKET_muzzle');
}

export async function loadSuppressor(
  renderer: Pick<Renderer, 'hasFeature'>
): Promise<SuppressorModel> {
  return makeSuppressorModel(
    await loadWeaponGLTF(renderer, '/models/attachments/suppressor.runtime.glb')
  );
}

export async function loadLaser(renderer: Pick<Renderer, 'hasFeature'>): Promise<LaserModel> {
  return makeLaserModel(await loadWeaponGLTF(renderer, '/models/attachments/laser.runtime.glb'));
}

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

/** Iron-sight nodes of a weapon whose irons can be removed; null when they are fixed. */
export function ironSightNodes(
  model: WeaponModelRecord
): { installed: THREE.Object3D; removed: THREE.Object3D | undefined } | null {
  if (!WEAPON_DEFS[model.id].removableIrons) return null;
  return {
    installed: requiredNode(model.scene, 'IRON_sights'),
    removed: model.scene.getObjectByName('IRON_sights_removed'),
  };
}

/** Shared gameplay/inspection mount solver, run only when configuration changes. */
export function mountAttachments(
  model: WeaponModelRecord,
  config: AttachmentConfig,
  optics: OpticModels,
  laser: LaserModel | null = null,
  suppressor: SuppressorModel | null = null
): {
  group: THREE.Group;
  railGroup: THREE.Group;
  railParent: THREE.Object3D;
  laserEmitter: THREE.Object3D | null;
  muzzleGroup: THREE.Group;
  muzzleParent: THREE.Object3D;
  muzzleSocket: THREE.Object3D | null;
  parent: THREE.Object3D;
  mountedOptic: WeaponEntry['mountedOptic'];
  sight: THREE.Vector3;
  optic: OpticData | null;
} {
  const { optic: opticId, ironSights } = config;
  if (!isAttachmentConfig(config, model.id))
    throw new Error(
      `[weapons] incompatible attachments: ${model.id}, optic=${opticId}, ironSights=${ironSights}`
    );
  // Validate every requested asset/datum before changing any installed visibility.
  const railGroup = new THREE.Group();
  railGroup.name = 'rail_attachment';
  let railParent = model.root;
  let laserEmitter: THREE.Object3D | null = null;
  if (config.rail === 'laser') {
    if (!laser) throw new Error('[weapons] laser asset unavailable');
    railParent = requiredNode(model.root, 'MOUNT_rail');
    const instance = laser.scene.clone(true);
    instance.position.sub(laser.mount);
    laserEmitter = requiredNode(instance, 'SOCKET_laser');
    railGroup.add(instance);
  }
  const muzzleGroup = new THREE.Group();
  muzzleGroup.name = 'muzzle_attachment';
  let muzzleParent = model.root;
  let muzzleSocket: THREE.Object3D | null = null;
  const baseDevice =
    config.muzzle !== null || WEAPON_DEFS[model.id].fits?.muzzle
      ? requiredNode(model.root, 'MUZZLE_device')
      : null;
  if (config.muzzle === 'suppressor') {
    if (!suppressor) throw new Error('[weapons] suppressor asset unavailable');
    muzzleParent = requiredNode(model.root, 'MOUNT_muzzle');
    const instance = suppressor.scene.clone(true);
    instance.position.sub(suppressor.mount);
    muzzleSocket = requiredNode(instance, 'SOCKET_muzzle');
    muzzleGroup.add(instance);
  }
  const irons = ironSightNodes(model);
  const group = new THREE.Group();
  group.name = 'attachments';
  let parent = model.root;
  let mountedOptic: WeaponEntry['mountedOptic'] = null;
  const sight = new THREE.Vector3().fromArray(model.nodes.sight);
  let optic: OpticData | null = 'opticGlass' in model.nodes ? model.nodes.opticGlass : null;
  if (opticId !== null) {
    const asset = optics[opticId];
    if (!asset) throw new Error(`[weapons] ${opticId} asset unavailable`);
    // Rest-pose mount transform, including orientation; asset mount is its origin.
    // Never read the live pose: a slide or bolt may be mid-animation here.
    const transform = model.opticMountRest;
    if (!transform) throw new Error(`[weapons] ${model.id} has no optic mount`);
    // Look the node up under this rig, where the datum was captured: inspection mounts on a clone.
    const mount = requiredNode(model.root, 'MOUNT_optic');
    const instance = asset.scene.clone(true);
    instance.position.sub(asset.mount);
    // Keep the instance in mount-local space so slide/cover/bone animation
    // remains authoritative. Only the ADS datum is resolved in rig space.
    parent = mount;
    group.add(instance);
    mountedOptic = { mount, sight: asset.sight.clone().sub(asset.mount) };
    sight.copy(mountedOptic.sight).applyMatrix4(transform);
    optic = { ...OPTICS[opticId].optic, center: sight.toArray() };
  }
  if (irons) {
    irons.installed.visible = ironSights;
    if (irons.removed) irons.removed.visible = !ironSights;
  }
  if (baseDevice) {
    baseDevice.visible = config.muzzle === null;
    const adapter = model.root.getObjectByName('MUZZLE_device_removed');
    if (adapter) adapter.visible = config.muzzle !== null;
  }
  return {
    group,
    parent,
    mountedOptic,
    sight,
    optic,
    railGroup,
    railParent,
    laserEmitter,
    muzzleGroup,
    muzzleParent,
    muzzleSocket,
  };
}

/** Commit a fully staged mount atomically. The effective definition is shared by
 * handling, FOV/sensitivity and fire events (audio/FX suppression). */
export function configureWeaponAttachments(
  entry: WeaponEntry,
  config: AttachmentConfig,
  optics: OpticModels,
  laser: LaserModel | null = null,
  suppressor: SuppressorModel | null = null
): void {
  const mounted = mountAttachments(entry.model, config, optics, laser, suppressor);
  releaseAttachmentMount(entry.attachmentGroup);
  releaseAttachmentMount(entry.railGroup);
  releaseAttachmentMount(entry.muzzleGroup);
  entry.muzzleGroup = mounted.muzzleGroup;
  entry.muzzleSocket = mounted.muzzleSocket;
  if (mounted.muzzleSocket) mounted.muzzleParent.add(mounted.muzzleGroup);
  entry.railGroup = mounted.railGroup;
  entry.laserEmitter = mounted.laserEmitter;
  mounted.railParent.add(mounted.railGroup);
  entry.attachmentGroup = mounted.group;
  entry.mountedOptic = mounted.mountedOptic;
  mounted.parent.add(mounted.group);
  entry.attachments = Object.freeze({ ...config });
  entry.sight.copy(mounted.sight);
  entry.optic = mounted.optic;
  const base = WEAPON_DEFS[entry.id];
  const attached = config.optic === null ? null : OPTICS[config.optic];
  entry.def.eyeRelief =
    config.optic === null
      ? base.eyeRelief
      : (base.fits?.optic?.[config.optic]?.eyeRelief ?? base.eyeRelief);
  // Legacy integrated cans remain until their base-weapon conversion lands.
  entry.def.suppressed = base.suppressed ?? false;
  entry.def.attachments = entry.attachments;
  const fov = attached ? attached.adsFovScale : base.adsFovScale;
  const sensitivity = attached ? attached.adsSensScale : base.adsSensScale;
  if (fov === undefined) delete entry.def.adsFovScale;
  else entry.def.adsFovScale = fov;
  if (sensitivity === undefined) delete entry.def.adsSensScale;
  else entry.def.adsSensScale = sensitivity;
}

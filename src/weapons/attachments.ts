import * as THREE from 'three';
import type { GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js';
import type { Renderer } from 'three/webgpu';

import { hasOwn, isRecord } from '../core/guards.ts';
import { isGroup, isMesh } from '../core/three-guards.ts';
import { loadWeaponGLTF } from './asset-loader.ts';
import {
  convertWeaponScene,
  disposeWeaponMaterials,
  type WeaponSceneMaterials,
} from './asset-material.ts';
import { requiredNode } from './authored-model.ts';
import { WEAPON_DEFS, type WeaponId } from './defs.ts';
import type { OpticData, WeaponEntry, WeaponModelRecord } from './runtime-types.ts';

const OPTIC_IDS = ['rmr', 'acog', 'scope'] as const;
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
    /** Lens material (by source-name prefix): the overlay owns the magnified picture,
     * so glass keeps thin alpha and never adds a full-scene transmission pass. */
    glass: {
      prefix: string;
      opacity: number;
      tint?: { rgb: [number, number, number]; roughness: number; specularIntensity: number };
    };
  }
> = {
  rmr: {
    adsFovScale: 0.62,
    adsSensScale: 0.62,
    optic: { apertureR: 0.0055, dotMoa: 3.25, minDotPixels: 5, dotOpacity: 0.9 },
    glass: { prefix: '10 |', opacity: 0.13 },
  },
  acog: {
    adsFovScale: 0.28,
    adsSensScale: 0.28,
    optic: { kind: 'scope', reticle: 'chevron', apertureR: 0.0137 },
    glass: {
      prefix: '11 |',
      opacity: 0.1,
      tint: { rgb: [0.035, 0.075, 0.085], roughness: 0.12, specularIntensity: 0.25 },
    },
  },
  scope: {
    adsFovScale: 0.25,
    adsSensScale: 0.25,
    optic: { kind: 'scope', reticle: 'p4fl' },
    glass: { prefix: '10 |', opacity: 0.13 },
  },
};

/** The owned asset releases shared geometry and finishes; instances never do. */
function disposeAttachmentAsset(scene: THREE.Group, finishes: WeaponSceneMaterials): void {
  scene.removeFromParent();
  const geometries = new Set<THREE.BufferGeometry>();
  scene.traverse((node): void => {
    node.dispose();
    if (isMesh(node)) geometries.add(node.geometry);
  });
  for (const geometry of geometries) geometry.dispose();
  disposeWeaponMaterials(finishes);
}

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
  const { glass } = OPTICS[id];
  const finishes = convertWeaponScene(scene, (source, material): void => {
    if (!source.name.startsWith(glass.prefix)) return;
    material.transmission = 0;
    material.transparent = true;
    material.opacity = glass.opacity;
    material.depthWrite = false;
    material.side = THREE.DoubleSide;
    if (glass.tint) {
      material.color.setRGB(...glass.tint.rgb);
      material.metalness = 0;
      material.roughness = glass.tint.roughness;
      material.specularIntensity = glass.tint.specularIntensity;
    }
  });
  return { scene, mount, sight, dispose: (): void => disposeAttachmentAsset(scene, finishes) };
}
type OpticModel = ReturnType<typeof makeOpticModel>;

/** Owned rigid attachment with an authored `SOCKET_mount` origin and an output socket. */
function makeRigidAttachment(
  gltf: GLTF,
  output: string
): {
  scene: THREE.Group;
  mount: THREE.Vector3;
  output: string;
  dispose(): void;
} {
  const scene = gltf.scene;
  scene.updateMatrixWorld(true);
  const mount = requiredNode(scene, 'SOCKET_mount').getWorldPosition(new THREE.Vector3());
  requiredNode(scene, output);
  const finishes = convertWeaponScene(scene);
  return { scene, mount, output, dispose: (): void => disposeAttachmentAsset(scene, finishes) };
}
type RigidAttachmentModel = ReturnType<typeof makeRigidAttachment>;

/** TOR Mini: `SOCKET_laser` is the beam emitter. */
export function makeLaserModel(gltf: GLTF): RigidAttachmentModel {
  return makeRigidAttachment(gltf, 'SOCKET_laser');
}

/** Suppressor: `SOCKET_muzzle` is the endcap bore exit. */
export function makeSuppressorModel(gltf: GLTF): RigidAttachmentModel {
  return makeRigidAttachment(gltf, 'SOCKET_muzzle');
}

/** Loaded assets keyed by attachment id; a missing entry makes that attachment unavailable. */
export type AttachmentAssets = Partial<
  Record<OpticId, OpticModel> & Record<RailId | MuzzleId, RigidAttachmentModel>
>;

/** Load every attachment in parallel; a failure only makes that attachment unavailable. */
export async function loadAttachments(
  renderer: Pick<Renderer, 'hasFeature'>
): Promise<AttachmentAssets> {
  const assets: AttachmentAssets = {};
  const load = async <K extends keyof AttachmentAssets>(
    id: K,
    make: (gltf: GLTF) => Required<AttachmentAssets>[K]
  ): Promise<void> => {
    try {
      assets[id] = make(await loadWeaponGLTF(renderer, `/models/attachments/${id}.runtime.glb`));
    } catch (err: unknown) {
      console.error(`[weapons] ${id} attachment load failed`, err);
    }
  };
  await Promise.all([
    ...OPTIC_IDS.map((id): Promise<void> =>
      load(id, (gltf): OpticModel => makeOpticModel(gltf, id))
    ),
    load('laser', makeLaserModel),
    load('suppressor', makeSuppressorModel),
  ]);
  return assets;
}

/** Whether every installed slot's asset loaded; fit validity is `isAttachmentConfig`. */
export function hasAttachmentAssets(config: AttachmentConfig, assets: AttachmentAssets): boolean {
  return [config.optic, config.rail, config.muzzle].every(
    (id): boolean => id === null || assets[id] !== undefined
  );
}

const SLOTS = ['optic', 'rail', 'muzzle'] as const;

/** Mounted instance groups, one per slot; an empty group has no parent. */
interface AttachmentMounts {
  attachmentGroup: THREE.Group;
  railGroup: THREE.Group;
  muzzleGroup: THREE.Group;
}

function releaseAttachmentMount(group: THREE.Group): void {
  group.removeFromParent();
  group.traverse((node): void => node.dispose());
  group.clear();
}

/** Release instance transforms only; geometry/finishes stay with the owned assets. */
export function releaseAttachmentMounts(mounts: AttachmentMounts): void {
  releaseAttachmentMount(mounts.attachmentGroup);
  releaseAttachmentMount(mounts.railGroup);
  releaseAttachmentMount(mounts.muzzleGroup);
}

/** Release the mounts copied along with a configured weapon scene clone. */
export function releaseClonedMounts(root: THREE.Object3D): void {
  for (const slot of SLOTS) {
    const group = root.getObjectByName(`${slot}_attachment`);
    if (isGroup(group)) releaseAttachmentMount(group);
  }
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

/** Stage one slot's instance for the weapon's authored `MOUNT_<slot>`, with the asset's
 * mount datum at its origin, and resolve the instance's output socket (if any).
 * Mount-local instances keep slide/cover/bone animation authoritative. Nothing is attached here. */
function stageMount(
  model: WeaponModelRecord,
  slot: (typeof SLOTS)[number],
  id: OpticId | RailId | MuzzleId | null,
  asset: { scene: THREE.Group; mount: THREE.Vector3; output?: string } | null | undefined
): { group: THREE.Group; parent: THREE.Object3D | null; socket: THREE.Object3D | null } {
  const group = new THREE.Group();
  group.name = `${slot}_attachment`;
  if (id === null) return { group, parent: null, socket: null };
  if (!asset) throw new Error(`[weapons] ${id} asset unavailable`);
  // Look the node up under this rig, not the source: inspection mounts on a clone.
  const parent = requiredNode(model.root, `MOUNT_${slot}`);
  const instance = asset.scene.clone(true);
  instance.position.sub(asset.mount);
  group.add(instance);
  const socket = asset.output === undefined ? null : requiredNode(instance, asset.output);
  return { group, parent, socket };
}

/** Shared gameplay/inspection mount solver, run only when configuration changes.
 * Every asset/datum is validated before anything is attached or hidden. */
export function mountAttachments(
  model: WeaponModelRecord,
  config: AttachmentConfig,
  assets: AttachmentAssets
): AttachmentMounts & {
  laserEmitter: THREE.Object3D | null;
  muzzleSocket: THREE.Object3D | null;
  mountedOptic: WeaponEntry['mountedOptic'];
  sight: THREE.Vector3;
  optic: OpticData | null;
} {
  const { optic: opticId, ironSights } = config;
  if (!isAttachmentConfig(config, model.id))
    throw new Error(
      `[weapons] incompatible attachments: ${model.id}, optic=${opticId}, ironSights=${ironSights}`
    );
  const opticAsset = opticId && assets[opticId];
  const opticSlot = stageMount(model, 'optic', opticId, opticAsset);
  const rail = stageMount(model, 'rail', config.rail, config.rail && assets[config.rail]);
  const muzzle = stageMount(model, 'muzzle', config.muzzle, config.muzzle && assets[config.muzzle]);
  const baseDevice =
    config.muzzle !== null || WEAPON_DEFS[model.id].fits?.muzzle
      ? requiredNode(model.root, 'MUZZLE_device')
      : null;
  const irons = ironSightNodes(model);
  let mountedOptic: WeaponEntry['mountedOptic'] = null;
  const sight = new THREE.Vector3().fromArray(model.nodes.sight);
  let optic: OpticData | null = null;
  if (opticId !== null && opticAsset && opticSlot.parent) {
    // Only the ADS datum is resolved in rig space, from the rest-pose mount transform
    // (including orientation). Never the live pose: a slide or bolt may be mid-animation.
    const transform = model.opticMountRest;
    if (!transform) throw new Error(`[weapons] ${model.id} has no optic mount`);
    mountedOptic = {
      mount: opticSlot.parent,
      sight: opticAsset.sight.clone().sub(opticAsset.mount),
    };
    sight.copy(mountedOptic.sight).applyMatrix4(transform);
    optic = { ...OPTICS[opticId].optic, center: sight.toArray() };
  }
  // Staging succeeded: attach instances and switch the replaced base parts.
  opticSlot.parent?.add(opticSlot.group);
  rail.parent?.add(rail.group);
  muzzle.parent?.add(muzzle.group);
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
    attachmentGroup: opticSlot.group,
    railGroup: rail.group,
    muzzleGroup: muzzle.group,
    laserEmitter: rail.socket,
    muzzleSocket: muzzle.socket,
    mountedOptic,
    sight,
    optic,
  };
}

/** Commit a fully staged mount atomically. The effective definition is shared by
 * handling, FOV/sensitivity and fire events (audio/FX suppression). */
export function configureWeaponAttachments(
  entry: WeaponEntry,
  config: AttachmentConfig,
  assets: AttachmentAssets
): void {
  const mounted = mountAttachments(entry.model, config, assets);
  releaseAttachmentMounts(entry);
  entry.attachmentGroup = mounted.attachmentGroup;
  entry.railGroup = mounted.railGroup;
  entry.muzzleGroup = mounted.muzzleGroup;
  entry.laserEmitter = mounted.laserEmitter;
  entry.muzzleSocket = mounted.muzzleSocket;
  entry.mountedOptic = mounted.mountedOptic;
  entry.attachments = Object.freeze({ ...config });
  entry.sight.copy(mounted.sight);
  entry.optic = mounted.optic;
  const base = WEAPON_DEFS[entry.id];
  const attached = config.optic === null ? null : OPTICS[config.optic];
  entry.def.eyeRelief =
    config.optic === null
      ? base.eyeRelief
      : (base.fits?.optic?.[config.optic]?.eyeRelief ?? base.eyeRelief);
  entry.def.suppressed = config.muzzle === 'suppressor';
  const fov = attached ? attached.adsFovScale : base.adsFovScale;
  const sensitivity = attached ? attached.adsSensScale : base.adsSensScale;
  if (fov === undefined) delete entry.def.adsFovScale;
  else entry.def.adsFovScale = fov;
  if (sensitivity === undefined) delete entry.def.adsSensScale;
  else entry.def.adsSensScale = sensitivity;
}

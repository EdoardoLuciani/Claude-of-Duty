import * as THREE from 'three';
import type { GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js';
import type { Renderer } from 'three/webgpu';

import { disposeMaterials } from '../core/dispose-materials.ts';
import { isGroup, isMesh } from '../core/three-guards.ts';
import { loadWeaponGLTF } from './asset-loader.ts';
import { convertWeaponScene, type WeaponSceneMaterials } from './asset-material.ts';
import {
  CAN_MODELS,
  fittedCan,
  isAttachmentConfig,
  OPTIC_IDS,
  OPTICS,
  SLOTS,
  type AttachmentConfig,
  type CanModel,
  type OpticId,
  type RailId,
} from './attachment-rules.ts';
import { requiredNode } from './authored-model.ts';
import { WEAPON_DEFS, type WeaponId } from './defs.ts';
import type { WeaponEntry, WeaponModelRecord } from './runtime-types.ts';

/** MIL-STD-1913 groove pitch (tools/blender/picatinny.py): one `railSlots` step. */
const PICATINNY_PITCH = 0.394 * 0.0254;

/** The owned asset releases shared geometry and finishes; instances never do. */
function disposeAttachmentAsset(scene: THREE.Group, finishes: WeaponSceneMaterials): void {
  scene.removeFromParent();
  const geometries = new Set<THREE.BufferGeometry>();
  scene.traverse((node): void => {
    node.dispose();
    if (isMesh(node)) geometries.add(node.geometry);
  });
  for (const geometry of geometries) geometry.dispose();
  disposeMaterials(finishes);
}

/** One owned asset; mounted/inspection instances borrow its geometry and finishes. */
function makeOpticModel(
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

/** Owned rigid attachment with an authored `SOCKET_mount` origin and an output socket:
 * `SOCKET_laser` (TOR Mini beam emitter) or `SOCKET_muzzle` (can endcap bore exit). */
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

/** Loaded assets keyed by optic/rail id or can model; a missing entry makes it unavailable. */
export type AttachmentAssets = Partial<
  Record<OpticId, OpticModel> & Record<RailId | CanModel, RigidAttachmentModel>
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
      assets[id] = make(await loadWeaponGLTF(renderer, `models/attachments/${id}.runtime.glb`));
    } catch (err: unknown) {
      console.error(`[weapons] ${id} attachment load failed`, err);
    }
  };
  await Promise.all([
    ...OPTIC_IDS.map((id): Promise<void> =>
      load(id, (gltf): OpticModel => makeOpticModel(gltf, id))
    ),
    load('laser', (gltf): RigidAttachmentModel => makeRigidAttachment(gltf, 'SOCKET_laser')),
    ...CAN_MODELS.map((id): Promise<void> =>
      load(id, (gltf): RigidAttachmentModel => makeRigidAttachment(gltf, 'SOCKET_muzzle'))
    ),
  ]);
  return assets;
}

/** Whether every installed slot's asset loaded; fit validity is `isAttachmentConfig`. */
export function hasAttachmentAssets(
  id: WeaponId,
  config: AttachmentConfig,
  assets: AttachmentAssets
): boolean {
  const can = fittedCan(id, config.muzzle);
  return (
    (config.optic === null || assets[config.optic] !== undefined) &&
    (config.rail === null || assets[config.rail] !== undefined) &&
    (can === null || (can !== undefined && assets[can] !== undefined))
  );
}

/** Mounted instance groups, one per slot; an empty group has no parent. */
interface AttachmentMounts {
  opticGroup: THREE.Group;
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
  releaseAttachmentMount(mounts.opticGroup);
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

const REPLACED = {
  optic: ['removableIrons', 'IRON_sights'],
  muzzle: ['removableMuzzleDevice', 'MUZZLE_device'],
} as const;

type SlotVisuals = { bare: THREE.Object3D; fitted: THREE.Object3D | undefined };

/** Authored hardware whose visibility follows the slot, excluding permanent parts. */
export function slotVisuals(
  model: WeaponModelRecord,
  slot: (typeof SLOTS)[number]
): SlotVisuals | undefined {
  if (slot === 'rail') return;
  const [flag, name] = REPLACED[slot];
  if (!WEAPON_DEFS[model.id][flag]) return;
  return {
    bare: requiredNode(model.scene, name),
    fitted: model.scene.getObjectByName(`${name}_removed`),
  };
}

/** Stage one slot's instance for the weapon's authored `MOUNT_<slot>`, with the asset's
 * mount datum at its origin, and resolve the instance's output socket (if any).
 * Mount-local instances keep slide/cover/bone animation authoritative. Nothing is attached here. */
function stageMount(
  model: WeaponModelRecord,
  slot: (typeof SLOTS)[number],
  id: keyof AttachmentAssets | null,
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
} {
  const { optic: opticId } = config;
  if (!isAttachmentConfig(config, model.id))
    throw new Error(`[weapons] incompatible attachments: ${model.id} ${JSON.stringify(config)}`);
  const opticAsset = opticId && assets[opticId];
  const opticSlot = stageMount(model, 'optic', opticId, opticAsset);
  // Select physical grooves along the rail, never a vertical seating correction.
  const slots = opticId ? (WEAPON_DEFS[model.id].fits?.optic?.[opticId]?.railSlots ?? 0) : 0;
  opticSlot.group.position.z = -slots * PICATINNY_PITCH;
  const rail = stageMount(model, 'rail', config.rail, config.rail && assets[config.rail]);
  // isAttachmentConfig guarantees a fitted can for any installed muzzle.
  const can = fittedCan(model.id, config.muzzle) ?? null;
  const muzzle = stageMount(model, 'muzzle', can, can && assets[can]);
  const visuals = SLOTS.map((slot): SlotVisuals | undefined => slotVisuals(model, slot));
  let mountedOptic: WeaponEntry['mountedOptic'] = null;
  const sight = new THREE.Vector3().fromArray(model.nodes.sight);
  if (opticId !== null && opticAsset && opticSlot.parent) {
    // Only the ADS datum is resolved in the weapon frame, from the rest-pose mount transform
    // (including orientation). Never the live pose: a slide or bolt may be mid-animation.
    const transform = model.opticMountRest;
    if (!transform) throw new Error(`[weapons] ${model.id} has no optic mount`);
    mountedOptic = {
      mount: opticSlot.parent,
      sight: opticAsset.sight.clone().sub(opticAsset.mount).add(opticSlot.group.position),
      optic: OPTICS[opticId].optic,
    };
    sight.copy(mountedOptic.sight).applyMatrix4(transform);
  }
  // Staging succeeded: attach instances and switch the slot hardware.
  opticSlot.parent?.add(opticSlot.group);
  rail.parent?.add(rail.group);
  muzzle.parent?.add(muzzle.group);
  for (const [i, slot] of SLOTS.entries()) {
    const nodes = visuals[i];
    if (!nodes) continue;
    const fitted = config[slot] !== null;
    nodes.bare.visible = !fitted;
    if (nodes.fitted) nodes.fitted.visible = fitted;
  }
  return {
    opticGroup: opticSlot.group,
    railGroup: rail.group,
    muzzleGroup: muzzle.group,
    laserEmitter: rail.socket,
    muzzleSocket: muzzle.socket,
    mountedOptic,
    sight,
  };
}

/** Commit a fully staged mount atomically: instances, sockets and the ADS datum. */
export function configureWeaponAttachments(
  entry: WeaponEntry,
  config: AttachmentConfig,
  assets: AttachmentAssets
): void {
  const mounted = mountAttachments(entry.model, config, assets);
  releaseAttachmentMounts(entry);
  entry.opticGroup = mounted.opticGroup;
  entry.railGroup = mounted.railGroup;
  entry.muzzleGroup = mounted.muzzleGroup;
  entry.laserEmitter = mounted.laserEmitter;
  entry.muzzleSocket = mounted.muzzleSocket ?? entry.baseMuzzleSocket;
  entry.mountedOptic = mounted.mountedOptic;
  entry.sight.copy(mounted.sight);
  const { def } = entry;
  entry.eyeRelief = (config.optic && def.fits?.optic?.[config.optic]?.eyeRelief) ?? def.eyeRelief;
}

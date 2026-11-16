import * as THREE from 'three';

import type { AttachmentAssets } from '../../src/weapons/attachments.ts';
import { requiredNode } from '../../src/weapons/authored-model.ts';
import { WEAPON_DEFS, type WeaponId } from '../../src/weapons/defs.ts';
import type { WeaponEntry, WeaponModelRecord } from '../../src/weapons/runtime-types.ts';
import { fixture } from './fixture.ts';

type Assets = Required<AttachmentAssets>;

/** Named empty datums, as authored in attachment and weapon GLBs. */
export function datums(...names: string[]): THREE.Group {
  const scene = new THREE.Group();
  for (const name of names) scene.add(Object.assign(new THREE.Object3D(), { name }));
  return scene;
}

function datum(scene: THREE.Object3D, name: string): THREE.Vector3 {
  scene.updateMatrixWorld(true);
  return requiredNode(scene, name).getWorldPosition(new THREE.Vector3());
}

/** Owned optic record without a GLB: `MOUNT_base` and `SOCKET_sight` datums. */
export function opticAsset(scene = datums('MOUNT_base', 'SOCKET_sight')): Assets['rmr'] {
  const mount = datum(scene, 'MOUNT_base');
  return { scene, mount, sight: datum(scene, 'SOCKET_sight'), dispose(): void {} };
}

/** Owned rigid (laser/can) record: `SOCKET_mount` plus its output socket. */
export function rigidAsset(
  output: 'SOCKET_laser' | 'SOCKET_muzzle',
  scene = datums('SOCKET_mount', output)
): Assets['laser'] {
  return { scene, mount: datum(scene, 'SOCKET_mount'), output, dispose(): void {} };
}

/** Attachment fields of a weapon entry whose scene has every mount and removable part. */
export function mountableWeapon(
  id: WeaponId
): Pick<
  WeaponEntry,
  | 'model'
  | 'eyeRelief'
  | 'opticGroup'
  | 'railGroup'
  | 'muzzleGroup'
  | 'baseMuzzleSocket'
  | 'muzzleSocket'
  | 'laserEmitter'
  | 'mountedOptic'
  | 'sight'
> {
  const scene = datums(
    'IRON_sights',
    'MUZZLE_device',
    'MOUNT_optic',
    'MOUNT_rail',
    'MOUNT_muzzle',
    'SOCKET_muzzle'
  );
  const model = fixture<WeaponModelRecord>({
    scene,
    root: scene,
    opticMountRest: new THREE.Matrix4(),
    nodes: fixture<WeaponModelRecord['nodes']>({ sight: [0, 0.14, 0.03] }),
  });
  // The record union rejects a WeaponId-typed literal; assign it on the fixture instead.
  model.id = id;
  return {
    model,
    eyeRelief: WEAPON_DEFS[id].eyeRelief,
    opticGroup: new THREE.Group(),
    railGroup: new THREE.Group(),
    muzzleGroup: new THREE.Group(),
    baseMuzzleSocket: requiredNode(scene, 'SOCKET_muzzle'),
    muzzleSocket: requiredNode(scene, 'SOCKET_muzzle'),
    laserEmitter: null,
    mountedOptic: null,
    sight: new THREE.Vector3(),
  };
}

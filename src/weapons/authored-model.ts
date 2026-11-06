import * as THREE from 'three';
import type { GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js';

import type { WeaponSceneMaterials } from './asset-material.ts';
import type { WeaponId } from './defs.ts';

/** Required authored nodes, never a procedural fallback. */
export function requiredNode(root: THREE.Object3D, name: string): THREE.Object3D {
  const node = root.getObjectByName(name);
  if (!node) throw new Error(`[${root.name}] missing ${name}`);
  return node;
}

export function authoredModel(
  gltf: GLTF,
  rigName: string,
  required: readonly string[],
  scene: THREE.Object3D = gltf.scene
): {
  root: THREE.Object3D;
  animations: THREE.AnimationClip[];
  point: (name: string) => [number, number, number];
} {
  scene.updateMatrixWorld(true);
  const root = requiredNode(scene, rigName);
  const animations = required.map((name): THREE.AnimationClip => {
    const clip = gltf.animations.find((clip): boolean => clip.name === name);
    if (!clip) throw new Error(`[${rigName}] missing ${name} clip`);
    return clip;
  });
  const point = (name: string): [number, number, number] => {
    const p = requiredNode(root, name).getWorldPosition(new THREE.Vector3());
    return [p.x, p.y, p.z];
  };
  return { root, animations, point };
}

/** Common adapter product; each weapon retains its exact nodes and hand poses. */
export interface AuthoredModelData<
  Id extends WeaponId,
  Nodes extends AuthoredNodes,
> extends WeaponSceneMaterials {
  id: Id;
  scene: THREE.Group;
  root: THREE.Object3D;
  animations: THREE.AnimationClip[];
  nodes: Nodes;
  shell: { caseLen: number; rimR: number };
  magSize: { len: number };
}

export interface AuthoredNodes {
  muzzle: [number, number, number];
  eject: [number, number, number];
  sight: [number, number, number];
  ejectDir: number[];
  gripR: { pos: number[]; finger: number[]; back: number[] };
  gripL: { pos: number[]; finger: number[]; back: number[] };
  magSeat: { pos: number[]; rot: number[] };
}

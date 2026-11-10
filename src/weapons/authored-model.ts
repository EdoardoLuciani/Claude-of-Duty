import * as THREE from 'three';
import type { GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js';

import { hasOwn } from '../core/guards.ts';
import type { WeaponSceneMaterials } from './asset-material.ts';
import type { WeaponId } from './defs.ts';

/** Required authored nodes, never a procedural fallback. */
export function requiredNode(root: THREE.Object3D, name: string): THREE.Object3D {
  const node = root.getObjectByName(name);
  if (!node) throw new Error(`[${root.name}] missing ${name}`);
  return node;
}

/** Authored clip lengths from a weapon manifest; glTF itself stores none. */
type AuthoredClips = Readonly<Record<string, { readonly duration: number }>>;

/**
 * three infers a clip's duration from its last key, which must match the authored length
 * so lost or drifted animation fails at load instead of playing wrong. Idle is a single
 * pose authored as 0 s.
 */
export function checkAuthoredDuration(
  clip: THREE.AnimationClip,
  authored: AuthoredClips,
  rigName: string
): void {
  const expected = hasOwn(authored, clip.name) ? authored[clip.name]?.duration : undefined;
  // Only the Idle pose may be 0 s; a 0 s gesture would load as a clip that never plays.
  if (expected === undefined || !(expected > 0 || (expected === 0 && clip.name === 'Idle')))
    throw new Error(`[${rigName}] no authored duration for ${clip.name}`);
  if (clip.tracks.length === 0) throw new Error(`[${rigName}] ${clip.name} has no tracks`);
  // Key times are float32: allow one float32 step of rounding (it grows with the length),
  // never less than 1e-6. The inverted comparison also rejects NaN.
  if (!(Math.abs(clip.duration - expected) <= Math.max(1e-6, expected * 2 ** -23)))
    throw new Error(`[${rigName}] ${clip.name} lasts ${clip.duration} s, authored ${expected} s`);
}

export function authoredModel(
  gltf: GLTF,
  rigName: string,
  required: readonly string[],
  authored: AuthoredClips,
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
    checkAuthoredDuration(clip, authored, rigName);
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

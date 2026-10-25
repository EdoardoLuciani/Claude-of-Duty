import * as THREE from 'three';
import type { GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js';

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

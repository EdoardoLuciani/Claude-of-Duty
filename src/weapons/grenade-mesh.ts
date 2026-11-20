import * as THREE from 'three';
import type { Renderer } from 'three/webgpu';

import { disposeMaterials } from '../core/dispose-materials.ts';
import { isMesh } from '../core/three-guards.ts';
import { loadWeaponGLTF } from './asset-loader.ts';
import { convertWeaponScene } from './asset-material.ts';

export interface GrenadeAsset {
  instantiate(): THREE.Mesh;
  dispose(): void;
}

/** The held and world visuals borrow one static exterior mesh and finish. */
export async function loadGrenade(renderer: Renderer): Promise<GrenadeAsset> {
  const { scene } = await loadWeaponGLTF(renderer, '/models/weapons/m67.runtime.glb');
  const finishes = convertWeaponScene(scene);
  const mesh = scene.children.at(0);
  mesh?.updateMatrix();
  if (
    scene.children.length !== 1 ||
    !isMesh(mesh) ||
    mesh.name !== 'MESH_grenade' ||
    mesh.children.length !== 0 ||
    !mesh.matrix.equals(new THREE.Matrix4())
  ) {
    scene.traverse((node): void => {
      if (isMesh(node)) node.geometry.dispose();
    });
    disposeMaterials(finishes);
    throw new Error('[weapons] M67: expected one untransformed MESH_grenade with no children');
  }
  const { geometry, material, name } = mesh;
  return {
    instantiate(): THREE.Mesh {
      const prop = new THREE.Mesh(geometry, material);
      prop.name = name;
      prop.receiveShadow = true;
      return prop;
    },
    dispose(): void {
      geometry.dispose();
      disposeMaterials(finishes);
    },
  };
}

import {
  MeshStandardMaterial,
  type Group,
  type Object3D,
  type BufferGeometry,
  type Material,
  type Mesh,
  type Texture,
} from 'three';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshBasicNodeMaterial, MeshStandardNodeMaterial } from 'three/webgpu';

import { disposeMaterials } from '../core/dispose-materials.ts';
import { isSingleMaterialMesh, isTexture } from '../core/three-guards.ts';

const URL = 'models/props/intel-case.runtime.glb';

export async function loadIntelScene(): Promise<Group> {
  const model = await new GLTFLoader().setMeshoptDecoder(MeshoptDecoder).loadAsync(URL);
  return model.scene;
}

function node(parent: Object3D, name: string): Object3D {
  const found = parent.children.find((child): boolean => child.name === name);
  if (!found) throw new Error(`[intel] missing ${name} under ${parent.name}`);
  return found;
}

function mesh(parent: Object3D, name: string): Mesh<BufferGeometry, Material> {
  const object = node(parent, name);
  if (!isSingleMaterialMesh(object)) throw new Error(`[intel] expected mesh ${object.name}`);
  return object;
}

interface IntelKit {
  root: Object3D;
  beacon: MeshBasicNodeMaterial;
  dispose(): void;
}

/** Own one GLB's resources; pooled clones share all geometry and finishes. */
export function makeKit(scene: Group): IntelKit {
  const geometries = new Set<BufferGeometry>();
  const materials = new Set<Material>();
  const textures = new Set<Texture>();
  scene.traverse((object): void => {
    if (!isSingleMaterialMesh(object)) return;
    geometries.add(object.geometry);
    materials.add(object.material);
    for (const value of Object.values(object.material)) if (isTexture(value)) textures.add(value);
  });
  const dispose = (): void => {
    for (const geometry of geometries) geometry.dispose();
    geometries.clear();
    disposeMaterials({ materials, textures });
  };
  try {
    const root = node(scene, 'INTEL_CASE');
    const lid = node(root, 'INTEL_HINGE');
    node(root, 'INTEL_SPARK');
    const body = mesh(root, 'INTEL_BODY');
    const lidMesh = mesh(lid, 'INTEL_LID');
    const finish = body.material;
    if (
      !(finish instanceof MeshStandardMaterial) ||
      lidMesh.material !== finish ||
      !finish.map ||
      !finish.roughnessMap ||
      finish.roughnessMap !== finish.metalnessMap
    ) {
      throw new Error('[intel] expected a shared PBR finish with color and packed surface maps');
    }
    // The world renderer patches node materials with room-aware indirect lighting.
    body.material = lidMesh.material = new MeshStandardNodeMaterial().copy(finish);
    materials.add(body.material);
    for (const solid of [body, lidMesh]) solid.castShadow = solid.receiveShadow = true;
    const lens = mesh(lid, 'INTEL_BEACON');
    const leds = mesh(root, 'INTEL_LEDS');
    const beacon = new MeshBasicNodeMaterial({ color: 0xff0802 });
    const status = new MeshBasicNodeMaterial({ color: 0x53ffb1 });
    beacon.name = 'Intel beacon pulse';
    status.name = 'Intel status LEDs';
    materials.add(beacon).add(status);
    lens.material = beacon;
    leds.material = status;
    lens.userData.owNoPrepass = leds.userData.owNoPrepass = true;
    return { root, beacon, dispose };
  } catch (error) {
    dispose();
    throw error;
  }
}

export function makeCrate(kit: IntelKit): Object3D & { lid: Object3D; spark: Object3D } {
  const root = kit.root.clone(true);
  const lid = node(root, 'INTEL_HINGE');
  const spark = node(root, 'INTEL_SPARK');
  root.visible = false;
  root.name = 'intel-cache';
  return Object.assign(root, { lid, spark });
}

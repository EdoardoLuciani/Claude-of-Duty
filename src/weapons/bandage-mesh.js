import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { BANDAGE_SEGMENTS } from './bandage-path.js';

/** Authored with the player arms in assets/player/arms/player-arms.blend. */
export async function loadBandage() {
  const gltf = await new GLTFLoader().loadAsync(`${import.meta.env.BASE_URL}models/player/bandage.glb`);
  const wrap = gltf.scene.getObjectByName('Bandage_wrap');
  const roll = gltf.scene.getObjectByName('Bandage_roll');
  if (!wrap?.isMesh || !roll?.isMesh || wrap.geometry.index.count !== BANDAGE_SEGMENTS * 6) {
    throw new Error('Bandage: stale Blender export (run tools/blender/player_bandage.py)');
  }
  wrap.material.side = THREE.DoubleSide;
  wrap.material.color.multiplyScalar(.38); // viewmodel's bright local fill
  wrap.material.roughness = .92;
  wrap.geometry.setDrawRange(0, 0);
  wrap.frustumCulled = false;
  roll.frustumCulled = false;
  roll.visible = false;
  // The loose section bridges the roll and the growing wrap. Deform two
  // triangles, not the entire authored strip, to follow both moving hands.
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(12), 3));
  geometry.setAttribute('uv', new THREE.BufferAttribute(new Float32Array([0, 0, 1, 0, 0, 1, 1, 1]), 2));
  geometry.setIndex([0, 1, 2, 1, 3, 2]);
  const tail = new THREE.Mesh(geometry, wrap.material);
  tail.frustumCulled = false;
  tail.visible = false;
  return { wrap, roll, tail, dispose() {
    const textures = new Set();
    for (const mat of new Set([wrap.material, roll.material])) {
      for (const value of Object.values(mat)) if (value?.isTexture) textures.add(value);
      mat.dispose();
    }
    for (const tex of textures) { tex.source?.data?.close?.(); tex.dispose(); }
    wrap.geometry.dispose();
    roll.geometry.dispose();
    geometry.dispose();
  } };
}

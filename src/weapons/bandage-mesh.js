import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { BANDAGE_SEGMENTS } from './bandage-path.js';

/** Authored with the player arms in assets/player/arms/player-arms.blend. */
export async function loadBandage() {
  const gltf = await new GLTFLoader().loadAsync(`${import.meta.env.BASE_URL}models/player/bandage.glb`);
  const wrap = gltf.scene.getObjectByName('Bandage_wrap');
  const body = gltf.scene.getObjectByName('Bandage_roll');
  const cap = gltf.scene.getObjectByName('Bandage_cap');
  if (!wrap?.isMesh || !body?.isMesh || !cap?.isMesh || wrap.geometry.index.count !== BANDAGE_SEGMENTS * 24) {
    throw new Error('Bandage: stale Blender export (run tools/blender/player_bandage.py)');
  }
  wrap.material.side = THREE.DoubleSide;
  wrap.material.color.multiplyScalar(.26); // viewmodel's bright local fill
  cap.material.color.multiplyScalar(.26);
  wrap.geometry.setDrawRange(0, 0);
  wrap.frustumCulled = false;
  body.frustumCulled = false;
  cap.frustumCulled = false;
  const roll = new THREE.Group();
  roll.position.copy(body.position);
  body.position.set(0, 0, 0);
  cap.position.set(0, 0, 0);
  roll.add(body, cap);
  // Show the coiled end to the camera, while leaving the roll between
  // opposing fingers. Spin the children about their own X axle at runtime.
  roll.rotation.y = .85;
  roll.visible = false;
  // Twelve curved sections: a tensioned free span, then a sleeve-hugging
  // arc. No diagonal polygon cutting straight through the other arm.
  const geometry = new THREE.BufferGeometry();
  const uv = new Float32Array(26 * 2);
  const index = [];
  for (let i = 0; i <= 12; i++) {
    uv[i * 4] = 0; uv[i * 4 + 1] = i / 6;
    uv[i * 4 + 2] = 1; uv[i * 4 + 3] = i / 6;
    if (i < 12) {
      const k = i * 2;
      index.push(k, k + 1, k + 2, k + 1, k + 3, k + 2);
    }
  }
  geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(26 * 3), 3));
  geometry.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(26 * 3), 3));
  geometry.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  geometry.setIndex(index);
  const tail = new THREE.Mesh(geometry, wrap.material);
  tail.frustumCulled = false;
  tail.visible = false;
  return { wrap, roll, body, cap, tail, dispose() {
    const textures = new Set();
    for (const mat of new Set([wrap.material, body.material, cap.material])) {
      for (const value of Object.values(mat)) if (value?.isTexture) textures.add(value);
      mat.dispose();
    }
    for (const tex of textures) { tex.source?.data?.close?.(); tex.dispose(); }
    wrap.geometry.dispose();
    body.geometry.dispose();
    cap.geometry.dispose();
    geometry.dispose();
  } };
}

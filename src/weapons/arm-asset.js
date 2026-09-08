import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

/** Owned by a Viewmodel, never a global cache: disposal/restart stays local. */
export async function loadArmAsset() {
  const gltf = await new GLTFLoader().loadAsync(`${import.meta.env.BASE_URL}models/player/arms.glb`);
  gltf.scene.updateMatrixWorld(true);
  const meshes = [];
  const calibrated = new Set();
  gltf.scene.traverse((o) => {
    if (!o.isSkinnedMesh) return;
    if (!o.geometry.getAttribute('skinWeight') || !o.geometry.getAttribute('skinIndex')) {
      throw new Error(`Player arms: missing skin data on ${o.name}`);
    }
    for (const mat of Array.isArray(o.material) ? o.material : [o.material]) {
      if (calibrated.has(mat)) continue;
      calibrated.add(mat);
      // Match the existing weapon exposure without crushing the authored maps.
      // This compensation belongs to the game's unusually bright view light rig,
      // not the Blender asset's physical albedo.
      mat.color.multiplyScalar(mat.name.startsWith('Olive_') ? 0.30 : 0.80);
      for (const tex of [mat.map, mat.normalMap, mat.roughnessMap]) {
        if (tex) tex.anisotropy = 8;
      }
    }
    meshes.push(o);
  });
  if (!meshes.length) throw new Error('Player arms: no deformation meshes in arms.glb');
  return { meshes, dispose() {
    const geometries = new Set();
    const materials = new Set();
    const textures = new Set();
    const skeletons = new Set();
    for (const mesh of meshes) {
      geometries.add(mesh.geometry);
      skeletons.add(mesh.skeleton);
      for (const mat of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) {
        materials.add(mat);
        for (const value of Object.values(mat)) if (value?.isTexture) textures.add(value);
      }
    }
    for (const g of geometries) g.dispose();
    for (const s of skeletons) s.dispose();
    for (const m of materials) m.dispose();
    for (const t of textures) t.dispose();
  } };
}

/** Rebind Blender weights to the gameplay contact rig in its neutral pose. */
export function bindArmAsset(arm, asset) {
  const controls = arm.controls;
  const oldPose = arm.pose;
  arm.upperPivot.position.set(0, 0, .63 * arm.scale);
  arm.forePivot.position.set(0, 0, .3 * arm.scale);
  arm.upperPivot.quaternion.identity();
  arm.forePivot.quaternion.identity();
  arm.hand.position.set(0, 0, 0);
  arm.hand.quaternion.identity();
  for (const f of arm.fingers) for (const j of f.joints) j.rotation.set(0, 0, 0);
  arm.thumb.root.rotation.set(0, -.95, 0);
  for (const j of arm.thumb.joints) j.rotation.set(0, 0, 0);
  arm.updateFlex();
  arm.root.updateWorldMatrix(true, true);
  // Source vertices are in authoring world space. Bring them into the arm's
  // bind space; reflecting positions also requires reversing triangle winding.
  const transform = new THREE.Matrix4();
  const scale = new THREE.Matrix4().makeScale(arm.side < 0 ? arm.scale : -arm.scale, arm.scale, arm.scale);
  const names = asset.meshes[0].skeleton.bones.map(b => b.name);
  const bones = names.map((name) => {
    const control = controls[name];
    if (!control) throw new Error(`Player arms: unknown Blender bone ${name}`);
    return control;
  });
  const skeleton = new THREE.Skeleton(bones, bones.map(b => b.matrixWorld.clone().invert()));
  arm.skeleton = skeleton;
  for (const source of asset.meshes) {
    if (source.skeleton.bones.length !== names.length || source.skeleton.bones.some((b, i) => b.name !== names[i])) {
      throw new Error('Player arms: inconsistent exported bone order');
    }
    const geometry = source.geometry.clone();
    transform.multiplyMatrices(scale, source.matrixWorld);
    geometry.applyMatrix4(transform);
    if (arm.side > 0) {
      const index = geometry.index;
      if (!index) throw new Error('Player arms: expected indexed Blender geometry');
      for (let i = 0; i < index.count; i += 3) {
        const a = index.getX(i);
        index.setX(i, index.getX(i + 2));
        index.setX(i + 2, a);
      }
      // Recompute tangents after reflection rather than retain wrong handedness.
      if (geometry.hasAttribute('tangent')) geometry.deleteAttribute('tangent');
    }
    const mesh = new THREE.SkinnedMesh(geometry, source.material);
    mesh.name = `${arm.root.name}-${source.name}`;
    mesh.frustumCulled = false;
    mesh.receiveShadow = true;
    mesh.userData.owNoShadow = true;
    mesh.userData.owNoPrepass = true;
    arm.root.add(mesh);
    mesh.updateWorldMatrix(true, false);
    mesh.bind(skeleton, mesh.matrixWorld);
    arm.skins.push(mesh);
  }
  arm.setPose(oldPose);
}

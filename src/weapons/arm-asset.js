import * as THREE from 'three';
import { MeshPhysicalNodeMaterial, MeshStandardNodeMaterial } from 'three/webgpu';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { createArmBlood, addArmBloodCoordinates } from './arm-blood.js';

/** Preserve glTF physical extensions (notably the authored low specular strength). */
export function createArmMaterial(source) {
  const physical = source.isMeshPhysicalMaterial;
  const mat = physical ? new MeshPhysicalNodeMaterial() : new MeshStandardNodeMaterial();
  mat.copy(source);
  mat.defines = { ...mat.defines };
  if (physical) mat.iridescenceThicknessRange = [...mat.iridescenceThicknessRange];
  return mat;
}

/** Owned by a Viewmodel, never a global cache: disposal/restart stays local. */
export async function loadArmAsset() {
  const gltf = await new GLTFLoader().loadAsync(`${import.meta.env.BASE_URL}models/player/arms.glb`);
  gltf.scene.updateMatrixWorld(true);
  const meshes = [];
  const decorated = new Set();
  const replacements = new Map();
  const blood = createArmBlood();
  gltf.scene.traverse((o) => {
    if (!o.isSkinnedMesh) return;
    if (!o.geometry.getAttribute('skinWeight') || !o.geometry.getAttribute('skinIndex')) {
      throw new Error(`Player arms: missing skin data on ${o.name}`);
    }
    const convert = source => {
      let mat = replacements.get(source);
      if (!mat) {
        mat = createArmMaterial(source);
        replacements.set(source, mat);
      }
      return mat;
    };
    o.material = Array.isArray(o.material) ? o.material.map(convert) : convert(o.material);
    for (const mat of Array.isArray(o.material) ? o.material : [o.material]) {
      if (decorated.has(mat)) continue;
      decorated.add(mat);
      // Preserve authored reflectance; illumination belongs to the renderer.
      // Glove seams share stitch material, but their bind-space mask stays clean.
      if (mat.name === 'Olive_ripstop' || mat.name === 'Olive_stitch') blood.decorate(mat);
      for (const tex of [mat.map, mat.normalMap, mat.roughnessMap]) {
        if (tex) tex.anisotropy = 8;
      }
    }
    meshes.push(o);
  });
  for (const source of replacements.keys()) source.dispose();
  if (!meshes.length) throw new Error('Player arms: no deformation meshes in arms.glb');
  return { meshes, blood, dispose() {
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
    blood.texture.dispose();
    for (const g of geometries) g.dispose();
    for (const s of skeletons) s.dispose();
    for (const m of materials) m.dispose();
    const images = new Set();
    for (const t of textures) {
      if (t.source?.data?.close) images.add(t.source.data);
      t.dispose();
    }
    // Texture clones can share decoded ImageBitmaps. GPU disposal does not
    // release them, and each owned bitmap must be closed only once.
    for (const image of images) image.close();
    meshes.length = 0;
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
    if ((Array.isArray(source.material) ? source.material : [source.material])
      .some(mat => mat.name === 'Olive_ripstop' || mat.name === 'Olive_stitch')) {
      addArmBloodCoordinates(geometry, source, arm.side);
    }
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
    mesh.castShadow = false;
    mesh.userData.owNoPrepass = true;
    arm.root.add(mesh);
    mesh.updateWorldMatrix(true, false);
    mesh.bind(skeleton, mesh.matrixWorld);
    arm.skins.push(mesh);
  }
  arm.setPose(oldPose);
}

import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { attribute, normalMap, texture, varying, vec3 } from 'three/tsl';
import { MeshPhysicalNodeMaterial } from 'three/webgpu';

import { createWeaponMaterial, type WeaponSceneMaterials } from './asset-material.ts';

// Only these rigid GLTF mesh groups participate. Mechanisms, cartridges,
// magazine shells and emissive sight paint retain their independent nodes.
const PARTS = ['receiver_mesh', 'handguard_mesh', 'stock_mesh'];
const FINISH_FIELDS = new Set([
  'id',
  'uuid',
  'name',
  'version',
  '_listeners',
  'color',
  'roughness',
  'metalness',
  'normalScale',
  'map',
]);

function sameValue(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (a instanceof THREE.Color && b instanceof THREE.Color) return a.equals(b);
  if (a instanceof THREE.Vector2 && b instanceof THREE.Vector2) return a.equals(b);
  if (a instanceof THREE.Euler && b instanceof THREE.Euler) return a.equals(b);
  if (Array.isArray(a) && Array.isArray(b))
    return a.length === b.length && a.every((v, i) => sameValue(v, b[i]));
  if (
    a &&
    b &&
    Object.getPrototypeOf(a) === Object.prototype &&
    Object.getPrototypeOf(b) === Object.prototype
  ) {
    const left = a as Record<string, unknown>,
      right = b as Record<string, unknown>;
    return (
      Object.keys(left).length === Object.keys(right).length &&
      Object.keys(left).every((key) => sameValue(left[key], right[key]))
    );
  }
  return false;
}

/** Anything not represented by the finish attributes must remain identical,
 * including shared map identity/UV transforms and native physical extensions.
 * Changed authoring that doesn't fit this seam simply retains its old draws. */
function compatible(a: MeshPhysicalNodeMaterial, b: MeshPhysicalNodeMaterial): boolean {
  const left = a as unknown as Record<string, unknown>;
  const right = b as unknown as Record<string, unknown>;
  return (
    !a.transparent &&
    !b.transparent &&
    a.opacity === 1 &&
    b.opacity === 1 &&
    a.alphaTest === 0 &&
    b.alphaTest === 0 &&
    !a.alphaHash &&
    !a.alphaToCoverage &&
    !a.vertexColors &&
    !b.vertexColors &&
    !a.colorNode &&
    !a.roughnessNode &&
    !a.metalnessNode &&
    !a.normalNode &&
    a.normalMapType === THREE.TangentSpaceNormalMap &&
    Object.keys(left).every((key) => FINISH_FIELDS.has(key) || sameValue(left[key], right[key])) &&
    Object.keys(right).every((key) => key in left || FINISH_FIELDS.has(key))
  );
}

/** Slice indexed accessor ranges before concatenation: GLTFLoader can expose
 * an entire shared vertex accessor for a primitive using only a subrange. */
function finishGeometry(
  mesh: THREE.Mesh<THREE.BufferGeometry, MeshPhysicalNodeMaterial>,
  mapIndex: number
) {
  const source = mesh.geometry;
  const index = source.index!;
  let first = Infinity,
    last = -1;
  for (let i = 0; i < index.count; i++) {
    const vertex = index.getX(i);
    first = Math.min(first, vertex);
    last = Math.max(last, vertex);
  }
  const geometry = new THREE.BufferGeometry();
  for (const [name, attr] of Object.entries(source.attributes)) {
    const array = (attr as THREE.BufferAttribute).array.slice(
      first * attr.itemSize,
      (last + 1) * attr.itemSize
    );
    geometry.setAttribute(name, new THREE.BufferAttribute(array, attr.itemSize, attr.normalized));
  }
  geometry.setIndex(Array.from({ length: index.count }, (_, i) => index.getX(i) - first));
  const count = last - first + 1,
    m = mesh.material;
  const colors = new Float32Array(count * 3),
    finishes = new Float32Array(count * 4),
    maps = new Float32Array(count);
  for (let i = 0; i < count; i++) {
    m.color.toArray(colors, i * 3);
    finishes.set([m.roughness, m.metalness, m.normalScale.x, m.normalScale.y], i * 4);
    maps[i] = mapIndex;
  }
  geometry.setAttribute('weaponColor', new THREE.BufferAttribute(colors, 3));
  geometry.setAttribute('weaponFinish', new THREE.BufferAttribute(finishes, 4));
  geometry.setAttribute('weaponAlbedo', new THREE.BufferAttribute(maps, 1));
  return geometry;
}

export function batchM4Finishes(scene: THREE.Object3D, owned: WeaponSceneMaterials): void {
  for (const name of PARTS) {
    const part = scene.getObjectByName(name);
    if (!part || part.children.length < 2) continue;
    const meshes = part.children.filter(
      (child): child is THREE.Mesh<THREE.BufferGeometry, MeshPhysicalNodeMaterial> =>
        child instanceof THREE.Mesh &&
        !(child instanceof THREE.SkinnedMesh) &&
        child.material instanceof MeshPhysicalNodeMaterial
    );
    if (meshes.length !== part.children.length) continue;
    const first = meshes[0].material;
    if (
      !meshes.every((mesh) => {
        mesh.updateMatrix();
        const g = mesh.geometry;
        return (
          mesh.visible &&
          mesh.children.length === 0 &&
          mesh.matrix.equals(new THREE.Matrix4()) &&
          compatible(first, mesh.material) &&
          g.index &&
          g.index.count > 0 &&
          g.drawRange.start === 0 &&
          g.drawRange.count === Infinity &&
          g.groups.length === 0 &&
          Object.keys(g.morphAttributes).length === 0 &&
          Object.keys(g.attributes).sort().join(',') === 'normal,position,uv' &&
          Object.values(g.attributes).every(
            (attr) =>
              attr instanceof THREE.BufferAttribute &&
              attr.array instanceof Float32Array &&
              !attr.normalized
          )
        );
      })
    )
      continue;

    // Existing albedos, including the receiver-only bake. No texture arrays,
    // copied images or finish lookup texture are needed for these three parts.
    const maps = [...new Set(meshes.map((mesh) => mesh.material.map))];
    const pieces = meshes.map((mesh) => finishGeometry(mesh, maps.indexOf(mesh.material.map)));
    const geometry = mergeGeometries(pieces, false)!;
    for (const piece of pieces) piece.dispose();
    const material = createWeaponMaterial(first);
    const color = varying(attribute('weaponColor', 'vec3')).setInterpolation('flat');
    const finish = varying(attribute('weaponFinish', 'vec4')).setInterpolation('flat');
    const albedo = varying(attribute('weaponAlbedo', 'float')).setInterpolation('flat');
    const sample = (map: THREE.Texture | null) => (map ? texture(map).rgb : vec3(1));
    let pigment = sample(maps[0]);
    for (let i = 1; i < maps.length; i++)
      pigment = albedo.equal(i).select(sample(maps[i]), pigment);
    material.colorNode = pigment.mul(color);
    material.roughnessNode = material.roughnessMap
      ? texture(material.roughnessMap).g.mul(finish.x)
      : finish.x;
    material.metalnessNode = material.metalnessMap
      ? texture(material.metalnessMap).b.mul(finish.y)
      : finish.y;
    if (material.normalMap) {
      const mappedNormal = normalMap(texture(material.normalMap).rgb, finish.zw);
      if (
        material.normalMap.format === THREE.RGFormat ||
        material.normalMap.format === THREE.RED_GREEN_RGTC2_Format ||
        material.normalMap.format === THREE.RG11_EAC_Format
      )
        mappedNormal.unpackNormalMode = THREE.NormalRGPacking;
      material.normalNode = mappedNormal;
    }
    owned.materials.add(material);
    const batch = new THREE.Mesh(geometry, material);
    batch.name = `${name}_finishes`;
    batch.frustumCulled = false;
    batch.castShadow = false;
    batch.receiveShadow = true;
    for (const mesh of meshes) {
      // Retain authored primitive names/transforms for discovery, without hidden
      // mesh draws that boot prewarm could accidentally reveal again.
      const marker = new THREE.Object3D().copy(mesh, false);
      part.remove(mesh);
      part.add(marker);
    }
    part.add(batch);
  }
}

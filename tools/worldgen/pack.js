import * as THREE from 'three';
import { mergeGeometries, mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { MeshoptSimplifier } from 'meshoptimizer/simplifier';

const INSTANCE_COLLISION_RATIO = 0.12;
const STATIC_COLLISION_RATIO = 0.22;
const STATIC_FABRIC_COLLISION_RATIO = 0.02;
const MIN_SIMPLIFY_TRIANGLES = 24;
const MIN_COLLISION_TRIANGLES = 4;
const WELD_TOLERANCE = 1e-4;
const SIMPLIFY_ERROR_LIMIT = 1;

function triangleCount(geometry) {
  return geometry.index.count / 3;
}

function simplifyGeometry(source, ratio) {
  const geometry = source.clone();
  for (const name of Object.keys(geometry.attributes)) {
    if (name !== 'position') geometry.deleteAttribute(name);
  }
  const welded = mergeVertices(geometry, WELD_TOLERANCE);
  geometry.dispose();

  const position = welded.getAttribute('position');
  const indices = welded.getIndex().array;
  const sourceTris = indices.length / 3;
  if (sourceTris <= MIN_SIMPLIFY_TRIANGLES) return welded;

  const targetTris = Math.max(MIN_COLLISION_TRIANGLES, Math.round(sourceTris * ratio));
  const [simplified] = MeshoptSimplifier.simplify(
    indices,
    position.array,
    position.itemSize,
    targetTris * 3,
    SIMPLIFY_ERROR_LIMIT,
    []
  );
  const [remap, vertexCount] = MeshoptSimplifier.compactMesh(simplified);
  const positions = new Float32Array(vertexCount * 3);
  for (let oldIndex = 0; oldIndex < remap.length; oldIndex++) {
    const newIndex = remap[oldIndex];
    if (newIndex >= vertexCount) continue;
    positions.set(position.array.subarray(oldIndex * 3, oldIndex * 3 + 3), newIndex * 3);
  }

  welded.dispose();
  const result = new THREE.BufferGeometry();
  result.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  result.setIndex(vertexCount <= 65535
    ? new THREE.Uint16BufferAttribute(Uint16Array.from(simplified), 1)
    : new THREE.Uint32BufferAttribute(simplified, 1));
  return result;
}

export async function buildCollision(visualScene) {
  await MeshoptSimplifier.ready;
  visualScene.updateWorldMatrix(true, true);

  const scene = new THREE.Scene();
  const root = new THREE.Group();
  root.name = 'world_collision';
  scene.add(root);
  const material = new THREE.MeshBasicMaterial({ name: 'collision', visible: false });
  const staticGroups = new Map();
  const instanceMeshes = [];
  const simplified = new WeakMap();
  const local = new THREE.Matrix4();
  let collideTris = 0;

  function geometryFor(object) {
    let geometry = simplified.get(object.geometry);
    if (geometry) return geometry;
    const ratio = object.isInstancedMesh
      ? INSTANCE_COLLISION_RATIO
      : object.userData.surface === 'fabric'
        ? STATIC_FABRIC_COLLISION_RATIO
        : STATIC_COLLISION_RATIO;
    geometry = simplifyGeometry(object.geometry, ratio);
    simplified.set(object.geometry, geometry);
    return geometry;
  }

  visualScene.traverse((object) => {
    if (!object.isMesh || object.userData.surface === 'foliage') return;
    const surface = object.userData.surface;
    if (!surface) throw new Error(`[world] visual mesh ${object.name} has no collision surface`);
    const geometry = geometryFor(object);
    if (object.isInstancedMesh) {
      const mesh = new THREE.InstancedMesh(geometry, material, object.count);
      mesh.name = `collide_${object.name}`;
      mesh.userData.surface = surface;
      mesh.matrixAutoUpdate = false;
      for (let i = 0; i < object.count; i++) {
        object.getMatrixAt(i, local);
        mesh.setMatrixAt(i, local.premultiply(object.matrixWorld));
      }
      mesh.instanceMatrix.needsUpdate = true;
      mesh.computeBoundingSphere();
      mesh.updateMatrix();
      instanceMeshes.push(mesh);
      collideTris += triangleCount(geometry) * object.count;
    } else {
      const part = geometry.clone().applyMatrix4(object.matrixWorld);
      (staticGroups.get(surface) ?? staticGroups.set(surface, []).get(surface)).push(part);
    }
  });

  for (const [surface, parts] of staticGroups) {
    const geometry = parts.length === 1 ? parts[0] : mergeGeometries(parts, false);
    if (!geometry) throw new Error(`[world] could not merge collision surface ${surface}`);
    const mesh = new THREE.Mesh(geometry, material);
    mesh.name = `collide_${surface}`;
    mesh.userData.surface = surface;
    mesh.matrixAutoUpdate = false;
    mesh.updateMatrix();
    root.add(mesh);
    collideTris += triangleCount(geometry);
    if (parts.length > 1) for (const part of parts) part.dispose();
  }

  for (const mesh of instanceMeshes) root.add(mesh);
  return { scene, collideTris };
}

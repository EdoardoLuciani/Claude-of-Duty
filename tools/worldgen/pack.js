import * as THREE from 'three';
import { mergeGeometries, mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { MeshoptSimplifier } from 'meshoptimizer/simplifier';
import { solidIds } from '../../src/physics/solids.js';

const INSTANCE_COLLISION_RATIO = 0.12;
const STATIC_COLLISION_RATIO = 0.22;
const STATIC_FABRIC_COLLISION_RATIO = 0.02;
const MIN_SIMPLIFY_TRIANGLES = 24;
const MIN_COLLISION_TRIANGLES = 4;
const WELD_TOLERANCE = 1e-4;
// Collision is authored in metres. A relative limit of 1 let simplification
// bridge multi-metre shop openings and delete disconnected interior shells once
// meshes were merged across the city. Five centimetres stays well below the
// 32 cm character radius while bounding topology drift independently of map size.
const SIMPLIFY_ERROR_LIMIT_METRES = 0.05;

function triangleCount(geometry) {
  return geometry.index.count / 3;
}

function simplifyGeometry(source, ratio) {
  const geometry = source.clone();
  for (const name of Object.keys(geometry.attributes)) {
    if (name !== 'position' && name !== '_solid') geometry.deleteAttribute(name);
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
    SIMPLIFY_ERROR_LIMIT_METRES,
    ['ErrorAbsolute']
  );
  const [remap, vertexCount] = MeshoptSimplifier.compactMesh(simplified);
  const positions = new Float32Array(vertexCount * 3);
  const sourceSolids = welded.getAttribute('_solid');
  const solids = sourceSolids ? new Float32Array(vertexCount) : null;
  for (let oldIndex = 0; oldIndex < remap.length; oldIndex++) {
    const newIndex = remap[oldIndex];
    if (newIndex >= vertexCount) continue;
    positions.set(position.array.subarray(oldIndex * 3, oldIndex * 3 + 3), newIndex * 3);
    if (solids) solids[newIndex] = sourceSolids.getX(oldIndex);
  }

  welded.dispose();
  const result = new THREE.BufferGeometry();
  result.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  if (solids) result.setAttribute('_solid', new THREE.Float32BufferAttribute(solids, 1));
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
    if (!geometry.getAttribute('_solid')) {
      geometry.setAttribute('_solid', new THREE.Float32BufferAttribute(solidIds(geometry).ids, 1));
    }
    simplified.set(object.geometry, geometry);
    return geometry;
  }

  visualScene.traverse((object) => {
    if (!object.isMesh || object.userData.surface === 'foliage') return;
    const surface = object.userData.surface;
    if (!surface) throw new Error(`[world] visual mesh ${object.name} has no collision surface`);
    const geometry = geometryFor(object);
    const ballisticSurface = object.userData.ballisticSurface ?? surface;
    const sheetThickness = object.userData.sheetThickness ?? 0;
    const groupKey = `${surface}|${ballisticSurface}|${sheetThickness}`;
    if (object.isInstancedMesh) {
      const mesh = new THREE.InstancedMesh(geometry, material, object.count);
      mesh.name = `collide_${object.name}`;
      mesh.userData.surface = surface;
      mesh.userData.ballisticSurface = ballisticSurface;
      mesh.userData.sheetThickness = sheetThickness;
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
      let group = staticGroups.get(groupKey);
      if (!group) {
        group = { surface, ballisticSurface, sheetThickness, parts: [], solidCount: 0 };
        staticGroups.set(groupKey, group);
      }
      const ids = part.getAttribute('_solid');
      let count = 0;
      for (let i = 0; i < ids.count; i++) {
        const id = ids.getX(i);
        count = Math.max(count, id + 1);
        ids.setX(i, id + group.solidCount);
      }
      group.solidCount += count;
      group.parts.push(part);
    }
  });

  for (const { surface, ballisticSurface, sheetThickness, parts } of staticGroups.values()) {
    const geometry = parts.length === 1 ? parts[0] : mergeGeometries(parts, false);
    if (!geometry) throw new Error(`[world] could not merge collision surface ${surface}`);
    const mesh = new THREE.Mesh(geometry, material);
    mesh.name = `collide_${surface}`;
    mesh.userData.surface = surface;
    mesh.userData.ballisticSurface = ballisticSurface;
    mesh.userData.sheetThickness = sheetThickness;
    mesh.matrixAutoUpdate = false;
    mesh.updateMatrix();
    root.add(mesh);
    collideTris += triangleCount(geometry);
    if (parts.length > 1) for (const part of parts) part.dispose();
  }

  for (const mesh of instanceMeshes) root.add(mesh);
  return { scene, collideTris };
}

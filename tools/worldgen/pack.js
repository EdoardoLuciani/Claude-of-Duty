import * as THREE from 'three';
import { GLTFExporter } from 'three/examples/jsm/exporters/GLTFExporter.js';
import { mergeGeometries, mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { MeshoptSimplifier } from 'meshoptimizer/simplifier';

if (typeof globalThis.FileReader === 'undefined') {
  globalThis.FileReader = class {
    readAsArrayBuffer(blob) {
      blob.arrayBuffer().then((result) => {
        this.result = result;
        queueMicrotask(() => this.onloadend?.());
      });
    }
  };
}

const INSTANCE_COLLISION_RATIO = 0.12;
const STATIC_COLLISION_RATIO = 0.22;
const STATIC_FABRIC_COLLISION_RATIO = 0.02;
const MIN_SIMPLIFY_TRIANGLES = 24;
const MIN_COLLISION_TRIANGLES = 4;
const WELD_TOLERANCE = 1e-4;
const SIMPLIFY_ERROR_LIMIT = 1;

function triangleCount(geometry) {
  return (geometry.index?.count ?? geometry.getAttribute('position')?.count ?? 0) / 3;
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

  const used = new Map();
  const positions = [];
  const remapped = new Uint32Array(simplified.length);
  for (let i = 0; i < simplified.length; i++) {
    const oldIndex = simplified[i];
    let newIndex = used.get(oldIndex);
    if (newIndex === undefined) {
      newIndex = used.size;
      used.set(oldIndex, newIndex);
      positions.push(position.getX(oldIndex), position.getY(oldIndex), position.getZ(oldIndex));
    }
    remapped[i] = newIndex;
  }

  welded.dispose();
  const result = new THREE.BufferGeometry();
  result.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  result.setIndex(used.size <= 65535
    ? new THREE.Uint16BufferAttribute(Uint16Array.from(remapped), 1)
    : new THREE.Uint32BufferAttribute(remapped, 1));
  return result;
}

export async function buildCollision(visualScene) {
  await MeshoptSimplifier.ready;
  visualScene.updateWorldMatrix(true, true);

  const staticGroups = new Map();
  const instanceGroups = [];
  const simplified = new WeakMap();
  const local = new THREE.Matrix4();

  function geometryFor(object) {
    const ratio = object.isInstancedMesh
      ? INSTANCE_COLLISION_RATIO
      : object.userData.surface === 'fabric'
        ? STATIC_FABRIC_COLLISION_RATIO
        : STATIC_COLLISION_RATIO;
    let byRatio = simplified.get(object.geometry);
    if (!byRatio) {
      byRatio = new Map();
      simplified.set(object.geometry, byRatio);
    }
    let geometry = byRatio.get(ratio);
    if (!geometry) {
      geometry = simplifyGeometry(object.geometry, ratio);
      byRatio.set(ratio, geometry);
    }
    return geometry;
  }

  visualScene.traverse((object) => {
    if (!object.isMesh || object.userData.surface === 'foliage') return;
    const surface = object.userData.surface;
    if (!surface) throw new Error(`[world] visual mesh ${object.name} has no collision surface`);
    const geometry = geometryFor(object);
    if (object.isInstancedMesh) {
      const matrices = [];
      for (let i = 0; i < object.count; i++) {
        object.getMatrixAt(i, local);
        matrices.push(new THREE.Matrix4().multiplyMatrices(object.matrixWorld, local));
      }
      instanceGroups.push({ geometry, surface, matrices, name: object.name });
    } else {
      const part = geometry.clone().applyMatrix4(object.matrixWorld);
      (staticGroups.get(surface) ?? staticGroups.set(surface, []).get(surface)).push(part);
    }
  });

  const scene = new THREE.Scene();
  const root = new THREE.Group();
  root.name = 'world_collision';
  scene.add(root);
  const material = new THREE.MeshBasicMaterial({ name: 'collision', visible: false });
  let collideTris = 0;

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

  for (const group of instanceGroups) {
    const mesh = new THREE.InstancedMesh(group.geometry, material, group.matrices.length);
    mesh.name = `collide_${group.name}`;
    mesh.userData.surface = group.surface;
    mesh.matrixAutoUpdate = false;
    for (let i = 0; i < group.matrices.length; i++) mesh.setMatrixAt(i, group.matrices[i]);
    mesh.instanceMatrix.needsUpdate = true;
    mesh.computeBoundingSphere();
    mesh.updateMatrix();
    root.add(mesh);
    collideTris += triangleCount(group.geometry) * group.matrices.length;
  }

  return { scene, collideTris };
}

export async function exportBinary(scene) {
  const value = await new GLTFExporter().parseAsync(scene, { binary: true });
  return Buffer.from(value);
}

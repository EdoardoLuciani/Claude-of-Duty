import { readFileSync } from 'node:fs';
import { dirname } from 'node:path';
import * as THREE from 'three';
import { GLTFExporter } from 'three/examples/jsm/exporters/GLTFExporter.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

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

export async function loadGlb(file) {
  const buffer = readFileSync(file);
  const array = buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);
  return new GLTFLoader().parseAsync(array, `${dirname(file)}/`);
}

function triangleCount(geometry) {
  return (geometry.index?.count ?? geometry.getAttribute('position')?.count ?? 0) / 3;
}

function collisionGeometry(source) {
  const geometry = source.geometry.clone();
  for (const attribute of ['normal', 'uv', 'uv1', 'color', 'tangent']) geometry.deleteAttribute(attribute);
  return geometry;
}

export function buildCollision(gltf) {
  gltf.scene.updateWorldMatrix(true, true);
  const sources = [];
  gltf.scene.traverse((object) => {
    if (object.isMesh) sources.push(object);
  });

  const groups = new Map();
  const staticGroups = new Map();
  for (const source of sources) {
    const group = source.userData.cod_instance_group;
    if (group) {
      (groups.get(group) ?? groups.set(group, []).get(group)).push(source);
    } else {
      const surface = source.userData.surface;
      (staticGroups.get(surface) ?? staticGroups.set(surface, []).get(surface)).push(source);
    }
  }

  const scene = new THREE.Scene();
  const root = new THREE.Group();
  root.name = 'world_collision';
  scene.add(root);
  const material = new THREE.MeshBasicMaterial({ name: 'collision', visible: false });
  let collideTris = 0;

  for (const [surface, members] of staticGroups) {
    const parts = members.map((source) => collisionGeometry(source).applyMatrix4(source.matrixWorld));
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

  for (const [groupName, members] of groups) {
    members.sort((a, b) => a.userData.cod_instance_index - b.userData.cod_instance_index);
    for (let i = 0; i < members.length; i++) {
      if (members[i].userData.cod_instance_index !== i) {
        throw new Error(`[world] collision group ${groupName} has non-contiguous indices`);
      }
    }
    const first = members[0];
    const geometry = collisionGeometry(first);
    const mesh = new THREE.InstancedMesh(geometry, material, members.length);
    mesh.name = `collide_${groupName.replace(/\.\d{3}$/, '')}`;
    mesh.userData.surface = first.userData.surface;
    mesh.matrixAutoUpdate = false;
    for (let i = 0; i < members.length; i++) mesh.setMatrixAt(i, members[i].matrixWorld);
    mesh.instanceMatrix.needsUpdate = true;
    mesh.computeBoundingSphere();
    mesh.updateMatrix();
    root.add(mesh);
    collideTris += triangleCount(geometry) * members.length;
  }

  return { scene, collideTris };
}

export async function exportBinary(scene) {
  const value = await new GLTFExporter().parseAsync(scene, { binary: true });
  return Buffer.from(value);
}

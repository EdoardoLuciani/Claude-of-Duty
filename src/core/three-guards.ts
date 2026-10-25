import { Group, Mesh, SkinnedMesh, Texture } from 'three';
import type { BufferGeometry, Material } from 'three';

// Concrete predicates retain Three's safe generic defaults; bare instanceof
// narrows generic constructors to Mesh<any, any, any>/Texture<any, any>.
export function isGroup(value: unknown): value is Group {
  return value instanceof Group;
}

export function isMesh(value: unknown): value is Mesh {
  return value instanceof Mesh;
}

export function isSingleMaterialMesh(value: unknown): value is Mesh<BufferGeometry, Material> {
  return isMesh(value) && !Array.isArray(value.material);
}

export function isSkinnedMesh(value: unknown): value is SkinnedMesh {
  return value instanceof SkinnedMesh;
}

export function isTexture(value: unknown): value is Texture {
  return value instanceof Texture;
}

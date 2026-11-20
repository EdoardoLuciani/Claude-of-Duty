import type { Material, Texture } from 'three';

import { isClosable } from './guards.ts';

/** Dispose owned finishes; texture clones may share one decoded image. */
export function disposeMaterials({
  materials,
  textures,
}: {
  materials: Set<Material>;
  textures: Set<Texture>;
}): void {
  const images = new Set<unknown>();
  for (const material of materials) material.dispose();
  for (const texture of textures) {
    images.add(texture.source.data);
    texture.dispose();
  }
  for (const image of images) if (isClosable(image)) image.close();
  materials.clear();
  textures.clear();
}

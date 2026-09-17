import * as THREE from 'three';

/** Load a PNG into a THREE.Texture with DataTexture-compatible upload. */
export async function loadPngTexture(url, { srgb = false, aniso = 8, wrap = THREE.RepeatWrapping } = {}) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`[pngtex] ${url}: HTTP ${response.status}`);
  const bitmap = await createImageBitmap(await response.blob());
  const texture = new THREE.Texture(bitmap);
  texture.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  texture.wrapS = texture.wrapT = wrap;
  texture.generateMipmaps = true;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.anisotropy = aniso;
  texture.flipY = false;
  texture.needsUpdate = true;
  return texture;
}

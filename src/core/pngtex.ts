import * as THREE from 'three';

type TextureWrapping = typeof THREE.RepeatWrapping | typeof THREE.ClampToEdgeWrapping;
interface PngTextureOptions { srgb?: boolean; aniso?: number; wrap?: TextureWrapping }

export async function loadPngTexture(url: string, { srgb = false, aniso = 8, wrap = THREE.RepeatWrapping }: PngTextureOptions = {}): Promise<THREE.Texture> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`[pngtex] ${url}: HTTP ${response.status}`);
  const bitmap = await createImageBitmap(await response.blob(), {
    premultiplyAlpha: 'none',
    colorSpaceConversion: 'none',
  });
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

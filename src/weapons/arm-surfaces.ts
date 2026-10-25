import * as THREE from 'three';
import { attribute, float, normalMap, texture, uv, varying, vec2, vec3 } from 'three/tsl';
import { MeshPhysicalNodeMaterial } from 'three/webgpu';
import type { Node } from 'three/webgpu';
import type { ConstNode, TextureNode, VarNode } from 'three/webgpu';

import { isImageBitmap } from '../core/guards.ts';
import type { createArmBlood } from './arm-blood.ts';

/** Equal-sized authored tiles stay separate layers: no atlas seams or UV remapping. */
function armTextureArray(maps: THREE.Texture[], srgb: boolean): THREE.DataArrayTexture {
  const first = maps[0].image;
  if (!isImageBitmap(first) || !first.width || !first.height)
    throw new Error('Player arms: missing texture image');
  const { width, height } = first;
  const canvas = new OffscreenCanvas(width, height);
  const context = canvas.getContext('2d', { willReadFrequently: true });
  if (!context) throw new Error('Player arms: texture packing needs a 2D canvas');
  const stride = width * height * 4;
  const pixels = new Uint8Array(stride * maps.length);
  for (const [layer, map] of maps.entries()) {
    const image = map.image;
    if (!isImageBitmap(image) || image.width !== width || image.height !== height || map.flipY)
      throw new Error('Player arms: incompatible texture layer');
    context.clearRect(0, 0, width, height);
    context.drawImage(image, 0, 0);
    pixels.set(context.getImageData(0, 0, width, height).data, layer * stride);
  }
  const array = new THREE.DataArrayTexture(pixels, width, height, maps.length);
  array.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  array.flipY = false;
  array.wrapS = array.wrapT = THREE.RepeatWrapping;
  array.magFilter = THREE.LinearFilter;
  array.minFilter = THREE.LinearMipmapLinearFilter;
  array.generateMipmaps = true;
  array.anisotropy = 8;
  array.needsUpdate = true;
  return array;
}

/** One physical finish graph, with immutable per-surface authored factors. */
export function createArmSurfaceMaterial(
  sources: THREE.MeshPhysicalMaterial[],
  blood: ReturnType<typeof createArmBlood>
): MeshPhysicalNodeMaterial {
  const first = sources[0];
  for (const source of sources) {
    if (
      !source.isMeshPhysicalMaterial ||
      source.transparent ||
      source.specularIntensity !== first.specularIntensity ||
      source.side !== first.side ||
      !source.map ||
      !source.normalMap ||
      !source.roughnessMap ||
      !source.aoMap ||
      source.roughnessMap.source !== source.aoMap.source ||
      source.map.channel !== 1 ||
      source.normalMap.channel !== 1 ||
      source.roughnessMap.channel !== 1 ||
      source.aoMap.channel !== 0
    )
      throw new Error(`Player arms: incompatible authored surface ${source.name}`);
  }
  const material = new MeshPhysicalNodeMaterial();
  material.copy(first);
  material.name = 'Player_arm_surfaces';
  material.map = armTextureArray(
    sources.map((m): THREE.Texture => m.map!),
    true
  );
  material.normalMap = armTextureArray(
    sources.map((m): THREE.Texture => m.normalMap!),
    false
  );
  material.roughnessMap = armTextureArray(
    sources.map((m): THREE.Texture => m.roughnessMap!),
    false
  );
  material.aoMap = material.roughnessMap;
  material.metalnessMap = null;
  const surface = varying(attribute('armSurface', 'float')).setInterpolation('flat');
  const choose = <T extends 'float' | 'vec2' | 'vec3'>(values: Node<T>[]): Node<T> => {
    let result = values[0];
    for (let i = 1; i < values.length; i++) result = surface.equal(i).select(values[i], result);
    return result;
  };
  const sample = (map: THREE.Texture, channel: number): TextureNode<'vec4'> =>
    texture(map, uv(channel)).depth(surface);
  const base = sample(material.map, 1).rgb.mul(
    choose(
      sources.map((m): VarNode<'vec3', ConstNode<'vec3', THREE.Vector3>> =>
        vec3(m.color.r, m.color.g, m.color.b)
      )
    )
  );
  const roughness = sample(material.roughnessMap, 1).g.mul(
    choose(sources.map((m): VarNode<'float', ConstNode<'float', number>> => float(m.roughness)))
  );
  material.metalnessNode = choose(
    sources.map((m): VarNode<'float', ConstNode<'float', number>> => float(m.metalness))
  );
  material.aoNode = sample(material.aoMap, 0)
    .r.sub(1)
    .mul(
      choose(
        sources.map((m): VarNode<'float', ConstNode<'float', number>> => float(m.aoMapIntensity))
      )
    )
    .add(1);
  // Retain the native derivative tangent frame (including mirrored/back-face handling).
  material.normalNode = normalMap(
    sample(material.normalMap, 1).rgb,
    choose(
      sources.map((m): VarNode<'vec2', ConstNode<'vec2', THREE.Vector2>> => vec2(m.normalScale))
    )
  );
  blood.decorate(
    material,
    base,
    roughness,
    choose(
      sources.map((m): VarNode<'float', ConstNode<'float', number>> =>
        float(m.name === 'Olive_ripstop' || m.name === 'Olive_stitch' ? 1 : 0)
      )
    )
  );
  return material;
}

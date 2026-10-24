import type { Material } from 'three';
import {
  CustomBlending,
  SrcAlphaFactor,
  OneFactor,
  ZeroFactor,
  Color,
  DoubleSide,
  MeshBasicNodeMaterial,
} from 'three/webgpu';

/** Cached reticle finishes. Weapon surfaces belong to their authored GLBs. */
export class ReticleMaterials {
  private cache = new Map<string, Material>();

  private own(key: string, material: Material): Material {
    material.name = `ow-${key}`;
    this.cache.set(key, material);
    return material;
  }

  // Additive light cannot darken the sky; a separate keyline keeps the dot legible.
  reticleOutline(opacity = 0.8): Material {
    const key = `reticleOutline:${opacity}`;
    return (
      this.cache.get(key) ??
      this.own(
        key,
        new MeshBasicNodeMaterial({
          color: 0x14060a,
          transparent: true,
          opacity,
          depthWrite: false,
          depthTest: true,
          side: DoubleSide,
          toneMapped: false,
        })
      )
    );
  }

  reticle(color = 0xff2a12, intensity = 6.5): Material {
    const key = `reticle:${color}:${intensity}`;
    return (
      this.cache.get(key) ??
      this.own(
        key,
        new MeshBasicNodeMaterial({
          color: new Color(color).multiplyScalar(intensity),
          transparent: true,
          opacity: 1,
          blending: CustomBlending,
          depthWrite: false,
          blendSrc: SrcAlphaFactor,
          blendDst: OneFactor,
          blendSrcAlpha: ZeroFactor,
          blendDstAlpha: OneFactor,
          depthTest: true,
          side: DoubleSide,
          toneMapped: true,
        })
      )
    );
  }

  dispose(): void {
    for (const material of this.cache.values()) material.dispose();
    this.cache.clear();
  }
}

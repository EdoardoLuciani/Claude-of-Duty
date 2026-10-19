import { MeshStandardNodeMaterial, Object3D, SkinnedMesh } from 'three/webgpu';
import type { Material, MeshPhysicalNodeMaterial, Node } from 'three/webgpu';

import { SHADOW_ONLY_LAYER } from '../core/layers.ts';

type AuthoredMaterial = { material: Material; version: number; color: Node | null };

// The soldier asset owns contiguous opaque groups. Do not infer equivalence for
// cutouts, custom shadow shaders or callbacks: leave those on the original mesh.
// Only AI-authored skins use this helper. Replaced color graphs/material versions
// invalidate that authored contract rather than being treated as opaque by guesswork.
function shadowMaterial(
  source: SkinnedMesh,
  authored: AuthoredMaterial[]
): MeshStandardNodeMaterial | null {
  const materials = source.material;
  const geometry = source.geometry;
  if (!Array.isArray(materials) || !geometry.index || geometry.groups.length < 2) return null;
  if (
    source.onBeforeRender !== Object3D.prototype.onBeforeRender ||
    source.onAfterRender !== Object3D.prototype.onAfterRender ||
    source.onBeforeShadow !== Object3D.prototype.onBeforeShadow ||
    source.onAfterShadow !== Object3D.prototype.onAfterShadow
  )
    return null;
  const first = materials[0];
  if (!(first instanceof MeshStandardNodeMaterial)) return null;
  if (materials.length !== authored.length) return null;
  for (let i = 0; i < materials.length; i++) {
    const material = materials[i];
    const physical = material as MeshPhysicalNodeMaterial;
    if (
      !(material instanceof MeshStandardNodeMaterial) ||
      material !== authored[i].material ||
      material.version !== authored[i].version ||
      material.colorNode !== authored[i].color ||
      material.opacity !== 1 ||
      material.opacityNode ||
      physical.transmission > 0 ||
      physical.transmissionNode ||
      material.backdropNode ||
      !material.visible ||
      !material.allowOverride ||
      material.transparent ||
      material.alphaTest !== 0 ||
      material.alphaHash ||
      material.alphaMap ||
      material.displacementMap ||
      material.positionNode ||
      material.castShadowPositionNode ||
      material.castShadowNode ||
      material.maskNode ||
      material.maskShadowNode ||
      material.depthNode ||
      material.side !== first.side ||
      material.shadowSide !== first.shadowSide
    )
      return null;
  }
  let end = 0;
  for (const group of geometry.groups) {
    if (group.start !== end || group.count % 3 !== 0 || !materials[group.materialIndex ?? 0])
      return null;
    end += group.count;
  }
  if (
    end !== geometry.index.count ||
    geometry.drawRange.start % 3 !== 0 ||
    (Number.isFinite(geometry.drawRange.count) && geometry.drawRange.count % 3 !== 0)
  )
    return null;
  return first;
}

/** One shadow-only draw of the same skin, using public scene/layer APIs only.
 * Geometry, materials and skeleton are borrowed; the identity child shares the
 * source's world transform and visibility, including ragdoll poses. */
export class SoldierShadowCaster {
  readonly mesh: SkinnedMesh;
  private readonly originalCastShadow: boolean;
  private readonly authored: AuthoredMaterial[];
  private readonly source: SkinnedMesh;

  constructor(source: SkinnedMesh) {
    this.source = source;
    this.originalCastShadow = source.castShadow;
    this.authored = (Array.isArray(source.material) ? source.material : []).map((material) => ({
      material,
      version: material.version,
      color: material instanceof MeshStandardNodeMaterial ? material.colorNode : null,
    }));
    this.mesh = new SkinnedMesh(
      source.geometry,
      Array.isArray(source.material) ? source.material[0] : source.material
    );
    this.mesh.name = 'soldier-shadow';
    this.mesh.layers.set(SHADOW_ONLY_LAYER);
    this.mesh.userData.owNoPrepass = true;
    this.mesh.bind(source.skeleton, source.bindMatrix);
    source.add(this.mesh);
    this.update(source.castShadow);
  }

  update(enabled: boolean): void {
    const material = shadowMaterial(this.source, this.authored);
    const proxy = this.mesh;
    this.source.castShadow = enabled && material === null;
    proxy.visible = proxy.castShadow = enabled && material !== null;
    if (!material) return;
    proxy.material = material;
    proxy.geometry = this.source.geometry;
    proxy.skeleton = this.source.skeleton;
    proxy.bindMode = this.source.bindMode;
    proxy.bindMatrix.copy(this.source.bindMatrix);
    proxy.frustumCulled = this.source.frustumCulled;
    proxy.boundingSphere = this.source.boundingSphere;
    proxy.morphTargetInfluences = this.source.morphTargetInfluences;
    proxy.morphTargetDictionary = this.source.morphTargetDictionary;
  }

  dispose(): void {
    this.mesh.removeFromParent();
    this.source.castShadow = this.originalCastShadow;
    // Never dispose borrowed geometry, materials, skeleton or bone textures.
  }
}

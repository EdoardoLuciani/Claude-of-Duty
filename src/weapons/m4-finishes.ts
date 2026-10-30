import { attribute, normalMap, texture, uv, varying, vec2, vec3 } from 'three/tsl';
import type { MeshPhysicalNodeMaterial } from 'three/webgpu';

/** UV1/UV2 are constant surface data, not a detail atlas. Keep the original UV0
 * derivative tangent frame and full-resolution receiver/checkering maps. */
export function configureM4Finishes(material: MeshPhysicalNodeMaterial): void {
  if (!material.map || !material.normalMap || !material.roughnessMap || !material.emissiveMap)
    throw new Error('M4: missing unified finish maps');
  const factors = varying(attribute('uv1', 'vec2')).setInterpolation('flat');
  const detail = varying(attribute('uv2', 'vec2')).setInterpolation('flat');
  const paint = detail.y.equal(2);
  const surface = texture(material.map, uv(0)).rgb;
  const receiver = texture(material.emissiveMap, uv(0)).rgb;
  // NodeMaterial applies the original COLOR_0 tint to colorNode exactly once.
  material.colorNode = paint.select(vec3(1), detail.y.equal(1).select(receiver, surface));
  material.roughnessNode = paint.select(
    factors.x,
    texture(material.roughnessMap, uv(0)).g.mul(factors.x)
  );
  material.metalnessNode = factors.y;
  material.normalNode = normalMap(texture(material.normalMap, uv(0)).rgb, vec2(detail.x));
  material.emissiveNode = paint.select(attribute('color', 'vec3').mul(2), vec3(0));
}

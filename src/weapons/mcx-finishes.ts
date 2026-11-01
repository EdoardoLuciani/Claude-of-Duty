import { float, normalMap, texture, uv, vec2, vec3 } from 'three/tsl';
import type { MeshPhysicalNodeMaterial } from 'three/webgpu';

/** UV1 identifies finishes; UV0 remains repeating detail. Cooked triangles retain
 * one normal/emission role even where fine-finish tile coordinates interpolate.
 * Keep normal strength and untextured fiber emission as surface data, not draws.
 */
export function configureMCXFinishes(material: MeshPhysicalNodeMaterial): void {
  if (!material.normalMap) throw new Error('MCX: missing repeating normal detail');
  const finishUV = uv(1);
  const finish = finishUV.x
    .mul(4)
    .floor()
    .add(float(1).sub(finishUV.y).mul(4).floor().mul(4))
    .toVar('mcxFinish');
  const fiber = finish.equal(11).toVar('mcxFiber');
  const strength = finish
    .equal(2)
    .select(0.5, finish.equal(3).select(0.9, fiber.select(0.03, 0.02)));
  // GLTFLoader reverses the normal Y sign for derivative tangents. Retain that
  // convention and Three's back-face handling instead of inventing a TBN frame.
  material.normalNode = normalMap(
    texture(material.normalMap).rgb,
    vec2(Math.sign(material.normalScale.x), Math.sign(material.normalScale.y)).mul(strength)
  );
  material.emissiveNode = fiber.select(vec3(0.336, 0.0175, 0.0056), vec3(0));
}

import { Color, MeshStandardNodeMaterial } from 'three/webgpu';
import { abs, cameraPosition, clamp, dot, float, mix, normalMap,
  normalWorldGeometry, normalize, positionWorld, smoothstep, texture, uv,
  vec3, vec4 } from 'three/tsl';

/** Soldier maps retain their CPU-authored camouflage, packed ORM and GLB UVs. */
export function createSoldierNodeMaterial(set, opts = {}, detail = null) {
  const color = opts.tint ? new Color(opts.tint[0], opts.tint[1], opts.tint[2]) : new Color(1, 1, 1);
  const mat = new MeshStandardNodeMaterial({ vertexColors: true,
    side: opts.side, dithering: true, roughness: opts.rough ?? 1,
    metalness: opts.metal ?? 1, color });
  const baseUv = uv();
  const orm = texture(set.orm, baseUv);
  mat.colorNode = texture(set.albedo, baseUv).rgb.mul(vec3(color.r, color.g, color.b));
  mat.aoNode = float(1).add(orm.r.sub(1).mul(opts.ao ?? 0.85));
  const detailSample = detail ? texture(detail.texture, baseUv.mul(detail.scale)) : null;
  mat.roughnessNode = clamp(orm.g.mul(opts.rough ?? 1)
    .add(detailSample ? detailSample.a.sub(0.5).mul(detail.rough) : 0), 0.04, 1);
  mat.metalnessNode = orm.b.mul(opts.metal ?? 1);
  const n = texture(set.normal, baseUv).rgb.mul(2).sub(1);
  const slope = detailSample ? detailSample.xy.mul(2).sub(1).mul(detail.normal) : 0;
  const combined = normalize(vec3(n.xy.mul(opts.normalScale ?? 1).add(slope), n.z));
  mat.normalNode = normalMap(combined.mul(0.5).add(0.5));
  // The authored soldier's dark silhouette is applied to the *lit* result,
  // including metal specular. Normal-map noise cannot shift this rim band.
  // Match the authored RIM values in textures.js; the legacy hook goes away
  // when production switches to node materials.
  const strength = 0.62 * (opts.rim ?? 1);
  const edge = 0.42;
  const power = 1.9;
  const previous = mat.setupOutput;
  mat.setupOutput = function (builder, output) {
    const view = normalize(cameraPosition.sub(positionWorld));
    const facing = abs(dot(view, normalize(normalWorldGeometry)));
    const rim = smoothstep(edge, 1, float(1).sub(facing)).pow(power).mul(strength);
    return previous.call(this, builder, vec4(mix(output.rgb, vec3(0), rim), output.a));
  };
  mat.name = opts.name ?? 'ai_node';
  return mat;
}

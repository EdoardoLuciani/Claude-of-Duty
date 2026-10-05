import { RedFormat, UnsignedByteType } from 'three/webgpu';
import { Fn, Loop, abs, exp, float, int, max, rtt, screenUV,
  textureSize, vec2 } from 'three/tsl';

/** Two full-resolution bilateral passes over GTAO visibility. The same opaque
 * linear-depth prepass gates taps, so a near wall never smears into sky or a
 * distant street. Match the legacy three-tap weights without its intensity
 * curve; the GTAO node itself remains responsible for AO strength. */
export function createAoBilateralBlur(source, depth) {
  const blur = (input, direction) => Fn(() => {
    const uv = screenUV;
    const centerDepth = depth.sample(uv).r;
    const centerAO = input.sample(uv).r;
    const texel = direction.div(textureSize(depth, 0));
    const sum = centerAO.mul(0.4).toVar();
    const total = float(0.4).toVar();
    Loop({ start: int(1), end: int(4), type: 'int', condition: '<' }, ({ i }) => {
      const offset = texel.mul(i);
      for (const neighbor of [uv.add(offset), uv.sub(offset)]) {
        const d = depth.sample(neighbor).r;
        const w = float(0.4).div(i.add(1))
          .mul(exp(abs(d.sub(centerDepth)).mul(-22).div(max(0.1, centerDepth))))
          .mul(d.greaterThan(0).select(1, 0));
        sum.addAssign(input.sample(neighbor).r.mul(w));
        total.addAssign(w);
      }
    });
    return centerDepth.lessThanEqual(0).select(1, sum.div(total));
  })();
  const options = { type: UnsignedByteType, format: RedFormat, depthBuffer: false };
  const horizontal = rtt(blur(source, vec2(1, 0)), null, null, options);
  const vertical = rtt(blur(horizontal, vec2(0, 1)), null, null, options);
  horizontal.name = 'AO bilateral horizontal';
  vertical.name = 'AO bilateral vertical';
  return { textureNode: vertical, dispose() { vertical.dispose(); horizontal.dispose(); } };
}

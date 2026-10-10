import { RedFormat, UnsignedByteType } from 'three/webgpu';
import { Fn, max, rtt, screenUV, textureSize, vec2 } from 'three/tsl';
import { depthAwareBlur } from 'three/addons/tsl/display/depthAwareBlur.js';

/** Reuse Three's five-tap Gaussian, retaining depth-relative rejection, neutral
 * sky, full-resolution R8 intermediates and GTAO's unmodified strength.
 * A 1.65-pixel step approximates the previous seven-tap spatial variance. */
export function createAoBilateralBlur(source, linearDepth, rawDepth, camera) {
  const blur = (input, direction) => Fn(() => {
    const center = linearDepth.sample(screenUV).r;
    const step = direction.mul(1.65).div(textureSize(rawDepth, 0));
    const radius = max(0.1, center).mul(2 / 22);
    const value = depthAwareBlur(input, rawDepth, step, camera, 2, radius);
    return center.lessThanEqual(0).select(1, value);
  })();
  const options = { type: UnsignedByteType, format: RedFormat, depthBuffer: false };
  const horizontal = rtt(blur(source, vec2(1, 0)), null, null, options);
  const vertical = rtt(blur(horizontal, vec2(0, 1)), null, null, options);
  horizontal.name = 'AO bilateral horizontal';
  vertical.name = 'AO bilateral vertical';
  return { textureNode: vertical, dispose() { vertical.dispose(); horizontal.dispose(); } };
}

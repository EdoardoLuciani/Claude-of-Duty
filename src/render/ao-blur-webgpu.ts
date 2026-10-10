import { RedFormat, UnsignedByteType } from 'three/webgpu';
import type { Camera, Node } from 'three/webgpu';
import type TextureNode from 'three/src/nodes/accessors/TextureNode.js';
import { Fn, float, max, rtt, screenUV, textureSize, uint, vec2 } from 'three/tsl';
import { depthAwareBlur } from 'three/addons/tsl/display/depthAwareBlur.js';

/** Reuse Three's five-tap Gaussian, retaining depth-relative rejection, neutral
 * sky, full-resolution R8 intermediates and GTAO's unmodified strength.
 * A 1.65-pixel step approximates the previous seven-tap spatial variance. */
export function createAoBilateralBlur(source: TextureNode, linearDepth: TextureNode, rawDepth: TextureNode, camera: Camera) {
  const blur = (input: Node, direction: Node<'vec2'>) => Fn(() => {
    const center = linearDepth.sample(screenUV).r;
    const step = direction.mul(1.65).div(textureSize(rawDepth, uint(0)) as unknown as Node<'vec2'>);
    const radius = max(float(0.1), center).mul(2 / 22);
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

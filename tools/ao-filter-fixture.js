import { RedFormat, UnsignedByteType } from 'three/webgpu';
import { rtt, texture, textureSize, vec2 } from 'three/tsl';
import { bilateralBlur } from 'three/addons/tsl/display/BilateralBlurNode.js';
import { depthAwareBlur } from 'three/addons/tsl/display/depthAwareBlur.js';
export { ao } from 'three/addons/tsl/display/GTAONode.js';

// Review-only choices. The production filter is not selected by this module.
export function createAoFilter(filter, source, linearDepth, { camera, rawDepth }, current, selected) {
  if (filter === 'current' || filter === 'compute')
    return current(source, linearDepth, { compute: filter === 'compute' });
  if (filter === 'color' || filter === 'color-default') {
    // Match full-resolution output from GTAO's half-resolution input. With odd
    // sizes this rounds differently; report the actual output rather than hide it.
    const node = bilateralBlur(texture(source.value), null, filter === 'color' ? 0.5 : 4, 0.1);
    node.resolutionScale = 2;
    return { textureNode: node.getTextureNode(), computeNodes: [], dispose() { node.dispose(); } };
  }
  if (filter === 'depth-tuned')
    return { ...selected(source, linearDepth, rawDepth, camera), computeNodes: [] };
  if (filter !== 'depth') throw Error(`Unknown AO filter: ${filter}`);
  const options = { type: UnsignedByteType, format: RedFormat, depthBuffer: false };
  const pass = (input, direction, name) => {
    const node = rtt(depthAwareBlur(input, rawDepth, direction.div(textureSize(rawDepth, 0)), camera),
      null, null, options);
    node.name = name;
    return node;
  };
  const horizontal = pass(source, vec2(1, 0), 'Three depth-aware horizontal');
  const vertical = pass(horizontal, vec2(0, 1), 'Three depth-aware vertical');
  return { textureNode: vertical, computeNodes: [],
    dispose() { vertical.dispose(); horizontal.dispose(); } };
}

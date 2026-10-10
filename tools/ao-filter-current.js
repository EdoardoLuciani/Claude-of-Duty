import { RedFormat, StorageTexture, UnsignedByteType, Vector2 } from 'three/webgpu';
import { Fn, If, Loop, abs, exp, float, globalId, int, max, rtt, screenUV,
  texture, textureSize, textureStore, uniform, vec2, vec4 } from 'three/tsl';

// Review-only seven-tap reference (develop 7de9433). Compute uses portable
// RGBA8 storage with the same red-channel quantization as the raster R8 passes.
export function createAoBilateralBlur(source, depth, compute) {
  const blur = (input, direction, uv) => Fn(() => {
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
  const materialize = (input, direction, name) => {
    if (!compute) {
      const node = rtt(blur(input, direction, screenUV), null, null,
        { type: UnsignedByteType, format: RedFormat, depthBuffer: false });
      node.name = name;
      return { textureNode: node, dispose() { node.dispose(); } };
    }
    const output = new StorageTexture();
    output.generateMipmaps = false;
    output.name = name;
    const dispatch = [1, 1, 1];
    const size = uniform(new Vector2()).onRenderUpdate(({ renderer }, self) => {
      renderer.getDrawingBufferSize(self.value);
      output.setSize(self.value.x, self.value.y);
      dispatch[0] = Math.ceil(self.value.x / 8);
      dispatch[1] = Math.ceil(self.value.y / 8);
    });
    const color = blur(input, direction, globalId.xy.toVec2().add(0.5).div(size));
    const computeNode = Fn(() => {
      If(globalId.x.lessThan(size.x.toUint()).and(globalId.y.lessThan(size.y.toUint())), () => {
        textureStore(output, globalId.xy, vec4(color, 0, 0, 1));
      });
    })().compute(dispatch, [8, 8, 1]).setName(name);
    return { textureNode: texture(output), computeNode,
      dispose() { computeNode.dispose(); output.dispose(); } };
  };
  const horizontal = materialize(source, vec2(1, 0), 'AO bilateral horizontal');
  const vertical = materialize(horizontal.textureNode, vec2(0, 1), 'AO bilateral vertical');
  return { textureNode: vertical.textureNode,
    computeNodes: compute ? [horizontal.computeNode, vertical.computeNode] : [],
    dispose() { vertical.dispose(); horizontal.dispose(); } };
}

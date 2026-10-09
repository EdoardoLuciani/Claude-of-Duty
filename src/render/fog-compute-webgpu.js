import { HalfFloatType, StorageTexture, Vector2 } from 'three/webgpu';
import { Fn, If, globalId, texture, textureStore, uniform, vec4 } from 'three/tsl';

/** Native ComputeNode scheduled by the render graph; publish its storage
 * texture directly so haze does not materialize an extra identity RTT. */
export function createFogCompute(fog, inputs) {
  const output = new StorageTexture();
  output.type = HalfFloatType;
  output.generateMipmaps = false;
  output.name = 'Volumetric fog compute';
  const dispatch = [1, 1, 1];
  const size = uniform(new Vector2(1, 1)).onRenderUpdate(({ renderer }, self) => {
    renderer.getDrawingBufferSize(self.value);
    output.setSize(self.value.x, self.value.y);
    dispatch[0] = Math.ceil(self.value.x / 8);
    dispatch[1] = Math.ceil(self.value.y / 8);
  });
  // Match fragment pixel centres/dither; keep pass inputs in the native graph
  // so TRAA retains its render-pipeline jitter callbacks.
  const coordinate = globalId.xy.toVec2().add(0.5);
  const color = fog({ ...inputs, uv: coordinate.div(size), coordinate });
  const computeNode = Fn(() => {
    If(globalId.x.lessThan(size.x.toUint()).and(globalId.y.lessThan(size.y.toUint())), () => {
      textureStore(output, globalId.xy, vec4(color, 1));
    });
  })().compute(dispatch, [8, 8, 1]).setName('Volumetric fog');
  return { computeNode, textureNode: texture(output),
    dispose() { computeNode.dispose(); output.dispose(); } };
}

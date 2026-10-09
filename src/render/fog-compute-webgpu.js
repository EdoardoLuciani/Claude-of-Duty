import { HalfFloatType, StorageTexture, Vector2 } from 'three/webgpu';
import { Fn, If, globalId, texture, textureStore, uniform, vec4 } from 'three/tsl';

/** Full-resolution fog with the same RGBA16F boundary as the raster RTT.
 * Pixel centres are native top-left coordinates, including the half texel used
 * by fragment position and the fog's deterministic dither/shadow rotation. */
export function createFogCompute(fog, inputs) {
  const output = new StorageTexture();
  output.type = HalfFloatType;
  output.generateMipmaps = false;
  output.name = 'Volumetric fog compute';
  const size = uniform(new Vector2(1, 1));
  const coordinate = globalId.xy.toVec2().add(0.5);
  // Schedule upstream passes in the render graph, not a hidden compute build.
  // In particular TRAA must install its before/after-pipeline jitter callbacks.
  const color = fog({ ...inputs, color: texture(inputs.color.value),
    depth: texture(inputs.depth.value), uv: coordinate.div(size), coordinate });
  const kernel = Fn(() => {
    If(globalId.x.lessThan(size.x.toUint()).and(globalId.y.lessThan(size.y.toUint())), () => {
      textureStore(output, globalId.xy, vec4(color, 1));
    });
  })().computeKernel([8, 8, 1]).setName('Volumetric fog');
  const node = texture(output);
  const setup = node.setup.bind(node);
  node.setup = builder => {
    inputs.color.build(builder);
    inputs.depth.build(builder);
    return setup(builder);
  };
  const dispatch = [1, 1, 1];
  node.updateBeforeType = 'frame';
  node.updateBefore = ({ renderer }) => {
    renderer.getDrawingBufferSize(size.value);
    output.setSize(size.value.x, size.value.y);
    dispatch[0] = Math.ceil(size.value.x / 8);
    dispatch[1] = Math.ceil(size.value.y / 8);
    renderer.compute(kernel, dispatch);
  };
  const dispose = node.dispose.bind(node);
  node.dispose = () => { kernel.dispose(); output.dispose(); dispose(); };
  return node;
}

import { DepthTexture, LessEqualCompare, LinearFilter, Matrix4, Vector2 } from 'three/webgpu';
import type { Node } from 'three/webgpu';
import type NodeBuilder from 'three/src/nodes/core/NodeBuilder.js';
import { Fn, If, float, interleavedGradientNoise, max, renderGroup, screenCoordinate,
  uniform, uniformTexture, vec2, vec4, vogelDiskSample, wgslFn } from 'three/tsl';

// Three's depth.compare() only emits fragment-stage WGSL. The explicit-LOD
// equivalent retains hardware comparison filtering in a compute shader.
const compareLevel = wgslFn(`fn fogCompare(depth: texture_depth_2d, comparison: sampler_comparison,
  uv: vec2<f32>, receiver: f32) -> f32 {
  return textureSampleCompareLevel(depth, comparison, uv, receiver);
}`);

/** Read the already-rendered native cascades; no extra shadow draw or target.
 * Four Vogel taps match the authored volumetric filter budget. Shadow matrices
 * and textures are read at render time, after the world pass updates the CSM.
 */
interface CascadeShadow { matrix: Matrix4; map?: { depthTexture?: DepthTexture | null } | null; camera: { right: number; left: number; far: number; near: number }; mapSize: { x: number; y: number } }
interface CascadeRender { activeSun: { shadow: { shadowNode?: { lights?: Array<{ shadow?: CascadeShadow }>; breaks?: number[] }; } }; q: { cascades: number; shadowDistance: number }; ctx: { camera: { far: number; matrixWorldInverse: Matrix4 } } }
interface ShadowLayer { matrix: Node<'mat4'>; depth: ReturnType<typeof uniformTexture>; params: Node<'vec2'>; split: Node<'float'> }
type StageFn = (callback: (inputs: Node, builder: NodeBuilder & { shaderStage: string }) => Node<'float'>) => () => Node<'float'>;
const stageFn = Fn as unknown as StageFn;

export function createVolumetricShadow(render: CascadeRender) {
  const placeholders: DepthTexture[] = [];
  const identity = new Matrix4();
  const csm = () => render.activeSun.shadow.shadowNode;
  const layers = Array.from({ length: render.q.cascades }, (_, index) => {
    // Texture uniforms are deduplicated by initial texture UUID. A distinct
    // placeholder per cascade prevents three later maps sharing one binding.
    const empty = new DepthTexture(1, 1);
    empty.compareFunction = LessEqualCompare;
    empty.minFilter = empty.magFilter = LinearFilter;
    placeholders.push(empty);
    const shadow = () => csm()?.lights?.[index]?.shadow;
    const matrix = uniform(identity).setGroup(renderGroup).onRenderUpdate(() => shadow()?.matrix ?? identity);
    const depth = uniformTexture(empty).onRenderUpdate(() => shadow()?.map?.depthTexture ?? empty);
    const params = uniform(new Vector2()).setGroup(renderGroup).onRenderUpdate((_frame, self) => {
      const s = shadow();
      if (s) self.value.set(2.2 * (s.camera.right - s.camera.left) / s.mapSize.x / (s.camera.far - s.camera.near), 1.6 / s.mapSize.x);
      return self.value;
    });
    const split = uniform(0).setGroup(renderGroup).onRenderUpdate(() => (csm()?.breaks?.[index] ?? 0) * Math.min(render.ctx.camera.far, render.q.shadowDistance));
    return { matrix, depth, params, split };
  });
  const view = uniform(render.ctx.camera.matrixWorldInverse).setGroup(renderGroup);
  const sample = (layer: ShadowLayer, point: Node<'vec3'>, phi: Node<'float'>) => Fn(() => {
    const h = layer.matrix.mul(vec4(point, 1)).toVar();
    const uvz = h.xyz.div(h.w).toVar();
    const result = float(1).toVar();
    If(uvz.x.greaterThanEqual(0).and(uvz.x.lessThanEqual(1))
      .and(uvz.y.greaterThanEqual(0)).and(uvz.y.lessThanEqual(1))
      .and(uvz.z.greaterThan(0)).and(uvz.z.lessThan(1)), () => {
      const uv = vec2(uvz.x, uvz.y.oneMinus());
      const receiver = max(0, uvz.z.sub(layer.params.x));
      const taps: Node<'float'>[] = [];
      for (let i = 0; i < 4; i++) {
        const tapUV = uv.add(vogelDiskSample(float(i), float(4), phi).mul(layer.params.y));
        taps.push(stageFn((_, builder) => builder.shaderStage === 'compute' ?
          compareLevel({ depth: layer.depth, comparison: layer.depth, uv: tapUV, receiver }) as Node<'float'> :
          layer.depth.sample(tapUV).compare(receiver) as unknown as Node<'float'>)());
      }
      result.assign(taps[0].add(taps[1]).add(taps[2]).add(taps[3]).mul(.25));
    });
    return result;
  })();
  const visibility = Fn<[Node<'vec3'>, Node<'float'> | undefined], Node<'float'>>(([point, noise = interleavedGradientNoise(screenCoordinate.xy)]) => {
    const distance = view.mul(vec4(point, 1)).z.negate().toVar();
    const phi = noise.mul(6.28318530718).toVar();
    const result = float(1).toVar();
    let branch;
    for (const layer of layers) {
      const condition = distance.lessThan(layer.split);
      const body = () => result.assign(sample(layer, point, phi));
      branch = branch ? branch.ElseIf(condition, body) : If(condition, body);
    }
    return result;
  });
  return { visibility, dispose: () => { for (const empty of placeholders) empty.dispose(); } };
}

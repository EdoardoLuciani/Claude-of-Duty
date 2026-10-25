import { CSMShadowNode } from 'three/addons/csm/CSMShadowNode.js';
import type NodeBuilder from 'three/src/nodes/core/NodeBuilder.js';
import {
  Fn,
  abs,
  add,
  dot,
  interleavedGradientNoise,
  lightPosition,
  lightTargetPosition,
  float,
  max,
  normalWorldGeometry,
  reference,
  renderGroup,
  screenCoordinate,
  sqrt,
  texture,
  vec2,
  vogelDiskSample,
} from 'three/tsl';
/*!
 * PCF sampling adapted from Three.js (MIT).
 * Copyright © 2010-2026 three.js authors
 *
 * Permission is hereby granted, free of charge, to any person obtaining a copy
 * of this software and associated documentation files (the "Software"), to deal
 * in the Software without restriction, including without limitation the rights
 * to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
 * copies of the Software, and to permit persons to whom the Software is
 * furnished to do so, subject to the following conditions:
 *
 * The above copyright notice and this permission notice shall be included in
 * all copies or substantial portions of the Software.
 *
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
 * OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
 * THE SOFTWARE.
 */
import { Matrix4, PCFShadowMap, DirectionalLight } from 'three/webgpu';
import type { DepthTexture, DirectionalLightShadow, Node } from 'three/webgpu';

// PCF spans neighboring depth texels on a sloping receiver. Express the
// conservative receiver bias in cascade texels, not a resolution-independent
// normalized-depth constant. Keep the authored normal offset and base bias.
export const CSM_BIAS = Object.freeze({ texels: 0.5, slopeTexels: 1.5, maxSlope: 5 });
type GroupedReference<T extends string> = Node<T> & {
  setGroup(group: typeof renderGroup): GroupedReference<T>;
};
function hasReferenceGroup<T extends string>(node: Node<T>): node is GroupedReference<T> {
  return 'setGroup' in node && typeof node.setGroup === 'function';
}
export function groupedReference<T extends 'float' | 'vec2'>(
  name: string,
  type: T,
  object: object
): GroupedReference<T> {
  const ref = reference(name, type, object);
  if (!hasReferenceGroup(ref)) throw new Error('[render] reference node lacks uniform grouping');
  return ref.setGroup(renderGroup);
}
type CascadeShadow = DirectionalLightShadow & { bias: number };
function cascadeBias(shadow: CascadeShadow, key: DirectionalLight): Node<'float'> {
  const field = (name: string, object: object): GroupedReference<'float'> =>
    groupedReference(name, 'float', object);
  const camera = shadow.camera;
  const width = field('right', camera).sub(field('left', camera));
  const range = field('far', camera).sub(field('near', camera));
  const mapSize = groupedReference('mapSize', 'vec2', shadow);
  const base = field('bias', shadow);
  const direction = lightPosition(key).sub(lightTargetPosition(key)).normalize();
  return Fn((): Node<'float'> => {
    const cosine = abs(dot(normalWorldGeometry, direction)).clamp(0.12, 1).toVar();
    const slope = sqrt(max(0, cosine.mul(cosine).oneMinus()))
      .div(cosine)
      .min(CSM_BIAS.maxSlope);
    return base.sub(
      width
        .div(mapSize.x)
        .mul(slope.mul(CSM_BIAS.slopeTexels).add(CSM_BIAS.texels))
        .div(max(range, 1))
    );
  })();
}

// Same five-sample Vogel/IGN PCF as Three 0.186.1's PCFShadowFilter. Only the
// parameter-node lifetime differs: one pair per shadow, not per shader build.
// Otherwise fresh reference IDs fragment the render bind group by material,
// making every draw compare/upload the same camera and light coefficients.
type PCFArguments = {
  depthTexture: DepthTexture;
  shadowCoord: Node<'vec3'>;
  shadow: CascadeShadow;
  depthLayer: Node;
};

interface PCFNodes {
  mapSize: GroupedReference<'vec2'>;
  radius: GroupedReference<'float'>;
}
const shadowFields = new WeakMap<CascadeShadow, PCFNodes>();
export const stablePCFShadowFilter = Fn<PCFArguments, Node<'float'>>(
  ({ depthTexture, shadowCoord, shadow, depthLayer }): Node<'float'> => {
    let fields = shadowFields.get(shadow);
    if (!fields) {
      fields = {
        mapSize: groupedReference('mapSize', 'vec2', shadow),
        radius: groupedReference('radius', 'float', shadow),
      };
      shadowFields.set(shadow, fields);
    }
    const radiusScaled = fields.radius.mul(vec2(1).div(fields.mapSize).x);
    const phi = interleavedGradientNoise(screenCoordinate.xy).mul(6.28318530718);
    const compare = (i: number): Node<'float'> => {
      const uv = shadowCoord.xy.add(vogelDiskSample(float(i), float(5), phi).mul(radiusScaled));
      let depth = texture(depthTexture, uv);
      if (depthTexture.isArrayTexture) depth = depth.depth(depthLayer);
      return depth.compare(shadowCoord.z).toFloat();
    };
    return add(compare(0), compare(1), compare(2), compare(3), compare(4)).mul(1 / 5);
  }
);

/** Cache only the CSM expression, never shader builds, values or shadow draws. */
export class StableCSMShadowNode extends CSMShadowNode {
  declare _stableOutput: ReturnType<CSMShadowNode['setup']>;
  declare _stableFade: boolean;
  declare _stableCascades: number;
  _cameraProjection = new Matrix4();

  override updateFrustums(): void {
    super.updateFrustums();
    if (this.camera) this._cameraProjection.copy(this.camera.projectionMatrix);
  }

  // Called before the graph applies temporal jitter. Refit only real lens
  // changes, retaining the lights, split vectors and cached shader expression.
  refreshCameraFrustums(): void {
    if (this.camera && !this._cameraProjection.equals(this.camera.projectionMatrix))
      this.updateFrustums();
  }

  override setup(builder: NodeBuilder): ReturnType<CSMShadowNode['setup']> {
    // The inherited Fn still runs setupShadowPosition for each builder/context.
    // Its camera, split and far-distance references remain live native nodes.
    if (
      !this._stableOutput ||
      this.camera === null ||
      this._stableFade !== this.fade ||
      this._stableCascades !== this.cascades
    ) {
      this._stableOutput = super.setup(builder);
      this._stableFade = this.fade;
      this._stableCascades = this.cascades;
    }
    for (const light of this.lights) {
      const shadow = light.shadow;
      if (!shadow) continue;
      if (!(this.light instanceof DirectionalLight))
        throw new Error('[render] CSM requires a directional light');
      shadow.biasNode ??= cascadeBias(shadow, this.light);
      if (builder.renderer.shadowMap.type === PCFShadowMap) {
        if (!('filterNode' in shadow) || !shadow.filterNode)
          Object.assign(shadow, { filterNode: stablePCFShadowFilter });
      } else if ('filterNode' in shadow && shadow.filterNode === stablePCFShadowFilter) {
        shadow.filterNode = null;
      }
    }
    return this._stableOutput;
  }
}

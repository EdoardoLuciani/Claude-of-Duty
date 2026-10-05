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
import { Matrix4, PCFShadowMap } from 'three/webgpu';
import { CSMShadowNode } from 'three/addons/csm/CSMShadowNode.js';
import { Fn, abs, add, dot, interleavedGradientNoise, lightPosition, lightTargetPosition,
  max, normalWorldGeometry, reference, renderGroup, screenCoordinate, sqrt,
  texture, vec2, vogelDiskSample } from 'three/tsl';

// PCF spans neighboring depth texels on a sloping receiver. Express the
// conservative receiver bias in cascade texels, not a resolution-independent
// normalized-depth constant. Keep the authored normal offset and base bias.
export const CSM_BIAS = Object.freeze({ texels: 0.5, slopeTexels: 1.5, maxSlope: 5 });
function cascadeBias(shadow, key) {
  const field = (name, object) => reference(name, 'float', object).setGroup(renderGroup);
  const camera = shadow.camera;
  const width = field('right', camera).sub(field('left', camera));
  const range = field('far', camera).sub(field('near', camera));
  const mapSize = reference('mapSize', 'vec2', shadow).setGroup(renderGroup);
  const base = field('bias', shadow);
  const direction = lightPosition(key).sub(lightTargetPosition(key)).normalize();
  return Fn(() => {
    const cosine = abs(dot(normalWorldGeometry, direction)).clamp(0.12, 1).toVar();
    const slope = sqrt(max(0, cosine.mul(cosine).oneMinus())).div(cosine).min(CSM_BIAS.maxSlope);
    return base.sub(width.div(mapSize.x).mul(slope.mul(CSM_BIAS.slopeTexels).add(CSM_BIAS.texels)).div(max(range, 1)));
  })();
}

// Same five-sample Vogel/IGN PCF as Three 0.186.1's PCFShadowFilter. Only the
// parameter-node lifetime differs: one pair per shadow, not per shader build.
// Otherwise fresh reference IDs fragment the render bind group by material,
// making every draw compare/upload the same camera and light coefficients.
const shadowFields = new WeakMap();
export const stablePCFShadowFilter = Fn(({ depthTexture, shadowCoord, shadow, depthLayer }) => {
  let fields = shadowFields.get(shadow);
  if (!fields) {
    fields = {
      mapSize: reference('mapSize', 'vec2', shadow).setGroup(renderGroup),
      radius: reference('radius', 'float', shadow).setGroup(renderGroup),
    };
    shadowFields.set(shadow, fields);
  }
  const radiusScaled = fields.radius.mul(vec2(1).div(fields.mapSize).x);
  const phi = interleavedGradientNoise(screenCoordinate.xy).mul(6.28318530718);
  const compare = i => {
    const uv = shadowCoord.xy.add(vogelDiskSample(i, 5, phi).mul(radiusScaled));
    let depth = texture(depthTexture, uv);
    if (depthTexture.isArrayTexture) depth = depth.depth(depthLayer);
    return depth.compare(shadowCoord.z);
  };
  return add(compare(0), compare(1), compare(2), compare(3), compare(4)).mul(1 / 5);
});

/** Cache only the CSM expression, never shader builds, values or shadow draws. */
export class StableCSMShadowNode extends CSMShadowNode {
  _cameraProjection = new Matrix4();

  updateFrustums() {
    super.updateFrustums();
    this._cameraProjection.copy(this.camera.projectionMatrix);
  }

  // Called before the graph applies temporal jitter. Refit only real lens
  // changes, retaining the lights, split vectors and cached shader expression.
  refreshCameraFrustums() {
    if (this.camera && !this._cameraProjection.equals(this.camera.projectionMatrix))
      this.updateFrustums();
  }

  setup(builder) {
    // The inherited Fn still runs setupShadowPosition for each builder/context.
    // Its camera, split and far-distance references remain live native nodes.
    if (!this._stableOutput || this.camera === null ||
        this._stableFade !== this.fade || this._stableCascades !== this.cascades) {
      this._stableOutput = super.setup(builder);
      this._stableFade = this.fade;
      this._stableCascades = this.cascades;
    }
    for (const light of this.lights) {
      light.shadow.biasNode ??= cascadeBias(light.shadow, this.light);
      if (builder.renderer.shadowMap.type === PCFShadowMap) {
        light.shadow.filterNode ??= stablePCFShadowFilter;
      } else if (light.shadow.filterNode === stablePCFShadowFilter) {
        light.shadow.filterNode = null;
      }
    }
    return this._stableOutput;
  }
}

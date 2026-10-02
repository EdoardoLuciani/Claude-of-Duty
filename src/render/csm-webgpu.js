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
import { PCFShadowMap } from 'three/webgpu';
import { CSMShadowNode } from 'three/addons/csm/CSMShadowNode.js';
import { Fn, add, interleavedGradientNoise, reference, renderGroup, screenCoordinate,
  texture, vec2, vogelDiskSample } from 'three/tsl';

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
      if (builder.renderer.shadowMap.type === PCFShadowMap) {
        light.shadow.filterNode ??= stablePCFShadowFilter;
      } else if (light.shadow.filterNode === stablePCFShadowFilter) {
        light.shadow.filterNode = null;
      }
    }
    return this._stableOutput;
  }
}

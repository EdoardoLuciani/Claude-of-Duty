import {
  ClampToEdgeWrapping, FloatType, HalfFloatType, LinearFilter, Mesh,
  MeshBasicNodeMaterial, NoColorSpace, OrthographicCamera, PlaneGeometry,
  RGBAFormat, RenderTarget, Scene,
} from 'three/webgpu';

/**
 * Full-screen TSL bake plumbing, local to the sky subsystem.
 *
 * `src/render/pass.js` has an equivalent WebGL pass helper, but ARCHITECTURE.md
 * forbids importing another subsystem's module, so we keep our own tiny copy.
 * One shared geometry / scene / camera / mesh, and one node material per step —
 * the material never changes after construction, so the WebGPU pipeline cache is
 * warm by the second bake.
 *
 * The plane is drawn through an orthographic camera with `uv()` as the fragment
 * coordinate, which is exactly how `tools/material-node` bakes its surfaces.
 */

const geometry = new PlaneGeometry(2, 2);
const scene = new Scene();
scene.matrixAutoUpdate = false;
const camera = new OrthographicCamera(-1, 1, 1, -1, 0.1, 10);
camera.position.z = 2;
const mesh = new Mesh(geometry, null);
mesh.frustumCulled = false;
mesh.matrixAutoUpdate = false;
scene.add(mesh);

const RT_OPTIONS = {
  depthBuffer: false,
  stencilBuffer: false,
  generateMipmaps: false,
};

/** A full-screen TSL node step. */
export class BakePass {
  constructor(name, colorNode) {
    this.material = new MeshBasicNodeMaterial({
      name,
      depthTest: false,
      depthWrite: false,
      toneMapped: false,
    });
    this.material.colorNode = colorNode;
  }

  render(renderer, target) {
    const previous = renderer.getRenderTarget();
    mesh.material = this.material;
    renderer.setRenderTarget(target);
    renderer.render(scene, camera);
    renderer.setRenderTarget(previous);
  }

  dispose() {
    this.material.dispose();
  }
}

/** Half-float colour target. Sky radiance is HDR and physically scaled. */
export function hdrTarget(width, height, opts = {}) {
  const rt = new RenderTarget(Math.max(1, width | 0), Math.max(1, height | 0), {
    type: HalfFloatType,
    format: RGBAFormat,
    minFilter: LinearFilter,
    magFilter: LinearFilter,
    wrapS: ClampToEdgeWrapping,
    wrapT: ClampToEdgeWrapping,
    colorSpace: NoColorSpace,
    ...RT_OPTIONS,
    ...opts,
  });
  rt.texture.name = opts.name ?? 'sky-hdr';
  return rt;
}

/** Float32 target — used for the transmittance LUT, where banding shows. */
export function floatTarget(width, height, opts = {}) {
  return hdrTarget(width, height, { ...opts, type: FloatType });
}

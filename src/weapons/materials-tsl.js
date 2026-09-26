import { AdditiveBlending, ClampToEdgeWrapping, Color, DataTexture, DoubleSide,
  LinearFilter, MeshBasicNodeMaterial, MeshPhysicalNodeMaterial, RGBAFormat } from 'three/webgpu';
import { texture } from 'three/tsl';
import { ENV_OCCLUSION, WEAPON_MATERIALS } from './materials.js';

/** Viewmodel materials backed by the strict-WebGPU procedural material library. */
export class WeaponMaterialsNode {
  constructor(library) {
    this.lib = library;
    this.cache = new Map();
    this.owned = [];
    this.rimTexture = null;
  }

  get(key) {
    if (key === 'cavity') return this.cavity();
    if (key === 'optic_tube') return this.opticTube();
    if (key === 'glass') return this.glass();
    if (key === 'lens_ring') return this.lensRing();
    if (key === 'lens_vig') return this.lensVignette();
    const cached = this.cache.get(key);
    if (cached) return cached;
    const def = WEAPON_MATERIALS[key];
    if (!def) throw new Error(`[weapon] unknown material "${key}"`);
    const mat = this.lib.get(def[0], def[1]);
    mat.envMapIntensity = ENV_OCCLUSION;
    mat.needsUpdate = true;
    this.cache.set(key, mat);
    return mat;
  }

  own(key, mat) {
    mat.name = `ow-${key}`;
    this.cache.set(key, mat);
    this.owned.push(mat);
    return mat;
  }

  cavity() {
    if (this.cache.has('cavity')) return this.cache.get('cavity');
    return this.own('cavity', new MeshPhysicalNodeMaterial({
      color: 0x0a0c0e, roughness: 1, metalness: 0,
      specularIntensity: 0.04, envMapIntensity: 0.18, side: DoubleSide,
    }));
  }

  opticTube() {
    if (this.cache.has('optic_tube')) return this.cache.get('optic_tube');
    return this.own('optic_tube', new MeshPhysicalNodeMaterial({
      color: 0x1d2023, roughness: 0.9, metalness: 0,
      specularIntensity: 0.12, envMapIntensity: 0.3, side: DoubleSide,
    }));
  }

  glass(tint = 0x3b6e8c) {
    const key = `glass:${tint}`;
    if (this.cache.has(key)) return this.cache.get(key);
    return this.own(key, new MeshPhysicalNodeMaterial({
      color: 0x121c22, transparent: true, opacity: 0.1, roughness: 0.03,
      metalness: 0, ior: 1.52, reflectivity: 0.55, specularIntensity: 1,
      specularColor: new Color(0x59c489), iridescence: 1, iridescenceIOR: 1.4,
      iridescenceThicknessRange: [220, 560], sheen: 0.42,
      sheenColor: new Color(0xa856b8), sheenRoughness: 0.3,
      envMapIntensity: 2.4, side: DoubleSide, depthWrite: false,
      premultipliedAlpha: true,
    }));
  }

  lensRing(intensity = 0.14) {
    const key = `lensRing:${intensity}`;
    if (this.cache.has(key)) return this.cache.get(key);
    return this.own(key, new MeshBasicNodeMaterial({
      color: new Color(0x9fc4d8).multiplyScalar(intensity),
      transparent: true, opacity: 0.5, blending: AdditiveBlending,
      depthWrite: false, side: DoubleSide, toneMapped: true,
    }));
  }

  rimRamp() {
    if (this.rimTexture) return this.rimTexture;
    const N = 64, data = new Uint8Array(N * N * 4);
    for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
      const r = Math.min(1, Math.hypot((x + 0.5) / N - 0.5, (y + 0.5) / N - 0.5) * 2);
      const t = Math.max(0, (r - 0.8) / 0.2);
      const i = (y * N + x) * 4;
      data[i] = data[i + 1] = data[i + 2] = 255;
      data[i + 3] = Math.round(t * t * (3 - 2 * t) * 255);
    }
    const texture = new DataTexture(data, N, N, RGBAFormat);
    texture.needsUpdate = true;
    texture.minFilter = texture.magFilter = LinearFilter;
    texture.wrapS = texture.wrapT = ClampToEdgeWrapping;
    texture.generateMipmaps = false;
    this.rimTexture = texture;
    return texture;
  }

  lensVignette(strength = 0.34) {
    const key = `vignette:${strength}`;
    if (this.cache.has(key)) return this.cache.get(key);
    const mat = new MeshBasicNodeMaterial({
      color: 0x05070a, transparent: true, depthWrite: false,
      side: DoubleSide, toneMapped: true,
    });
    // The procedural ramp is in A (legacy alphaMap reads G instead).
    // Use the actual alpha channel so the center of the aperture stays clear.
    mat.opacityNode = texture(this.rimRamp()).a.mul(strength);
    return this.own(key, mat);
  }

  reticleOutline(opacity = 0.8) {
    const key = `reticleOutline:${opacity}`;
    if (this.cache.has(key)) return this.cache.get(key);
    return this.own(key, new MeshBasicNodeMaterial({
      color: 0x14060a, transparent: true, opacity, depthWrite: false,
      depthTest: true, side: DoubleSide, toneMapped: false,
    }));
  }

  reticle(color = 0xff2a12, intensity = 6.5) {
    const key = `reticle:${color}:${intensity}`;
    if (this.cache.has(key)) return this.cache.get(key);
    return this.own(key, new MeshBasicNodeMaterial({
      color: new Color(color).multiplyScalar(intensity), transparent: true,
      opacity: 1, blending: AdditiveBlending, depthWrite: false,
      depthTest: true, side: DoubleSide, toneMapped: true,
    }));
  }

  dispose() {
    for (const mat of this.owned) mat.dispose();
    this.rimTexture?.dispose();
    this.owned.length = 0;
    this.cache.clear();
  }
}

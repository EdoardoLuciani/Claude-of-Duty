import * as THREE from 'three';
import {
  atan,
  attribute,
  clamp,
  float,
  materialColor,
  materialRoughness,
  max,
  mix,
  smoothstep,
  step,
  texture as textureNode,
  uniform,
  vec2,
  vec3,
  vec4,
} from 'three/tsl';
import type { MeshStandardNodeMaterial, Node } from 'three/webgpu';

// Cylindrical bind-space stains, in turns around the sleeve and metres from
// the wrist. Fixed placement keeps captures reproducible without consuming RNG.
const STAINS = [
  [0.1, 0.095, 0.085, 0.04],
  [0.17, 0.145, 0.065, 0.06],
  [0.42, 0.08, 0.1, 0.028],
  [0.51, 0.205, 0.08, 0.07],
  [0.72, 0.125, 0.11, 0.05],
  [0.87, 0.25, 0.075, 0.065],
  [0.04, 0.33, 0.07, 0.06],
  [0.34, 0.39, 0.09, 0.055],
  [0.65, 0.47, 0.08, 0.075],
  [0.91, 0.545, 0.09, 0.045],
];
const WIDTH = 256,
  HEIGHT = 512,
  LENGTH = 0.64;

function hash(x: number, y: number): number {
  let h = Math.imul(x ^ 0x27d4eb2d, 0x85ebca6b);
  h = Math.imul(h ^ y, 0xc2b2ae35);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

// Periodic value noise: no visible sine bands and no azimuth seam.
function noise(u: number, v: number, scale: number): number {
  const x = u * scale,
    y = v * scale;
  const ix = Math.floor(x),
    iy = Math.floor(y);
  const fx = THREE.MathUtils.smoothstep(x - ix, 0, 1);
  const fy = THREE.MathUtils.smoothstep(y - iy, 0, 1);
  const a = hash(ix % scale, iy),
    b = hash((ix + 1) % scale, iy);
  const c = hash(ix % scale, iy + 1),
    d = hash((ix + 1) % scale, iy + 1);
  return THREE.MathUtils.lerp(THREE.MathUtils.lerp(a, b, fx), THREE.MathUtils.lerp(c, d, fx), fy);
}

/** One shared density/clot/wetness map, made at boot, never uploaded on hits. */
interface ArmBlood {
  texture: THREE.DataTexture;
  amount: ReturnType<typeof uniform>;
  setHealthFraction(fraction: number): void;
  decorate(
    material: MeshStandardNodeMaterial,
    base?: Node<'vec3'>,
    roughness?: Node<'float'>,
    eligible?: Node<'float'>
  ): void;
}
export function createArmBlood(): ArmBlood {
  const stains = [...STAINS];
  // Satellite droplets around the larger contact smears, not evenly tiled dots.
  for (let i = 0; i < 96; i++) {
    const [u, z, ru, rz] = STAINS[i % STAINS.length];
    const angle = hash(i, 1) * Math.PI * 2;
    const spread = 0.7 + hash(i, 2) * 0.9;
    const r = 0.003 + hash(i, 3) * 0.009;
    stains.push([
      (u + Math.cos(angle) * ru * spread + 1) % 1,
      z + Math.sin(angle) * rz * spread,
      r * 1.4,
      r * 0.45,
    ]);
  }
  const data = new Uint8Array(WIDTH * HEIGHT * 4);
  for (let y = 0; y < HEIGHT; y++) {
    const v = (y + 0.5) / HEIGHT,
      z = v * LENGTH;
    for (let x = 0; x < WIDTH; x++) {
      const u = (x + 0.5) / WIDTH;
      const coarse = noise(u, v, 16),
        fine = noise(u, v, 64);
      const fibers = noise(u, v * 4, 128);
      const warp = (coarse - 0.5) * 0.65 + (fine - 0.5) * 0.3;
      const support = 1.25 - warp; // Outside this radius both core and halo are zero.
      let density = 0;
      for (const [cu, cz, ru, rz] of stains) {
        const dz = (z - cz) / rz;
        if (Math.abs(dz) > support) continue;
        const du = Math.abs(u - cu);
        const dx = Math.min(du, 1 - du) / ru;
        if (dx > support) continue;
        const radius = Math.hypot(dx, dz) + warp;
        // Dense irregular centres and a thin capillary halo along cloth fibers.
        const core = 1 - THREE.MathUtils.smoothstep(radius, 0.48, 0.98);
        const halo = (1 - THREE.MathUtils.smoothstep(radius, 0.85, 1.25)) * 0.24 * fibers;
        density = Math.max(density, core + halo);
      }
      density *=
        (0.88 + 0.12 * fibers) *
        THREE.MathUtils.smoothstep(z, 0.025, 0.045) *
        (1 - THREE.MathUtils.smoothstep(z, 0.6, LENGTH));
      const i = (y * WIDTH + x) * 4;
      data[i] = Math.round(Math.min(1, density) * 255);
      data[i + 1] = Math.round((0.55 * coarse + 0.45 * fine) * 255);
      data[i + 2] = Math.round(THREE.MathUtils.smoothstep(density, 0.72, 0.98) * fine * 255);
      data[i + 3] = 255;
    }
  }
  const texture = new THREE.DataTexture(data, WIDTH, HEIGHT);
  texture.name = 'arm-blood-mask';
  texture.wrapS = THREE.RepeatWrapping;
  texture.minFilter = texture.magFilter = THREE.LinearFilter;
  texture.needsUpdate = true;
  const amount = uniform(0);
  const p = attribute('armBloodPosition', 'vec3');
  const uv = vec2(
    atan(p.y, p.x)
      .div(Math.PI * 2)
      .add(0.5),
    p.z.div(LENGTH)
  );
  const sample = textureNode(texture).sample(uv);
  const blood = smoothstep(float(1).sub(amount), float(1.12).sub(amount), sample.r)
    .mul(step(0.0001, amount))
    .toVar('armBlood');
  const soaked = smoothstep(
    max(0.02, float(0.82).sub(amount)),
    max(0.08, float(1.08).sub(amount)),
    sample.r
  ).mul(smoothstep(0, 0.2, amount));
  return {
    texture,
    amount,
    setHealthFraction(fraction: number): void {
      if (Number.isFinite(fraction)) amount.value = 1 - Math.max(0, Math.min(1, fraction));
    },
    decorate(
      material: MeshStandardNodeMaterial,
      base = materialColor.rgb,
      roughness = materialRoughness,
      eligible = float(1)
    ): void {
      // Explicit bases let a consolidated surface retain its authored maps/factors.
      // Eligibility excludes glove surfaces even where their bind positions overlap.
      const localizedBlood = blood.mul(eligible);
      const localizedSoaked = soaked.mul(eligible);
      const stained = mix(vec3(0.004, 0.0003, 0.00035), vec3(0.018, 0.0007, 0.0012), sample.g).mul(
        clamp(base.rgb.mul(12), vec3(0.55), vec3(1))
      );
      const absorbed = mix(
        base.rgb,
        base.rgb.mul(vec3(0.32, 0.1, 0.08)),
        localizedSoaked.mul(0.65)
      );
      material.colorNode = vec4(mix(absorbed, stained, localizedBlood), 1);
      material.roughnessNode = mix(
        roughness,
        mix(0.88, 0.6, sample.b.mul(localizedBlood)),
        localizedBlood
      );
      // Same graph at full health and injured: no mid-combat permutations.
      material.customProgramCacheKey = (): string => 'arm-blood-tsl-v2';
    },
  };
}

/** Separate bind coordinates survive skinning and do not disturb either UV set. */
export function addArmBloodCoordinates(
  geometry: THREE.BufferGeometry,
  source: THREE.SkinnedMesh,
  side: number
): void {
  const positions = source.geometry.getAttribute('position').clone();
  positions.applyMatrix4(source.matrixWorld);
  // Offset the right arm's pattern rather than repeat an identical pair of marks.
  if (side > 0) positions.applyMatrix4(new THREE.Matrix4().makeRotationZ(0.9));
  geometry.setAttribute('armBloodPosition', positions);
}

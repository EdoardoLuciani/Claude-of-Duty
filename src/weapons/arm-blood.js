import * as THREE from 'three';
import { atan, attribute, clamp, float, materialColor, materialRoughness, max, mix, smoothstep, step,
  texture as textureNode, uniform, vec2, vec3, vec4 } from 'three/tsl';

// Cylindrical bind-space stains, in turns around the sleeve and metres from
// the wrist. Fixed placement keeps captures reproducible without consuming RNG.
const STAINS = [
  [.10, .095, .085, .040], [.17, .145, .065, .060],
  [.42, .080, .100, .028], [.51, .205, .080, .070],
  [.72, .125, .110, .050], [.87, .250, .075, .065],
  [.04, .330, .070, .060], [.34, .390, .090, .055],
  [.65, .470, .080, .075], [.91, .545, .090, .045],
];
const WIDTH = 256, HEIGHT = 512, LENGTH = .64;

function hash(x, y) {
  let h = Math.imul(x ^ 0x27d4eb2d, 0x85ebca6b);
  h = Math.imul(h ^ y, 0xc2b2ae35);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

// Periodic value noise: no visible sine bands and no azimuth seam.
function noise(u, v, scale) {
  const x = u * scale, y = v * scale;
  const ix = Math.floor(x), iy = Math.floor(y);
  const fx = THREE.MathUtils.smoothstep(x - ix, 0, 1);
  const fy = THREE.MathUtils.smoothstep(y - iy, 0, 1);
  const a = hash(ix % scale, iy), b = hash((ix + 1) % scale, iy);
  const c = hash(ix % scale, iy + 1), d = hash((ix + 1) % scale, iy + 1);
  return THREE.MathUtils.lerp(THREE.MathUtils.lerp(a, b, fx), THREE.MathUtils.lerp(c, d, fx), fy);
}

/** One shared density/clot/wetness map, made at boot, never uploaded on hits. */
export function createArmBlood() {
  const stains = [...STAINS];
  // Satellite droplets around the larger contact smears, not evenly tiled dots.
  for (let i = 0; i < 96; i++) {
    const [u, z, ru, rz] = STAINS[i % STAINS.length];
    const angle = hash(i, 1) * Math.PI * 2;
    const spread = .7 + hash(i, 2) * .9;
    const r = .003 + hash(i, 3) * .009;
    stains.push([(u + Math.cos(angle) * ru * spread + 1) % 1,
      z + Math.sin(angle) * rz * spread, r * 1.4, r * .45]);
  }
  const data = new Uint8Array(WIDTH * HEIGHT * 4);
  for (let y = 0; y < HEIGHT; y++) {
    const v = (y + .5) / HEIGHT, z = v * LENGTH;
    for (let x = 0; x < WIDTH; x++) {
      const u = (x + .5) / WIDTH;
      const coarse = noise(u, v, 16), fine = noise(u, v, 64);
      const fibers = noise(u, v * 4, 128);
      const warp = (coarse - .5) * .65 + (fine - .5) * .3;
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
        const core = 1 - THREE.MathUtils.smoothstep(radius, .48, .98);
        const halo = (1 - THREE.MathUtils.smoothstep(radius, .85, 1.25)) * .24 * fibers;
        density = Math.max(density, core + halo);
      }
      density *= (.88 + .12 * fibers) * THREE.MathUtils.smoothstep(z, .025, .045) *
        (1 - THREE.MathUtils.smoothstep(z, .60, LENGTH));
      const i = (y * WIDTH + x) * 4;
      data[i] = Math.round(Math.min(1, density) * 255);
      data[i + 1] = Math.round((.55 * coarse + .45 * fine) * 255);
      data[i + 2] = Math.round(THREE.MathUtils.smoothstep(density, .72, .98) * fine * 255);
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
  const uv = vec2(atan(p.y, p.x).div(Math.PI * 2).add(.5), p.z.div(LENGTH));
  const sample = textureNode(texture).sample(uv);
  const blood = smoothstep(float(1).sub(amount), float(1.12).sub(amount), sample.r)
    .mul(step(.0001, amount)).toVar('armBlood');
  const soaked = smoothstep(max(.02, float(.82).sub(amount)), max(.08, float(1.08).sub(amount)), sample.r)
    .mul(smoothstep(0, .20, amount));
  return {
    texture,
    amount,
    setHealthFraction(fraction) {
      if (Number.isFinite(fraction)) amount.value = 1 - Math.max(0, Math.min(1, fraction));
    },
    decorate(material) {
      // materialColor/materialRoughness retain the authored maps and factors;
      // the separate bind attribute survives the native skinning path.
      const base = materialColor;
      const stained = mix(vec3(.004, .0003, .00035), vec3(.018, .0007, .0012), sample.g)
        .mul(clamp(base.rgb.mul(12), vec3(.55), vec3(1)));
      const absorbed = mix(base.rgb, base.rgb.mul(vec3(.32, .10, .08)), soaked.mul(.65));
      material.colorNode = vec4(mix(absorbed, stained, blood), base.a);
      material.roughnessNode = mix(materialRoughness, mix(.88, .60, sample.b.mul(blood)), blood);
      // Same graph at full health and injured: no mid-combat permutations.
      material.customProgramCacheKey = () => 'arm-blood-tsl-v1';
    },
  };
}

/** Separate bind coordinates survive skinning and do not disturb either UV set. */
export function addArmBloodCoordinates(geometry, source, side) {
  const positions = source.geometry.getAttribute('position').clone();
  positions.applyMatrix4(source.matrixWorld);
  // Offset the right arm's pattern rather than repeat an identical pair of marks.
  if (side > 0) positions.applyMatrix4(new THREE.Matrix4().makeRotationZ(.9));
  geometry.setAttribute('armBloodPosition', positions);
}

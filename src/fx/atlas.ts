import * as THREE from 'three';

import { isClosable } from '../core/guards.ts';
import { loadPngTexture } from '../core/pngtex.ts';
import type { Rng } from '../core/rng.ts';
import { Noise, clamp01 } from './noise.ts';

/** Runtime atlas layout/loaders. Particle/decal generation lives in tools/lib. */
// ---------------------------------------------------------------------------
//  particle atlas layout (4x4)
// ---------------------------------------------------------------------------
export const P = {
  SMOKE_A: 0,
  SMOKE_B: 1,
  WISP: 2,
  DUST: 3,
  SPARK: 4,
  STREAK: 5,
  FLASH_LOBE: 6,
  FLASH_CORE: 7,
  CHIP: 8,
  SPLINTER: 9,
  DROPLET: 10,
  MIST: 11,
  SPLASH: 12,
  RING: 13,
  FIRE: 14,
  MOTE: 15,
};

// ---------------------------------------------------------------------------
//  decal atlas layout (4x4)
// ---------------------------------------------------------------------------
export const D = {
  HOLE_CONCRETE: 0,
  HOLE_CONCRETE_B: 1,
  HOLE_METAL: 2,
  HOLE_WOOD: 3,
  HOLE_PLASTER: 4,
  GLASS_CRACK: 5,
  BLOOD_A: 6,
  BLOOD_B: 7,
  SCORCH: 8,
  IMPACT_DIRT: 9,
  IMPACT_SAND: 10,
  SCRAPE: 11,
  RIPPLE: 12,
  HOLE_GLASS: 13,
  SMUDGE: 14,
  TEAR: 15,
};

const ATLAS_COLS = 4;

export function makeTexture(
  data: Uint8Array,
  size: number,
  { srgb, mips = true, name }: { srgb: boolean; mips?: boolean; name: string }
): THREE.DataTexture {
  const t = new THREE.DataTexture(data, size, size, THREE.RGBAFormat, THREE.UnsignedByteType);
  t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
  t.minFilter = mips ? THREE.LinearMipmapLinearFilter : THREE.LinearFilter;
  t.magFilter = THREE.LinearFilter;
  t.generateMipmaps = mips;
  t.anisotropy = 4;
  t.name = name;
  t.needsUpdate = true;
  return t;
}

export async function loadFxAtlases(size: number): Promise<{
  particles: { texture: THREE.Texture; cols: number; size: number };
  decals: {
    albedo: THREE.Texture;
    normal: THREE.Texture;
    orm: THREE.Texture;
    cols: number;
    size: number;
  };
}> {
  const wrap = THREE.ClampToEdgeWrapping;
  const aniso = 4;
  const results = await Promise.allSettled([
    loadPngTexture(`/models/proc/fx-particles-${size}.png`, { srgb: true, aniso, wrap }),
    loadPngTexture(`/models/proc/fx-decals-${size}-albedo.png`, { srgb: true, aniso, wrap }),
    loadPngTexture(`/models/proc/fx-decals-${size}-normal.png`, { srgb: false, aniso, wrap }),
    loadPngTexture(`/models/proc/fx-decals-${size}-orm.png`, { srgb: false, aniso, wrap }),
  ]);
  const textures = results
    .filter(
      (result): result is PromiseFulfilledResult<THREE.Texture> => result.status === 'fulfilled'
    )
    .map((result): THREE.Texture => result.value);
  const failed = results.find(
    (result): result is PromiseRejectedResult => result.status === 'rejected'
  );
  if (failed) {
    for (const texture of textures) {
      texture.dispose();
      const image: unknown = texture.source.data;
      if (isClosable(image)) image.close();
    }
    throw failed.reason;
  }
  const [texture, albedo, normal, orm] = textures;
  return {
    particles: { texture, cols: ATLAS_COLS, size },
    decals: { albedo, normal, orm, cols: ATLAS_COLS, size },
  };
}

/**
 * Brass casing maps: drawn seams, extractor scuffing and a machined-rim
 * roughness break so casings never read as plastic.
 */
export function buildBrassTextures(
  rng: Rng,
  size = 256
): { normal: THREE.DataTexture; orm: THREE.DataTexture } {
  const n = new Noise(rng);
  const normal = new Uint8Array(size * size * 4);
  const orm = new Uint8Array(size * size * 4);
  const h = new Float32Array(size * size);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const u = x / size;
      const v = y / size;
      // Drawing marks run along the casing axis (V), machining rings across it.
      const draw = n.fbm(u * 42, v * 3.5, 3);
      const rings = Math.sin(v * 190) * 0.5 + 0.5;
      const scuff = Math.pow(clamp01(1 - n.worleyEdge(u * 9, v * 9) * 7), 2);
      h[y * size + x] = 0.5 + (draw - 0.5) * 0.35 + (rings - 0.5) * 0.08 - scuff * 0.25;
      const i = (y * size + x) * 4;
      // AO in the scuffs, roughness up where the brass is abraded.
      orm[i] = clamp01(1 - scuff * 0.55) * 255;
      orm[i + 1] = clamp01(0.19 + 0.3 * scuff + 0.12 * draw) * 255;
      orm[i + 2] = 255;
      orm[i + 3] = 255;
    }
  }
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const at = (dx: number, dy: number): number =>
        h[((((y + dy) % size) + size) % size) * size + ((((x + dx) % size) + size) % size)];
      const gx = (at(1, 0) - at(-1, 0)) * 5;
      const gy = (at(0, 1) - at(0, -1)) * 5;
      let nx = -gx;
      let ny = -gy;
      let nz = 1;
      const l = Math.hypot(nx, ny, nz) || 1;
      const i = (y * size + x) * 4;
      normal[i] = ((nx / l) * 0.5 + 0.5) * 255;
      normal[i + 1] = ((ny / l) * 0.5 + 0.5) * 255;
      normal[i + 2] = ((nz / l) * 0.5 + 0.5) * 255;
      normal[i + 3] = 255;
    }
  }
  const nt = makeTexture(normal, size, { srgb: false, name: 'fx-brass-normal' });
  const ot = makeTexture(orm, size, { srgb: false, name: 'fx-brass-orm' });
  nt.wrapS = nt.wrapT = THREE.RepeatWrapping;
  ot.wrapS = ot.wrapT = THREE.RepeatWrapping;
  return { normal: nt, orm: ot };
}

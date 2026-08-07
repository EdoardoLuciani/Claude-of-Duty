# World GLB migration validation

The runtime world now defaults to build-time assets under `public/models/world/`:

- `level-visual.glb(.gz)` — visual meshes and `EXT_mesh_gpu_instancing`
- `level-collision.glb(.gz)` — dedicated low-poly static collision
- `level.json` — transform, bounds, spawns, building volumes, lights, and stats

`tools/export-world.mjs` runs automatically before Vite and validates a GLTFLoader
round trip. `?world=procedural` retains the old browser build path for A/B tests.

## Asset parity

| Metric | Procedural | GLB |
|---|---:|---:|
| Static triangles | 606,374 | 606,374 |
| Instanced triangles | 1,146,484 | 1,146,484 |
| Instances | 8,008 | 8,008 |
| World draw calls | 220 | 220 |
| Collision triangles | 38,580 | 38,580 |
| Collision objects | 8 | 8 |

Round-trip checks found exact position, normal, UV, color, index, surface, and
palette data. The loader restores authored float32 instance matrices and the few
non-unit authored normals from GLB extras/custom accessors. This avoids subpixel
TAA differences from glTF's required TRS decomposition and normal normalization.

Deterministic `hero` captures at 1280x720, 45 settle frames were compared with
`tools/imagediff.mjs --tol=0`: **0 changed pixels, max delta 0**.

Physics validation: `node src/physics/selftest.js` passed **55/55** checks.

## Asset size

| Asset | Raw | Default transfer |
|---|---:|---:|
| Visual GLB | 60.6 MB | 10.2 MB gzip |
| Collision GLB | 1.1 MB | 0.31 MB gzip |
| Manifest | 19 KB | 2.7 KB gzip |

The raw files are compatibility fallbacks. Modern browsers use the gzip package
and `DecompressionStream`; servers that set `Content-Encoding` are detected to
avoid double decompression.

## Startup benchmark

Chromium, 640x360, low preset, deterministic lockstep, prewarm disabled, HTTP
cache disabled. Two isolated runs per mode:

| Mode | World init | Ready time | JS heap at ready |
|---|---:|---:|---:|
| GLB | 151 / 1,129 ms | 12,198 / 12,932 ms | 133 / 135 MB |
| Procedural | 1,337 / 1,446 ms | 12,842 / 13,403 ms | 458 / 410 MB |
| Median | **640 ms** | **12,565 ms** | **134 MB** |
| Procedural median | **1,391 ms** | **13,123 ms** | **434 MB** |

On this machine the migration reduced median world initialization by **54%**,
total ready time by **4.2%**, and ready-time JS heap by roughly **69%**. Transfer
for the visual/collision/manifest set was 10.56 MB encoded and 64.67 MB decoded.
Network conditions will affect the GLB result; the raw measurements are included
above rather than presenting a single synthetic number.

## Runtime profile

`tools/profile.mjs`, 800x450 DPR 1, low preset, prewarm disabled, deterministic
capture seed, 240 measured firefight frames after a 60-frame warmup:

| Metric | Procedural | GLB |
|---|---:|---:|
| Frame p50 | 521.1 ms | 513.9 ms |
| Frame p95 | 602.5 ms | 593.3 ms |
| Programs compiled during play | 0 | 0 |
| Geometry resources | 232 | 232 |
| Texture resources | 72 | 72 |

This headless host is software/GPU constrained, so the absolute frame rates are
not representative. The relevant result is that GLB loading adds no steady-state
runtime cost: p50/p95 were within normal run variance (slightly faster in the GLB
run), with identical resource counts and no runtime shader compilation.

## Commands

```bash
npm run world
npm run build
node src/physics/selftest.js
node tools/baseline.mjs --port=8080 --out=/tmp/world-glb --shots=hero --w=1280 --h=720 --settle=45
node tools/imagediff.mjs --a=/tmp/world-procedural --b=/tmp/world-glb --tol=0
```

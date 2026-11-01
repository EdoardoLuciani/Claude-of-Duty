# World editing map

This directory is the authoritative world source. Normal dev/build consumes the
committed products in `public/models/world/`; `assets/world/` and Blender backups
are not build inputs. Runtime behavior lives separately in `src/world/`.

## Where to edit

| Task                                                                                           | Primary location                                                                     |
| ---------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| Change street, alleys, building footprints/floors/room plans, gate or set-piece specifications | [`level/layout.js`](level/layout.js)                                                 |
| Change level transform or player spawns                                                        | [`level/config.js`](level/config.js)                                                 |
| Change intel drop sites                                                                        | [`level/intel.js`](level/intel.js)                                                   |
| Move, rotate, scale, add or remove an explicit prop instance                                   | [`level/placements/`](level/placements/), by street/market/interior area             |
| Change a prop's shape                                                                          | [`props.js`](props.js); dressing-only prototypes are in [`dressing.js`](dressing.js) |
| Change building construction or facade elements                                                | [`buildings.js`](buildings.js), [`kit.js`](kit.js)                                   |
| Change attached room details                                                                   | [`interiors.js`](interiors.js)                                                       |
| Change procedural ground/dressing, cables or gate/perimeter construction                       | [`ground.js`](ground.js), [`dressing.js`](dressing.js)                               |
| Change authored surface appearance                                                             | [`src/world/palette.ts`](../../src/world/palette.ts), re-exported by `palette.js`    |

Coordinates in level records are in **level space, metres**. Placement rotations
are degrees; record IDs identify individual instances and prototypes identify
shapes. Keep IDs unique. `support: 'balcony'`, where present, is a diagnostic
annotation, not an instruction to generate a supporting surface.

`level/placements/index.js` only aggregates data, preserving the existing area
and record order. [`placement.js`](placement.js) separately validates records,
applies transforms/masks, and clears low clutter from traversal/volume sweeps.
Changing a record does not require changing the placement compiler. Do not
reorder prototype registration, RNG calls or placements during mechanical edits.

## What builds the level

```text
level/ records + geometry/dressing builders
    -> build.js -> Assembler (builder.js), canonical instance buckets
    -> tools/export-world.mjs
       visual GLB + pack.js collision cook + nav-bake.js navigation bake
    -> public/models/world/level.json + content-hashed compressed products
    -> src/core/models.ts -> src/world/, physics and AI
```

The assembler owns batching and geometry lifetime; support tools, collision and
navigation retain canonical geometry even where visuals use an owned derivative.
Never author a separate collision mesh or edit generated world products.
Navigation intentionally uses the real runtime physics/controller algorithms;
this shared correctness boundary is not a second world implementation.

## Regenerate and check

From the repository root after `npm ci`:

```sh
npm run world                  # regenerate visual, collision, nav and manifest
npm run world:validate         # validate products and provenance
npm run world -- --check       # deterministic regeneration check, no replacement
npm test
npm run build
# Optional isolated full build, without replacing committed world products:
npm run world -- --out=/tmp/world-review
```

Commit changed source and regenerated runtime products together. Source hashes
include paths and source bytes: moving files can change manifest/navigation
provenance even if geometry is identical. Compare geometry, collision and
navigation payloads independently of expected provenance changes. Keep hash
coverage when relocating scripts; `source-hash.js` recursively includes `.js`
and `.ts` under this directory and explicitly includes the exporter `.mjs`.

Other model families keep their own authoring pipelines under `tools/blender/`
and `tools/export-models.mjs`; this directory does not introduce a multi-map or
universal asset framework. See [ARCHITECTURE.md](../../ARCHITECTURE.md) for runtime
contracts and the [repository README](../../README.md) for setup/play.

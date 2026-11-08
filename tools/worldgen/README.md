# World editing map

This directory is authoritative world source; dev/build/tests generate missing or
stale `public/models/world/` products. Outputs are ignored, not committed.
Runtime behavior belongs to `src/world/`.

- `level/layout.js`: streets, buildings, rooms, gates and set pieces.
- `level/config.js`: transform/spawns; `level/intel.js`: intel drop sites.
- `level/placements/`: data-only prop transforms, grouped by area.
- `props.js`/`dressing.js`: props; `buildings.js`/`kit.js`: construction.
- `interiors.js`: attached details; `ground.js`/`dressing.js`: ground/cables.
- [Runtime palette](../../src/world/palette.ts): surface appearance.

Records use level-space metres, degree rotations and unique instance IDs.
`placement.js` owns validation, transforms/masks and clutter clearance.
Preserve record order. Procedural detail draws only from `keyedRng(...)` streams
named after the element that owns them (building, facade, room, set piece), so an
edit re-rolls that element alone; `smoke-world-locality.ts` enforces this. Never
pass one stream across elements or add draws to keep another element stable.

`build.js` → `Assembler`/`builder.js` → `tools/export-world.mjs` →
visual GLB, `pack.js` collision and `nav-bake.js` navigation →
manifest/content-hashed products → runtime model loader.
The assembler owns geometry lifetime; support/collision/navigation use canonical
geometry even when visuals have derivatives. Never author separate collision
meshes or hand-edit products. Navigation shares runtime controller algorithms.

Run from the repository root after `bun ci`:

```sh
bun run world
bun run world:validate
bun run world -- --check
bun run test
bun run build
```

Use `bun run world -- --out=/tmp/world-review` for isolated output.
Commit source only, not generated assets. `--force` rebuilds unchanged inputs and
`--check` verifies a fresh rebuild against the local outputs. Paths/source bytes affect provenance;
compare physical payloads separately from expected hash changes. `source-hash.js`
covers recursive JS/TS and the exporter. Other model families retain their own
pipelines. See [ARCHITECTURE.md](../../ARCHITECTURE.md) for runtime contracts.

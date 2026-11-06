# World editing map

This directory is authoritative world source; normal builds consume committed
`public/models/world/` products. Runtime behavior belongs to `src/world/`.

- `level/layout.js`: streets, buildings, rooms, gates and set pieces.
- `level/config.js`: transform/spawns; `level/intel.js`: intel drop sites.
- `level/placements/`: data-only prop transforms, grouped by area.
- `props.js`/`dressing.js`: props; `buildings.js`/`kit.js`: construction.
- `interiors.js`: attached details; `ground.js`/`dressing.js`: ground/cables.
- [Runtime palette](../../src/world/palette.ts): surface appearance.

Records use level-space metres, degree rotations and unique instance IDs.
`placement.js` owns validation, transforms/masks and clutter clearance.
Preserve record/prototype/RNG order.

`build.js` → `Assembler`/`builder.js` → `tools/export-world.mjs` →
visual GLB, `pack.js` collision and `nav-bake.js` navigation →
manifest/content-hashed products → runtime model loader.
The assembler owns geometry lifetime; support/collision/navigation use canonical
geometry even when visuals have derivatives. Never author separate collision
meshes or hand-edit products. Navigation shares runtime controller algorithms.

Run from the repository root after `npm ci`:

```sh
npm run world
npm run world:validate
npm run world -- --check
npm test
npm run build
```

Use `npm run world -- --out=/tmp/world-review` for isolated output.
Commit source and regenerated assets together. Paths/source bytes affect provenance;
compare physical payloads separately from expected hash changes. `source-hash.js`
covers recursive JS/TS and the exporter. Other model families retain their own
pipelines. See [ARCHITECTURE.md](../../ARCHITECTURE.md) for runtime contracts.

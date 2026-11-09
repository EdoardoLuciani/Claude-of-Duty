# World editing map

This directory is authoritative world source; dev/build/tests generate missing or
stale `public/models/world/` products. Outputs are ignored, not committed.
Runtime behavior belongs to `src/world/`.

- `level/layout.ts`: streets, buildings, rooms, gates and set pieces.
- `level/config.ts`: transform/spawns; `level/intel.ts`: intel drop sites.
- `level/placements/`: data-only prop transforms, one `PlacementRow` per line, grouped by area.
- `props.ts`/`dressing.ts`: props; `buildings.ts`/`kit.ts`: construction.
- `interiors.ts`: attached details; `ground.ts`/`dressing.ts`: ground/cables.
- [Runtime palette](../../src/world/palette.ts): surface appearance.

Records use level-space metres, degree rotations and unique instance IDs.
`placement.ts` owns validation, transforms/masks and clutter clearance.
Preserve record order. Procedural detail draws only from `keyedRng(...)` streams
named after the element that owns them (building, facade, room, set piece), so an
edit re-rolls that element alone; `smoke-world-locality.ts` enforces this. Never
pass one stream across elements or add draws to keep another element stable.
Seed with authored identities, not coordinates derived from trigonometry: engine-specific
last-bit rounding must not reroll dressing (`smoke-world-seed-stability.ts`).

`build.ts` → `Assembler`/`builder.ts` → `tools/export-world.ts` →
visual GLB, `pack.ts` collision and `nav-bake.ts` navigation →
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
compare physical payloads separately from expected hash changes. `source-hash.ts`
covers recursive JS/TS and the exporter. Other model families retain their own
pipelines. See [ARCHITECTURE.md](../../ARCHITECTURE.md) for runtime contracts.

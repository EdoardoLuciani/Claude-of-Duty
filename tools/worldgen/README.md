# World editing map

This directory is authoritative world source; dev/build/tests generate missing or
stale `public/models/world/` products. Outputs are ignored, not committed.
Runtime behavior belongs to `src/world/`.

- `level/layout.ts`: streets, buildings, rooms, gates and set pieces. Balcony slabs
  and railings are authored by facade side, floor and bay; a `balconyDoor` in
  `bayKinds` alone opens without a slab (e.g. onto a terrace). Solid street
  rubble has explicit footprints here.
- `level/frontages.ts`: playable facade bays, window sizes and obstructions,
  shop shutters, and awning depths/supports. A playable floor needs one entry
  per bay on each facade; unlisted backdrop facades may vary procedurally.
- `level/pavement.ts`, `level/ground-covers.ts`, `level/ground-stones.ts`:
  authored pavement spans, covers and loose stones in level space. Pavement may
  not cover an alley mouth; stones are seated on the ground at build time.
- `level/room-fixtures.ts`: room dressing by building, floor and room ID.
  Counter footprints and their goods share a record. Shelf, counter and bench
  goods use offsets from their support. Ceiling joists are a count spread across
  the room; ruin rubble is a seeded mound. Shelves, conduits and leaning sheets
  fail the bake when their wall or clearance is gone.
- `level/roof-fixtures.ts`: aerials and laundry relative to the roof footprint;
  garments hang evenly spaced along the authored cable.
- `level/config.ts`: transform/spawns; `level/intel.ts`: intel drop sites.
- `level/training.ts`: Training Grounds geometry and metadata. `level/training-layout.ts`
  defines the target faces and station for geometry and manifest generation;
  `level/training-markings.ts` adds paint without a second physical layer.
- `level/placements/`: data-only prop transforms, one `PlacementRow` per line, grouped by area.
- `props.ts`/`dressing.ts`: props; `buildings.ts`/`kit.ts`: construction.
- `industrial-props.ts`: reusable barrier and platform with [Blender-authored meshes](../blender/industrial_props/README.md).
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

## Add a playable map

1. Author geometry and metadata (bounds, spawns, lights, and any query/marker data)
   with `Assembler`.
2. Add an entry to [`src/core/playable-maps.ts`](../../src/core/playable-maps.ts)
   with a stable unique ID, menu label, unique bundle directory relative to
   `public/models/world/`, and an existing session mode. The root bundle stays
   reserved for Survival. An optional `startIntro` orients players in the Start gate.
3. Register its geometry-and-metadata builder under the same ID in
   `playable-builds.ts`. The chooser, session boot, and exporter use the catalog;
   maps can share a mode without sharing a bundle or adding startup branches.

Range metadata is optional in any mode: emit world-space `WORLD.MARKERS.RANGE_STATION`
(XZ) for the free-counter loadout interaction, `WORLD.MARKERS.RANGE_TARGETS` (XYZ centres and
positive width/height of +Z faces) for retained impact marks, and `WORLD.MARKERS.COURSE`
gates for a tracked parkour circuit. Keep those records
aligned with the same source data that creates the corresponding geometry.

`tools/export-world.ts` iterates the catalog and builds and validates each bundle's
visual GLB, `pack.ts` collision, and manifest. Survival-mode bundles also require
`nav-bake.ts` navigation and cover; Training bundles do not bake or ship either. The assembler
owns geometry lifetime; support/collision/navigation use canonical geometry even
when visuals have derivatives. Never author separate collision meshes or hand-edit
products. Navigation shares runtime controller algorithms.
Mark visual-only pieces at assembly so collision
and navigation never include them, even if they share a palette with solids.
Cable, stain and spall generators mark their own geometry.

Run from the repository root after `bun ci`:

```sh
bun tools/export-world.ts
bun tools/export-world.ts --check
bun tools/check-prop-support.ts
bun run verify
```

`check-prop-support.ts` samples beneath ground-seated props and stacks against the
assembled meshes, ignoring each prop's own geometry. It reports candidate gaps
with level coordinates and placement IDs where available. Use `--gap=0.15` to
raise the threshold, `--json` for structured output, or `--check` for a failing
exit status. This is a review aid: it does not test hanging cloth, mounts, or
whether a stack with contact is stable.

Use `bun tools/export-world.ts --out=/tmp/world-review` for isolated output.
Commit no binaries. The exporter reads checked-in text inputs, including the
[Blender-authored industrial mesh tables](../blender/industrial_props/README.md);
its generated world bundles stay local. `--force` rebuilds unchanged inputs and
`--check` verifies a fresh rebuild against the local outputs. A cached run validates
all bundles without rewriting them. `source-hash.ts` hashes the exporter and its
first-party imports (including workers); changing this shared hash rebuilds all
bundles. Compare physical payloads separately from expected hash changes. Other
model families retain their own pipelines. See [ARCHITECTURE.md](../../ARCHITECTURE.md)
for runtime contracts.

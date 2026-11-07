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
Preserve record order. Procedural detail draws only from `keyedRng(...)` streams
named after the element that owns them (building, facade, room, set piece), so an
edit re-rolls that element alone; `smoke-world-locality.mjs` enforces this. Never
pass one stream across elements or add draws to keep another element stable.

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

## Cook retention policy

Keep runtime world products local and committed; do not use Git LFS or add a
runtime download dependency. Retain only the hashed cooked blobs referenced by
current `main` and `develop` trees, not every historical cook. This is the
coordinated-history-purge option from [#603](https://github.com/EdoardoLuciani/Claude-of-Duty/issues/603).

A cook that replaces `level-*.glb.gz` or `level-*.bin.gz` must include coordinated
history maintenance. Removing old filenames in the new commit is not enough:
Git still retains their blobs in earlier commits (roughly 8–15 MiB per cook).
After the validated cook lands, purge superseded cooked blobs before the next
cook lands:

- Retire feature branches/worktrees first; use a fresh mirror and a recoverable
  offline backup, never rewrite active feature branches.
- Preserve every blob used by either trunk tip, all text history and both tip
  trees. Remove only obsolete cooked blobs; never hand-edit/regenerate assets
  as part of the purge. Historical checkouts may no longer have their old cooks.
- Verify the rewritten trees, clean-install tests/build, world validation and
  packed clone size before force-pushing explicit refs with leases. Update any
  tags retaining the old history, coordinating release targets as needed.
- Record old/new SHAs and before/after sizes, and require existing clones to be
  replaced. Check GitHub's retained PR refs and server-side size separately;
  request garbage collection if needed rather than assuming the push freed it.

Do not land another cook until that cleanup is verified. Moving outputs out of
Git would require a separate reviewed authoring/distribution change, not an
unannounced exception to this policy.

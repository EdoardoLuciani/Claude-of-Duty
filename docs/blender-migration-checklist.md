# Blender world migration checklist

This is the live implementation tracker for replacing procedural world authoring.
Items are checked only after their acceptance criteria have been exercised.

## 1. Blender exporter and runtime asset postprocessor

- [x] Export `WORLD/VISUAL` and `WORLD/COLLISION` headlessly from `world.blend`.
- [x] Rebuild linked Blender objects as `EXT_mesh_gpu_instancing` batches.
- [x] Restore per-instance `_COLOR_0` masks from `cod_instance_color`.
- [x] Preserve palette, shadow, LOD, collision surface, spawn, light, building, and bounds metadata.
- [x] Deterministically gzip/hash assets and replace the asset set atomically under a process lock.
- [x] Expose the authoring pipeline as `npm run world:export`.

## 2. Round-trip parity

- [x] Runtime validation reports 220 draws, 8,008 instances, and 38,580 collision triangles.
- [x] Production build succeeds using Blender-exported assets.
- [x] Browser boot/capture succeeds with Blender-exported assets.
- [x] Full screenshot baseline is compared against the procedural reference.
- [x] Physics and browser-level world/spawn smoke tests pass.
- [x] Vertex masks, shadows, LODs, lights, and collision surfaces survive inspection.

Accepted parity measurements are recorded in `docs/blender-migration-parity.md`.

## 3. Author-friendly Blender organization

- [x] Preserve linked prop prototypes and stable instance groups.
- [x] Classify 606,374 static faces into editable `REGION_*` vertex groups. A loose-part split was deliberately rejected because it would create approximately 335,543 objects.
- [x] Add architecture/building, ground, set-piece, static-batch, and prop collections.
- [x] Validate material names and custom properties after source cleanup.

## 4. Manifest v2 and data-driven runtime queries

- [x] Define and validate manifest v2.
- [x] Export spawns as world-space position plus forward vector.
- [x] Export lights, building footprints, volumes, bounds, open areas, and ground hints.
- [x] Make `WorldSystem` consume v2 metadata.
- [x] Replace runtime imports of procedural layout/query data with manifest-driven queries.

## 5. Commit assets and simplify normal builds

- [x] Track the world manifest and hashed runtime assets in Git.
- [x] Decide and document Git/LFS policy for `.blend` and generated GLBs.
- [x] Make `dev`/`build` validate committed world assets without requiring Blender.
- [x] Keep Blender invocation explicit through `npm run world:export`.
- [x] Add CI-friendly source/runtime validation and stale-export checking.

## 6. Cut over and remove procedural authoring

- [x] Make Blender plus `world.meta.json` the documented source of truth.
- [x] Remove the legacy procedural world exporter from Vite/package scripts.
- [x] Remove unused world builders, kit, dressing, ground, props, interiors, and utilities.
- [x] Remove procedural layout/config after all runtime consumers are data-driven.
- [x] Run final export check, build, capture, world smoke, physics suite, and dead-import checks.

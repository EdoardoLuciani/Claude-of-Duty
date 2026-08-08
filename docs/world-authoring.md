# Blender world authoring

`assets/world/world.blend` is the spatial source of truth;
`assets/world/world.meta.json` stores non-spatial gameplay metadata. Use Blender
5.2 LTS, metres, and Z-up. Blender local **+Y** is gameplay forward.

## Workflow

```bash
npm run world             # validate source, export, and validate runtime assets
npm run world -- --check  # fail if committed assets are stale
npm run world:validate    # validate runtime assets without Blender
```

Export produces committed files under `public/models/world/`:

```text
level-visual.<hash>.glb.gz
level-collision.<hash>.glb.gz
level.json
```

Commit the `.blend`, sidecar, manifest, and both hashed assets together. Normal
`dev` and `build` validate committed assets and do not require Blender.

## Collections

```text
WORLD
├── VISUAL
├── MARKERS
│   ├── SPAWNS
│   └── LIGHTS
└── METADATA
    ├── BUILDINGS
    ├── VOLUMES
    └── BOUNDS
```

Collection membership controls export. Every authored object requires a stable
`cod_id`; do not reuse an ID for a different object.

## Visual geometry

Meshes under `WORLD/VISUAL` use:

| property | value |
|---|---|
| `cod_role` | `visual` |
| `cod_id` | stable ID |
| `palette` | key in `src/world/palette.js` |
| `castShadow` / `receiveShadow` | optional booleans; default true |
| `owLodDist` | optional positive distance in metres |

Use one palette material per mesh, named after its palette key. Blender materials
are viewport previews; runtime materials come from the material subsystem.

Repeated objects must use linked mesh data. Export groups
`cod_instance_group` members into `EXT_mesh_gpu_instancing`. Do not edit
`cod_instance_group`, `cod_instance_index`, or `cod_instance_color`; the last
preserves the `_COLOR_0` instance mask. UVs, normals, vertex colours, and instance
transforms must survive export.

## Collision

Collision has no separately authored source. The exporter derives a decimated
collision LOD from every visual mesh except non-solid `foliage`, retaining linked
prop instances and each mesh's `surface`. This keeps visual and physical shape
under one source of truth. Change the visual mesh to change collision; do not add
proxy meshes or asset-specific collision rules.

The reduction ratio is global and intentionally simple. Collision output remains
triangle geometry, so playable openings must exist in the visual source.

## Markers

Spawn empties under `WORLD/MARKERS/SPAWNS` use:

| property | value |
|---|---|
| `cod_role` | `spawn` |
| `cod_id` | stable ID |
| `cod_tag` | UI/debug label |
| `cod_team` | optional; default `any` |

The exporter converts local +Y to a world-space forward vector. Spawns must be
inside playable bounds with collision ground below them.

Point lights under `WORLD/MARKERS/LIGHTS` use:

| property | value |
|---|---|
| `cod_role` | `light` |
| `cod_id` | stable ID |
| `cod_kind` | `interior` or `street` |
| `cod_range` | range in metres |
| `cod_priority` | renderer priority |
| `cod_day` / `cod_night` | daytime/nighttime intensity |

Position and colour come from the Blender light.

## Buildings, volumes, and bounds

Building Cube empties under `WORLD/METADATA/BUILDINGS` use `cod_role=building`,
`cod_id`, `cod_enterable`, and `cod_floors`. X/Y dimensions define the footprint;
Z defines height.

Volume Cube empties under `VOLUMES` use `cod_role=volume`, `cod_id`, and
`cod_kind`. `BOUND_playable` under `BOUNDS` encloses the playable world. Spatial
facts belong in Blender; labels, categories, query parameters, and script hooks
belong in `world.meta.json`, keyed by stable ID.

## Export invariants

- Screenshot and physics tests pass.
- World totals remain near 220 draws and 8,008 visual instances. Derived
  collision remains within its validated runtime budget.
- Runtime queries use manifest v2 rather than a second layout source.
- A clean checkout builds without Blender.

# Asset and world editing map

Start here to find an editing location. Asset-specific READMEs own detailed
commands, references and acceptance limits; this index does not replace them.
Run commands from the repository root after `npm ci`.

## Three purposeful homes

- **`tools/`**: offline generation, inspection and cooking. Weapon Python recipes
  are authoritative; their generated `.blend` files are editable review products,
  not fallback build inputs.
- **`assets/`**: per-asset reference/calibration inputs and generated authoring,
  native-export and cooked products. Check the asset README before editing a file.
- **`src/`**: runtime behavior, adapters and shared contracts. A tool may reuse
  runtime algorithms (especially world collision/navigation); runtime should not
  need to run an offline builder.

`public/models/` holds assets delivered by public URL. Weapons instead use static
Vite imports of cooked GLBs in `assets/`; the world uses a content-hashed manifest.
These delivery mechanisms intentionally remain distinct. Do not move or hand-edit
runtime products to change a model.

## Weapons: shape, finish, animation and checks

Each weapon's build entry point, checks and helpers now share one directory.
`build.py` orchestrates authoring; `check.py` checks the saved Blender scene.
Where present, `actions.py` authors clips and `hand-reference.mjs` explicitly
regenerates calibration. MCX authors clips in `animations.py`, with no separate
hand-calibration stage. Calibration is never an automatic normal-build step.

| Weapon | Authoring tools                                     | Products, references and full commands                    | Runtime adapter                         |
| ------ | --------------------------------------------------- | --------------------------------------------------------- | --------------------------------------- |
| M4     | [`tools/blender/m4/`](../tools/blender/m4/)         | [M4 asset](../assets/weapons/m4a1-block-ii/README.md)     | [`m4.ts`](../src/weapons/m4.ts)         |
| MCX    | [`tools/blender/mcx/`](../tools/blender/mcx/)       | [MCX asset](../assets/weapons/mcx-virtus/README.md)       | [`mcx.ts`](../src/weapons/mcx.ts)       |
| P320   | [`tools/blender/p320/`](../tools/blender/p320/)     | [P320 asset](../assets/weapons/p320-compact/README.md)    | [`p320.ts`](../src/weapons/p320.ts)     |
| EVOLYS | [`tools/blender/evolys/`](../tools/blender/evolys/) | [EVOLYS asset](../assets/weapons/fn-evolys-762/README.md) | [`evolys.ts`](../src/weapons/evolys.ts) |
| MPX    | [`tools/blender/mpx/`](../tools/blender/mpx/)       | [MPX asset](../assets/weapons/sig-mpx/README.md)          | [`mpx.ts`](../src/weapons/mpx.ts)       |
| AX338  | [`tools/blender/ax338/`](../tools/blender/ax338/)   | [AX338 asset](../assets/weapons/ax338/README.md)          | [`ax338.ts`](../src/weapons/ax338.ts)   |
| M590   | [`tools/blender/m590/`](../tools/blender/m590/)     | [M590 asset](../assets/weapons/m590/README.md)            | [`m590.ts`](../src/weapons/m590.ts)     |

For example, start at `tools/blender/m4/geometry.py` for its shape,
`materials.py` for its source finishes, and `actions.py` for authored motion.
Weapon-specific source maps and asset edit tables describe exceptions; some
weapons construct geometry/materials directly in `build.py`.

```sh
# Isolated M4 authoring products; no committed calibration is refitted:
blender -b -t 2 --python-exit-code 1 --python tools/blender/m4/build.py -- \
  --output /tmp/m4-review --quick
blender -b /tmp/m4-review/m4a1-block-ii.blend --python-exit-code 1 \
  --python tools/blender/m4/check.py
npm run models:cook -- m4 /tmp/m4-review
node tests/smoke/smoke-m4.mjs  # checks committed products/runtime behavior
```

Blender 5.2.2 and the pinned gltfpack encoder are only needed for explicit
authoring/cooking. See the [shared authoring workflow](../tools/blender/README.md)
and [cooking recipe](../build/README.md). Committed manifests/blends may name the
old tool paths from their last export; current README commands supersede those
historical notes. Products are not rebuilt just to update embedded paths.

Gameplay tuning belongs in [`src/weapons/defs.ts`](../src/weapons/defs.ts);
runtime handling/IK stays in `src/weapons/`, separate from Blender-authored motion.

## World: shape versus placement

Start in [`tools/worldgen/`](../tools/worldgen/) for level layout, configuration,
intel sites and explicit placement records. This is the world source—not
`assets/world/` or a Blender backup.

- **Prop shape:** [`props.js`](../tools/worldgen/props.js); dressing-only prototypes
  also live in [`dressing.js`](../tools/worldgen/dressing.js).
- **Building construction:** [`buildings.js`](../tools/worldgen/buildings.js),
  [`kit.js`](../tools/worldgen/kit.js) and [`interiors.js`](../tools/worldgen/interiors.js).
- **Appearance palette:** [`src/world/palette.ts`](../src/world/palette.ts), shared
  by authoring and runtime materials.
- **Compile:** `npm run world`; then `npm run world:validate` and
  `npm run world -- --check`. Commit source and generated products together.
- **Products:** `public/models/world/level.json` binds visual/collision GLBs and
  baked navigation. Never hand-edit these products or author separate collision.
- **Consumers:** [`src/core/models.ts`](../src/core/models.ts) loads them;
  [`src/world/`](../src/world/) owns runtime world behavior, physics collision and
  AI navigation consume the cooked data.

## Other model and texture families

| Family                      | Authoritative editing location                                                                                                                                    | Regenerate / validate                                                                      | Products and consumers                                                                                                         |
| --------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------ |
| Arms and bandage            | [`player_arms.py`](../tools/blender/player_arms.py), [`player_bandage.py`](../tools/blender/player_bandage.py); [asset contract](../assets/player/arms/README.md) | Follow the asset's Blender commands and arm/bandage smoke checks                           | `assets/player/arms/`, `public/models/player/`, generated poses/paths in `src/weapons/`; loaded by weapon arm/bandage adapters |
| Soldiers                    | [`src/ai/soldier.ts`](../src/ai/soldier.ts), `parts.ts`, `geo.ts`, `weapon.ts`; geometry and runtime surface/variant helpers currently share modules              | `npm run models`; `npm test`                                                               | Generated `public/models/soldiers/*.glb` + JSON, loaded by `ModelSystem` and AI                                                |
| Spent shotgun hull          | [`tools/lib/spent-hull.mjs`](../tools/lib/spent-hull.mjs)                                                                                                         | `npm run models`; `node tests/smoke/smoke-shells.mjs`                                      | `public/models/fx/spent12g.glb`, consumed by FX                                                                                |
| Procedural textures         | [`tools/export-proc-textures.mjs`](../tools/export-proc-textures.mjs) and its declared AI/FX inputs                                                               | `node tools/export-proc-textures.mjs`; `npm test`                                          | Committed `public/models/proc/`, consumed by AI materials and FX                                                               |
| Standalone EXPS3 attachment | [`exps3.py`](../tools/blender/exps3.py), [`exps3_bake.py`](../tools/blender/exps3_bake.py); [asset contract](../assets/attachments/eotech-exps3-0/README.md)      | Asset Blender commands; `npm run models:cook -- exps3`; `node tests/smoke/smoke-exps3.mjs` | `assets/attachments/eotech-exps3-0/`; cooked attachment is not yet wired into gameplay                                         |

Normal `npm run dev` / `npm run build` prepare procedural textures and models,
and validate committed world assets. They do **not** regenerate the world,
Blender assets or cooked weapons. `npm run assets` currently exports procedural
models and validates the world; run the texture exporter separately when using
that command rather than Vite. No preparation-command redesign is part of this
organization change.

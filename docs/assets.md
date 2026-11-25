# Asset and world editing map

Start here to find an editing location. Each recipe's README owns its asset
contract, commands, references and acceptance limits; this index does not replace them.
Run commands from the repository root after `bun ci`.

`bun run test` is not asset acceptance: use Blender checks and in-engine review when
changing authored assets.

## Source and products

The map chooser and loading screen share [Last Light](../public/images/last-light.webp),
a static WebP backdrop. It was painted with OpenAI GPT Image 2.6 Sunburst using
the [Survival night capture](screenshots/after-dark.webp) as the reference. Dev
and build serve the artwork directly without baking it.

Keep model and gameplay texture recipes and text inputs in Git, not their
generated products. Attach review screenshots rather than adding them to the source tree.

- **`tools/`**: offline generation, inspection and cooking. Each Blender recipe
  directory in `tools/blender/` holds its Python source, README (asset contract)
  and authored reference/calibration JSON.
- **`src/`**: runtime behavior, adapters and shared contracts. A tool may reuse
  runtime algorithms (especially world collision/navigation); runtime should not
  need to run an offline builder. `src/weapons/authored/<weapon>/` holds the
  committed hand calibration and Blender manifest that weapon code imports.
- **`.cache/blender/`** (ignored): native Blender products: editable `.blend`
  review scenes, native GLBs, baked maps and review renders, laid out as
  `<family>/<asset>/`. They are regenerated, never fallback build inputs.
- **`public/models/`** (ignored): cooked runtime products delivered by fixed public
  URL (`build/models.ts` writes weapon/attachment/prop GLBs there); the world uses
  a content-hashed manifest. Do not hand-edit products to change a model.

Audio and market-art provenance lives in [`docs/provenance/`](provenance/).

## Weapons: shape, finish, animation and checks

Each weapon's build entry point, checks and helpers share one directory.
`build.py` orchestrates authoring; `check.py` checks the saved Blender scene.
Where present, `actions.py` authors clips and `hand-reference.ts` explicitly
regenerates calibration. MCX uses `animations.py` for mechanisms and `hands.py`
for wrist/finger and equip actions. All seven weapons export native hand controls;
shared review-only arm skins remain excluded from weapon GLBs. Calibration is
never an automatic normal-build step.

| Weapon | Recipe, contract and commands                       | Runtime adapter                         |
| ------ | --------------------------------------------------- | --------------------------------------- |
| M4     | [`tools/blender/m4/`](../tools/blender/m4/)         | [`m4.ts`](../src/weapons/m4.ts)         |
| MCX    | [`tools/blender/mcx/`](../tools/blender/mcx/)       | [`mcx.ts`](../src/weapons/mcx.ts)       |
| P320   | [`tools/blender/p320/`](../tools/blender/p320/)     | [`p320.ts`](../src/weapons/p320.ts)     |
| EVOLYS | [`tools/blender/evolys/`](../tools/blender/evolys/) | [`evolys.ts`](../src/weapons/evolys.ts) |
| MPX    | [`tools/blender/mpx/`](../tools/blender/mpx/)       | [`mpx.ts`](../src/weapons/mpx.ts)       |
| AX338  | [`tools/blender/ax338/`](../tools/blender/ax338/)   | [`ax338.ts`](../src/weapons/ax338.ts)   |
| M590   | [`tools/blender/m590/`](../tools/blender/m590/)     | [`m590.ts`](../src/weapons/m590.ts)     |

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
bun build/models.ts m4 /tmp/m4-review
```

Blender 5.3.0 and the pinned gltfpack encoder are needed by `bun run dev` /
`bun run build` whenever a Blender step is stale (see below). See the
[shared authoring workflow](../tools/blender/README.md) and
[cooking recipe](../build/README.md). Committed weapon manifests may name old tool
paths from their last export; current README commands supersede those notes.

The rigid [M67 grenade prop](../tools/blender/m67/README.md) is authored in
[`tools/blender/m67/`](../tools/blender/m67/) and cooked with `bun build/models.ts m67`.
It has no arm or animation inputs; the held, player-thrown and AI visuals share
its one rigid runtime mesh through [`grenade-mesh.ts`](../src/weapons/grenade-mesh.ts).

Gameplay tuning belongs in [`src/weapons/defs.ts`](../src/weapons/defs.ts);
runtime handling/IK stays in `src/weapons/`, separate from Blender-authored motion.

## World: shape versus placement

Start in [`tools/worldgen/`](../tools/worldgen/) for level layout, configuration,
intel sites and explicit placement records. This is the world source, not a
Blender scene.

- **Prop shape:** [`props.ts`](../tools/worldgen/props.ts); dressing-only prototypes
  also live in [`dressing.ts`](../tools/worldgen/dressing.ts).
- **Building construction:** [`buildings.ts`](../tools/worldgen/buildings.ts),
  [`kit.ts`](../tools/worldgen/kit.ts) and [`interiors.ts`](../tools/worldgen/interiors.ts).
- **Appearance palette:** [`src/world/palette.ts`](../src/world/palette.ts), shared
  by authoring and runtime materials.
- **Compile:** `bun tools/export-world.ts` (also validates); options are in the
  [world editing map](../tools/worldgen/README.md). Dev/build/tests also generate missing or stale world
  products. Commit source only; generated products are ignored.
- **Products:** `public/models/world/level.json` binds visual/collision GLBs and
  baked navigation. Never hand-edit these products or author separate collision.
- **Consumers:** [`src/core/models.ts`](../src/core/models.ts) loads them;
  [`src/world/`](../src/world/) owns runtime world behavior, physics collision and
  AI navigation consume the cooked data.

## Other model and texture families

| Family                      | Authoritative editing location                                                                             | Regenerate / validate                                                                        | Products and consumers                                                                                                                                                |
| --------------------------- | ---------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Arms and bandage            | [`tools/blender/player_arms/`](../tools/blender/player_arms/) (`build.py`, `bandage.py`)                   | Follow the recipe's Blender commands; review in engine                                       | `.cache/blender/player/arms/`, `public/models/player/`, generated poses/paths in `src/weapons/`; loaded by weapon arm/bandage adapters                                |
| Held field radio            | [`tools/blender/field_radio/`](../tools/blender/field_radio/)                                              | Independent Blender build/check and `bun build/models.ts field_radio`; review `--shot=radio` | `public/models/player/field-radio.runtime.glb`, bound by [`radio-mesh.ts`](../src/weapons/radio-mesh.ts)                                                              |
| Soldiers                    | [`tools/blender/soldiers/`](../tools/blender/soldiers/). Runtime RIG/registry/surfaces remain in `src/ai/` | Explicit Blender author/cook; `bun tools/export-models.ts` stages                            | Generated `.cache/blender/soldiers/` products stage to ignored `public/models/soldiers/*.glb` + JSON; loaded by `ModelSystem` and AI                                  |
| Spent shotgun hull          | [`tools/blender/spent_hull/`](../tools/blender/spent_hull/)                                                | Standalone Blender build, source check and native cook                                       | `public/models/fx/spent12g.glb`, consumed by FX                                                                                                                       |
| Ammo pickup case            | [`tools/blender/ammo_pickup/`](../tools/blender/ammo_pickup/)                                              | Standalone Blender author/check and `bun build/models.ts ammo_pickup`                        | `public/models/props/ammo-pickup.runtime.glb`, instanced by weapons; separate runtime recognition ring                                                                |
| Procedural textures         | [`tools/export-proc-textures.ts`](../tools/export-proc-textures.ts) and its declared AI/FX inputs          | `bun tools/export-proc-textures.ts`; `bun run test`                                          | Generated `public/models/proc/`, consumed by AI materials and FX                                                                                                      |
| Standalone EXPS3 attachment | [`tools/blender/exps3/`](../tools/blender/exps3/) (`build.py`, `bake.py`)                                  | Recipe Blender commands; `bun build/models.ts exps3`                                         | Native products: `.cache/blender/attachments/eotech-exps3-0/`; cooked: `public/models/attachments/exps3.runtime.glb`; shared gameplay/inspection (except on the P320) |

The [Al-Maktaba intel case](../tools/blender/intel_case/README.md) is authored in
[`tools/blender/intel_case/`](../tools/blender/intel_case/) and cooked with
`bun build/models.ts intel_case`. The recipe is independent of weapons, arms
and level compilation; [`src/intel/prop.ts`](../src/intel/prop.ts) consumes the
named hinge, emissive meshes and effect socket, not the editable scene.

The standalone [TOR Mini laser](../tools/blender/tor_mini/README.md)
is authored by [`tools/blender/tor_mini/`](../tools/blender/tor_mini/), with native
Blender validation and `bun build/models.ts tor_mini`. It is generated alongside
the EXPS3, independently of player arms, and uses the shared gameplay/inspection
rail path on all seven weapons.

Each suppressor can has its own Blender recipe and cook id
(`tools/blender/suppressor/` for the shared SRD762Ti, `suppressor9mm/`,
`suppressor338/`, `suppressor12g/`); all share scene, lathe, bore-gauge and export
helpers in `tools/blender/can.py`. The [M4-72 Brake](../tools/blender/muzzle_brakes/README.md)
is a single asset shared by the verified rifle fits. Weapon fit checks load built
attachments through `tools/blender/attachment_source.py`.

Normal `bun run dev` / `bun run build` run `tools/build-assets.ts` (also runnable
directly): arms and bandage, each weapon and its cook, standalone
attachments, the M67 grenade, field radio, spent hull, ammo pickup case, intel
case and soldiers in Blender, then procedural textures and soldier staging.
Bun world generation and validation run alongside these steps. Each
Blender step reruns only when its declared inputs (recipe directories,
weapon calibration, upstream steps) change; hashes live in ignored `.cache/assets/`
and `--force` rebuilds all. These products are ignored, not committed; the cook
copies each weapon's fresh `manifest.json` into `src/weapons/authored/`, which stays
committed with `src/weapons/hand-poses.ts` and `bandage-path.ts` because code imports them. World products, including `level.json`, are also ignored.
`bun run build:ci` skips Blender/model assets but generates missing or stale world
products; `bun run test` prepares the world before launching tests.

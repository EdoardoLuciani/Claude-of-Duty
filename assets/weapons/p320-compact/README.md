# P320 Compact

Early Nitron Compact, curved trigger, SIGLITE irons, flush 15-round magazine.
Original game art, not downloaded CAD/mesh/maps or an endorsed/licensed replica.
Follow the [shared source-first workflow](../../../tools/blender/README.md):
Python owns the weapon; blend, GLB, atlas PNGs and manifest are generated products.

## Edit map

| Concern | Source |
| --- | --- |
| Stage order, paths and manifest | `p320_compact.py` |
| Pigment/roughness/metalness/grain/stipple and unique 1024² base/ORM/normal bake | `p320/materials.py`: `build_source_materials`, `bake_atlas` |
| Named assemblies, sockets, cartridge-tip latitude rings, lettering/atlas | `p320/geometry.py`: `build_geometry` |
| Eight weapon/wrist/finger clips, STEP visibility, events and review hands | `p320_actions.py`: `author_actions` |
| Preview clip selection | `p320/animations.py` |
| Rest-space joining and stock native glTF export | `p320/export.py` |
| Fixed review cameras, lights and color management | `p320/studio.py` |

Paths above are under `tools/blender/`. Helpers remain weapon-local. Keep the
unique atlas, not MCX repeating projection; lettering retains separate physical
materials, tritium stays emissive, spare magazines reuse original geometry/UVs.
`src/weapons/p320.ts` owns native sampling; shared IK and ammo/healing/interruption
logic remain runtime-owned. Preserve sockets, eight clips/events, wrist/finger
contacts, reload thumb grip and STEP magazines without renderer compensation.

## Build/check (root, Blender 5.2.2)

```sh
blender -b -t 8 --python-exit-code 1 --python tools/blender/p320_compact.py
blender -b -t 8 --python-exit-code 1 --python tools/blender/p320_compact.py -- \
  --output /tmp/p320-review --render --quick
blender -b -t 8 /tmp/p320-review/p320-compact.blend \
  --python-exit-code 1 --python tools/blender/p320_check.py
node tests/smoke/smoke-p320.mjs
node tests/smoke/smoke-inspect.mjs
node tests/e2e/check-p320-game.mjs --out=/tmp/p320-game # GPU lane required
```

Each factory-empty build bakes three maps with Cycles CPU, authors actions, saves
packed preview/studio, then exports native Actions grouped by NLA name at **60 Hz**.
Disable NLA evaluation and restore rigid scales to one before joining so preview
visibility cannot collapse spare meshes. CONSTANT source scale curves export STEP;
post-export inspection is read-only. Review with `p320_review.py`.
Shared arm appearance and committed `hand-reference.json` are explicit read-only
inputs. Refit separately with `node tools/p320-hand-reference.mjs` only when
intentionally changing contacts; normal rebuilds never refit.

## Approved migration exceptions

The old all-unmuted NLA export zero-scaled `magazine_spare_round` in every clip.
The source already showed it; showing its authored brass/copper cartridge in both
reloads was explicitly approved. Stock Actions preserve its unit scale; parent
visibility still hides it in reset/other clips. Ammo semantics are unchanged.

The tip uses deterministic 24×12 latitude rings instead of allocator-dependent
UV-sphere traversal. Oriented connectivity is unchanged; maximum displacement is
4.067 nanometres. All twelve non-tip primitives retain exact positions/normals/
UVs/indices. Base/ORM PNGs are byte-identical; the normal atlas changes only tip
pixel `(822, 375)` from `(129, 128, 255)` to `(128, 128, 255)`, with no padding change.
Two fresh scratch builds and a committed-directory build matched runtime GLB/map
hashes. These narrow measured exceptions don't permit atlas/finish retuning or
replace human visual approval. History: [#315](https://github.com/EdoardoLuciani/Claude-of-Duty/pull/315).

# P320 Compact: source-first authoring

Early Nitron Compact, curved trigger, SIGLITE irons, flush 15-round magazine.
Original game art, not downloaded CAD/mesh/maps or an endorsed/licensed replica.

Python is the sole weapon-authoring authority. The `.blend`, `.glb`, atlas PNGs
and `manifest.json` are generated products, never build inputs. Normal Vite/game
builds use the committed products and need no Blender. Do not edit exported
buffers, repair images, or fall back to an older saved weapon scene.

## Where to edit

| Change | Source |
| --- | --- |
| Procedural pigment, roughness, metalness, grain and stipple | `tools/blender/p320/materials.py`: `build_source_materials` |
| Slide, molded frame/grip, controls, curved trigger, magazine, sights, sockets | `tools/blender/p320/geometry.py`: `build_geometry`, named assembly sections |
| Cartridge-tip shape and topology | Explicit latitude rings in `geometry.py` |
| Grip-conforming lettering, material separation, unique atlas UVs | End of `geometry.py` |
| Atlas baking and exported PBR shader | `materials.py`: `bake_atlas` |
| Eight weapon/wrist/finger clips, STEP visibility, events and preview hands | `tools/blender/p320_actions.py`: `author_actions` |
| Preview clip selection | `tools/blender/p320/animations.py` |
| Rest-space joining and stock native glTF options | `tools/blender/p320/export.py` |
| Review cameras, lighting and color management only | `tools/blender/p320/studio.py` |
| Stage order, output paths and manifest | `tools/blender/p320_compact.py` |

Imports do not create Blender objects. Helpers stay local to this weapon; there
is no shared authoring framework or alternative material-only build command.
The atlas remains a unique 1024² base/ORM/normal bake, not MCX-style repeating
projection. Lettering keeps its separate physical materials; tritium stays
emissive. Spare meshes reuse the original magazine geometry and UVs.

## Build and check

From the repository root, with Blender **5.2.2** and its bundled glTF exporter:

```sh
blender -b -t 8 --python-exit-code 1 --python tools/blender/p320_compact.py

# Complete fresh scratch build; never reads committed weapon textures/blend/GLB.
blender -b -t 8 --python-exit-code 1 --python tools/blender/p320_compact.py -- \
  --output /tmp/p320-review --render --quick

blender -b -t 8 /tmp/p320-review/p320-compact.blend \
  --python-exit-code 1 --python tools/blender/p320_check.py
node tests/smoke/smoke-p320.mjs
node tests/smoke/smoke-inspect.mjs
```

Every build starts from an empty factory scene, creates geometry/UVs, bakes all
three maps with Cycles on CPU, authors actions, saves the editable preview, then
exports native Actions grouped by NLA track names. NLA evaluation is disabled
and rigid scales explicitly restored to one before joining: preview visibility
must not collapse spare meshes during dependency-graph updates. Motion is
sampled natively at 60 Hz; authored CONSTANT scale curves export as STEP without
rewriting the GLB. Post-export inspection is read-only.

`--quick` changes only optional Eevee preview resolution/samples, not the asset.
Renders require working color management: use a compatible process-local `OCIO`
configuration if the system configuration is incompatible, never disable it.
The saved source includes the same fixed studio and packed maps for
`p320_review.py`; review hands use the existing shared arm appearance. The shared
arm `.blend` and committed `hand-reference.json` are explicit external inputs,
not alternate authorities for the weapon. Regenerate the latter separately with
`node tools/p320-hand-reference.mjs` only when intentionally editing hand contacts.

For reproducibility, build in two empty absolute output directories in separate
Blender processes and compare GLB/map hashes. Then run the same command to the
committed asset directory. `.blend` metadata/paths need not be byte-identical.
Existing structural and gameplay checks are necessary, not human visual approval.
Browser/game review (`node tests/e2e/check-p320-game.mjs --out=/tmp/p320-game`)
requires an available GPU lane.

## Preserved contracts and intentional migration exception

Native metres, original controls/SIGLITE sights, grip/lettering finishes, sockets,
eight clips, events, wrist/finger contacts, reload thumb grip and STEP magazines
remain asset/runtime contracts. `src/weapons/p320.ts` samples these tracks;
shared skins/IK and ammunition, healing and interruption logic remain runtime-owned.
No runtime or renderer compensation belongs in the recipe.

The old all-unmuted NLA export sampled the spare cartridge under a zero-scale
parent, accidentally giving `magazine_spare_round` zero scale in every clip.
The source preview already showed that cartridge. The user explicitly approved
showing the authored brass/copper cartridge when the spare magazine appears in
both reloads. Stock Actions export now preserves its authored unit scale rather
than reproducing that hidden-round artifact. Reset/other clips still hide the
spare through its parent; ammunition/gameplay semantics are unchanged.

The cartridge tip uses a small deterministic 24×12 latitude-ring mesh instead of
allocator-dependent UV-sphere face traversal. Its shape/resolution is retained;
only its numerical construction/atlas sampling is allowed to differ. This is
not permission to move other atlas islands or retune any finish. Migration audits
record exact affected values and pixels; they are not blanket tolerances for
future edits. At migration, all twelve non-tip primitives retain exact exported
positions, normals, UVs and indices. Base/ORM PNGs are byte-identical; the normal
atlas changes only pixel `(822, 375)` from `(129, 128, 255)` to `(128, 128, 255)`,
inside the tip island, with no changed padding pixels. Tip oriented triangle
connectivity is unchanged; maximum position displacement is 4.067 nanometres.
Two fresh scratch builds and the committed-directory build produce identical
runtime GLB/map hashes. Historical references: [#315](https://github.com/EdoardoLuciani/Claude-of-Duty/pull/315).

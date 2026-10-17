# MCX VIRTUS / .300 BLK

Gray 9-inch VIRTUS, short factory M-LOK guard, folding/telescoping stock,
direct-thread SRD762Ti, TA31F/TA51 and black MAG800 magazine.
Original art, not CAD/scan or an endorsed/licensed replica.
Visual review remains separate from technical validation.
History: [#334](https://github.com/EdoardoLuciani/Claude-of-Duty/pull/334).

## Reference authority

| Source | Authority / limitation |
|---|---|
| [SIG manual](https://www.sigsauer.com/media/sigsauer/resources/OPERATORS_MANUAL_SIGMCX_VIRTUS_ENGLISH_2402117-01_REV_02_LR.pdf), [9-inch SBR](https://www.midwestgunworks.com/page/mgwi/prod/rmcx-300b-9b-tap-sbr) | Base exterior; pictured accessories differ. |
| [PDW handguard](https://www.sigsauer.com/mcx-virtus-handguard-assembly-pdw-length-w-mlok-blk.html) | 8-inch nominal, overlap inferred. |
| [SRD762Ti](https://www.sigsauer.com/srd762ti.html) | 236 × 44 mm rounded exterior; not QD/SLH. |
| [TA31F](https://www.trijicon.com/products/details/ta31f) | 151.89 × 50.8 × 58.42 mm; inclusion of mount/protrusions uncertain. |
| [MAG800](https://magpul.com/pmag-30-ar-300-b-gen-m3.html) | Exterior and 7.5-inch max length; no measurement datum drawing. |

Photo-inferred contours/depths/finish/marks aren't certified dimensions.
Magazine construction uses its full minimum-area side envelope including
floorplate/feed lips, not world-Z height. No copied serial or real 5.56 BDC.

## Source/runtime contract

Python under [`tools/blender/mcx/`](../../../tools/blender/mcx/README.md) is the
sole authoring source. `mcx-virtus.blend/.glb` are generated preview/runtime
products; `manifest.json` records counts/events; `textures/` holds generated
1024² maps. Do not author changes in the generated files.
`src/weapons/mcx.ts` converts +X-forward/+Y-up and samples six native clips.
Draw/holster remain procedural, stock fold showcase-only. Shared arms/IK,
scope/reticle, sound and live pooled cases are runtime-owned; hide baked cases.
Normal builds need no Blender.

Caps: <110k triangles, ≤40 primitives, ≤16 materials, three 1024² maps, ≤10 MiB.
Preserve complete-magazine bounds, vents/trigger, charging stem, cap/spine seating,
hinge/handle clearance throughout reload/fold and the seated TA51 foot/rail.
Keep matching clip names and STEP magazine visibility without reload blending.
Materials borrow textures; counts aren't GPU timings.

## Rebuild/check (root, Blender 5.2.2)

```sh
blender -b --python-exit-code 1 --python tools/blender/mcx_virtus.py
blender -b assets/weapons/mcx-virtus/mcx-virtus.blend \
  --python-exit-code 1 --python tools/blender/mcx_check.py
node tests/smoke/smoke-mcx.mjs
node tests/smoke/smoke-mcx-game.mjs
node tests/e2e/check-mcx-game.mjs
```

The single command starts from an empty factory scene, not a saved asset.
Regeneration overwrites preview/export/maps. `-- --output /tmp/mcx-review`
builds elsewhere; add `--render --quick` for optional review stills.
`mcx_review.py` can inspect generated preview scenes/reels.

The recipe is separated into materials, named geometry assemblies, animations,
studio and export. Fixed physical-scale UV projection replaces automatic island
packing. Motion is authored as 60 Hz LINEAR keys and visibility as CONSTANT keys;
Blender's stock Actions exporter emits the correct glTF interpolation directly.
There is no post-export repair or alternate saved-source material-update path.
See the linked authoring guide for stage order and which file to edit.

The finish uses a warmer medium-gray coating, smoother surface detail, matte
polymer and a darker charcoal suppressor. This is an artistic alternative to the
previous cool satin proposal, not a measured factory finish. In `FINISHES`, the
coating is linear RGB (.135, .130, .123), roughness .44, normal strength .025;
polymer retains its pigment with roughness .84 / normal .50; the suppressor is
RGB (.045, .046, .049), roughness .76 / normal .15. Other finishes are unchanged.

The authoring pilot intentionally rebuilt UVs/triangle order. This subsequent
finish-only revision preserves that pilot's complete nonmaterial GLB JSON and
binary chunk, including maps, geometry, UVs, sockets and animations. Compare
frozen registration and matched lighting, not independently rescaled screenshots.
The appearance change is clearer in studio lighting; bright outdoor gameplay
still compresses the coating's tonal differences, and the indoor view stays dark.
No renderer or exposure compensation is included.

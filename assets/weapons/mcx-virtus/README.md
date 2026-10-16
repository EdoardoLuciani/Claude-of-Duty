# MCX VIRTUS / .300 BLK

Gray 9-inch VIRTUS, short factory M-LOK guard, folding/telescoping stock,
direct-thread SRD762Ti, TA31F/TA51 and black MAG800 magazine.
Original art, not CAD/scan or an endorsed/licensed replica.
**Human visual sign-off remains pending.**
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

`mcx-virtus.blend/.glb`: packed editable source/runtime; `manifest.json`:
counts/events; `textures/`: generated 1024² maps.
`src/weapons/mcx.ts` converts +X-forward/+Y-up and samples six native clips.
Draw/holster remain procedural, stock fold showcase-only. Shared arms/IK,
scope/reticle, sound and live pooled cases are runtime-owned; hide baked cases.
Normal builds need no Blender.

Caps: <110k triangles, ≤40 primitives, ≤16 materials, three 1024² maps, ≤10 MiB.
Preserve complete-magazine bounds, vents/trigger, charging stem, cap/spine seating,
hinge/handle clearance throughout reload/fold and the seated TA51 foot/rail.
Keep matching NLA tracks and STEP magazine visibility without reload blending.
Materials borrow textures; counts aren't GPU timings.

## Materials

The gray receiver/handguard is a satin dielectric coating, not bare metal or a
clearcoat. Its linear pigment is `(0.145, 0.155, 0.168)`, roughness multiplier
`0.57`, normal strength `0.10`. Black polymer keeps its pigment with roughness
`0.73` / normal `0.50`; the graphite suppressor uses `0.72` / `0.25`.
All three remain metalness zero with default IOR 1.5 (F0 0.04). These are
photo-informed art approximations, not measured proprietary finishes.
`tools/blender/mcx_materials.py` owns these settings for both authoring paths.

The same three 1024² maps remain byte-identical; roughness-map green averages
0.916, giving mean evaluated roughness about 0.522 / 0.669 / 0.660 respectively.
No new maps, material slots or shader features. Shared anodized/steel optic
hardware, glass, fiber, markings and other finishes remain unchanged. Geometry
faceting and native indoor darkness/bright outdoor lighting are not material fixes.

## Rebuild/check (root, Blender 5.2)

For **material-only maintenance**, preserve the packed source's geometry/UVs:

```sh
blender -b --python-exit-code 1 --python tools/blender/mcx_materials.py
```

This opens the existing packed source, validates the three target node graphs,
updates linked factors, saves before in-memory mesh conversion, and uses the
same `mcx_export.py` exporter as the full recipe. Export fails without replacing
the GLB if any nonmaterial JSON/binary or untouched material changes. The source
is saved first; on failure review/restore it before retrying. Full procedural
reconstruction has a pre-existing magazine UV/index reproducibility difference
in Blender 5.2.2, even with unchanged settings; do not use it for a material-only
patch or accept its geometry drift. Both paths retain the original export flags
and STEP visibility postprocess, with no geometry-buffer replacement.

For a deliberate **full procedural rebuild**, followed by checks:

```sh
blender -b --python-exit-code 1 --python tools/blender/mcx_virtus.py
blender -b assets/weapons/mcx-virtus/mcx-virtus.blend \
  --python-exit-code 1 --python tools/blender/mcx_check.py
node tests/smoke/smoke-mcx.mjs
node tests/smoke/smoke-mcx-game.mjs
node tests/e2e/check-mcx-game.mjs
```

Regeneration overwrites source/export/maps. `--render` adds stills;
`mcx_review.py` reviews saved source/reels. Compare frozen uniform registration
and matched Eevee settings, not historical Cycles or independent X/Y warps.

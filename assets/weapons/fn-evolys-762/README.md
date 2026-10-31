# FN EVOLYS 7.62

Tan/black 7.62 exterior, revised six-position non-folding stock, no irons/bipod;
RM06 Type 2 RMR/RM33 mount and inferred 100-round pouch. Original game art,
not scan/CAD or a certified/licensed replica. **Human visual sign-off pending.**

## References and datums

[FN right](https://fnherstal.com/app/uploads/STM7402-scaled.jpg) /
[left](https://fnherstal.com/app/uploads/STM7400-scaled.jpg) studio views,
[product](https://fnherstal.com/en/defence/portable-weapons/fn-evolys-762/),
[technical sheet](https://fnherstal.com/app/uploads/technical-data-fn-evolys-762-1.pdf),
[stock revision](https://fnherstal.com/en/news/fn-evolys-gets-ergonomic-changes-based-on-user-suggestions/),
[RM06](https://www.trijicon.com/products/details/rm06-c-700672) /
[RM33](https://www.trijicon.com/products/details/rm33).
Constructed barrel face-to-crown: 406 mm; retracted exterior: about 948 mm.
RM33 axis is 19.5072 mm above rail; clamp envelope isn't riser height.
Accessory loadout, unpublished depths/cloth and mechanism internals aren't certified.

## Source/runtime contract

Python is the weapon-authoring authority; `fn-evolys-762.blend/.glb` are generated
packed preview/native-export products, never build inputs. The derived
`fn-evolys-762.runtime.glb` uses gltfpack 1.3 with the shared cook flags and no
additional simplification flags, loaded through the shared KTX2/meshopt adapter. See the local guide's
[ordinary rigid export](../../../tools/blender/evolys/README.md#ordinary-rigid-export-current)
for the current representation and validation limits. Receiver, handguard and
optic share ordinary static geometry; the rotated stock retains its native local
mesh. Bolt, charging handle, feed cover and trigger remain ordinary meshes under
their authored controls. Only the independent eight-joint deforming belt is skinned.
Both pouches retain their separate animation/visibility ownership. There are ten
primitive instances total, nine in loaded Idle, and two unchanged materials.
The stock/head oracle checks all 4,922 actual ordinary stock triangles against
the unchanged 120 mm envelope. Native/runtime geometry and gameplay tests pass;
parent native AMD RDNA-4 / r187 measurements confirm uploaded geometry
**3,360,060 → 2,479,560 B** (−26.2%) and geometry-plus-logical-texture subtotal
**7,554,444 → 6,673,944 B**, with unchanged textures. Only the belt skin remains.
Isolated loaded-Idle beauty draws rise 5 → 10; CPU/GPU microbench timings do not
establish whole-game FPS. Matched views, RGBA fallback, market/production and
combined 160 tests passed; fresh independent review found no issues. These
subtotals exclude other renderer resources/palette buffers/driver padding and
do not clear general factory/human sign-off. `manifest.json` records
events/belt, `hand-reference.json` is read-only versioned hand calibration, and
`photo-review.json` freezes review registration. Shared review-arm appearance is
also read-only and excluded from export. See the [edit map and build stages](../../../tools/blender/evolys/README.md).

The [approved UV exception](../../../tools/blender/evolys/README.md#approved-uv-precision-exception)
rounds to 1/16384 after modifiers (maximum 0.03125 texel at 1024), collapsing seams
and some UV triangles. It is **not exact seam/tangent-frame preservation**. The
guide owns the measured counts, shading caveat and bounded six-view WebGPU review;
none waive final human approval or establish all-state/device equivalence.

Eight native clips in `src/weapons/evolys.ts`; shared skins/IK/ADS/recoil remain.
Reloads open cover, replace pouch/belt and close; empty reload racks.
Keep all event/balance/chamber/+1 values and one live pooled case per shot.
Runtime ADS framing enlarges the weapon-only sight picture and uses a world-sized 3.25 MOA dot with a five-pixel readability floor;
no segmented ring/halo. Physical window, lens material and authored grips are unchanged.

Eight cartridges/links, one skin/one atlas primitive, 12.7 mm pitch: finish the last
stroke, then stop. Only insertion restores spent belt; switch/reset/interruption
cannot resurrect it. Mirror native scale keys around mixer-cached constants.
Keep physical pouch/feed passages, curve/tail enclosure and synchronized DCC skins.
Caps: <150k triangles, ≤48 primitives, ≤18 materials, three 1024² maps, ≤15 MiB.

## Rebuild/check (root, Blender 5.2.2)

```sh
# Only when intentionally changing shared calibration/contact inputs:
# node tools/evolys-hand-reference.mjs
blender -b -t 2 --python-exit-code 1 --python tools/blender/evolys_762.py
# Full scratch build, without touching committed products/calibration:
blender -b -t 2 --python-exit-code 1 --python tools/blender/evolys_762.py -- \
  --output /tmp/evolys-review --quick
blender -b assets/weapons/fn-evolys-762/fn-evolys-762.blend \
  --python-exit-code 1 --python tools/blender/evolys_check.py
node tests/smoke/smoke-evolys.mjs
node tests/smoke/smoke-evolys-skin.mjs
node tests/smoke/smoke-evolys-clearance.mjs
# Extract the independent published native GLB from base d29573f8, then:
node tools/evolys-pass2-parity.mjs /absolute/path/to/base-native.glb
```

Follow the [shared authoring workflow](../../../tools/blender/README.md).
`--render` writes five studio views; the local guide owns 120 Hz/STEP export details.
Match cameras/uniform registration/ROI/exclusions; no independent axis fitting.
Preserve stock joins, 120 mm head-envelope and sleeve/pouch clearance, pitch,
contacts/events, replacement-pouch and reset gates. Sampled envelopes aren't
all-state cloth/contact certification. Stock/grip/typography/finish need review.
Evidence: [#350](https://github.com/EdoardoLuciani/Claude-of-Duty/pull/350).

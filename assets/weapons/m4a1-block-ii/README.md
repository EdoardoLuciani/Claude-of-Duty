# M4A1 Block II — work in progress

**Technical migration is implemented; visual/reference acceptance is not complete.**
This is not a scan or a certified pixel-perfect replica. See
[FIDELITY_AUDIT.md](./FIDELITY_AUDIT.md) for the approved exact configuration,
reference ledger, unresolved datums, fixed gameplay contract and budgets.

## Assets and authoring

- `m4a1-block-ii.blend`: editable packed materials, component geometry, weapon
  controls, synchronized wrist/finger actions and source-only shared review arms.
- `m4a1-block-ii.glb`: locally bundled geometry/maps, sockets and eight clips.
  No duplicate arm skins, downloaded meshes or photograph textures.
- `manifest.json`: instance-counted export statistics, durations/events and sockets.
- `hand-reference.json`: offline shared-hand fitting seed; Blender owns the
  exported choreography. It is not a runtime animation-generation path.
- `tools/blender/m4a1.py`: exterior/components, materials and export.
- `tools/blender/m4_actions.py`: mechanisms, weapon and wrist/finger choreography.
- `tools/m4-hand-reference.mjs`: rebuild fitting inputs after contact changes.
- `src/weapons/m4.js`: local loader and existing viewmodel/Clip event adapter.

Geometry helpers use game metres (+X right, +Y up, −Z forward), converted to
Blender coordinates. Actions are authored at 120 fps. The draw's fractional
endpoint is preserved at exactly .620 seconds rather than rounded to .616667.
All pre-existing action/event times and `WEAPON_DEFS.rifle` values are retained.
The firing mechanism plays alongside, not instead of, the original reactive
recoil. Runtime upper/forearm IK, shared skins, ADS and sway remain in charge.

Normal installation/build/boot needs **no Blender**:

```sh
npm ci
npm test
npm run lint
npm run build
node tests/e2e/check-m4-game.mjs --port=5199 --out=.tmp-rend/m4-game
node tools/capture.mjs --shot=weapon --out=.tmp-rend/m4-boot.png
```

Regeneration / source geometry review:

```sh
node tools/m4-hand-reference.mjs
blender -b --threads 8 --python-exit-code 1 --python tools/blender/m4a1.py -- --quick
blender -b assets/weapons/m4a1-block-ii/m4a1-block-ii.blend \
  --python-exit-code 1 --python tools/blender/m4_check.py
```

`--render` additionally produces a studio preview. Texture and render output,
Blender backups and `.tmp-rend/` evidence are ignored. Blender 5.2.2 LTS was used.
An OCIO 2.4-compatible configuration was supplied locally because this machine's
packaged 2.5 configuration is incompatible with its linked OpenColorIO library;
no system or runtime color-management settings were changed.

## Current measured export

| Metric | Actual | Approved maximum |
| --- | ---: | ---: |
| Triangle **instances** | 105,587 | strictly <110,000 |
| Primitive **instances** | 28 | 40 |
| Materials | 11 | 16 |
| Unique mesh buffers | 12 | informational |
| Maps | three 1024×1024 PNGs | three 1024×1024 |
| GLB bytes | 7,637,724 (7.28 MiB) | 10 MiB |

Both magazines and both cartridge groups count, even where glTF shares buffers;
the source-review casing also counts although runtime always hides it and keeps
the existing single physical shell event. Shared arm assets are separate.
Baseline was 61,672 triangles / 21 primitives / 21 materials / 2,637,084 bytes
without embedded maps; that byte comparison is not texture-inclusive.

Materials are deterministic authored color/roughness/normal atlases with finish
variation, restrained crevice dirt and normal-mapped A2 checkering. Runtime local
HDR material calibration is preliminary; it does not alter global lighting.

## Geometry and validation conventions

- Closed-bolt face → crown: **368.300 mm**, not muzzle-tip distance. Exported
  indexed geometry is ray-tested as well as named sockets.
- RIS II nominal complete main handguard envelope: **311.150 × 56.642 ×
  57.150 mm**, including rail teeth/side fasteners. The separate rear bolt-up
  flange is not added to its published length. Internal coaxial barrel gauge
  is 29.210 mm, with a disclosed .1 mm diameter polygon-chord allowance and a
  separate fit-inferred gas-tube channel above it.
- FH556RC length: **66.040 mm** under the provisional imperial convention;
  SureFire's conflicting 64.000 mm metric equivalent remains unresolved.
  Nominal 1/2-inch muzzle thread diameter is 12.700 mm; the hidden counterbore
  and thread engagement are clearance geometry, not certified thread CAD.
- Carbine tube nominal: **9.783 inches = 248.4882 mm**. Routing, attachment
  endpoints, receiver/FSB inlet and internal mechanism dimensions are inferred.
- Stock, furniture, receiver contour, magazine and sight details are not
  manufacturer-dimension-certified. Do not substitute retailer packaging sizes.

`m4_check.py` checks 1,373 complete-clip poses for conservative charging-handle
separation from the stock and rear sight. Current minima are **3.000 mm** and
**7.231 mm**, respectively. It additionally checks distinct mechanism states
against real triangulated receiver/extension/plate/nut/rail/gas-tube surfaces,
assembly support, open aligned irons, static tube fit and muzzle counterbore.
It is an explicit set of mechanical regression checks, not a claim that every
solid/interior is manufacturer CAD or that every possible pair was certified.

Geometry corrections were made to the roof/channel, gas-key inlet bevel, stock/
end-plate/handle fit, real carrier vent holes and muzzle counterbore; no avoidance
motion or gameplay retiming was used. BVHs use actual Blender loop triangles:
concave Boolean mouths must not be treated as convex polygon fans.

`smoke-m4.mjs` covers offline budgets/maps/actions, exact original clip milestones,
indexed-geometry barrel/iron probes, reload wrist contacts at 240 Hz, ammunition,
physical magazine pooling, recoil, single casings, lockback and cleanup.
Legacy rifle fixtures in zero/grip/LMG smoke tests now load the actual M4 GLB.
The LMG regression retains its assertions; its rifle-thumb test uses real
quad-rail triangles with the same 6 mm pad allowance, not a widened obsolete
cylinder radius. No smoke coverage was deleted or disabled.

Current run: **56/56 smoke scripts, lint and build pass**. Browser startup review
passes with **10 shots / 10 shells / zero browser/HTTP errors**, iron-only ADS,
both reloads, inspect interruption, last-round lockback, magazine interruption
and persistent dust cover across switching. The endpoint scene reported 1,017
calls / 238 programs / 156 textures. This is a lockstep resource snapshot, **not
GPU performance** and not a matched baseline performance comparison.

## Photo-led exterior correction checkpoint

The earlier `9d6b962` checkpoint is recorded in
[PHOTO_REVIEW.md](./PHOTO_REVIEW.md), `photo-review.json`,
`tools/blender/m4_photo_review.py` and `tools/m4-photo-diff.py` for seven
fixed-camera reference/before/after/mask/RGB-difference boards. This pass fixes
the reversed/disconnected forward assist, broadens the deflector casting,
rounds the upper shoulders, replaces the zig-zag FSB with a through-window
A-frame, corrects RIS vent cadence, and places the SOPMOD storage inside the
cheek shell with a relieved web and supported raked pad. The front sight stays
barrel-mounted: this is the approved FSP configuration, not a rail-mounted sight.

At that checkpoint the eight animation clips / 1,248 channels, socket
transforms, three image buffers and action milestones were byte-equivalent to
its previous export.
New source regressions check assist/deflector/pad support, the actual FSB and
stock windows, storage placement and 19 diagonal vent centers.

**The comparison is not an acceptance pass.** Several masks stay unchanged or
worsen, camera fits vary in reliability, the upper-photo sight/rail relationship
and lower/grip proportions remain unresolved, and finish/lighting disagree.
No full-rifle proportional claim is supported by component-only photographs.

## Side-reference stock/magazine/trigger correction

[SIDE_REVIEW.md](./SIDE_REVIEW.md) and `side-review.json` record the subsequent
side-on diagnostic boards. Removed the mistaken buttpad rake, rebuilt the
supported SOPMOD web/slots, shortened and reduced the curvature of the stamped
magazine, and cut the actual through-opening around a reshaped trigger/thin GI
guard with seated mounting ears. Fixed-registration regional disagreement drops
**39.47% stock / 32.60% trigger-guard / 57.59% magazine**. Two-anchor zero residual
is by construction, not independent camera validation or whole-rifle acceptance.

Right wrist/index/thumb fitting was rebuilt to contact the exposed trigger;
**1,157 channels are byte-unchanged and 91 right-hand channels updated**. All
sampler times/interpolation, weapon/left-hand curves, events, sockets and maps
remain unchanged from `9d6b962`. New source and indexed-GLB regressions check the
square pad, open trigger hole, guard attachment and revised magazine envelope.
Residual shape/material disagreement and full acceptance work remain open.

## Remaining acceptance work — do not merge as finished

- Refine and register the exterior against the selected upper/component
  photographs, especially receiver surface transitions, FSB casting/window,
  MaTech structure and SOPMOD web/cheek contours. Studio/game renders are not
  yet a completed reference overlay or AAA sign-off.
- Validate/refit charging-handle hand contact and exposed finger/skin clearance,
  not just finite transforms and magazine wrist attachment.
- Complete actual-input semi/auto/burst, further interruption/equipment/restart
  coverage and exported moving-geometry sweeps between sampled states.
- Complete matched-camera boards, finish/HDR review, before/after matched-frame
  resource evidence and independent visual review.

Accessible LMT, Colt/FSP-upper and MaTech photographs are review-only inputs.
Direct Daniel Defense image downloads returned HTTP 403; the accessible primary
specifications are not proof that those blocked images were inspected. No single
verified photograph of the entire exact bare build was found. Upper/component
comparisons must not be presented as complete-rifle proportional validation.

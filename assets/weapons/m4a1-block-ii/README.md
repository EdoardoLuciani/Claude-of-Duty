# M4A1 Block II

Blender-authored starting `rifle` / `M4A1`. Original game art, not a scan or
manufacturer-certified replica. Technical checks are not AAA/reference sign-off;
receiver/grip/sight contours, finish and some hand-contact review remain open.
Historical audits, comparison boards and checkpoint metrics are recorded in
[PR #339](https://github.com/EdoardoLuciani/Claude-of-Duty/pull/339), rather than
maintained as separate asset-folder documents.

## Committed files

| File | Why it is kept |
| --- | --- |
| `m4a1-block-ii.glb` | Runtime geometry, three embedded maps, sockets and eight clips. |
| `m4a1-block-ii.blend` | Editable, packed Blender source with components, controls and review hands. |
| `manifest.json` | Runtime clip/event data, export statistics and authoring metadata. |
| `hand-reference.json` | Runtime grip fitting and offline Blender wrist/finger inputs. |
| `photo-review.json` | Default fixed-camera/landmark/mask inputs used by the photo-render and diff tools. |
| `side-review.json` | Side-view registration inputs for stock, trigger/guard and seated-magazine comparisons. |
| `.gitignore` | Keeps generated textures and renders out of version control. |
| `README.md` | Configuration, regeneration and review instructions. |

Both review JSONs contain source URLs/camera data, not photographs or textures.
Render output, texture copies, Blender backups and `.tmp-rend/` are untracked.
Normal builds use the committed assets and require **no Blender**.

## Configuration and measurement caveats

- Colt M4A1-pattern receivers; 14.5-inch SOCOM-profile 5.56 mm barrel.
- FDE Daniel Defense **M4A1 RIS II FSP**, SKU **01-004-08030**; barrel-mounted
  A2 front-sight base and raised MaTech 600 m rear aperture.
- Unsuppressed SureFire **FH556RC-1/2-28** four-prong; black LMT SOPMOD stock,
  A2 grip, GI trigger guard and standard non-E2 aluminum USGI 30-round magazine.
- No optic, magnifier, laser, light, foregrip or rail covers. Restrained wear.

Reference anchors: [Block II configuration](https://clonerifles.com/m4a1blockii/),
[Daniel Defense RIS II FSP](https://danieldefense.com/m4a1-fsp-risii-fde.html),
[SureFire FH556RC](https://www.surefire.com/socom-4-prong-flash-hider/),
[LMT SOPMOD](https://lmtdefense.com/product/sopmod-buttstock-black/) and
[MaTech](https://www.matechsolutions.com/buis). Exact review-photo URLs and
registration estimates are in the two camera JSONs.

Closed-bolt face to crown is **368.300 mm**. The RIS main envelope is
**311.150 × 56.642 × 57.150 mm**, including teeth/side fasteners but excluding
the separate rear bolt-up flange. SureFire's **2.6 in / 6.4 cm** listing conflicts:
the provisional flash-hider length is **66.040 mm**, not simultaneously 64.000 mm.
The nominal carbine gas tube is **9.783 in / 248.4882 mm**; routing/endpoints and
internal clearances are inferred. Receiver/furniture/magazine/sight contours are
photo-informed, not certified CAD. No verified photograph of the entire exact
bare configuration has been established; component photos do not validate full-
rifle proportions. Direct DD photo downloads returned 403, not inspected-photo proof.

## Authoring and validation

Game metres are +X right, +Y up, −Z forward, converted in the generator to
Blender coordinates. Actions are authored at 120 fps: Idle, Fire, Last Shot,
Tactical/Empty Reload, Inspect, Draw and Holster. Blender owns mechanisms and
wrist/finger choreography; runtime retains shared skins/arm IK, ADS, sway and
reactive recoil. Original gameplay values and action/event timing are preserved,
including the fractional **.620 s** draw endpoint. No duplicate exported arms.

From the repository root, with Blender 5.2.2 LTS and Node dependencies installed:

```sh
node tools/m4-hand-reference.mjs
blender -b --threads 8 --python-exit-code 1 --python tools/blender/m4a1.py -- --quick
blender -b assets/weapons/m4a1-block-ii/m4a1-block-ii.blend \
  --python-exit-code 1 --python tools/blender/m4_check.py
npm test
npm run lint
npm run build
node tests/e2e/check-m4-game.mjs --port=5199 --out=.tmp-rend/m4-game
node tools/capture.mjs --shot=weapon --out=.tmp-rend/m4-boot.png
```

Regeneration overwrites the source/GLB/manifest and texture copies; normal builds
never regenerate them. `--render` adds Eevee studio stills. On this machine an
OCIO 2.4-compatible config is needed because the system config targets 2.5;
this is a local workaround, not a runtime color-management change.

Current export: **105,587 triangle instances / 28 primitives / 11 materials /
12 unique mesh buffers / three 1024² maps / 7,634,072 bytes (7.28 MiB)**. Caps are
strictly <110,000 triangles, ≤40 primitives, ≤16 materials and ≤10 MiB. Both
magazines/cartridge groups and the runtime-hidden review casing count.

Export gathers static child transforms with NLA tracks muted and an invertible
rest pose; the exporter samples those tracks itself. This keeps hidden spare
magazine/cartridge meshes from inheriting permanently collapsed transforms.
The rear-aperture throat is **2.8 mm**, enlarged from 2.2 mm for gameplay
readability; this is not a manufacturer aperture-dimension claim. Its center,
outer cup, front post and gameplay ADS/FOV/zero settings are unchanged.
The empty-reload charging grip is fitted separately from the magazine grip.
Checks cover visible spare descendants, latch contacts and deformed shared-arm
triangles against the stock through arrival, pull, release and return at 240 Hz.

## Front-post prototype review

```sh
node tools/capture-m4-sights.mjs --port=5208 --out=.tmp-rend/m4-sights
```

Review-only capture tooling compares the untouched post with +25%, +50% and
+100% width, plus +50% with ivory or muted-amber paint on its upper 1.4 mm.
It isolates the post from the loaded geometry and alters only that browser
session; the committed GLB/Blender source and normal gameplay are unchanged.
E/F paint is opaque and non-emissive. G keeps the original 2.6 mm front post,
gives its tip neon-green paint with emissive intensity 2, and opens the nearby
rear aperture from 2.8 to 5.6 mm. The outer cup stays 7.6 mm across; only its
radial wall profile changes. H keeps G's settings but shortens the rear support,
leaving its base fixed and its top 0.1 mm below the aperture's lowest inner edge.
It still meets the lower cup wall without extending into the opening. Painted
tips have 10 µm overlay clearance, making them very slightly wider than the
unpainted equivalent.

For a focused baseline-versus-green comparison:

```sh
node tools/capture-m4-sights.mjs --variants=A,G --out=.tmp-rend/m4-sights-green
```

For the support-clearance before/after comparison:

```sh
node tools/capture-m4-sights.mjs --variants=G,H --out=.tmp-rend/m4-sights-clear
```

Every image boots a fresh lockstep engine and captures frame 103 with identical
pose/idle phase, FOV, accuracy and recoil (G/H change the rear aperture). Output
includes full frames, native-size center-crop sheets, explicitly labeled 3× pixel
enlargements, and geometry/FOV/frame checks in `report.json`. Raycasts check the
horizontal throat/rim boundary and sample 161 points across the opening's inner
90% radius, including its lower third. H must have zero near-sight obstructions;
the distant front sight intentionally remains visible and is beyond these rays.
A separate anchoring check traces entry/exit boundaries through both closed
meshes at 18 junction locations. H requires real shared solid volume at three or
more locations and at least 0.25 mm maximum embedding, not just overlapping
bounding boxes. `report.json` records contact count and maximum overlap depth.
Cases cover daylight and dusk at 1920×1080, plus daylight at 1280×720, at device
pixel ratio 1. These are stationary
readability comparisons, not a moving/firing playtest or a selected final design.

## Saved-source review

`tools/blender/m4_review.py` renders isolated overview angles without hands,
spare magazine or review casing. `m4_photo_review.py` renders the recorded
photographic cameras. Both explicitly use **Eevee rasterization**, overriding
older sources' stored Cycles engine, and never save the `.blend`. A working
headless graphics context/driver is required, not HIP/CUDA configuration.

```sh
blender -b assets/weapons/m4a1-block-ii/m4a1-block-ii.blend \
  --python tools/blender/m4_review.py -- --out .tmp-rend/m4-views
# Add --view left --view right to select angles; default is all ten.
blender -b assets/weapons/m4a1-block-ii/m4a1-block-ii.blend \
  --python tools/blender/m4_photo_review.py -- --out .tmp-rend/m4-photo \
  --registration assets/weapons/m4a1-block-ii/side-review.json
```

For new pixel comparisons, render separate before/after sources with the **same
backend/settings and frozen registration**, then use `tools/m4-photo-diff.py`
with `--photos`, `--before`, `--after`, `--out` and the same `--registration`.
Review-only originals must retain their recorded filenames/dimensions. Do not
mix historical Cycles images with new Eevee frames or expect identical AA/RGB
metrics. Two-anchor zero residual is by construction, not independent camera
validation; weak oblique fits and lighting differences must remain disclosed.
Offline diff tooling needs Pillow/NumPy, not new runtime dependencies. The game
HDR renderer remains the final runtime appearance check.

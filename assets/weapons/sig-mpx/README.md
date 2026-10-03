# SIG MPX — staged Blender remake

**Gate 1 approved; static geometry/material candidate available for Gate 2.
Not integrated or animation-complete. No AAA/pixel-identical sign-off has been given.**

Original game artwork, not manufacturer CAD, a scan, manufacturing geometry or
an endorsed/licensed SIG product. The approved design is a reference-supported
assembly, not a claim that every catalog photograph depicts the same specimen.
See [REFERENCES.md](REFERENCES.md) for authorities and caveats.

## Approved configuration

- Black 8-inch (203.2 mm nominal barrel) select-fire MPX exterior.
- Factory folding/telescoping stock deployed in the labelled base-photo pose.
- Bare factory M-LOK handguard, **no vertical grip or handstop**.
- Factory 30-round magazine; folded factory backup irons.
- ROMEO4T **not PRO**, 1.41-inch mount, no additional lower-third spacer.
- MPX-specific SRD9 exterior, using the 2019 MIL-SRD9-MPX envelope as authority;
  located at the actual 8-inch barrel exit, not shrouded to imitate the different
  suppressed hero photograph.
- Restrained service wear; reference-backed maker/model/control marks, fictional
  serial rather than a copied specimen serial. Branding needs separate commercial
  review. Unverified typography/logos/contours must be called approximations.

## Approved final delivery and remaining gates

1. **Reference board/configuration — approved in the design interview.**
2. **Combined geometry/material review — pending.** Fixed-view base comparisons,
   opposite side, all-angle/detail renders, documented component differences and
   original PBR texture inspection. Do not silently reinterpret the hero barrel.
3. **Animation/gameplay review — pending.** Eight native clips (Idle, Fire,
   Last Shot, Tactical/Empty Reload, Inspect, Draw, Holster), fitted shared wrist/
   finger tracks and IK arms, hip/ADS/action screenshots and animation reels.
   Shared locomotion, ADS and reactive recoil remain runtime-driven. No world LOD
   or dropped/enemy weapon feature; no functional internals.

Pause for user approval at gates 2 and 3. Do not equate improved silhouette metrics
or passing tests with AAA approval or literal photograph equality. Normal builds
must not require Blender, network references or new runtime dependencies.

## Runtime budget and gameplay decisions (not implemented yet)

Runtime: **<110,000 triangle instances, ≤40 primitives, ≤16 materials, three
1024² PBR maps, ≤10 MiB self-contained GLB**. Source may retain editable parts.

Change capacity from 32 to **30**, preserving 224 reserve, damage, 950 rpm,
ballistics, recoil and action durations: tactical/empty reload 1.85/2.5 seconds,
inspect 2.9 seconds, draw/holster 0.52/0.34 seconds. Retain partial magazine on
tactical reload; discard empty magazine. Respect existing chamber/+1 rules,
interruption/reset semantics and exactly one live casing/event stream.
Suppressed sound/reduced flash at suppressor exit, without changing AI hearing
or balance. Existing suppressed sound support is not a verified MPX field
recording. No new dependencies or unrelated renderer/world refactors.

## Stage-2 authoring

`tools/blender/mpx.py` owns the candidate. Running it overwrites generated source,
GLB, maps and manifest. Manual Blender edits must be incorporated into authoring
before regeneration. The candidate is **static** until the animation gate work;
its manifest must not pretend absent native clips exist.

```sh
blender -b --threads 8 --python-exit-code 1 --python tools/blender/mpx.py
blender -b --threads 8 --python-exit-code 1 --python tools/blender/mpx.py -- --render
blender -b assets/weapons/sig-mpx/mpx.blend --python-exit-code 1 \
  --python tools/blender/mpx_check.py
node tests/smoke/smoke-mpx-asset.mjs
# With the referenced PDF page rasterized into the disposable reference folder:
python3 tools/mpx-photo-review.py
```

Source: `mpx.blend`; review export: `mpx.glb`; packed original images; manifest.
Disposable review output and downloaded reference originals live under
`.tmp-rend/mpx/`, not in shipped assets. Saved studio uses Eevee rasterization,
ray tracing disabled; no Cycles/GPU path tracing requirement. The local Blender
OCIO mismatch may require a compatible `OCIO` environment path (see existing
EVOLYS README). Exported geometry/textures do not depend on that local workaround.

## Candidate validation and remaining visual work

Current static export: **77,052 triangle instances / 27 primitives / 12 materials /
three 1024² images / 6,790,648 bytes (6.48 MiB)**. Counts include the editable
rigid controls/caps but not the future spare reload magazine, hand tracks or
native animations; recheck the budget when those are added.

MCP was used to open and inspect the actual source, audit evaluated components,
edit the oversized/incorrectly positioned deflector, and render its correction
in the running Blender session. The persisted generator also corrects the
full-ellipse receiver flank seam and refines the lower/grip against the frozen
photo overlay. These are reviewed changes, not a claim of final resemblance.

User review rejected the first candidate for a floating trigger, wrong magazine
size, out-of-bounds MPX text, upper/well separation and disconnected covers.
The revision seats the trigger root in its receiver pocket, registers a narrower
curve-normal magazine to the unchanged reference, mates its floor plate and the
well to the assembly, projects glyphs onto declared physical surfaces, and
constructs both open covers from real attached hinge pivots. Depths and hidden
magazine-neck dimensions are still inferred, not manufacturer measurements.

`mpx_check.py` independently checks saved-source barrel/can datums (1 µm
float32 tolerance), packed maps, actual open M-LOK slots, sampled upper/lower
and upper/well mating surfaces, trigger attachment, fixed visible-mag silhouette
bounds, glyph surface contact, deflector clearance and attached unobstructed
cover assemblies. The photo bounds include the shell **and floor plate** at the
bottom; a six-pixel tolerance acknowledges compressed-photo AA/perspective and
is not a manufacturing/pixel-equality certificate. The smoke test checks the committed
static GLB, dense finite position/normal/UV/index data, embedded maps, tints,
budgets and sockets. Neither certifies every triangle clearance or likeness.

`photo-review.json` freezes the uniform nominal registration used by
`tools/mpx-photo-review.py`; the resulting reference/candidate/50% overlay does
not produce an RGB or silhouette score. The catalog camera is not calibrated;
accessory differences, specimen perspective and annotations are explicit.
Stock/grip relief, optic/iron housing detail, controls, magazine appearance,
manufacturer typography and material realism remain human-review items.

Verification so far: clean `npm ci`, 68 smoke tests, lint, production build,
Blender source check, static asset check, ordinary game boot capture and a
legacy playable-SMG idle capture. **The game still uses its original SMG.**
These boot/baseline captures are not new-MPX gameplay evidence.

Before final delivery: clean `npm ci`, tests/lint/build, Blender/export checks,
browser gameplay/capture checks, budget/clip/event/material validation and human
visual approval; commit/push and PR against `develop` with before/after evidence.

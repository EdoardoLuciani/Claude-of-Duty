# SIG MPX — staged Blender remake

**Gates 1 and 2 approved. Eight native clips and playable SMG integration are
available for Gate 3 animation/gameplay review. Final approval is pending;
no certified AAA/pixel-identical claim.**

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
2. **Combined geometry/material review — approved after the five requested fixes.** Fixed-view base comparisons,
   opposite side, all-angle/detail renders, documented component differences and
   original PBR texture inspection. Do not silently reinterpret the hero barrel.
3. **Animation/gameplay review — pending.** Eight native clips (Idle, Fire,
   Last Shot, Tactical/Empty Reload, Inspect, Draw, Holster), fitted shared wrist/
   finger tracks and IK arms, hip/ADS/action screenshots and animation reels.
   Shared locomotion, ADS and reactive recoil remain runtime-driven. No world LOD
   or dropped/enemy weapon feature; no functional internals.

Pause for user approval at gate 3 before marking the draft PR ready. Do not equate improved silhouette metrics
or passing tests with AAA approval or literal photograph equality. Normal builds
must not require Blender, network references or new runtime dependencies.

## Implemented runtime budget and gameplay decisions

Runtime: **<110,000 triangle instances, ≤40 primitives, ≤16 materials, three
1024² PBR maps, ≤10 MiB self-contained GLB**. Source may retain editable parts.

Capacity changed from 32 to **30**, preserving 224 reserve, damage, 950 rpm,
ballistics, recoil and action durations: tactical/empty reload 1.85/2.5 seconds,
inspect 2.9 seconds, draw/holster 0.52/0.34 seconds. Retain partial magazine on
tactical reload; discard empty magazine. Respect existing chamber/+1 rules,
interruption/reset semantics and exactly one live casing/event stream.
Suppressed sound/reduced flash at suppressor exit, without changing AI hearing
or balance. Existing suppressed sound support is not a verified MPX field
recording. No new dependencies or unrelated renderer/world refactors.

## Reproducible authoring and native animations

`tools/blender/mpx.py` owns geometry/PBR/export; `mpx_actions.py` owns the eight
native clips; `tools/mpx-hand-reference.mjs` fits the shared-hand contact seed.
Running the generator overwrites source, GLB, maps and manifest. Useful MCP/manual
edits must be incorporated into these scripts before regeneration.

The editable scene retains original components and appended shared glove/sleeve
skins for review, not export. Enable a matching NLA track on all controls and
`MPX_arm_left/right`, and use that clip's frame range from the manifest. Source
uses metres, +X forward, +Z up, −Y right. The adapter converts the GLB hierarchy,
geometry and native curves into game coordinates once. Samplers may share glTF
accessor arrays; conversion copies their storage to avoid rotating idle hands
repeatedly through different clips.

Idle holds the fitted contact posture under shared runtime breathing/sway.
Fire/Last Shot author carrier/trigger/finger motion, not an extra root recoil.
The charging handle is non-reciprocating; empty reload operates the bolt release.
Tactical reload carries the partial magazine down out of frame before fetching a
fresh one; empty reload emits one physical magazine drop. Sampled wrist paths
follow the actual evaluated magazine transforms, rather than interpolated guesses.
No exported spent case or duplicate arm skin; runtime uses shared IK/live casings.

```sh
node tools/mpx-hand-reference.mjs
blender -b --threads 8 --python-exit-code 1 --python tools/blender/mpx.py
blender -b --threads 8 --python-exit-code 1 --python tools/blender/mpx.py -- --render
blender -b assets/weapons/sig-mpx/mpx.blend --python-exit-code 1 \
  --python tools/blender/mpx_check.py
node tests/smoke/smoke-mpx-asset.mjs
node tests/smoke/smoke-mpx.mjs
node tests/e2e/check-mpx-game.mjs
# Optional genuine game playback reel; ffmpeg must be installed:
node tests/e2e/check-mpx-game.mjs --reel
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

Current animated export: **98,212 triangle instances / 38 primitives / 15 authored materials /
three 1024² images / 8,246,252 bytes (7.86 MiB)**. Runtime uses 15 materials;
validation also accounts for any implicit glTF fallback. Counts include both native
magazine instances (even while one is hidden), fitted control tracks and all eight
clips. No texture/material duplicates for the spare. Shared game arm assets are
separate, as for the other authored weapons.

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
is not a manufacturing/pixel-equality certificate. The asset smoke test checks the committed
GLB, dense finite position/normal/UV/index data, embedded maps, tints, budgets,
sockets and eight complete native clips. The runtime smoke test checks exact
timings, game-space wrist/finger conventions, evaluated reload contact, spare
transforms, persistent lockback, reset/interrupt behavior and cleanup. Neither certifies every triangle clearance or likeness.

`photo-review.json` freezes the uniform nominal registration used by
`tools/mpx-photo-review.py`; the resulting reference/candidate/50% overlay does
not produce an RGB or silhouette score. The catalog camera is not calibrated;
accessory differences, specimen perspective and annotations are explicit.
Stock/grip relief, optic/iron housing detail, controls, magazine appearance,
manufacturer typography and material realism remain human-review items.

The playable SMG and standalone preview now use the committed MPX GLB. Normal
builds remove ignored legacy SMG exports and never invoke Blender. The existing
legacy builder remains only for historical/procedural diagnostic tests.

The browser check exercises actual game startup, hip/ADS, retained and empty
reloads, chamber/+1 accounting, inspection/fire interruption, one casing per
shot, persistent lockback, switching, cancellation before/after insertion,
pause, animated holster/draw switching, death/restart and console/network errors. It writes screenshots and a report
under `.tmp-rend/mpx/game/`; `--reel` also writes a real 30-fps gameplay sequence,
segment indices and MP4. This is new-MPX evidence, distinct from the retained
legacy idle baseline. Verified with clean `npm ci`, 69 smoke tests, lint,
production build, independent saved-source checks and the actual browser game
check/reel. Passing checks is not human animation acceptance.

### Handling/model audit revision (items 1–9)

The reload grip fits all four palmar finger patches to the curved magazine's
side faces, rather than an infinite-cylinder approximation. The shooting hand
wraps the grip with an indexed finger during handling. The support thumb presses
the left ambidextrous magazine catch, then returns to the magazine; the empty
reload thumb follows the moving bolt catch. Joint bounds and unreachable-contact
assertions are checked during offline authoring.

The feeding end now has an actual neck opening, seated extended lips, a visible
follower and two decorative loaded cartridges. Native/runtime visibility hides
cartridges in an empty magazine, including a chamber-only last round. These are
inferred exterior game details, not functional internals or manufacturer CAD.

Inspection is a two-handed side presentation with continuous handguard contact.
The support grip sits farther rearward, and the MPX has a weapon-specific firing
shoulder anchor so the runtime IK does not detach a wrist at full extension.
Draw/holster release and approach paths are sampled in body space, independently
of the weapon's one-handed carry motion.

The runtime regression evaluates actual posed finger pads during reloads,
thumb-to-moving-catch contact, and both wrists against the shared IK reach over
all handling clips. Source checks independently verify the feeding-end opening
and lip attachment. The revised 334-frame reel was reviewed via contact sheets
and full-resolution problem frames. Tests do not certify every skinned triangle
clearance or final visual acceptance. Separately audited runtime finish, rail
highlight aliasing, optical rendering, muzzle-flash and capture limitations
remain outside this handling/model pass. Gate 3 remains pending.

### Optic ADS shading revision

The optic's Boolean-cut inward faces previously used an empty material slot,
causing bright fallback shading. Main housing/ocular/objective interiors now
have an explicitly assigned absorptive finish; protective-cover interiors use
black polymer. Exterior envelopes, 20 mm aperture and cap opening angles remain
unchanged. Interior coating appearance is inferred game art, not measured optics.

Lenses and clear covers are single optical sheets. Runtime uses double-sided,
single-pass, low-opacity coating (2% per lens, 1% per cover), not stacked closed
translucent discs or transmission from a weapon-only render target. Global
lighting, other weapons and the collimated reticle implementation are unchanged.

The optional `--optic-review` browser check measures actual lens depths, near-plane
clearance and wrist reach, and temporarily compares 0.18/0.28 m eye-relief settings.
The committed 0.22 m setting and FOV remain unchanged: the baseline rear/front
lens depths are approximately 0.180/0.260 m, outside the 0.005 m near plane, with
no wrist reach error. Closer placement enlarges the housing; farther placement
shrinks the window and foregrounds the rear iron sight. Comparison screenshots
are diagnostics, not a claim of exact real-world sight-picture equivalence.
Source/export tests verify single sheets and actual interior material assignment;
runtime tests include the fallback material in the approved 16-material budget.
Human ADS/animation acceptance remains pending.

Before final delivery: clean `npm ci`, tests/lint/build, Blender/export checks,
browser gameplay/capture checks, budget/clip/event/material validation and human
visual approval; commit/push and PR against `develop` with before/after evidence.

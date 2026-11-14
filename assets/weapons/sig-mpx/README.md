# SIG MPX

Black select-fire 8-inch MPX, deployed stock, ROMEO4T and MPX-specific SRD9.
Solid 1.5 mm polymer cap lids are approved; closed lids intentionally occlude
the optic. General animation/gameplay/optic human acceptance remains outstanding.
Original art, not a certified replica.

[Source map](../../../tools/blender/mpx/README.md) ·
[Shared workflow](../../../tools/blender/README.md)

The adapter converts +X-forward/+Z-up/−Y-right once and samples eight clips.
Ordinary meshes preserve actual cap pivots, mechanisms, independent magazines and
rounds. Preserve lockback, cancellation, chamber accounting and pooled ejection.
Three materials retain original finish colors and UV0 grain, with UV1 finish tiles.
Body lenses stay at 2% opacity; the world-sized 2 MOA dot has a six-pixel floor.
Hand calibration/review-arm inputs are read-only. Normal builds use local assets.

Run from the repository root with Blender 5.2.2 and gltfpack 1.3:

```sh
blender -b -t 2 --python-exit-code 1 --python tools/blender/mpx/build.py
blender -b -t 2 assets/weapons/sig-mpx/mpx.blend \
  --python-exit-code 1 --python tools/blender/mpx/check.py
bun run models:cook -- mpx
```

Use `--output /tmp/mpx-review` for scratch builds. The registered cook retains
material boundaries and 16-bit colors; do not adopt more aggressive optic-rim
simplification. The source map records the UV-repeatability limitation.
Historical representation/storage comparisons remain in Git, not an FPS claim.

## TOR Mini rail (#686)

A short authored right-side Picatinny adapter enables the shared optional laser,
independently of the existing integrated optic and suppressor. The adapter stays
on the base weapon; `rail: 'laser'` installs the TOR Mini and `rail: null` removes
only the module. API/debug/capture and independent inspection share the same solver;
attachment purchase/customization UI remains separate work.

The corrected 43.5 mm backing and four full teeth remove the unused rear flange/
tooth that intersected the support glove during tactical reload and holster.
The TOR's clamp begins at source x=.2855, ahead of that removed tooth. Two modeled
anchors now pass through the last actual M-LOK slot instead of placing one beyond
the handguard end. Four real-surface rays verify backing contact on the slot's
upper/lower lands. This is authored game-fit hardware, not factory/CAD certification.
Hands, calibration and all eight animation/event timelines remain unchanged.

The MPX adapter's load-time +X-to-−Z conversion now preserves the shared attachment's
local frame. Conjugating that frame like weapon geometry previously turned the
module/emitter upward. The corrected slot is bore-forward in gameplay and inspection,
without a per-frame offset, weapon-specific laser renderer or handling bonus.

The full native check passes **998 poses at 120 Hz**, including fractional fire
endpoints, actual adapter/laser surfaces, both deformed hands, emitter corridor
and integrated optic/suppressor. A separate native-WebGPU fixture passes **4,096
runtime poses**, including hip/ADS clips, firing, last-shot lockback, returns,
sprint/low-ready/ADS transitions and gesture cancellation. Both arms clear native
hardware, cooked adapter-region geometry and the cooked laser; the emitter axis
remains bore-forward throughout. These finite samples are not continuous clearance
or final human animation/gameplay approval.

A full-game native-WebGPU run also checks optional equip/removal, actual firing,
both reloads, ADS/inspect, independent inspection alignment, switching/beam cleanup
and restoration. No page/console/TSL/GPU-validation errors were collected; ordinary
material-deprecation, zero-draw and canvas-format warnings remain disclosed.
No base conversion or dependency on the still-open #662/#663 issues is introduced;
the integrated ROMEO4T/SRD9, original sight datum and weapon handling are retained.

```sh
bun tools/capture.ts --weapon=smg --rail=laser --shot=weapon --out=/tmp/mpx-laser.png
```
See the [mount table, source sweep and limitations](../../attachments/steiner-tor-mini/README.md#weapon-mounting-686).

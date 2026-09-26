# P320 Compact — approved production brief

Status: the user approved the reference direction and subsequently authorized
end-to-end implementation without further intermediate stops. The original
review gates below remain the evidence checklist, not outstanding authorization
blocks. Final visual acceptance still belongs to the user. See [README.md](README.md)
for delivered assets, measurements and limitations; [REFERENCES.md](REFERENCES.md)
records the photographic sources.

## Subject and fidelity

- SIG P320 Nitron Compact, 9 mm, 3.9-inch barrel, standard compact grip,
  curved trigger, no external manual safety.
- SIGLITE iron sights; flush 15-round magazine; no optic, light, suppressor,
  extended magazine or aftermarket accessories.
- Lightly used black factory finish: restrained contact wear, molded polymer
  texture, coated-metal separation, reference-accurate visible markings and
  fictional serial numbers. Do not turn polymer edges into exposed silver metal.
- Recreate the complete assembled exterior from all angles and surfaces exposed
  during the agreed animations. No field-strip presentation or normally unseen
  internal mechanism. This is a non-functional game art asset.
- Exceed the current MCX's visual fidelity. Real photographs, not the procedural
  P-19 mesh, determine the shape and details.
- "Pixel perfect" means closely reference-matched visible shape and detail, not
  identical photographic pixels under different cameras, lighting and exposure.
  Do not claim dimensionally exact reconstruction from uncalibrated photographs.
- Production-era appearance: the coherent early-production exterior in the
  2015 review photographs, with the original broad curved trigger and medium grip.

## Deliverables

- Editable Blender source with named components, weapon rig and authored hand/
  finger performance, packed PBR textures, and review cameras.
- Committed animated GLB and required runtime assets, loaded offline without
  requiring Blender during normal builds or game startup.
- Studio comparisons, in-game screenshots and an animation review reel.
- Pistol integration, source/export documentation, regression coverage and
  geometry/draw/texture-memory/frame-time measurements.
- Dedicated branch/worktree, commits and PR against `develop`; game before/after
  screenshots attached when an actual visual implementation exists.

## Animation

Author these eight action categories in Blender with coordinated hands/fingers:

1. Idle.
2. Fire.
3. Last-shot lockback.
4. Tactical reload: retain the departing magazine.
5. Empty reload: drop the departing magazine and use a slide-catch release.
6. Inspect: no ammunition-state change.
7. Draw.
8. Holster.

Grounded, practiced handling; no theatrical spinning or gratuitous camera motion.
Hands must contact the correct controls and magazine rather than float or slide
through them. Weapon parts and hand motion must agree throughout transitions.
Reuse the current glove/sleeve appearance. Keep locomotion, sway and aiming as
runtime layers, with adjustment needed to fit authored motion into gameplay.

The end-to-end authorization superseded the timing approval stop. Delivered
handling durations are documented in README rather than forced to the old P-19.
Final review must cover rapid fire, last-shot lockback, reload interruption,
inspect cancellation, switching and transitions to shared utility actions, not
just isolated looping showcase clips. Preserve gameplay ammunition/event
contracts and avoid duplicate procedural plus authored recoil/part motion.

## Gameplay and scope

- Replace `pistol`, the existing starting secondary; display `P320 Compact`.
- Magazine capacity 15; reserve 60. Preserve the existing chamber accounting.
  Review HUD and reload results against that contract rather than inventing a
  second ammunition convention.
- Preserve damage, firing cadence and other unrelated combat tuning.
- Use existing audio assets; synchronize their timing with authored events.
- Remove the mini-reflex and align ADS to the actual iron sights.
- Other weapons, shared arm appearance and global lighting remain unchanged.
  If shared systems prevent acceptance, present evidence and request expanded
  scope rather than changing them silently.
- No new runtime dependencies, network assets or changes to world assets.
- Protect the unrelated `package-lock.json` change in the user's main worktree.

## Acceptance and approval gates

Originally these were four mandatory approval stops. The user's subsequent
end-to-end authorization removed the intermediate stops. Completing documents or
passing smoke checks is still not equivalent to final visual approval.

| Gate | Evidence | Stop condition |
| --- | --- | --- |
| 1. References | Verified configuration, attributed photographic board, source hierarchy, variation/missing-evidence notes | Approve reference set and production-era appearance before modeling |
| 2. Geometry and motion blockout | Matched-view untextured comparisons; all-around silhouette; hand contacts and draft action durations | Approve shape and timing before final polish |
| 3. Materials in engine | Studio and native 2560×1440/high game frames, hip/ADS/inspect views, unscaled close-up crops | Approve material response in game, not only Blender |
| 4. Final integration | Full animation reel, transitions/interruption tests, gameplay screenshots, smoke/build/lint results and performance report | Approve the completed replacement |

MCX runtime cost is the provisional ceiling. Compare current P-19, MCX and P320
under the same scene, hardware, resolution, preset and capture conditions.
Report triangle count, draw submissions, texture memory, frame-time distribution
and hitches; the MCX's manifest alone is not a runtime performance measurement.
Escalate overruns before sacrificing approved detail or declaring completion.
No fixed FPS is promised. Relevant tests and `npm run build` must pass before
final delivery; document unrelated pre-existing failures rather than weaken tests.

## Baseline implementation facts (before this replacement)

- `src/weapons/models/pistol.js` procedurally authors a fictional P-19 with a
  reflex sight; it is not an identified SIG replica.
- `src/weapons/defs.js` originally gave it 17 rounds, 68 reserve, 460 rpm,
  1.6 s tactical reload, 2.2 s empty reload, 2.6 s inspect, 0.42 s draw and
  0.30 s holster.
- The current MCX source/export is under `assets/weapons/mcx-virtus/`.
  Its manifest reports 93,606 triangles, 10 meshes, 40 material slots and
  1024-square tileable PBR textures. These are baseline facts, not proposed
  pistol budgets or proof of AAA acceptance.
- `src/weapons/mcx.js` samples Blender mechanical clips but supplies runtime
  hand targets. It has MCX-specific part names/timings and material calibration;
  it cannot simply be attached to this pistol unchanged.
- The current shared glove/arm asset already has Blender source. Coordinated
  action animation is new work, not something already present in the MCX file.

Working branch: `feat/p320-compact`. Worktree:
`/home/edoardo/Documents/Claude-of-Duty-p320`.

# SIG MPX

**Gates 1–2 approved; Gate 3 animation/gameplay/optic review remains pending.**
Original game art, not CAD/scan, certified replica or endorsed/licensed SIG product.
Do not mark visual delivery complete from tests alone. [Reference authority](REFERENCES.md).

## Locked configuration

Black select-fire 8-inch MPX, deployed factory folding/telescoping stock, bare
M-LOK handguard (no handstop), 30-round magazine, folded irons, ROMEO4T **not PRO**
on 1.41-inch mount without spacer, MPX-specific SRD9 at the actual barrel endpoint.
The suppressed catalog hero is not certified to be this barrel configuration.
Restrained wear; fictional serial, approximate reference-backed marks/typography;
branding needs separate commercial review. No functional internals/world LOD feature.

## Runtime contract

`src/weapons/mpx.js` loads the committed GLB for gameplay/preview. Normal builds
need no Blender/network; old procedural SMG remains only for historical diagnostics.
Source metres: +X forward, +Z up, −Y right. Convert GLB hierarchy/geometry/curves
once; copy shared sampler accessor arrays before conversion.

Eight native clips: Idle, Fire, Last Shot, Tactical/Empty Reload, Inspect, Draw,
Holster. Shared skins/IK, ADS, sway and reactive recoil stay runtime-driven;
no duplicate root recoil, exported arms or review casing. Enable matching NLA
tracks on every control and `MPX_arm_left/right` when reviewing source clips.

Capacity 30, reserve 224; existing damage/950 rpm/ballistics/recoil remain.
Tactical/empty reload 1.85/2.5 s, inspect 2.9 s, draw/holster .52/.34 s.
Retain partial magazine; physically discard empty one. Preserve chamber/+1,
lockback, cancellation/reset and exactly one live case/event stream per shot.
Non-reciprocating charging handle; empty reload uses bolt release. Suppressed
sound/reduced flash originate at the suppressor exit without changing AI hearing;
sound is not a verified MPX field recording.

Current export: 100,896 triangle instances / 38 primitives / 15 authored materials /
three 1024² images / 8,368,516 bytes, including spare magazine and all clips.
Caps: **<110k triangles**, ≤40 primitives, ≤16 materials (including implicit glTF
fallback), three 1024² maps, ≤10 MiB. Spare shares maps/materials; shared arms are separate.

## Rebuild and checks

`tools/blender/mpx.py` owns geometry/PBR/export; `mpx_actions.py` owns clips;
`tools/mpx-hand-reference.mjs` fits hand seeds. Persist manual/MCP changes in these
scripts: regeneration overwrites source, GLB, maps and manifest.

```sh
node tools/mpx-hand-reference.mjs
blender -b --threads 8 --python-exit-code 1 --python tools/blender/mpx.py
# Add -- --render for studio images.
blender -b assets/weapons/sig-mpx/mpx.blend --python-exit-code 1 \
  --python tools/blender/mpx_check.py
node tests/smoke/smoke-mpx-asset.mjs
node tests/smoke/smoke-mpx.mjs
node tests/e2e/check-mpx-game.mjs
node tests/e2e/check-mpx-game.mjs --reel # real 30-fps game video; needs FFmpeg
python3 tools/mpx-photo-review.py       # needs disposable rasterized PDF references
npm test
npm run lint
npm run build
```

Editable `mpx.blend` includes shared preview skins, excluded from `mpx.glb`.
Packed original images and manifest are assets; `.tmp-rend/mpx/` references/renders
are disposable. Eevee raster previews use no ray tracing. A local OCIO mismatch
may need a compatible configuration (see EVOLYS notes), not a runtime change.

## Geometry/handling regressions

Preserve attached trigger root, seated curved magazine/floorplate and well,
physical glyph seating, upper/lower joins and cover hinge connections. Source
checks cover open M-LOK slots, barrel/can datums, deflector clearance and fixed
magazine photo bounds (six-pixel compressed-image tolerance, not exact fidelity).
The feeding end has an opening, seated lips, follower and decorative rounds;
empty/chamber-only magazines hide rounds. Hidden depths remain inferred art.

Offline fits use palmar finger patches on actual curved magazine faces and thumb
contact with moving magazine/bolt catches. Inspect keeps handguard contact;
draw/holster release paths are body-space, independent of weapon carry motion.
Keep weapon-specific shoulder fit and actual shared-skin reach checks.

Asset/runtime tests cover complete finite geometry/maps, budgets/sockets, eight
clips, exact events, retained/empty reloads, insertion cancellation, spare transforms,
lockback, reset, pause, death/restart, casing counts and cleanup. Browser `--reel`
records gameplay rather than legacy preview. Contact/reach gates do not certify
all deformed-triangle clearance or final appearance.

## Optic and ADS decisions

- Explicit absorptive inward finish and black cover interiors; verify actual face
  assignment despite Boolean-created empty slots. Double-sided single-pass sheets:
  lens/cover opacity 2%/1%; no stacked discs or transmission of weapon-only targets.
- Nominal **2 MOA world-camera dot**, no ring/halo/outline; **1.5 internal-render-pixel
  minimum diameter** enlarges it at 720p. Update projection before sizing; no FOV
  lag. Foreground blur is deferred and global DOF remains disabled.
- Approved 85.5 mm envelope includes complete closed covers, not bare housing.
  Inferred body/rims/cap: 70/27/26 mm; battery rim thickness 6 mm. Keep 20 mm aperture,
  1.41-inch axis height, 120° open covers. **64 mm lens spacing is inferred**, not
  an optical prescription; source discrepancies are recorded in REFERENCES.md.
- ADS sight-centre eye distance .28 m; weapon-only FOV 8.7° (`viewFov: .145`), world
  FOV unchanged. Firing shoulder blends .12 hip → .28 ADS. No hidden aperture
  enlargement/target magnification. `--optic-review` measures matched-size framing,
  sheet depths/projection, near clearance, dot and wrists—not exact real sight picture.
- Preserve wrist/contact bounds: <60° ordinary hip/ADS, <85° held-aim draw; actual
  four-finger patch error <2 mm. Recorded Node maxima 54.96°/57.71°/81.43° and
  1.788 mm contact error are sampled regressions, not physical certification.

`photo-review.json` freezes uniform registration; no independent X/Y warp or
hidden exclusions. Catalog perspective/accessory differences limit comparisons.
Historical corrections/evidence: [PR #360](https://github.com/EdoardoLuciani/Claude-of-Duty/pull/360).
Finish, highlight aliasing, muzzle FX and capture/audio limitations remain separate
follow-ups. Final Gate 3 still requires human review, not improved test metrics.

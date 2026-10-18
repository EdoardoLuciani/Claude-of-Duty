# ADS framing: selected M4 F and first roster pass

Related to [#367](https://github.com/EdoardoLuciani/Claude-of-Duty/issues/367).
The owner selected [M4 candidate F](m4-ads-framing-review.md) and requested a
weapon-specific first pass for discussion, not the same values everywhere.

## Runtime choices

Eye distances are camera-to-sight-socket distances; weapon FOV is vertical and
independent of gameplay/world zoom. Only M4 eye distance changes. All hip poses,
shoulders, grips, models, materials, recoil, animations and ballistics are retained.

| Weapon | Eye before → after | Weapon FOV before → after | Decision                                                                  |
| ------ | -----------------: | ------------------------: | ------------------------------------------------------------------------- |
| M4     |        115 → 60 mm |                51.6 → 42° | Apply the owner's F selection exactly.                                    |
| EVOLYS |   125 mm unchanged |              50.4 → 28.8° | Larger RMR opening without disturbing arms/pouch clearance.               |
| P320   |   340 mm unchanged |                55.2 → 42° | Larger irons while retaining a two-handed arm-length presentation.        |
| M590   |   280 mm unchanged |                54 → 43.2° | Conservative ghost-ring enlargement; do not worsen its provisional wrist. |
| MPX    |   280 mm unchanged |            8.7° unchanged | Retain the existing comfortable framing reference and six-pixel dot.      |
| MCX    |   110 mm unchanged |           51.6° unchanged | Full ADS uses an already-large scope overlay, not the hidden model.       |
| AX338  |    90 mm unchanged |           43.2° unchanged | Retain its recent scope aperture/P4FL-inspired reticle improvements.      |

The ordinary world ADS FOV remains approximately 49.6° at an 80° gameplay FOV;
MCX remains approximately 22.4°, AX338 approximately 20°. Neither target zoom nor
sensitivity changes. MCX and AX338 keep their existing roughly 72%-screen-height
clear scope openings. Their frames are included in the roster review, but no
arbitrary scope change is made simply to touch every weapon.

### EVOLYS aiming mark

The enlarged RMR window uses the existing world-camera/angular dot path, with a
nominal 3.25 MOA setting and five-framebuffer-pixel minimum diameter. This is an
explicit readability policy, not a newly simulated optical prescription. Its mark
is dot-only, rather than the legacy shared segmented ring/halo. This is intentional:
shrinking weapon FOV must not multiply the aiming mark along with the housing.
The MPX's existing two-MOA/six-pixel settings remain untouched.

The new smoke test checks RMR footprint independence across weapon FOV, eye distance,
world FOV and resolutions (including a high-resolution case where angular size
exceeds the pixel floor), opacity, optical axis and off-aperture hiding.

## Iteration and review priorities

- An initial EVOLYS 16.8° trial was too large: housing/receiver dominated the full
  image. Backed off to 28.8°. This remains a stronger FOV readability compromise
  than the irons; review its whole-frame obstruction, not only the larger window.
- An initial M590 140 mm / 48° trial caused wrist angles above 95°, including
  worse folding during the pump stroke. Rejected without changing shoulders,
  loosening checks or refitting the native grip. The final 280 mm / 43.2° framing
  keeps the pose unchanged and passes the sampled <85° wrist check.
- [#447](https://github.com/EdoardoLuciani/Claude-of-Duty/issues/447) still owns the
  M590's existing right-grip/cuff defect. The new framing does not repair it or
  conceal the hand; its prominent glove should remain an explicit review concern.
- The P320 is deliberately not pulled up to the eye like a shoulder-fired weapon.
  Its unchanged 340 mm position preserves the existing elbows/hand contacts.
- MPX and scope overlays are reviewed but retained. Their different presentations
  should not inherit the M4's FOV or eye placement mechanically.

## Reproduce and judge

```sh
npm ci
node tools/capture-ads-framing.mjs --port=5239 --out=/tmp/ads-framing
# Iterate on just a subset, daylight 1080p only:
node tools/capture-ads-framing.mjs --quick --weapons=lmg,pistol,shotgun \
  --port=5239 --out=/tmp/ads-framing-quick
```

Each pair starts fresh engines at the same named `weapon` shot, RNG seed, fixed
lighting and frame 103. Before temporarily applies the explicit pre-#367 framing
values and original EVOLYS ring; after uses the actual runtime settings/optic data
without overrides. Before/after world-camera FOV, position and rotation are asserted
identical. There are 42 still cases: seven weapons × before/after × daylight/dusk
1080p and daylight 720p. Individual PNGs are native final-output readbacks with HUD.
`*-comparison.png` uses equal 50% full-frame scale; `*-crops.png` uses unscaled
centre crops. No after-only resize, geometry injection, sharpening or blur is used.

Every after weapon also runs ordinary aim-in, a real accepted shot with recovery
(including the M590 pump or AX338 bolt), and aim-out at 1080p. The report retains
per-frame wrist angle, hand-target error, forearm stretch, sight depth and optic
bounds. Checks require wrist angles <85°, hand error <2 mm, forearm scale <1.05,
sight points >20 mm beyond the near plane and measured optic geometry >5 mm beyond
it. Dot footprints remain five pixels for EVOLYS and six for MPX at these resolutions.
Physical socket alignment is checked for unscoped weapons; scopes instead assert
their fullscreen overlay is visible and the model hidden.

Existing inline-`Fn` TSL and zero-count prewarm-draw warnings are recorded/bounded;
other page, console-error, HTTP asset, WGSL and GPU-validation failures reject the
run. Outputs stay outside git and are attached to the PR. These are matched
captures, not a claim of bit-identical GPU pixels.

The existing EVOLYS sleeve/pouch clearance test now supplies the render-size/canvas
fixture contract required by its world-sized dot. All geometry assertions remain;
none are relaxed or deleted.

## Limits / follow-up

This is a first framing pass, not completion of #367. No focus or peripheral-world
blur is added. Numerical wrist/reach/depth checks are not proof against every
mesh intersection or a substitute for human visual approval, especially for M590.
Moving combat, arbitrary gameplay FOVs, ultrawide and all stances remain follow-up
review. Use the PR's individual weapon comparisons to decide which values need
adjustment before investigating nearby-housing softness separately from world blur.

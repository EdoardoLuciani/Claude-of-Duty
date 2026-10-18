# M4 ADS framing experiments — issue #367

**Historical A–H experiment: the owner selected F (60 mm / 42°).** Production
settings now include F and the [roster framing pass](ads-framing-review.md).
This tool preserves the original A–H comparison with temporary browser-only
overrides, including A's old 115 mm / 51.6° baseline; it never edits assets,
materials, aim sockets, recoil, or ballistics. Focus/blur remains outside this
framing phase of [#367](https://github.com/EdoardoLuciani/Claude-of-Duty/issues/367).

## Reproduce

From a clean install with Node 24 and hardware WebGPU:

```sh
npm ci
node tools/capture-m4-framing.mjs --port=5238 --out=/tmp/m4-framing-review
# Shorter iteration: daylight 1080p only, still exercises every candidate's motion.
node tools/capture-m4-framing.mjs --quick --port=5238 --out=/tmp/m4-framing-quick
```

Each still starts a fresh engine, applies the existing `weapon` shot, enables the
actual player ADS camera, then advances 100 simulation frames and presents twice.
The still is at engine frame 103. Base gameplay FOV is 80°; settled world ADS FOV
is approximately 49.6° for **every** variant. The tool asserts identical world
camera FOV, position and rotation, and runs the existing M4 sight geometry checks.
Lighting is 16:30 or 19:12; the automatic sky clock is disabled by capture mode.

Outputs are native final-render readbacks with the normal HUD, not Blender or
intermediate-render images. `*-overview.png` sheets display every full frame at
50% scale; `*-crops.png` sheets use unscaled centre crops. Individual PNGs retain
the original resolution. `report.json` records device, settings, still metrics,
per-frame motion metrics, constraints, errors and warnings. Keep outputs outside
git; attach the PNGs to the review PR.

## Candidates and measurements

Captured against `develop` at `c5c1f16`, on non-fallback AMD RDNA 4 WebGPU.
Weapon FOV below is **vertical weapon-camera FOV**, not target/world zoom.
`viewFov` in `defs.ts` is a multiplier of 60°.

| Candidate                           | Eye to rear socket | Weapon FOV | Nominal bore, 1080p | Front post width, 1080p |
| ----------------------------------- | -----------------: | ---------: | ------------------: | ----------------------: |
| A — shipped baseline                |             115 mm |      51.6° |             21.4 px |                  6.5 px |
| B — FOV only                        |             115 mm |        36° |             31.8 px |                  9.7 px |
| C — eye only                        |              75 mm |      51.6° |             32.8 px |                  7.1 px |
| D — moderate combination            |              85 mm |        39° |             39.5 px |                  9.5 px |
| E — farther eye, D-matched aperture |             180 mm |       ≈19° |             39.5 px |                 16.4 px |
| F — closer eye + FOV                |              60 mm |        42° |             51.7 px |                  9.3 px |
| G — closer eye, original FOV        |              50 mm |      51.6° |             49.3 px |                  7.6 px |
| H — close-eye limit probe           |              35 mm |      51.6° |             70.5 px |                  7.9 px |

"Nominal bore" projects the unchanged 2.2 mm diameter at the rear socket plane;
it is **not** a segmented measurement of the visible throat after perspective,
sway, post occlusion, shading and bloom. Post width is the projected bounding width
of the actual metal post, excluding the neon paint's bloom. 720p measurements are
approximately two-thirds of the listed pixel sizes.

### Iteration findings / proposed discussion

1. **B versus C:** similar rear opening sizes, but B enlarges the front post more.
   FOV alone magnifies everything; eye distance changes front/rear perspective.
2. **D versus E:** matched rear openings do not imply the same sight picture.
   E's front post is about 73% wider. This illustrates why the MPX's narrow weapon
   FOV should not simply be copied to iron sights.
3. **F versus G:** similar opening sizes, but G preserves a smaller aiming post.
   This motivated the second iteration's G/H eye-only probes.
4. G was the initial suggestion: about 2.3× the baseline nominal opening, with
   only about 17% more post width. **The owner preferred and selected F's larger
   front post instead.** H explores a still larger opening but also makes the
   sharp rear cup and nearby receiver very dominant.
5. Closer eye placement also changes receiver/hand perspective and muzzle-flash
   presentation. Judge the full frames and firing images, not only centre crops.
   Sharp rear metal remains deliberately unchanged; this experiment cannot settle
   the eventual focus treatment or claim to reproduce human vision.

## Pose checks and limitations

Every candidate also runs a 1080p hip-to-ADS transition, six accepted shots while
holding ADS, and aim-out: 84 one-frame motion samples per candidate. Aim-in and
mid-burst images are saved separately. No pose offsets, shoulder anchors or arm
limits are changed to make the candidates pass.

All 24 still cases and eight motion sweeps passed:

- Actual shared hand targets remain within 2 mm of solved wrist positions.
- Wrist angles stay below the existing 85° ADS limit; the maximum observed across
  all candidates is 63.6° (rounded up).
- Actual rear-cup vertices stay at least 5 mm beyond the camera near plane.
  G's minimum measured margin is 33.7 mm; H's is 18.7 mm (rounded).
- The original sight bore/post/paint, solid support attachment and unobstructed
  aperture rays pass `checkM4Sights` for every still.
- No unexpected page, console-error, HTTP asset, WGSL or GPU-validation failures.

The two existing inline-`Fn` TSL boot warnings and zero-count prewarm draw warnings
are recorded and bounded, not newly introduced shader diagnostics.
These are targeted checks, **not** a proof against every arm/weapon intersection,
all movement stances, arbitrary FOVs/aspect ratios, or moving-target readability.
No enemies, focus blur, ultrawide validation, or final human visual approval is
included. Fresh captures are matched, not claimed to be bit-identical GPU pixels.

## Real-world reference and deliberate compromises

[FM 3-22.9, chapter 4, §4-5a(6)](https://ar15-m16.com/FM3-22.9marksmanshipmanual/c04.htm)
links eye relief to a relaxed, repeatable cheek-to-stock weld, using nose-to-charging-
handle contact as a starting positioning cue. §4-5b(2) describes centering the eye
behind the rear aperture and focusing on the front post. It does **not** prescribe
one numerical eye-to-aperture distance, so the candidate distances above are
exploratory monitor-framing values, not asserted military specifications.

The existing [M4 asset](../assets/weapons/m4a1-block-ii/README.md) remains the
geometry authority. Unlike the earlier geometry variants, this comparison leaves
the 2.2 mm bore, 2.60 mm metal front post and neon tip untouched. The neon treatment
and separate weapon/world cameras remain existing readability compromises.
The issue's [iron-sight photographs](https://www.thearmorylife.com/how-to-use-iron-sights/)
illustrate focus relationships, not numerical framing targets.

F is now the selected M4 picture. The roster pass tunes other weapons independently;
pistols, collimated dots and fullscreen scope overlays have different constraints.
Moving-combat review remains necessary. Keep housing softness and peripheral-world
blur as separate later experiments.

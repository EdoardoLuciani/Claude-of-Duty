# Grip / wrist visual review

Follow-up to the Blender arm remake. **The accepted Blender mesh, textures and
runtime GLB are unchanged.** This pass changes the contact poses and arm solve.
All seven current weapons, including the integrated MCX, were reviewed.

## Before / after

Each comparison has before on the left, after on the right:

1. Cropped **real in-game** first-person view.
2. Close left-side diagnostic view.
3. Close right-side diagnostic view.

Diagnostic views bake the actual live skinned vertices and weapon-part transforms
into a neutral scene. Blue is the support arm, tan the firing arm. Only materials,
lighting and camera differ; this is not an alternative posing/modeling path.
`*-three-views.jpg` adds an underside view of the finished hold.

- [M4A1](rifle-comparison.jpg)
- [SMG](smg-comparison.jpg)
- [Pistol](pistol-comparison.jpg)
- [LMG](lmg-comparison.jpg)
- [Shotgun](shotgun-comparison.jpg)
- [Sniper](sniper-comparison.jpg)
- [MCX](mcx-comparison.jpg)

The comparison baseline is commit `44f2fe9`: the original arm PR combined with
current develop's seven-weapon roster, before this grip correction. Before and
after use the same capture harness/camera/lighting. The pistol's hip position
intentionally moves forward 40 mm to improve its two-hand presentation.

## Findings and corrections

- The firing palm pointed down from an already raised forearm, folding wrists
  backwards. Repositioned the wrist below the knuckles, then fitted finger spread,
  curls and thumb opposition separately to the weapon.
- A fixed downward elbow pole and independently chosen upper/forearm rolls
  introduced severe wrist bends and twisted the continuous sleeve at the elbow.
  The solve now balances wrist alignment with camera-space elbow clearance and
  transports the forearm roll through the elbow. Search storage is preallocated;
  interpolation between samples avoids stepped elbow motion.
- M4/LMG/shotgun/sniper/MCX support holds were retargeted toward a forward palm
  direction. Sniper/MCX holds moved rearward enough to avoid forearm extension.
- The SMG had no contact profile for its vertical foregrip. It now has one instead
  of using an unfitted generic clamp.
- The pistol support hand now sits lower/forward against the firing fingers,
  rather than beside the firing palm. Thumbs are seated on the frame, not posed
  as free-standing spurs.
- Thumb and trigger contacts are fitted per weapon and cached under weapon-specific
  pose names. Index spread eases with curls and resets for utility poses. Reload
  return keys restore the fitted hold instead of a generic pose.
- ADS optic distances, weapon meshes, gameplay timings and event contracts remain
  unchanged. Existing rifle/LMG surface-contact assertions are retained; their
  thumb probe now samples the new distal pad instead of the old mid-phalanx point.

## Measured hip-pose wrist alignment

Angle between elbow-to-wrist and the palm's longitudinal axis (degrees), from
`before.json` / `after.json`; lower means a straighter forearm-to-palm transition.
This is a consistent rig diagnostic, not a medical joint-range measurement.

| Weapon | Support before → after | Firing before → after |
|---|---:|---:|
| M4A1 | 64.2 → 38.2 | 116.5 → 34.9 |
| SMG | 44.8 → 29.6 | 119.3 → 29.9 |
| Pistol | 108.7 → 23.5 | 106.6 → 16.2 |
| LMG | 55.6 → 40.3 | 109.4 → 41.4 |
| Shotgun | 43.6 → 38.8 | 130.7 → 30.3 |
| Sniper | 57.1 → 37.5 | 106.3 → 30.6 |
| MCX | 60.2 → 30.6 | 104.8 → 28.9 |

The independent smoke run's maxima are 41.6° at hip, 73.6° in ADS, and 2.57 mm
thumb/trigger pad-centre error. ADS includes the firing wrist behind close optics
and the hidden scope viewmodel; the lower hip figures are not presented as an
all-animation maximum. No settled hold exceeds the forearm-length regression
limit. These contact probes complement, not replace, the image review.

## Animation review and reproduction

`reloadEmpty-55.jpg`, `inspect-55.jpg`, `sprint-50.jpg` and `ads-50.jpg` show all seven weapons
in-game. `actions.json` records **161 captures**: hip, ADS, walk, sprint, crouch,
airborne, landing, firing, tactical/empty reloads, inspection, draw/holster,
grenade holds/throws and radio. Reloads/inspections have three sampled beats.
Additional close reload views were checked separately. The capture harness pauses
gameplay while sampling the actual viewmodel clips; ordinary smoke tests retain
coverage of reload/release events and gameplay behavior.

```bash
node tools/review-grips.mjs --out=/tmp/grips
node tools/review-grips.mjs --weapon=pistol --action=reloadEmpty --t=1.2 --out=/tmp/pistol-reload
node tools/capture-arms.mjs --port=5193 --out=/tmp/arm-actions
node tools/smoke-grips.mjs
npm test
npm run lint
npm run build
```

The new smoke test loads real arm skins and all seven weapons, checks contact
centres, wrist/forearm bounds, elbow roll continuity, animated skin transforms,
return grips and utility-pose reset. It does not claim exhaustive mesh-collision
proof between every pair of surfaces at every possible animation time.

# Sleeve fabric and thumb-web polish

Follow-up to the accepted grips at `e3b8a42`.

- [MCX before/after](mcx-comparison.jpg)
- [M4 before/after](rifle-comparison.jpg)
- [Sniper before/after](sniper-comparison.jpg)

Left = the AFTER column of the previous committed comparison; right = fresh
captures using the same harness and camera. Top row is cropped in-game rendering;
lower rows are actual deformed skin in neutral diagnostic materials. Those neutral
materials deliberately do not show the sleeve texture.

## Changes

**Sleeve:** dedicated ripstop albedo/roughness/normal maps, with a roughly 7 mm
reinforcement grid, sub-mm yarn and restrained tonal variation. Cylindrical
microdetail UVs align the grain along the sleeve at a consistent physical scale.
The old fine, low-contrast texture largely vanished under filtering; increasing
only the normal strength would not have made the fabric readable at game scale.

**Thumb:** the apparent separation was aggravated by linear skinning pinching
the web during thumb opposition. A single `thumb_web` half-angle control now
preserves volume between the palm and thumb. Its weights and pose animation are
authored in Blender and mirrored by the runtime rig. The M4, sniper and MCX also
use a forward thumb bend plane and 3 mm lower contact centres, instead of pulling
the knuckle sideways away from the palm. Other weapon contact targets, hand
proportions, wrist positions and gameplay animation timelines are unchanged.

The Blender source and runtime GLB were regenerated together. There are now 28
controls per arm (nine hinge flex controls plus the thumb-web control), still
five material submissions and 12 pose actions. Exported vertices: 46,710 including
UV/material splits; below the existing 50,000 limit. No new runtime dependency or
per-frame allocation was added.

## Checks

- Visually inspected MCX/M4/sniper holds, the pistol, and seven-weapon inspection,
  reload and radio sheets; refreshed hip/ADS diagnostics and 161 action captures.
- `npm test`: all 21 pass, including unchanged handguard contact limits.
- New assertions require the distinct ripstop normal image, actual glove vertices
  weighted to `thumb_web`, and correct half-angle rotation during all pose blends.
- `npm run lint`, `npm run build`, `node tools/capture.mjs`, `git diff --check` pass.
- Grip maxima remain 41.6° hip / 73.6° ADS / 2.57 mm pad-centre error.

`actions.json` lists the captured states; `measurements.json` contains the current
hip/ADS diagnostics. `inspect-55.jpg`, `reloadEmpty-55.jpg`, `ads-50.jpg` and
`radio-50.jpg` are in-game sheets. As before, sampled captures and contact probes
are not exhaustive collision or art-quality certification.

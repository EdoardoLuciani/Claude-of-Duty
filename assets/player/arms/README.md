# Blender player arms

Charcoal gloves and olive ripstop sleeves for all seven weapons. Blender owns the
skin, textures and 12 finger-pose actions; gameplay owns weapon trajectories,
contact fitting, IK and event timing.

## Required files

- `player-arms.blend`: editable meshes, rig, actions and packed textures.
- `pose-reference.json`: reproducible pose-authoring input.
- `manifest.json`: generated asset/source fingerprints checked by smoke tests.
- `public/models/player/arms.glb` (repository root): runtime skin and embedded PBR maps.
- `src/weapons/hand-poses.js` (repository root): generated pose values/easing.
- `public/models/player/bandage.glb` and `src/weapons/bandage-path.js`:
  separate Blender-authored dressing, sampled hand guide, closed/loose roll
  grips and a dedicated support fist. The bandage is editable alongside the
  glove/sleeve in `player-arms.blend`, not baked into either arm's skin.
  Raise the bent left arm and present the roll (0–20%), then hold the left
  wrist, elbow and orientation **fixed**, with the forearm horizontal. The
  right wrist and gripped roll make **three complete 360° turns** around that
  axis (20–82%), including the far side. The hand guide and paid cloth share
  the same helix clock: no near-side substitute, hidden payout, or left-arm
  counter-rotation. The **right elbow, shoulder and upper-arm orientation
  also remain fixed**: only its forearm and hand rotate. Settle at the end
  (82–90%), then lower both arms. The 44 mm strip advances **20 mm per turn**
  from the cuff along the forearm (60 mm total travel, 24 mm overlap per turn).
  The actual mesh covers roughly 104 mm, rather than piling up in one ring.
  The support fist stays tucked clear of the sweep. Gameplay still controls
  healing time and cancellation; no wound is added.

  Bandaging uses a weapon-independent camera-space rig without idle sway.
  An authored fixed elbow bypasses the normal two-bone IK search; weapon grips
  still use their usual down/out constraints. Blender solves the advancing roll
  from the fixed pivot, rigid 30 cm forearm and palm offset. The **right hand
  continues the forearm** instead of folding sideways at the wrist; its orbit
  radius changes as the dressing advances. Runtime interpolation and finishing
  stay on that reach sphere without elbow movement or arm stretching.

  The guide also authors unequal lap durations, continuous tension slowdowns,
  modest pronation and a grip-pressure channel. Fingers soften for feeding and
  tighten for pulling, with slightly different pressure per finger; the finish
  eases into a small tension-settle instead of snapping. These are deterministic
  gestures, not random jitter or motion added to either fixed elbow.

  Checks cover full turns for **both wrist and roll**, cloth travel and overlap,
  wrist alignment, pressure variation, a stationary horizontal support arm,
  fixed right elbow/upper arm, both bone lengths, and cancellation mid-orbit.

The runtime has five material submissions and 28 controls per arm, including
half-angle hinge and thumb-web controls. It loads the committed GLB without
Blender. Standalone PNGs duplicate the packed/embedded maps and are not committed;
review images, videos and capture reports are generated locally as needed.

## Rebuild and check

```bash
blender -b --python-exit-code 1 --python tools/blender/player_arms.py
blender -b --python-exit-code 1 --python tools/blender/player_bandage.py
node tools/smoke-arms.mjs
node tools/smoke-bandage.mjs
node tools/check-bandage-intersections.mjs --dense --out=/tmp/bandage-intersections.json
node tools/smoke-grips.mjs
node tools/capture-arms.mjs --out=/tmp/player-arms
node tools/review-grips.mjs --out=/tmp/grips
npm test
npm run build
```

`--render` additionally generates a Blender overview. The local distro Blender's
OCIO configuration/library mismatch may require a compatible `OCIO` configuration;
a correctly packaged Blender needs no override. Captures exercise actual game
skins; they are not exhaustive collision or art-quality certification. Run
`node tools/check-bandage-game.mjs --out=/tmp/bandage --video` for a 60 fps
in-game sequence (omit `--video` for a quicker 20 fps check);
`ffmpeg -framerate 60 -i /tmp/bandage/frame-%03d.png -c:v libx264 -pix_fmt yuv420p /tmp/bandage.mp4`
encodes it as a review video. The intersection check CPU-deforms both GLB arms
and tests their triangles at every active frame (not a screen-space wrist
proxy); it exits nonzero on penetration and writes material pairs/locations to
JSON. Rebuild the bandage *after* the arms generator:
that generator replaces the saved Blender scene with its baseline arm skin.

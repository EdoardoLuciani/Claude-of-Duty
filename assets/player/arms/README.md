# Player arms and bandage

Charcoal gloves/olive sleeves for seven weapons. Blender owns skin/maps and
12 finger poses; gameplay owns trajectories, fitting, IK, healing and events.
Five editable authored surfaces, consolidated at load to one physical-material
submission per independently controlled arm; 28 controls per arm, including
hinge/thumb-web. UV0 retains baked AO and UV1 retains tiled microdetail; immutable
surface IDs select texture-array layers and restrict injury blood to sleeve/stitch.
Each hand owns its mirrored/bound geometry and skeleton.

The authored budget is 44,788 triangles per arm (previously 75,708). Glove
collapse ratio is 0.40 instead of 0.48; sewn panels use two bevel segments and
one conforming subdivision instead of three/two. Finger/thumb lofts, sleeve,
seams, bone controls, weighting function and pose references are unchanged.
Authoring rejects glove rest-surface deviation above 0.5 mm against the previous
budget. `manifest.json` records that measured deviation and exported triangle count.

Maintained: `player-arms.blend` (packed source), `pose-reference.json`,
`manifest.json`, `public/models/player/arms.glb`, generated `hand-poses.ts`.
Bandage is a separate GLB and generated `bandage-path.ts`, editable in the
same blend. Normal builds need no Blender; duplicate maps/captures aren't assets.

## Bandage contract

Raise/present 0–20%; right wrist and roll make three full turns at 20–82%;
settle 82–90%, then lower. Left wrist/elbow/orientation and right elbow/shoulder
stay fixed. No counter-rotation/hidden payout: 44 mm strip, 20 mm advance/turn,
60 mm travel, 24 mm overlap. Keep support-hand clearance and 30 cm forearm reach.
Camera-space guide/cloth share a helix clock, tension/pronation/pressure channels;
no idle sway or stretching. Gameplay retains cancellation, not an added wound.

## Rebuild/check from repository root

```sh
blender -b --python-exit-code 1 --python tools/blender/player_arms.py
blender -b --python-exit-code 1 --python tools/blender/player_bandage.py
node tests/smoke/smoke-arms.mjs
node tests/smoke/smoke-bandage.mjs
node tests/smoke/smoke-grips.mjs
node tests/e2e/check-bandage-intersections.mjs --dense --out=/tmp/bandage.json
node tests/e2e/check-bandage-game.mjs --out=/tmp/bandage --video
node tests/e2e/check-arm-surfaces.mjs
```

Rebuild bandage after arms: the arms generator replaces the scene.
Intersection checks deform actual triangles, not wrist proxies; keep full orbits,
cloth travel, fixed joints/alignment and cancellation gates. Sampled checks
don't certify exhaustive collision/art quality or replace in-engine
hip/ADS/reload/bandage review.

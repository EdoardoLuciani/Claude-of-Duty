# Player arms and bandage

Charcoal gloves/olive ripstop sleeves for seven weapons. Blender owns skin/maps
and 12 finger poses; gameplay owns trajectories, fitting, IK and events.
Runtime: five material submissions, 28 controls per arm (including hinge/thumb-web).

Maintained: `player-arms.blend` (packed source), `pose-reference.json`,
`manifest.json` (fingerprints), root `public/models/player/arms.glb` and generated
`src/weapons/hand-poses.js`. Bandage is separate `public/models/player/bandage.glb`
plus `src/weapons/bandage-path.js`, editable in the same blend—not baked into arms.
Normal builds need no Blender; duplicate PNGs/review captures are not committed.

## Bandage contract

Raise/present 0–20%; hold left wrist/elbow/orientation horizontal and fixed.
Right wrist **and roll** make three full turns, including far side, at 20–82%;
right elbow/shoulder/upper-arm orientation also stay fixed. Settle 82–90%, then lower.
No left counter-rotation or hidden payout. A 44 mm strip advances 20 mm/turn
(60 mm total, 24 mm overlap, ~104 mm mesh coverage); support fist clears the sweep.

Weapon-independent camera-space rig, no idle sway. Fixed-elbow guide respects
30 cm forearm and palm offset; hand continues the forearm, without stretching.
Guide/cloth share a helix clock, unequal lap durations, tension, pronation and
finger-pressure channels. Gameplay retains healing/cancellation; no wound added.

## Rebuild/check (repository root)

```sh
blender -b --python-exit-code 1 --python tools/blender/player_arms.py
blender -b --python-exit-code 1 --python tools/blender/player_bandage.py
node tests/smoke/smoke-arms.mjs
node tests/smoke/smoke-bandage.mjs
node tests/e2e/check-bandage-intersections.mjs --dense --out=/tmp/bandage-intersections.json
node tests/smoke/smoke-grips.mjs
node tools/capture-arms.mjs --out=/tmp/player-arms
node tools/review-grips.mjs --out=/tmp/grips
node tests/e2e/check-bandage-game.mjs --out=/tmp/bandage --video
npm test
npm run build
```

Rebuild bandage **after** arms: the arms generator replaces the saved scene.
`--render` adds an overview; distro OCIO/library mismatches may require a complete
compatible `OCIO` configuration. Game video uses 60 fps (`--video` omitted: 20 fps);
encode with `ffmpeg -framerate 60 -i /tmp/bandage/frame-%03d.png -c:v libx264 -pix_fmt yuv420p /tmp/bandage.mp4`.

Checks cover both full orbits, cloth travel, pressure/alignment, fixed joints,
bone lengths and cancellation. Intersection tooling deforms actual arm triangles
every active frame and fails on penetration, not wrist proxies. These checks are
not exhaustive art/collision certification.

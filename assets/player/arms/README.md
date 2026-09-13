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

The runtime has five material submissions and 28 controls per arm, including
half-angle hinge and thumb-web controls. It loads the committed GLB without
Blender. Standalone PNGs duplicate the packed/embedded maps and are not committed;
review images, videos and capture reports are generated locally as needed.

## Rebuild and check

```bash
blender -b --python-exit-code 1 --python tools/blender/player_arms.py
node tools/smoke-arms.mjs
node tools/smoke-grips.mjs
node tools/capture-arms.mjs --out=/tmp/player-arms
node tools/review-grips.mjs --out=/tmp/grips
npm test
npm run build
```

`--render` additionally generates a Blender overview. The local distro Blender's
OCIO configuration/library mismatch may require a compatible `OCIO` configuration;
a correctly packaged Blender needs no override. Captures exercise actual game
skins; they are not exhaustive collision or art-quality certification.

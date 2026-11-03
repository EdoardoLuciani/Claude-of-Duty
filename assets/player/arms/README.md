# Player arms and bandage

Blender owns charcoal gloves, olive sleeves, maps and twelve finger poses.
Gameplay owns trajectories, IK, healing and events. Each arm owns its mirrored
geometry and skeleton; immutable surface IDs select detail/injury layers.
UV0 retains baked AO and UV1 microdetail. Preserve 28 controls per arm.

Rebuild from the repository root, arms before bandage (arms replace the scene):

```sh
blender -b --python-exit-code 1 --python tools/blender/player_arms.py
blender -b --python-exit-code 1 --python tools/blender/player_bandage.py
node tests/smoke/smoke-bandage.mjs
```

The blend, manifest, pose references, runtime GLBs and generated hand-pose/bandage
paths are the maintained products. Bandaging makes three turns at 20–82%:
44 mm strip, 20 mm advance/turn, 60 mm travel and 24 mm overlap. Keep fixed support
joints, shared helix timing, clearance and gameplay cancellation.
Normal builds need no Blender. In-engine appearance still requires human review.

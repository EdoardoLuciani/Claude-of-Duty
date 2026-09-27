# P320 Compact

The starting `pistol`: early-production Nitron Compact, curved trigger, SIGLITE
irons and a flush 15-round magazine. Original game art; no downloaded meshes or
textures. Not endorsed by SIG SAUER and not manufacturing geometry.

## Maintained assets

- `p320-compact.blend`: editable weapon, preview arms, rig and packed PBR atlas.
- `p320-compact.glb`: runtime weapon, sockets and eight authored actions.
- `manifest.json`: export counts, clip durations and event timings.
- `hand-reference.json`: hand contact/pose input, also consumed by the adapter.
- `textures/`: atlas inputs for animation-only rebuilds (`--no-bake`).

`src/weapons/p320.js` samples weapon/wrist/finger curves. Shared runtime arms
supply the skin and shoulder/elbow IK. The two Blender preview armatures must
remain synchronized with the control curves; the source checker verifies wrists.
Reloads keep the right thumb in its idle grip. Magazine visibility uses STEP keys.
Gameplay owns ammunition, healing and interruption—not the Blender animation.
Normal builds bundle the committed GLB without Blender.

## Rebuild and check

From the repository root, with Blender 5.2 and Node dependencies installed:

```sh
node tools/p320-hand-reference.mjs
blender -b --python-exit-code 1 --python tools/blender/p320_compact.py
blender -b assets/weapons/p320-compact/p320-compact.blend \
  --python-exit-code 1 --python tools/blender/p320_check.py
node tests/smoke/smoke-p320.mjs
node tests/smoke/smoke-inspect.mjs
node tests/e2e/check-p320-game.mjs --out=/tmp/p320-review --frames=120
```

Regeneration overwrites manual source edits. Use `--no-bake` only when geometry
and UVs are unchanged. Optional studio stills: add `--render` to the generator.
`tools/blender/p320_review.py` renders saved-source poses/reels (reels need FFmpeg).
Review images, videos and reports are disposable, ignored outputs, not assets.

Historical visual references and performance measurements remain in
[PR #315](https://github.com/EdoardoLuciani/Claude-of-Duty/pull/315). Its lower
weapon GPU cost did **not** establish acceptable full-frame tail latency or final
human visual acceptance. A static review run is not a combat-performance gate.

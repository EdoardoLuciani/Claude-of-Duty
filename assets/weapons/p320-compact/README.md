# P320 Compact

Starting pistol: early Nitron Compact, curved trigger, SIGLITE irons, flush
15-round magazine. Original art, no downloaded meshes/maps, SIG endorsement or CAD.

Maintained: `p320-compact.blend` (weapon/preview arms/rig/packed atlas), `.glb`
(runtime/sockets/eight actions), `manifest.json` (events/counts),
`hand-reference.json` (contacts), `textures/` (inputs for animation-only rebuilds).
`src/weapons/p320.js` samples native weapon/wrist/finger tracks; shared skins/IK
and gameplay ammo/healing/interruption remain authoritative. Keep both preview
armatures synchronized, reload right-thumb grip and STEP magazine visibility.

## Rebuild/check (root, Blender 5.2 and Node dependencies)

```sh
node tools/p320-hand-reference.mjs
blender -b --python-exit-code 1 --python tools/blender/p320_compact.py
blender -b assets/weapons/p320-compact/p320-compact.blend \
  --python-exit-code 1 --python tools/blender/p320_check.py
node tests/smoke/smoke-p320.mjs
node tests/smoke/smoke-inspect.mjs
node tests/e2e/check-p320-game.mjs --out=/tmp/p320-review --frames=120
```

Normal builds use committed GLB, no Blender. Regeneration overwrites manual source
edits; `--no-bake` is safe only if geometry/UVs are unchanged. `--render` adds stills;
`p320_review.py` reviews source/reels (FFmpeg for reels). Eevee raster previews
override older Cycles scenes, with ray tracing off and a working graphics context.
**Cycles remains for atlas baking**. Match before/after backend/settings; outputs
are ignored, not assets.

[PR #315](https://github.com/EdoardoLuciani/Claude-of-Duty/pull/315) holds historical
references/performance: reduced weapon GPU cost did not establish acceptable
full-frame tails or human visual acceptance. Static review is not a combat gate.

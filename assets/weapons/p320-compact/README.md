# P320 Compact

Early Nitron Compact, curved trigger, SIGLITE irons, flush 15-round magazine.
Original game art, not downloaded CAD/mesh/maps or an endorsed/licensed replica.

`p320-compact.blend/.glb`: packed source/runtime and eight native actions.
`manifest.json` owns events/counts; `hand-reference.json` contacts; `textures/`
supports animation-only rebuilds. `src/weapons/p320.ts` samples native weapon/
wrist/finger tracks; shared skins/IK and ammo/healing/interruption stay authoritative.
Keep synchronized preview armatures, reload right-thumb grip and STEP magazines.

## Rebuild/check (root, Blender 5.2)

```sh
node tools/p320-hand-reference.mjs
blender -b --python-exit-code 1 --python tools/blender/p320_compact.py
blender -b assets/weapons/p320-compact/p320-compact.blend \
  --python-exit-code 1 --python tools/blender/p320_check.py
node tests/smoke/smoke-p320.mjs
node tests/smoke/smoke-inspect.mjs
node tests/e2e/check-p320-game.mjs --out=/tmp/p320-review
```

Normal builds need no Blender. Regeneration overwrites manual edits; `--no-bake`
requires unchanged geometry/UVs. Cycles remains for atlas baking; saved-source
`p320_review.py` and `--render` previews use Eevee without ray tracing.
Historical references/evidence: [#315](https://github.com/EdoardoLuciani/Claude-of-Duty/pull/315).
Technical gates aren't human visual or combat-performance acceptance.

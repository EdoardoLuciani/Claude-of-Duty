# Early Accuracy International AX338

Early solid-carrier AX338, .338 LM/27-inch barrel, Dark Earth panels, ten-round
magazine and older PM II LP 5–25×56. Original art; human sign-off is pending.

[Shared workflow](../../../tools/blender/README.md)

Sources are `tools/blender/ax338/build.py`, `actions.py`, `export.py` and
`finishes.py`. Grip/photo-review JSON, hand calibration and shared review arms
are read-only inputs; never refit during ordinary rebuilds.
Ordinary meshes retain nine clips, independent magazines and coated lenses.
Preserve 60°/100 mm bolt motion, the 1.1 s cycle, 2.8/3.6 s reloads, events,
STEP visibility and spent-ammo persistence. Runtime sampling normalizes rotations.
The registered cook uses 16-bit colors/positions without added simplification.

Run from the repository root with Blender 5.2.2 and gltfpack 1.3:

```sh
blender -b -t 2 --python-exit-code 1 --python tools/blender/ax338/build.py
blender -b -t 2 assets/weapons/ax338/ax338.blend --python-exit-code 1 \
  --python tools/blender/ax338/check.py
npm run models:cook -- ax338
node tests/smoke/smoke-ax338.mjs
node tests/smoke/smoke-sniper-reticle.mjs
```

Use `--output /tmp/ax338-review` for scratch builds.
The P4FL-inspired reticle is a gameplay adaptation: 5 mrad major ticks,
2.5 mrad minor ticks and 25 mrad heavy posts, not ballistic compensation.
Edit `src/weapons/sniper-reticle.ts`; no asset rebuild is needed.

**Full right-hand DCC acceptance still fails.** The frozen authoring baseline
measured 252 violations / 474 poses, maximum 7.041641 mm against a 1 mm allowance;
the matching left sweep passed at 0.903077 mm. Run `contact.py -- --side right`
against the blend to inspect it. Passing source/runtime tests does not waive this
failure. Sampled contact checks do not certify continuous clearance or factory
fidelity. Detailed representation comparisons and historical exceptions remain
in Git history; they are not permission to relax tolerances or claim FPS gains.

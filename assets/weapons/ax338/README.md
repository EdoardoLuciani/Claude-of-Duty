# Early Accuracy International AX338

Early solid-carrier AX338, .338 LM/27-inch barrel, Dark Earth panels, ten-round
magazine, factory brake and removable rail-mounted aperture/post irons. No
optional attachment is installed by default. Original art; human sign-off is pending.

[Shared workflow](../../../tools/blender/README.md)

Sources are `tools/blender/ax338/build.py`, `actions.py`, `export.py` and
`finishes.py`. Grip/photo-review JSON, hand calibration and shared review arms
are read-only inputs; never refit during ordinary rebuilds.
Ordinary meshes retain nine clips, independent magazines and `IRON_sights`.
Preserve 60°/100 mm bolt motion, the 1.1 s cycle, 2.8/3.6 s reloads, events,
STEP visibility and spent-ammo persistence. Runtime sampling normalizes rotations.
The #665 raw-GLB comparison preserved all 1215 named clip/node/TRS channels' input
and output bytes and interpolation across all nine clips. The registered cook
uses 16-bit colors/positions without added simplification.

Run from the repository root with Blender 5.2.2 and gltfpack 1.3:

```sh
blender -b -t 2 --python-exit-code 1 --python tools/blender/ax338/build.py
blender -b -t 2 assets/weapons/ax338/ax338.blend --python-exit-code 1 \
  --python tools/blender/ax338/check.py
bun run models:cook -- ax338
```

Use `--output /tmp/ax338-review` for scratch builds.
The shared [PM II](../../attachments/schmidt-bender-pm-ii/README.md) now has its
own canonical source in `tools/blender/scope/build.py`; the rifle neither builds
nor exports scope geometry, glass or a reticle. Build all three standalone optics
before running the attachment checks (normal `bun run build` does this).

## Sights and attachment datums

All positions below are game-frame metres, +Y up / −Z forward, under `AX338_RIG`:

| Datum | Position | Contract |
| --- | --- | --- |
| `SOCKET_sight` | `[0, .151, .055]` | Rear aperture centre; front post tip `[0, .151, −.540]`, 595 mm sight radius |
| `MOUNT_optic` | `[0, .118, −.089]` | Identity orientation; actual top-rail tooth contact plane |
| `MOUNT_muzzle` | `[0, .075, −.7958]` | Future barrel-crown contact; factory brake remains the base part |
| `MOUNT_rail` | `[.038, .075, −.455]` | Right-side KeySlot/Picatinny adapter; local +Y points inward (−X), −Z stays forward |

Irons are one removable `IRON_sights` assembly; no replacement part is needed.
RMR and ACOG clear installed irons. PM II crosses the rear aperture (301 actual
triangle contacts in the reference check), so `opticClashes: ['scope']` requires
removing them. Removing both optic and irons is valid and retains the base sight
datum with no reticle. Base ADS uses the common unscoped FOV/sensitivity; mounted
optics own magnification. Per-optic eye relief is RMR 125 mm / ACOG 110 mm / PM II
90 mm; base irons use 70 mm.

`check.py` loads each standalone editable optic and checks foot seating, measured
iron clashes, the aperture opening and post alignment. It sweeps all nine clips:
1545 bolt poses at 120 Hz and 320 actual deformed-hand/sleeve poses at 24 Hz plus
clip endpoints, with all three optics and the irons. A separate 181-pose sweep
rotates the stock around its physical left hinge through 180°; this is a geometric
clearance check, not an authored gameplay fold action. These sampled checks do
not certify continuous clearance or factory fidelity.

TOR Mini (#686) seats on the authored short right-side adapter ahead of the
support hand. Its shared checker sweeps all clips at 120 Hz plus the separate
181-position stock fold, including actual hands, bolt and all three optics.
See the [shared laser contract](../../attachments/steiner-tor-mini/README.md#weapon-mounting-686).
The future suppressor datum is not proof of a nonexistent muzzle asset's fit.

**Full right-hand DCC acceptance still fails.** The frozen authoring baseline
measured 252 violations / 474 poses, maximum 7.041641 mm against a 1 mm allowance;
the matching left sweep passed at 0.903077 mm. Run `contact.py -- --side right`
against the blend to inspect it. Passing source/runtime tests does not waive this
failure. Sampled contact checks do not certify continuous clearance or factory
fidelity. Detailed representation comparisons and historical exceptions remain
in Git history; they are not permission to relax tolerances or claim FPS gains.

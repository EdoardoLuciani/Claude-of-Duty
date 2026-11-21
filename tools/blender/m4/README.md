# M4A1 Block II

Starting rifle: 14.5-inch SOCOM barrel, RIS II FSP, MaTech rear aperture,
FH556RC, SOPMOD stock and USGI magazine. Original art, not a certified replica.

[Shared workflow](../README.md)

Python owns geometry, finishes and actions; blend, GLBs, maps and manifest are
generated. Ordinary static/mechanical meshes retain eight native clips,
independent magazines/rounds and exact iron surfaces. One physical material reads
linear vertex tint and UV finish data; keep the four original 1024² maps.
The 2.2 mm rear bore, 2.60 mm post and green tip are authored geometry.
`IRON_sights` retains the original front/rear assemblies; `IRON_sights_removed` supplies
the replacement collar and bored gas-tube seat when irons are independently removed.
See the [attachment contract](../../../ARCHITECTURE.md#models) for supported combinations.
Runtime ADS uses 30 mm eye relief and 42° weapon FOV, a readability trade-off,
not changed ballistics. Hand calibration and review-arm inputs are read-only.

Run from the repository root with Blender 5.2.2 and gltfpack 1.3:

```sh
blender -b --threads 2 --python-exit-code 1 --python tools/blender/m4/build.py -- --quick
blender -b .cache/blender/weapons/m4a1-block-ii/m4a1-block-ii.blend \
  --python-exit-code 1 --python tools/blender/m4/check.py
bun build/models.ts m4
```

Use `--output /tmp/m4-review` for scratch builds. Refit hands only intentionally.
Preserve events, STEP visibility, iron rays, lockback, contacts and resource
ownership. Representation/storage measurements and bounded normal-rounding
acceptance remain in Git history; they are not general visual or FPS approval.

## Side-profile references

- [Colt Block II FSP parts photograph](https://www.reddit.com/r/GunPorn/comments/eqzf90/m4a1_block_ii_fsp/):
  register its nearly side-on lower on the takedown pins for the GI opening,
  straight guard bar and trigger curve. Its assembled companion is oblique.
- [Daniel Defense SOCOM M4A1 FSP](https://danieldefense.com/socom-m4a1-fsp.html):
  whole-rifle barrel, rail, front-sight and receiver silhouette. Its furniture
  and enhanced guard differ.
- [Colt M4 catalog, page 26](https://www.colt.com/wp-content/uploads/2024/09/24-COLT-2263-COLLATERAL-MLE_Catalog-web-FINAL.pdf#page=26):
  lower forging taper, A2 grip heel and seated USGI magazine.

## Source map

- `build.py`: stages/paths; `geometry.py`: assemblies, sockets and atlas.
- `materials.py`: seeded maps/checkering; `finishes.py`: export finish factors.
- `actions.py`: eight actions/hands/events; `animations.py`: sampling/resets.
- `export.py`: ordinary joins/native Actions; `studio.py`: fixed review setup.

Hand calibration and shared review arms are read-only; refit separately with
`bun tools/blender/m4/hand-reference.ts`. Save the editable four-map preview
before export preparation. Preserve the smart-project/checkering atlas, not MCX UVs.
Motion uses the 120 Hz lattice with LINEAR motion and CONSTANT/STEP visibility;
Draw holds frame 75 at its exact 74.4-frame/.620 s endpoint. Keep explicit TRS
resets, matching NLA names and forced sampling off; never rewrite output.

Ordinary meshes retain original controls, precision iron surfaces and independent
magazines/rounds. Cache invertible rest seats before hiding spare geometry.
The single material reads COLOR_0 tint, UV1 roughness/metalness and UV2 normal
strength/role; all four 1024² maps stay on UV0. The receiver albedo uses the
standard emissive slot, so the M4 adapter is required. Preserve paint emission.
The registered cook adds `-noq -vc 16 -kv`; do not simplify precision irons.
Historical measurements remain in Git; human appearance acceptance is separate.

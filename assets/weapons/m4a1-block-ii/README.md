# M4A1 Block II

Starting rifle: 14.5-inch SOCOM barrel, RIS II FSP, MaTech rear aperture,
FH556RC, SOPMOD stock and USGI magazine. Original art, not a certified replica.

[Source map](../../../tools/blender/m4/README.md) ·
[Shared workflow](../../../tools/blender/README.md)

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
blender -b assets/weapons/m4a1-block-ii/m4a1-block-ii.blend \
  --python-exit-code 1 --python tools/blender/m4/check.py
bun run models:cook -- m4
```

Use `--output /tmp/m4-review` for scratch builds. Refit hands only intentionally.
Preserve events, STEP visibility, iron rays, lockback, contacts and resource
ownership. Representation/storage measurements and bounded normal-rounding
acceptance remain in Git history; they are not general visual or FPS approval.

## Side-profile reference

The GI guard has a straight lower bar with upturned ends. Rounded receiver
shoulders narrow the opening toward the ends, and the curved trigger reaches
toward the bar. The guard ears and A2 grip locate the ends of the opening.
The [Colt Block II FSP owner's parts photograph](https://www.reddit.com/r/GunPorn/comments/eqzf90/m4a1_block_ii_fsp/)
shows this lower nearly side-on and identifies the SOCOM barrel, RIS II FSP and
GI guard. Register its takedown pins with one uniform scale and a small in-plane
rotation; its assembled companion photograph is oblique and is not a dimension gauge.

[Daniel Defense's SOCOM M4A1 FSP side photographs](https://danieldefense.com/socom-m4a1-fsp.html)
provide a whole-rifle cross-check of the barrel/rail/receiver silhouette. The
front-sight pocket sits forward on the rail and follows the sight tower profile.
The photo shows Daniel Defense furniture and an enhanced curved guard. The Colt
photo guides the GI opening and trigger shape. The game uses a SOPMOD stock with
a fixed extension and separately calibrated hand contacts.

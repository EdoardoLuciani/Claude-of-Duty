# Aimpoint Micro T-2

Original Blender-authored game art for the Supply Market red-dot slot. The optic
uses the low standard Picatinny saddle, an open circular bore with recessed
lenses, and fixed open dust covers (opaque front, clear rear). The P320 has no
optic fit.

```sh
blender -b --python-exit-code 1 --python tools/blender/micro_t2/build.py
bun build/models.ts micro_t2
```

Dev/build run the recipe automatically. The editable blend has separate
components and packed procedural micro-grain; the native GLB exports a rigid
assembly, batched by finish. `MOUNT_base` is the rail contact datum and
`SOCKET_sight` is the rear optical axis datum, following the
[shared attachment contract](../../../ARCHITECTURE.md#models).

## Reference review

- [Aimpoint #200170](https://www.aimpoint.com/products/micro-t-2-2-moa-red-dot-reflex-sight-with-standard-mount-for-weaver-picatinny/):
  left/right profiles for tube proportions, covers, controls and markings;
  three-quarter photos for the objective coating, rear clear cap and raised
  elevation guard.
- [Aimpoint mount close-up](https://www.aimpoint.com/products/micro-standard-mount-for-micro-t-2-t-1-and-comp-m5-m5s-sights-fits-picatinny-rail/):
  saddle and clamp asymmetry. Obscured and underside details are inferred; the
  game mesh is not a scan or a mechanical model. Photos are reference only, not
  build inputs or texture sources.

Pass `-- --output /tmp/micro-t2-review --render` to the Blender command to
compare matched-scale left and right profiles and inspect the front, rear, top,
bottom, and three-quarter renders in `renders/`. Use the default output before
running `tools/blender/check_picatinny.py` and the weapon fit checks. Inspect ADS
with `bun tools/capture.ts --weapon=rifle --optic=micro_t2 --shot=ads`.

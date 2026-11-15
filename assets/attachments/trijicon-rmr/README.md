# Shared RMR RM06 / RM33

Original Blender-authored game art; the lens contour is inferred.
`tools/blender/rmr/{geometry,build}.py` own the standalone optic; no generated
weapon is an input.

Build: `blender -b --python-exit-code 1 --python tools/blender/rmr/build.py`, then
`bun run models:cook -- rmr`. Dev/build runs both automatically. Generated GLB/blend
products are ignored.

Coordinates are metres, +Y up, -Z forward after native glTF export.
`MOUNT_base` is the rail contact datum at the origin, with identity orientation.
The assembly includes a see-through riser that clears the M4's fixed front sight.
Mount/sight datums, glass policy and mounted-instance ownership follow the
[shared attachment contract](../../../ARCHITECTURE.md#models).

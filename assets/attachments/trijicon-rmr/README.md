# Shared RMR RM06 / RM33

Original Blender-authored game art extracted from the EVOLYS authoring source.
`tools/blender/rmr/geometry.py` is shared by both builds; no generated weapon is
an input. External dimensions follow the existing EVOLYS reference; the lens
contour is inferred, not certified CAD.

Build: `blender -b --python-exit-code 1 --python tools/blender/rmr/build.py`, then
`bun build/models.ts rmr`. Dev/build runs both automatically. Generated GLB/blend
products are ignored. No new runtime dependency or network asset.

Coordinates are metres, +Y up, -Z forward after native glTF export.
`MOUNT_base` is the rail contact datum at the origin, with identity orientation.
The standalone assembly includes a 23 mm see-through riser to clear the M4's
fixed front sight. `SOCKET_sight` is 42.5072 mm above the rail and 18 mm forward
of the mount centre. EVOLYS reuses the low RM33 source without this riser.
The adapter owns shared physical finishes/geometry. Mounted instances own only
transforms; removing one never disposes resources borrowed by another or inspection.

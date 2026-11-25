# C-MORE Railway

Original Blender-authored game art based on the black polymer RW. The long low
base carries one dished lens in a swept circular rim, with no tube behind it.
Gameplay ADS and the Supply Market use the same model and attachment datums;
the P320 has no optic fit.

```sh
blender -b --python-exit-code 1 --python tools/blender/railway/build.py
bun build/models.ts railway
bun tools/capture.ts --weapon=rifle --optic=railway --shot=ads
```

Dev/build generate the editable blend and runtime GLB. The build measures the
evaluated mesh envelope and lens diameter against the manufacturer's **RW**
specification table. The table does not specify the individual molded parts;
their contours follow the photos. Source meshes and finishes stay separate in
Blender. Export bakes small-part tints into vertex colors and batches them into
polymer and metal primitives, with a separate glass primitive. The runtime cook
simplifies the geometry with locked mesh borders to keep the pane edge intact.
The opaque materials share one seeded micro-grain normal map. `MOUNT_base` is
the rail-contact frame and `SOCKET_sight` is the
lens centre, following the [attachment contract](../../../ARCHITECTURE.md#models).
The EVOLYS fit seats forward to keep the long saddle outside the reload-hand sweep.

## Photo review

- [C-MORE RW](https://cmore.com/Item/RW): black polymer body, stepped controls,
  continuous low mount and side hardware pattern.
- [C-MORE Railway base](https://cmore.com/Item/RW-Base): saddle and clamp edges.
- [C-MORE parts illustration](https://cmore.com/media/CMS-IS-RW-041608.pdf):
  battery-cover wrap, lens support and asymmetric side hardware.
- [Optics Trade angle gallery](https://www.optics-trade.eu/en/c-more-railway-red-dot-sight.html):
  opposing sides and front, rear, lower and elevated angles. Some photos show
  a different clamp configuration; the game model uses the manufacturer's RW
  product photo for the continuous mount.

Pass `-- --output /tmp/railway-review --render` to render all six studio axes
and quarter views. Photo matching uses a perspective registration and uniform
scale, not independent X/Y scaling. Silhouette overlap and edge distances show
where the registrations disagree; they do not measure depth from a photograph.
Lens colour is lighting dependent and partially obscured detail is inferred.
Photos are not used as textures or build inputs.

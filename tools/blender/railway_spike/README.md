# C-MORE Railway silhouette / ADS blockout

Read-only to the game catalog: the review browser temporarily substitutes the
blockout for the RMR asset. No production optics, weapon fits, or renderer
logic are changed. The question is whether a thin round single-window sight
looks clear and meaningfully different from the EXPS3 on the M4.

```sh
blender -b --python-exit-code 1 --python tools/blender/railway_spike/build.py -- --render
bun tools/capture-railway-spike.ts
```

The editable blend, native GLB, studio angles and two native WebGPU captures all
land in `/tmp/railway-blockout` by default. Pass `--output <directory>` to the
Blender script and the same directory as the first argument to the capture tool
for a different output location. The captures lock the pose, exposure and both
FOVs, and verify that the dot stays visible and centered. Weapon-camera distance
is set independently to frame each attachment naturally.

[Manufacturer RW photos](https://cmore.com/Item/RW) anchor the low, long base,
swept lens pedestal, forward tab, and stepped aft housing. The [Optics Trade
gallery](https://www.optics-trade.eu/en/c-more-railway-red-dot-sight.html) provides
opposing sides and front/rear angles. This is game art: surface details not
needed for the silhouette are intentionally simplified. No photos are embedded
as textures or required to rebuild the mesh.

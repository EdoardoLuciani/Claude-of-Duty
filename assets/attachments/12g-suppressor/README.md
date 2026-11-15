# Dedicated 12-gauge expansion suppressor

Authoring authority: `tools/blender/suppressor12g/build.py` (shared `tools/blender/can.py`).
An original stepped expansion shell with a narrow tapered adapter neck, machined end
rings, shallow grooves and side ID; not a scaled SRD762Ti. The clear bore flares to
an open endcap with no painted closing disk or hidden obstruction.

## Frame and fit

Native metres, +Y forward/+Z up in Blender; glTF -Z forward/+Y up, unit scale.
`SOCKET_mount` is the origin/rear seating plane; `SOCKET_muzzle` is the endcap exit.
The M590 mounts it at its existing `MOUNT_muzzle` on the permanent adapter face, via
`WEAPON_DEFS.shotgun.fits.muzzle.suppressor` (can model `suppressor12g`). Both 12g
adapter pieces stay visible, mounted or removed: the M590 leaves
`removableMuzzleDevice` unset.

The broad expansion chamber deliberately **occludes the low iron sightline**; the
front blade, cheeks and ghost ring stay physically unchanged. Use an optic for an
unobstructed aiming view; the game never installs one or adjusts eye relief for the can.

The build's bore gauge (`can.assert_clear`) ray-tests a conservative pellet cone
wider than the runtime spread through the whole can. `tools/blender/m590/muzzle.py`
checks the actual can and TOR Mini meshes against the front sight, magazine cap,
lug, laser clamps, review hands, pump stroke and shell across every clip, plus the
installed exit and intentional iron-line occlusion.

## Rebuild and check

```sh
blender -b -t 2 --python-exit-code 1 --python tools/blender/suppressor12g/build.py
bun run models:cook -- suppressor12g
# After bun run assets (shared optics/laser and M590):
blender -b -t 2 assets/weapons/m590/m590.blend --python-exit-code 1 \
  --python tools/blender/m590/check.py
bun tools/capture.ts --weapon=shotgun --rail=laser --muzzle=suppressor --shot=ads \
  --out=/tmp/m590-can-irons.png
```

`build.py -- --output /absolute/scratch` supports isolated review. Generated
`.blend`/GLBs are ignored products; runtime URL:
`/models/attachments/suppressor12g.runtime.glb`.

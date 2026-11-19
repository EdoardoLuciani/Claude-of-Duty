# AX338 .338-class suppressor

Original exterior authored by `tools/blender/suppressor338/build.py`, not a reused
or scaled SRD762Ti: a graphite ceramic body with a stepped steel rear sleeve, six
wrench lands, shallow seams and a recessed open endcap.

## Frame and fit

Metres, +Y up / -Z forward in glTF, unit scale and identity socket rotations.
`SOCKET_mount` is the rear seating plane; `SOCKET_muzzle` is the endcap exit. The
rear sleeve receives the AX338-owned can adapter, and the build ray-tests a clear
gauge wider than a .338 projectile through the endcap.

AX338's `fits.muzzle.suppressor` names this can model (`suppressor338`); only the
AX338 uses it. Mounting hides the factory brake (`MUZZLE_device`) and shows an open
thread adapter (`MUZZLE_device_removed`) at the crown; the can does not enclose the
old brake. Removal restores the brake.

`tools/blender/ax338/muzzle.py` (also run by AX338's `check.py`) checks the actual
can and adapter against every weapon component, the review glove/sleeve across all
clips, and the mounted RMR, ACOG, PM II and TOR Mini. The only allowed adapter/barrel
contact is their shared crown plane. AX338 has no authored bipod.

## Build and review

```sh
blender -b -t 2 --python-exit-code 1 --python tools/blender/suppressor338/build.py
bun build/models.ts suppressor338
# After bun tools/build-assets.ts (AX338, TOR Mini and standalone optics):
blender -b -t 2 assets/weapons/ax338/ax338.blend --python-exit-code 1 \
  --python tools/blender/ax338/muzzle.py
bun tools/capture.ts --weapon=sniper --optic=scope --rail=laser \
  --muzzle=suppressor --shot=weapon --out=/tmp/ax338-suppressed.png
```

The editable `.blend` keeps the individual parts; GLB export joins the rigid
assembly into material groups without changing the mount or exit sockets.

The builder accepts `-- --output /tmp/suppressor338-review`. Runtime URL:
`/models/attachments/suppressor338.runtime.glb`.

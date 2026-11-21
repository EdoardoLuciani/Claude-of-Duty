# Shared suppressor

Authoring authority: `tools/blender/suppressor/build.py` (shared can helpers in
`tools/blender/can.py`). Cook/asset id: `srd762ti`
(`/models/attachments/srd762ti.runtime.glb`). Build with `bun tools/build-assets.ts`; native
Blender/GLB and cooked runtime products are ignored. Graphite ceramic exterior with
shallow seams, wrench flats and a recessed open endcap.

## Datums and fit

Metres, +Y up, -Z forward in glTF. `SOCKET_mount` is the rear seating plane at the
origin; `SOCKET_muzzle` is the front endcap face. Weapons supply `MOUNT_muzzle` in
this same frame, with unit scale; rotation/translation belongs to the authored
mount, never runtime scale tuning. `MUZZLE_device` holds the removable base device;
optional `MUZZLE_device_removed` holds the adapter shown with the can installed.

The M4, MCX, MPX and EVOLYS mount this can. The M4 receives an authored adapter
sleeve at the barrel shoulder; its flash hider is hidden, not enclosed by a
direct-thread can. The MPX is a deliberate game-fit compromise: the same exterior
with an open 9mm-capable endcap and rear sleeve receiving its authored adapter,
ray-tested by the native build.

## Calibre decision

Never scale this rifle can for another calibre. The AX338, P320 and M590 mount their
own [.338](../suppressor338/README.md), [compact 9mm](../suppressor9mm/README.md) and
[12-gauge](../suppressor12g/README.md) cans through
`fits.muzzle.suppressor.model`; the player always buys one `suppressor`.

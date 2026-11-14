# Shared suppressor

Authoring authority: `tools/blender/suppressor/{geometry,build}.py`.
Build with `bun run assets`; native Blender/GLB and cooked runtime products are ignored.
The exterior is extracted into shared Python from the MCX's authored SRD762Ti:
236 mm long, 44 mm maximum diameter, graphite ceramic, shallow circumferential
seams, wrench flats and a recessed open endcap. The MCX still calls the same
geometry until its base conversion (#662); no generated weapon file is an input.

## Datums and fit

Metres, +Y up, -Z forward in glTF. `SOCKET_mount` is the rear seating
plane at the origin. `SOCKET_muzzle` is at [0, 0, -0.236], the front
endcap face, not the legacy MCX's socket 2 mm ahead of it.
Weapons supply `MOUNT_muzzle` in this same frame, with unit scale;
rotation/translation belongs to the authored mount, never runtime scale tuning.
`MUZZLE_device` holds the removable base device; optional
`MUZZLE_device_removed` holds the adapter shown with the can installed.

M4 (#670) and MPX (#663) fits are enabled. The M4's 1/2-28 barrel receives an authored
5/8-24 adapter sleeve at the barrel shoulder; the SureFire FH556RC is removed,
not incorrectly enclosed by a direct-thread can. Removing the attachment restores
the entire original flash hider. This is an exterior gameplay fit, not a claim of
manufacturer-approved hardware or internal baffle engineering.

## Caliber decision

Do **not** scale this rifle can indiscriminately:
- 5.56/.300 BLK/7.62 can share this exterior once each authored fit is verified.
- .338 remains unverified; its muzzle, adapter and bore requirements need separate authoring.
- MPX (#663) uses an approved universal **GAME-FIT** compromise: the same
  236×44mm exterior with a 10.4mm open endcap and shadow annulus, and an open
  19mm rear sleeve receiving its authored adapter. The native build ray-tests a
  10.2mm gauge through all three. This is not manufacturer-approved 9mm SRD762Ti
  compatibility, rated hardware, or a redesign/certification of physical baffles.
  External shape, socket transforms, catalog id and runtime asset URL are unchanged.
- P320 (9 mm) still needs a pistol-appropriate booster/mount; a fixed rifle direct-thread fit is not
  verified for its moving barrel.
- M590 (12 gauge) needs a dedicated large-bore model and adapter, not a stretched
  7.62 can. No current fit is enabled.

The .338, pistol and shotgun variants are not catalog entries yet. Unverified combinations
are rejected by the common fit validator. No damage, velocity, recoil, accuracy,
AI-hearing or handling modifiers are introduced, and no shop purchase is added.
The existing suppressed flash recipe and the #668 recordings are presentation only.

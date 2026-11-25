# M4A1 RIS II hand stop

Original game art, not an installation drawing. The [Magpul XTM Hand Stop Kit](https://magpul.com/xtmhandstopkit.html)
is the reference for a low-profile, front-indexing Picatinny stop under a conventional wrap.
The [Magpul AFG-2](https://magpul.com/afg-2-angled-fore-grip.html) illustrates the larger angled
support deliberately not shipped here. A compact stop keeps the support hand on the rail, not
on a separate handle. Angled and vertical grips and other weapon fits are outside this slice.

The one verified fit is the M4A1 Block II's integral bottom RIS II Picatinny rail: no adapter,
rail cover, or fixed hardware removal. No M-LOK fit is implied. `MOUNT_support` follows the
handguard and marks a real groove. `SOCKET_mount` is the rail contact frame (+Z into the rail in
Blender, +Y forward). `SOCKET_support_contact` marks the stop's rear-facing pad;
`SOCKET_support_wrist` marks the fitted M4 support wrist in the same frame. Gameplay uses the
existing M4 finger wrap, IK and weapon poses; the support hand releases and returns without
retargeting the magazine or charging-handle work. The studio previews the same rigid assembly,
without first-person arms.

**Mount policy:** the right TOR Mini remains on its proven forward seat, with a clear beam.
Reserve the underside contact zone and top/left support-hand sweep from #506 flashlight
placement. A future light needs a separate verified seat (or adapter) outside both those
volumes and the laser's seat/beam. The light body, switch and beam must clear the hand, stop and
moving parts in every enabled combination. A same-seat or failed-clearance fit is incompatible,
not an automatic removal. There is no mount or offer for a flashlight in this slice.

The molded polymer body and blackened fastener use one vertex-tinted opaque finish and one
primitive. Geometry/materials are shared across mounts, with no texture, light, animation
channels or per-frame asset work. Assets build offline from a factory-empty Blender 5.3.0 scene.

```sh
blender -b -t 2 --python-exit-code 1 --python tools/blender/handstop/build.py -- --output /tmp/handstop
bun build/models.ts handstop /tmp/handstop
bun tools/build-assets.ts
blender -b -t 2 --python-exit-code 1 --python tools/blender/check_picatinny.py
blender -b -t 2 .cache/blender/weapons/m4a1-block-ii/m4a1-block-ii.blend \
  --python-exit-code 1 --python tools/blender/m4/check_handstop.py
bun tools/capture.ts --weapon=rifle --support=handstop --shot=weapon --out=/tmp/m4-handstop.png
```

The source sweep samples the actual hardware, moving assemblies and deformed review hands at
120 Hz, including the native reload, inspection and swap clips. It does not replace runtime IK
and WebGPU visual review of hip fire, ADS, recoil, sprint and low ready.

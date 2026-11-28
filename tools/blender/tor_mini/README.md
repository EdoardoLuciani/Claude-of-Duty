# Steiner TOR Mini laser module

Original reference-backed **green 7003** reconstruction; no flashlight. References,
photo rights and known approximations: [reference-review.json](reference-review.json).
The optimized target uses one opaque material and a 2K atlas; detailed high source
remains in the blend.

## Build and inspect

Use Blender **5.3.0**, AgX color management and the pinned **gltfpack 1.3**.
Run from the repository root after `bun ci`:

```sh
# Factory-empty scratch build, editable source, target, maps and eight review views:
blender -b -t 8 --python-exit-code 1 --python tools/blender/tor_mini/build.py -- \
  --output /tmp/tor-mini-review --render
# Separate-process, read-only saved-scene/native-export checks:
blender -b /tmp/tor-mini-review/tor-mini.blend --python-exit-code 1 \
  --python tools/blender/tor_mini/check.py
bun build/models.ts tor_mini /tmp/tor-mini-review
blender /tmp/tor-mini-review/tor-mini.blend
```

`--quick` changes render samples/resolution only, not geometry, atlas or export.
Without `--output`, products go into this directory. Normal dev/build generates
and cooks the attachment independently of player arms to
`public/models/attachments/laser.runtime.glb`. The runtime mounts `SOCKET_mount` and
uses `SOCKET_laser` as the emitter; weapons own beam/dot rendering. Build source is
[`tools/blender/tor_mini/build.py`](build.py);
[`bake.py`](bake.py) owns atlas preparation.
No downloaded mesh, old blend, reference-photo texture or network input is needed
to regenerate the asset.

Products (ignored, reproducibly generated):

- `tor-mini.blend`: hidden `SOURCE_HIGH` detailed components, visible optimized
  `TOR_MINI_body`, packed maps, named sockets and studio cameras.
- `tor-mini.glb`: native self-contained glTF export, one opaque material/primitive.
- `public/models/attachments/laser.runtime.glb` (or `laser.runtime.glb` with the
  scratch-directory cook above): shared gltfpack meshopt/KTX2 cook; the authored target
  is already reduced, so cooking does not simplify its geometry further.
- `tor-mini-{base-color,normal,orm}.png`: unique 2048² PBR atlas. ORM has R=1,
  G=roughness, B=metallic, with **no baked studio lighting or AO**.
- `manifest.json`: source hashes, nominal dimensions, socket conventions and counts.
- `renders/`: front/rear, both sides, top/bottom and two quarters when requested.

The recipe uses fewer radial segments for small fasteners/cutters and bakes
sub-0.12 mm bevels instead of modeling them. Larger edge radii and pressure-pad
relief stay in geometry. The aperture retains 32 outline segments; the checker
protects those segments and enforces a **6,000-triangle** target budget.

## Mount and emitter contract

Manufacturer nominal envelope: **2.1 × 1.3 × 1.2 inches**, approximately
**53 × 33 × 30 mm** (length × width × height). Local shapes/datum placement are
photo-inferred, not installation tolerances.

- Blender: native metres, +X right, +Y forward, +Z up, **mount facing up and body
  below the rail**, matching the reference subject's documented orientation.
- GLB: +X right, +Y up, **−Z forward** under `ATTACHMENT_tor_mini`.
- `SOCKET_mount`: `[0,0,0]`, provisional rail-channel-bed datum.
- `SOCKET_laser`: GLB `[0,-0.0105,-0.02518]` metres, just outside the aperture;
  emitter direction is local `[0,0,-1]`. No beam, dot or emission is baked in.

The subject uses a Picatinny/Weaver clamp with captive screws and an adjustable
rail bar. Each weapon integration validates rail seating, orientation, clearance and
animated parenting. The asset contains no camera-aim or bullet-zero assumption.

## Weapon mounting

Every weapon enables the module through `fits.rail.laser`, independently of
optics/irons; `rail: null` removes it. Gameplay and market inspection use the same
solver and borrowed asset. Rails and channels use the
[common Picatinny profile](../README.md#common-picatinny-interface).
The non-bearing upper inner jaw corners are chamfered to clear adjacent rail
shoulders, keeping the external envelope.

The module body is **below** its local mount: local +Y points **into** the seat.
Side mounts therefore keep forward -Z but turn the body outward.

| Weapon     | `MOUNT_rail` owner / physical support                                   |
| ---------- | ----------------------------------------------------------------------- |
| M4A1       | Right RIS II rail, forward grooves clear of the support hand            |
| P320       | Frame bone, not slide; integral underside rail                          |
| EVOLYS     | Handguard; direct underside Picatinny rail                              |
| M590       | Receiver; two fixed magazine-tube clamps ahead of the pump stroke       |
| AX338      | Fixed right KeySlot/Picatinny adapter, ahead of hand/bolt/folding stock |
| MCX VIRTUS | Receiver; upper-right chamfer adapter                                   |
| SIG MPX    | Receiver; four-tooth right adapter anchored in the last M-LOK slot      |

Each weapon's `check.py` checks the actual module, hardware, hands and mechanisms
through the native clips; only bounded mating rail/clamp contacts are exempt. The
isolated sweep remains available for diagnostics:

```sh
blender -b .cache/blender/weapons/m590/m590.blend --python-exit-code 1 \
  --python tools/blender/tor_mini/mounts.py -- m590
bun tools/capture.ts --weapon=smg --rail=laser --shot=weapon --out=/tmp/mpx-laser.png
```

## Review standard

Compare silhouette and feature placement against **both manufacturer side views**,
then use the front/rear quarters to check the open channel, screw heads, aperture,
rear relief and pressure pads. Inspect the high source and baked target under the
same camera and lighting. Hidden internals, rail tolerances, battery threads and
inaccessible underside details are not engineering reconstructions. See the
[shared authoring workflow](../README.md).

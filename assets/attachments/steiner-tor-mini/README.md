# Steiner TOR Mini laser module

Original reference-backed **green 7003** reconstruction; visual-review candidate,
not manufacturer CAD or final human visual acceptance. No flashlight or gameplay
changes. References, photo rights and known approximations: [reference-review.json](reference-review.json).
Open: human visual acceptance and mounting on a weapon.
The optimized target is **5,924 triangles** (down from 9,978), one opaque material,
with the same 2K map resolution. Detailed high source remains in the blend.

## Build and inspect

Use Blender **5.2.2**, AgX color management and the pinned **gltfpack 1.3**.
Run from the repository root after `bun ci`:

```sh
# Factory-empty scratch build, editable source, target, maps and eight review views:
blender -b -t 8 --python-exit-code 1 --python tools/blender/tor_mini/build.py -- \
  --output /tmp/tor-mini-review --render
# Separate-process, read-only saved-scene/native-export checks:
blender -b /tmp/tor-mini-review/tor-mini.blend --python-exit-code 1 \
  --python tools/blender/tor_mini/check.py
bun run models:cook -- tor_mini /tmp/tor-mini-review
blender /tmp/tor-mini-review/tor-mini.blend
```

`--quick` changes render samples/resolution only, not geometry, atlas or export.
Without `--output`, products go into this directory. Normal dev/build generates
and cooks the attachment independently of player arms; the resulting attachment
is **not loaded into gameplay**. Build source is
[`tools/blender/tor_mini/build.py`](../../../tools/blender/tor_mini/build.py);
[`bake.py`](../../../tools/blender/tor_mini/bake.py) owns atlas preparation.
No downloaded mesh, old blend, reference-photo texture or network input is needed
to regenerate the asset.

Products (ignored, reproducibly generated):

- `tor-mini.blend`: hidden `SOURCE_HIGH` detailed components, visible optimized
  `TOR_MINI_body`, packed maps, named sockets and studio cameras.
- `tor-mini.glb`: native self-contained glTF export, one opaque material/primitive.
- `tor-mini.runtime.glb`: shared gltfpack meshopt/KTX2 cook; the authored target
  is already reduced, so cooking does not simplify its geometry further.
- `tor-mini-{base-color,normal,orm}.png`: unique 2048² PBR atlas. ORM has R=1,
  G=roughness, B=metallic, with **no baked studio lighting or AO**.
- `manifest.json`: source hashes, nominal dimensions, socket conventions and counts.
- `renders/`: front/rear, both sides, top/bottom and two quarters when requested.

The recipe uses fewer radial segments for small fasteners/cutters and bakes
sub-0.12 mm bevels instead of modeling them. Larger edge radii and pressure-pad
relief stay in geometry. The aperture retains 32 outline segments; the checker
protects those segments and enforces a **6,000-triangle** target budget.

Uncompressed RGBA8 maps occupy 48 MiB before mips / approximately 64 MiB with full
mips. That is not the cooked GPU texture allocation or a gameplay performance claim.
The same asset is intended to be shared, not duplicated per compatible weapon.

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
rail bar. This does **not** certify fit on every weapon or arbitrary side/top
mounting. Later integration must validate the shared module's rail seating,
mount orientation, muzzle/hand/control clearance and animated parenting on each
compatible weapon. Laser zeroing is a separate gameplay decision; this asset
contains no camera-aim or bullet-zero assumption.

## Review standard

Compare silhouette and feature placement against **both manufacturer side views**,
then use the front/rear quarters to check the open channel, screw heads, aperture,
rear relief and pressure pads. Inspect the high source and baked target under the
same camera and lighting. Correctness checks are not visual approval; in-engine
mounted material/fit verification and human close-up review remain required before
calling the attachment final or AAA accepted.

Hidden internals, exact rail tolerances, battery threads, calibrated optical
prescriptions and inaccessible underside details are not engineering reconstructions.
See the [shared authoring workflow](../../../tools/blender/README.md).

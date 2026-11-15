# Steiner TOR Mini laser module

Original reference-backed **green 7003** reconstruction; visual-review candidate,
not manufacturer CAD or final human visual acceptance. No flashlight. References,
photo rights and known approximations: [reference-review.json](reference-review.json).
Open: human visual acceptance.
The optimized target uses one opaque material and a 2K atlas; detailed high source
remains in the blend.

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
and cooks the attachment independently of player arms to
`public/models/attachments/laser.runtime.glb`. Compatible weapons use the same rail configuration API, for example
`weapons.setAttachments('rifle', { optic: null, muzzle: null, rail: 'laser' })`.
The shared runtime mount uses `SOCKET_mount` and keeps `SOCKET_laser` as the emitter;
weapons own beam/dot rendering, with no stat changes or AI-perception effects. Build source is
[`tools/blender/tor_mini/build.py`](../../../tools/blender/tor_mini/build.py);
[`bake.py`](../../../tools/blender/tor_mini/bake.py) owns atlas preparation.
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
rail bar. This does **not** certify fit on every weapon or arbitrary side/top
mounting. Each weapon integration must validate the shared module's rail seating,
mount orientation, muzzle/hand/control clearance and animated parenting on each
compatible weapon. Laser zeroing is a separate gameplay decision; this asset
contains no camera-aim or bullet-zero assumption.

## Weapon mounting (#686)

Runtime laser compatibility is enabled for all seven weapons through `fits.rail.laser`.
The module is optional and independent of optics/irons. `rail: null` removes it;
removing an optic does not remove the laser. No statistics, AI perception, beam
zeroing or emitter-occlusion semantics change. Gameplay and market inspection
use the same solver and borrowed asset; there is no weapon-specific renderer.

`MOUNT_rail` positions below are in runtime metres (+Y up, −Z forward).
Rails and channels use the [common Picatinny profile](../../../tools/blender/README.md#common-picatinny-interface).
The recoil key is centred on the mount's groove. The non-bearing upper inner jaw
corners are chamfered to clear adjacent rail shoulders, while retaining the external
bar height, rail purchase and nominal manufacturer envelope. The M4's mount sits
on the right RIS II rail ahead of the support glove.

The module body is **below** its local mount: local +Y points **into** the seat,
not out of the weapon. Side mounts therefore retain forward −Z but turn the
body outward. These are authored game-fit adaptations, not certified hardware.

| Weapon | Availability | Rail seat | Owner / physical support |
| --- | --- | --- | --- |
| M4A1 | Enabled | `[.028321, .075, −.4101216]` | Actual right RIS II contact plane; sixteen forward grooves clear the support hand |
| P320 | Enabled | `[0, .002, −.122]` | Frame bone, not slide; integral game-fit rail extended 14 mm with fifth slot |
| EVOLYS | Enabled | `[0, .0165924, −.363725]` | Handguard; direct reference-backed underside Picatinny rail, no side bracket |
| M590 | Enabled | `[0, .009, −.575]` | Receiver; two fixed magazine-tube clamps ahead of the entire pump stroke, clear of cap fluting/barrel lug |
| AX338 | Enabled | `[.038, .075, −.455]` | Fixed right KeySlot/Picatinny adapter, ahead of hand/bolt/folding stock |
| MCX VIRTUS | Enabled | `[.03064, .10247, −.361]` | Receiver; upper-right chamfer adapter, shared optics and removable SRD762Ti |
| SIG MPX | Enabled | `[.037, 0, −.295]` | Receiver; four-tooth right adapter, two anchors in the last M-LOK slot, shared optics and removable suppressor |

P320's extended rail is a game-fit deviation from the Compact factory frame.
M590's clamps attach to the fixed tube, never the moving forend. Each weapon's
`check.py` checks actual module, hardware, hands and mechanisms through the native
clips; AX338 also sweeps the stock hinge. Only bounded mating rail/clamp contacts
are exempt. See each weapon README for its mount and known limitations.
Finite source sampling does not certify runtime transitions or human visual acceptance.
The isolated sweep remains available for diagnostics, not a substitute for full checks:


```sh
blender -b assets/weapons/m590/m590.blend --python-exit-code 1 \
  --python tools/blender/tor_mini/mounts.py -- m590
bun tools/capture.ts --port=5186 --weapon=smg --rail=laser --shot=weapon --out=/tmp/mpx-laser.png
# Also use --shot=ads, --reload, and the existing market inspection controls.
```

Combined configurations require actual mesh/motion checks, not estimated cylinders
or empty datums.

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

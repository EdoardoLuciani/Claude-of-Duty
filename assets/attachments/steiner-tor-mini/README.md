# Steiner TOR Mini laser module

Original reference-backed **green 7003** reconstruction; visual-review candidate,
not manufacturer CAD or final human visual acceptance. No flashlight. References, photo rights and known approximations: [reference-review.json](reference-review.json).
Measured build/render evidence and open acceptance items: [REVIEW.md](REVIEW.md).
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
and cooks the attachment independently of player arms to
`public/models/attachments/laser.runtime.glb`. Compatible weapons use the same rail configuration API, for example
`weapons.setAttachments('rifle', { optic: null, ironSights: true, muzzle: null, rail: 'laser' })`.
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
mounting. Each weapon integration must validate the shared module's rail seating,
mount orientation, muzzle/hand/control clearance and animated parenting on each
compatible weapon. Laser zeroing is a separate gameplay decision; this asset
contains no camera-aim or bullet-zero assumption.

## Weapon mounting (#686)

**Partial implementation:** the target is all seven weapons, but runtime laser
compatibility is enabled for M4, P320, EVOLYS, AX338, MPX and MCX. M590
hardware/checks remain staged, with no `fits.rail.laser` entry, so API/debug/capture
configuration rejects its `rail: 'laser'`. M590 requires authorized shared-arm
input resolution and a complete authoring check pass. MPX remains acceptance-blocked
by its disclosed hardware/glove collision; MCX's corrected fit has full sampled
runtime-hand evidence rather than only selected-pose snapshots.

The module is optional and independent of optics/irons. `rail: null` removes it;
removing an optic does not remove the laser. No statistics, AI perception, beam
zeroing or emitter-occlusion semantics change. Gameplay and market inspection
use the same solver and borrowed asset; there is no weapon-specific renderer.

`MOUNT_rail` positions below are in runtime metres (+Y up, −Z forward).
The module body is **below** its local mount: local +Y points **into** the seat,
not out of the weapon. Side mounts therefore retain forward −Z but turn the
body outward. These are authored game-fit adaptations, not certified hardware.

| Weapon | Availability | Rail seat | Owner / physical support |
| --- | --- | --- | --- |
| M4A1 | Enabled | `[.0285, .075, −.250]` | Existing right RIS II rail; fit unchanged |
| P320 | Enabled | `[0, .002, −.122]` | Frame bone, not slide; integral game-fit rail extended 14 mm with fifth slot |
| EVOLYS | Enabled | `[0, .0165924, −.363725]` | Handguard; direct reference-backed underside Picatinny rail, no side bracket |
| M590 | Staged / disabled | `[0, .009, −.590]` | Receiver; two fixed magazine-tube clamps ahead of the entire pump stroke |
| AX338 | Enabled | `[.038, .075, −.455]` | Fixed right KeySlot/Picatinny adapter, ahead of hand/bolt/folding stock |
| MCX VIRTUS | Enabled | `[.03064, .10247, −.361]` | Receiver; upper-right chamfer adapter, integrated ACOG/SRD762Ti retained |
| SIG MPX | Enabled | `[.037, 0, −.295]` | Receiver; forward right adapter with short supported overhang, ROMEO4T/SRD9 retained |

P320's rail extension is an explicit deviation from the Compact factory frame.
The module nose sits a few millimetres ahead of its barrel exit, below the bore;
barrel/slide/hand motion is unchanged. M590's laser deliberately does **not**
move with the forend: its clamps grip the fixed tube between the pump and end cap.
EVOLYS intentionally recalibrates its support hold 23 mm rearward and 16 mm lower
and stages release/regrip below the rail; feed/pouch/charging beats stay intact.
Its lower rail and actual module are checked against both evaluated hands.
The MPX hardware-versus-hand check still exposes unresolved adapter contacts;
its earlier module-only fit evidence is not full hand-clearance acceptance.

Each changed weapon's `check.py` calls `tools/blender/tor_mini/mounts.py` against
actual editable TOR/weapon/optic surfaces. It checks forward direction, rail
contact, emitter clearance and intersections over every clip at 120 Hz, including
fractional endpoints; AX338 also sweeps its stock hinge through 181 positions.
Only bounded mating rail/clamp contacts are exempt, not hands or mechanisms.
MCX now includes runtime-driven DCC review arms: 1,656 sampled source poses across
nine tracks check both arms, support hardware, module and emitter, with evaluated
skin parity against actual runtime references. This complements the earlier native
WebGPU sweep of 5,051 runtime poses, including returns/cancellation transitions,
against the real adapter and cooked laser plus the hand/emitter corridor. Fitted
draw fingers and a lowered post-charge return resolve the motion crossings. See the
[MCX receipt and limits](../../weapons/mcx-virtus/README.md#tor-mini-rail-686).
Sampling is not continuous-clearance or human visual certification. M590's
historical shared-arm hash certificate remains unresolved (see its asset README).
Its full check stops before mount/optic gates; the independent laser-only sweep
does not establish those later gates or justify enabling compatibility:


```sh
blender -b assets/weapons/m590/m590.blend --python-exit-code 1 \
  --python tools/blender/tor_mini/mounts.py -- m590
bun tools/capture.ts --port=5186 --weapon=smg --rail=laser --shot=weapon --out=/tmp/mpx-laser.png
# Also use --shot=ads, --reload, and the existing market inspection controls.
```

The authored MCX/MPX integrations do not depend on their open base-conversion issues #662/#663.
Their existing integrated suppressors are included in native fit checks. Other
weapons' `MOUNT_muzzle` datums do **not** certify any future suppressor (#670):
there is no standalone muzzle catalog/asset to fit, and future geometry must be
rechecked rather than inferred from an estimated cylinder or an empty datum.

## Review standard

Strict native browser receipts remain failed on two TSL inline `Fn()` return
errors. The `rail: null` M4 control ran on the **changed branch**, not unmodified
`7cb4fbf`; it establishes reproduction without an installed laser only, not
baseline attribution or a harmless-error waiver. No unmodified-base control was
performed. Issue #686 is not complete or merge-ready.

Compare silhouette and feature placement against **both manufacturer side views**,
then use the front/rear quarters to check the open channel, screw heads, aperture,
rear relief and pressure pads. Inspect the high source and baked target under the
same camera and lighting. Correctness checks are not visual approval; in-engine
mounted material/fit verification and human close-up review remain required before
calling the attachment final or AAA accepted.

Hidden internals, exact rail tolerances, battery threads, calibrated optical
prescriptions and inaccessible underside details are not engineering reconstructions.
See the [shared authoring workflow](../../../tools/blender/README.md).

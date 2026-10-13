# M590A1 — authored weapon and handling candidate

Original game art for the existing M-590: 18.5-inch configuration identity,
6+1 tube, ghost-ring irons, SureFire-style light forend, pistol grip and
M4-style stock. **Asset-only: the current game still uses the procedural
shotgun.** Runtime integration, live-game ADS/reach/interruption checks and human
visual approval remain separate gates. No combat definitions were changed.

## Files and rebuild

- `m590.blend`: editable component meshes/modifiers, packed original maps, seven
  native NLA tracks and shared glove/sleeve review skins, plus an excluded studio.
- `m590.glb`: committed local runtime candidate; only rigid weapon meshes and
  mechanism/wrist/finger controls. No arms, spent cases, cameras or lights.
- `manifest.json`: actual export statistics, basis, sockets, mechanism, exact
  gameplay event times and contact windows.
- `hand-reference.json`: offline shared `Arm` fit; game-space wrist quaternions
  are **x,y,z,w**, finger/thumb poses are radians. `pads` are palmar distal contact
  patches (right index uses the common trigger patch); `thumb` is the common
  thumb-centre oracle and `thumbPad` is its palmar surface patch.

From the repository root, after `npm ci`:

```sh
node tools/m590-hand-reference.mjs
blender -b --threads 8 --python-exit-code 1 --python tools/blender/m590.py
blender -b assets/weapons/m590/m590.blend --threads 8 --python-exit-code 1 --python tools/blender/m590_check.py
node tests/smoke/smoke-shotgun-asset.mjs
# Optional DCC stills/contact frames; images must stay outside the repository:
blender -b --threads 8 --python-exit-code 1 --python tools/blender/m590.py -- --render-dir=/tmp/m590-review
```

Geometry/actions live in `tools/blender/m590.py` and `m590_actions.py`. Rebuild
source and export together after authoring changes; do not hand-patch the GLB.
The scripts reuse the M4 native basis, rigid-parent export and shared review-skin
patterns. Only evaluated export copies are merged. Planar UVs are deterministic;
original source components retain editable bevels. Exact fractional endpoints
and hull visibility keys are corrected in the exporter, including the quaternion
lost by Blender's zero-scale decomposition. Two consecutive Blender 5.2.2
rebuilds produced byte-identical GLBs. Normal game builds require no Blender.

Blender must have a compatible OCIO installation with AgX. The review host's
Blender 5.2.2 shipped an OCIO 2.5 profile with a linked 2.4 library; authoring used
an external `BLENDER_SYSTEM_DATAFILES` directory containing a compatible profile
copy and original LUT links. No fallback transform or repository config change
was used. Optional Draco/meshoptimizer bridge warnings are harmless here: this
GLB does not request either extension.

## Locked native contract

Metres, origin at the existing shooting-hand thumb-web datum. Blender coordinates
are `(x,-z,y)` for game `(x,y,z)`: **+Y forward / +Z up / +X right**.
`export_yup=True` yields **−Z forward / +Y up / +X right** with no extra adapter
rotation. `M590_RIG` is identity at Idle. Direct children are `receiver`, `forend`,
`bolt`, `trigger`, `shell_insert`, all sockets and all hand controls.

| Socket | Game-space position |
|---|---|
| `SOCKET_muzzle` | `[0,.068,-.545]` |
| `SOCKET_ejection` | `[.0205,.071,-.072]` |
| `SOCKET_sight` | `[0,.102,-.137]` |
| `SOCKET_loading` | `[0,.041,-.055]` |
| `SOCKET_chamber` | `[0,.068,-.072]` |

Ejection direction is `[.84,.42,.28]`. The front blade tip is centered at the
same `.102 m` sightline through the real rear aperture. No optic or reticle glass.
The loading mouth is a real 23×74 mm cut aligned with the loading datum's x/z.
Its exterior belly lip is at `.0345 m`; the `.041 m` socket lies within the open
insertion depth, not at the legacy below-weapon seat helper. Its length and
internal channel accommodate the 70 mm hull during the authored angled entry.
These are inferred game-art dimensions, not manufacturer CAD.

Wrist/finger nodes follow `authored-hands.ts`: `hand_L/R`,
`L/R_finger_{0..3}_root`, `L/R_finger_{0..3}_{0..2}`,
`L/R_thumb_base`, `L/R_thumb_0`, `L/R_thumb_1`. Use the shared arm scales
**left .97 / right 1**. The fitted right wrist stays `[.037,-.020,.130]`;
the left wrist is `[-.0394,.0377,-.220]` (32 mm rearward from the procedural
starting datum; the index is re-fitted to the 180 mm forend while the glove/palm
clears the receiver at full stroke). Directions and
measured contacts are authoritative in `hand-reference.json`; do not independently
offset wrists in the adapter.

Forend, twin action bars, bolt and planted support hand share a **38 mm +Z**
stroke. Bolt rest is `[0,.068,-.017]`; trigger pivot `[0,.037,.0025]`, pull −.28
radians. Pump reaches full rear at `.32×duration`, holds to `.55`, closes by `.82`.
The trigger/finger pulse is part of Pump; there is no separate Fire action or
baked shot recoil. Preserve the game's reactive recoil and pooled live ejection.

| Native clip / alias | Duration | Gameplay events (seconds) |
|---|---:|---|
| `Idle` | 2, visual loop | none |
| `Pump` / `pump` | .45 | pump .144; end .44775 |
| `Reload_Tactical` / `reloadTac` | .55 | start .011; shellin .451; end .54725 |
| `Reload_Empty` / `reloadEmpty` | .95 | start .019; shellin .646; pump .836; boltrelease .8835; end .94525 |
| `Inspect` / `inspect` | 3 | end 2.985 |
| `Draw` / `draw` | .7 | end .6965 |
| `Holster` / `holster` | .45 | end .44775 |

Consume `manifest.clips` through the existing event-only Clip bridge. Manifest
values use the original fractional formulas (`.995×duration`, etc.), not rounded
video frames. Dispatch gameplay events only from existing Clip callbacks, never
from AnimationMixer listeners. Idle restores every mechanism, root and hand
channel; Holster intentionally ends lowered, and Draw ends at Idle.

Hull visibility remains tactical `[.187,.462)` and empty `[.418,.665)`.
The support hand transports the shell with a genuine four-finger wrap, releases
that wrap before entering the receiver, then pushes the rear rim from below with
the thumb. Fingers remain curled outside the receiver during insertion; after
shellin the thumb withdraws and the hand moves outboard before opening for return.
These phases are distinct contact/clearance assertions, not a continuous grip
through the receiver wall:

| Phase / manifest key | Tactical | Empty |
|---|---|---|
| Four pads + thumb wrap / `shell` | `[.187,.319]` | `[.418,.475]` |
| Release transition / `release` | `[.319,.385]` | `[.475,.551]` |
| Thumb/rim push / `thumb` | `[.385,.451]` | `[.551,.646]` |
| Whole glove/receiver clearance / `insertionClearance` | `[.319,.55]` | `[.475,.95]` |

Empty reload additionally plants the hand on the forend during `[0,.209]` and
`[.741,.95]`. The hull's local base is zero and it extends −Z for 70 mm, with an
11.05 mm rim radius. `shell` and `insertion` reference wrists/poses/contacts are in
game space relative to `shell.hullPosition`; `insertion.rimPad` is the desired
palmar contact on the rear face near its lower edge. The GLB owns both paths and
all release/return interpolation; runtime must not reconstruct either phase.

**Do not expose `shell_insert` as `parts.magazine` or `magazineBody`.** Those are
shared detachable-magazine/hide/drop paths. The shotgun adapter alone converts
its authored STEP scale to visibility. Reset samples Idle and hides the hull;
retain `reactiveFire: true`, `fxClass: 'shotgun'`, shell metadata and the common
record's legacy below-mouth `magSeat` helper if needed. No procedural part/hand
updates or second animation clock should overwrite native curves.

## Measurements and limits

Actual GLB: **34,178 triangle instances, 13 primitives, 7 materials, 3 embedded
1024² PBR maps, 5,742,712 bytes (5.48 MiB)**. No implicit fallback material.
Source: 97 editable component meshes and 46 animated rigid/hand controls, plus
review-only arms. Raw source component bounds (excluding the insertion hull):
`[-.024,-.085,-.545]` to `[.024,.114,.261]`, approximately 806 mm long.
The nominal 18.5-inch identity, shortened `.445 m` visual barrel and legacy
39.5-inch reference are different measurements; no photographic/OAL certification
is claimed.

The saved-source check uses rendered tessellation/BVH for real openings, aligned
irons, mesh contacts, barrel/receiver separation and hull/loading-channel sweep.
It measures approximately 2 mm minimum pump rear clearance and sweeps the actual
deformed shared glove/sleeve against receiver/barrel during planted pump motion,
and against the receiver throughout release, insertion and return (193 skin
poses). Every visible hull pose is separately swept against the loading channel,
so shortened wrap windows cannot conceal interpenetration. The focused actual
GLB regression samples 1,951 poses at 240 Hz and validates all seven actions/exact
beats/native PBR/sockets/controls/visible hull transitions, actual triangle
contacts/openings, rim-thumb contact, continuous wrist/finger/thumb motion and
canonical reset. Maximum wrap/pump drift is .240 mm; rim-thumb drift .808 mm;
maximum 240 Hz wrist step 19.86 mm and hand rotation step .286 radians.
These checks do not certify runtime shared-IK reach, final game lighting, ADS
framing, death/restart/pause or fire/reload interruption behavior. Those remain
component B's integration gates, without weakening existing tolerances.

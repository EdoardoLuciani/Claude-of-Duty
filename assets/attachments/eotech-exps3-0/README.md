# EOTECH EXPS3-0 attachment

Shared gameplay optic on all seven weapons, with a native nonmagnified
68 MOA ring / 1 MOA dot. `tools/blender/exps3.py` owns geometry/export;
`exps3_bake.py` owns the atlas. Blend/native GLB/maps/manifest and cooked runtime
GLB are generated products. References, rights and visual limitations live in
`reference-review.json`. This is original game art, not manufacturer CAD.

[Shared workflow and rail contract](../../../tools/blender/README.md)

## Rebuild and validate

Run from the repository root with Blender 5.2.2, compatible AgX and gltfpack 1.3:

```sh
bun run assets
blender -b -t 2 --python-exit-code 1 --python tools/blender/check_picatinny.py
# Then run each weapon's saved-source check.py (commands beside each asset).
bun tools/capture.ts --weapon=rifle --optic=exps3 --rail=laser --muzzle=suppressor --shot=ads --out=/tmp/m4-exps3.png
```

The cook writes `public/models/attachments/exps3.runtime.glb`. Standalone review
is available with `blender -b -t 8 --python-exit-code 1 --python tools/blender/exps3.py -- --output /tmp/exps3-review --render`;
`bun run models:cook -- exps3 /tmp/exps3-review` cooks that scratch native export.

## Mechanical interface

Native metres export −Z forward/+Y up under `ATTACHMENT_exps3`. `MOUNT_base`
and retained `SOCKET_mount` identify the QD saddle contact, 4.8 mm above the art
zero. `SOCKET_sight` is 43.4 mm above that plane and 23.1 mm aft of its centre.
The optical dimensions remain photo-derived, not manufacturer-certified.

`tools/blender/picatinny.py` owns the common nominal MIL-STD-1913 head/neck,
45° flanks, groove depth/width and pitch. The EXPS3's former 16 mm internal saddle
was too narrow for the nominal 19 mm top flat. Its projecting jaws were also
10.3 mm deep below contact. The authored channel now follows the shared gauge,
including the relief through the low rear casting; the jaws stop 4.8 mm below
contact. Flanks have 0.1 mm transverse assembly clearance, while the saddle seats
at zero. Other optic and laser clamps use the same interface.

The shared solver subtracts the datum once; there are no weapon-specific or
per-frame seating offsets. A fit may select whole forward rail grooves via
`railSlots` (the M4's PM II uses seven to clear its ocular from the charging hand);
the shared gameplay/inspection solver and source check read the same fit data.
This changes longitudinal slot choice only, never the common seating height.
A source-mesh check tests every actual clamp against
an inset slotted rail solid and probes its seating faces. It independently
measures both optic/laser rails on every weapon. Entire rail meshes are not
accepted as evidence that a penetrating clamp is correct.

## Fits and gameplay

| Weapon / API id | EXPS3 eye relief | Source fitting changes |
| --- | --- | --- |
| M4A1 / `rifle` | 200 mm | Common rail profile, flange shoulder relief and accurate right-rail datum; laser moved sixteen grooves ahead of the support hand; outboard hooked-hand reload approach/return |
| MCX / `mcx` | 200 mm | Replace oversized 27 mm rail teeth; common head/neck and laser recoil-groove clearance |
| MPX / `smg` | 200 mm | Replace rectangular rail/spine; common profile and laser recoil-groove clearance |
| P320 / `pistol` | 353 mm | Narrow bridge supports below the rail neck; standard top/frame rails; preserve extended pistol hold |
| EVOLYS / `lmg` | 200 mm | Supported optic rail raised 5.5 mm to clear guard/cover; aligned irons; extend underside support to cover the laser clamp |
| M590 / `shotgun` | 200 mm | Common profile and one additional forward land to support the PM II's full pedestal envelopes |
| AX338 / `sniper` | 200 mm | Common top/side rails and laser recoil-groove clearance |

The current attachment contract is `{ optic, muzzle, rail }`. Mounted optics
replace removable irons automatically; removal restores them. P320/M590 retain
fixed irons. Base weapons remain attachment-free. EXPS3 uses the existing market
build/ownership path (350 credits), gameplay solver and inspection preview.

`?attachmentOptic=exps3` configures the default, owned M4 at boot. For an acquired,
loaded weapon, use `weapons.setAttachments(id, { optic: 'exps3', muzzle: null,
rail: null })`. Unowned weapons still require acquisition; capture tooling uses
`applyBuild()` after readiness rather than bypassing ownership.

## Rendering and acceptance limits

Body/glass remain separate with three 1024² PBR maps. Glass is thin alpha, without
a scene-transmission pass. The live-axis viewmodel reticle is not baked into the
mesh. World FOV/sensitivity scales are 1; the 1 MOA dot has a documented two-pixel
readability floor. The ring preserves world-angular size, fades before leaving
the clear bore, and is depth-tested against the housing.

Per-weapon checks sample authored mechanisms and actual deformed review hands at
120 Hz, with separate stock-fold/charging sweeps where no native clip exists.
Laser and calibre-specific suppressor combinations are included. These finite
checks and representative hardware-WebGPU captures are not continuous collision
proof, final human visual approval or real-world mounting certification.

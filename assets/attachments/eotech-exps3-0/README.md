# EOTECH EXPS3-0 attachment

Shared gameplay optic with a native, nonmagnified 68 MOA ring / 1 MOA dot.
`tools/blender/exps3.py` owns geometry/export; `exps3_bake.py` owns the atlas.
Blend/native GLB/maps/manifest and cooked runtime GLB are generated products.
See `reference-review.json` for references, rights and visual limitations.

[Shared workflow](../../../tools/blender/README.md)

Run from the repository root with Blender 5.2.2, compatible AgX and gltfpack 1.3:

```sh
blender -b -t 8 --python-exit-code 1 --python tools/blender/exps3.py
bun run models:cook -- exps3
```

The runtime cook now writes `public/models/attachments/exps3.runtime.glb`.
Standalone review remains available with `--output /tmp/exps3-review --render`;
`bun run models:cook -- exps3 /tmp/exps3-review` cooks that scratch source beside
it as `exps3.runtime.glb` rather than the historical `exps3-0.runtime.glb`.

Native metres export −Z forward/+Y up under `ATTACHMENT_exps3`. `MOUNT_base`
and the retained `SOCKET_mount` identify the flat QD saddle underside, 4.8 mm
above the original art zero, **not** the projecting jaws. The shared mount solver
subtracts that datum; there is no weapon-specific or per-frame seating offset.
`SOCKET_sight` is 43.4 mm above this contact plane and 23.1 mm aft of its centre.
These are verified art datums, not manufacturer-certified optical dimensions.
Body/glass stay separate with three 1024² PBR maps. Glass uses the existing thin
alpha adapter; the reticle is projected by the common viewmodel path, not baked
into the mesh. World FOV/sensitivity scales are both 1; the 1 MOA dot has an explicit
2-pixel minimum diameter for readability. The ring fades before leaving the clear
bore, and ordinary viewmodel depth testing occludes it against the housing.

## Compatibility: partial #685, not all-seven acceptance

Only **AX338** is enabled, with 200 mm eye relief and either installed or removed
irons. The EXPS3 does not clash with its irons; the existing PM II restriction is
unchanged. Gameplay, API/debug configuration and market inspection use the same
mount solver. Removing the optic retains the independent iron-sight selection;
attachment-free defaults and integrated optics on other weapons are unchanged.

```sh
bun tools/capture.ts --port=5185 --weapon=sniper --optic=exps3 --shot=ads --out=/tmp/ax338-exps3.png
blender -b assets/weapons/ax338/ax338.blend --python-exit-code 1 --python tools/blender/ax338/check.py
```

The AX338 source check covers actual saddle seating, non-mating body/iron
clearance, native 120 Hz bolt and deformed-hand poses across all authored clips,
and the existing 181-pose stock-fold sweep. Those checks are not final human
visual acceptance or manufacturer/CAD certification.

`attachmentOptic=exps3` is recognized by the shared URL validator, but the plain
boot URL cannot equip AX338: it is not initially owned/loaded. Use the capture
command above (which acquires it after readiness), or acquire it normally and call
`weapons.setAttachments('sniper', { optic: 'exps3', ironSights: true, muzzle: null,
rail: null })`. No boot ownership bypass is introduced; URL equip acceptance is
still incomplete.

Other weapons are **rejected** by the existing verified-eye-relief boundary,
not silently accepted or automatically stripped of irons. Read-only Blender
mesh probes of the current mounts found these unresolved fits:

| Weapon | Blocker at the shared rail-contact datum |
| --- | --- |
| M4A1 | Empty-reload charging hand's woven glove contacts the body at 2.375 s and 2.7083 s in the 24 Hz probe. |
| P320 | Clamp jaws intersect both `Optic bridge \| side support` meshes (not merely the mating rail deck). |
| EVOLYS | Body contacts `handguard_mesh` and `feed_cover_mesh`, beyond receiver rail contact. |
| M590 | Clamp jaws intersect four `Optic rail receiver foot` supports, beyond mating Picatinny lugs. |
| MCX VIRTUS | No authored shared optic mount/fit; integrated ACOG remains. Base conversion #662 is open, including standalone ACOG extraction. |
| SIG MPX | No authored shared optic mount/fit; integrated ROMEO remains. Base conversion #663 is open. |

The four failed probes are diagnostic samples, not full-rate clearance
certification. Correcting their hardware/animation fits and validating the two
base conversions remain follow-up work before #685 can be completed. No attachment
economy/customization UI (#672/#673) or combined fit with #686's new laser hardware
is claimed here. Existing laser configuration and rendering are unchanged.

Hardware WebGPU captures reached the market preview with the shared mount present,
but the strict browser run reported two `THREE.TSL` inline-`Fn()` return warnings (treated as strict failures)
during boot/prewarm, before selecting the preview. This is an unresolved shared-renderer risk, not proven
to exist on the unmodified base. A successful screenshot/API round trip does not
make that strict run pass; clean inspection visual acceptance remains open.

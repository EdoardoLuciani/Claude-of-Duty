# Dedicated 12-gauge expansion suppressor (#715)

Authoring authority: `tools/blender/suppressor12g/{build,check}.py`. This is a
new game-art model, **not a scaled SRD762Ti**, licensed/manufacturer hardware,
or a claim of physically certified baffles or shotgun ammunition compatibility.
A stepped 220 mm expansion shell reaches 84 mm diameter, with a narrow tapered
adapter neck, machined end rings, shallow circumferential grooves and side ID.
The clear bore flares from 19.2 mm at the rear to 76 mm at the open endcap.
There is no painted closing disk or hidden bore-shadow obstruction.

## Frame, catalog and base hardware

Native metres, +Y forward/+Z up in Blender; glTF -Z forward/+Y up, unit scale.
`SOCKET_mount` is the origin/rear seating plane; `SOCKET_muzzle` is the real
endcap exit `[0, 0, -.220]` in runtime coordinates. M590 uses its existing
`MOUNT_muzzle = [0, .068, -.6672884763]` at the permanent adapter face, giving
an installed exit of `[0, .068, -.8872884763]` in weapon space. No runtime
scale/offset tuning and no M590 rail/optic authoring changes are needed.

The player-facing muzzle id stays `suppressor`; `WEAPON_DEFS.shotgun.fits.muzzle.suppressor`
names this **`suppressor12g`** can model (its cook id and runtime GLB), so the shotgun
never mounts the SRD762Ti. Every suppressor fit uses the existing suppressed
flag/audio/flash behavior. No stat, damage,
eight-pellet count, spread, velocity, handling or report-bank changes.

Both original 12g adapter pieces remain **permanent**, mounted or removed.
M590 leaves `removableMuzzleDevice` unset, so there is no `MUZZLE_device` to hide;
the solver still requires the authored mount and output socket. Weapons that set
the flag must author `MUZZLE_device` and switch it normally. Removing the can restores the original adapter-exit socket.

## Clearance and sightline decision

The broad coaxial expansion chamber deliberately **occludes the low .096 m
iron sightline** (can top .110 m). The front blade, cheeks and ghost ring stay
physically unchanged/clear, but irons are not a usable aiming view with this can.
Use the verified RMR/ACOG/PM II fits for an unobstructed aiming view; the game
does not silently install an optic, hide fixed sights or adjust eye relief.
This is an explicit game-art compromise rather than a new elevated-sight model.

`check.py` fires 288 mesh rays from an 18.6 mm rear shot envelope at a conservative
7 degree half-angle through the entire 220 mm length. Runtime's worst rest
spread is 1.2 × 1.15 × 2.2 × 2 = 6.072 degrees; the accumulated spread cap is
2.1 degrees. The check exceeds both without changing any tuning. Runtime
actually spawns all pellets at the installed exit, not inside the can.

The M590-owned `tools/blender/m590/muzzle.py` uses actual can/TOR Mini meshes,
checks the front blade/cheeks, magazine cap, lug and fixed TOR Mini clamps, then
sweeps both evaluated review-hand skins, full provisional 89 mm pump stroke,
bolt/trigger and visible shell at 120 Hz through all seven clips, including exact
fractional endpoints. It also verifies the stationary receiver-owned exit and
intentional iron-line occlusion. The combined rail/suppressor check verifies all
three mounted optic meshes and sight rays, including the PM II. Finite sampled
source checks do not certify continuous clearance or all runtime IK/recoil transitions.

## Rebuild and check

```sh
# Builds and runs the 7 degree shot-envelope gauge (shared tools/blender/can.py):
blender -b -t 2 --python-exit-code 1 --python tools/blender/suppressor12g/build.py
bun run models:cook -- suppressor12g
# Build shared optics/laser and M590 first (bun run assets), then all source gates:
blender -b -t 2 assets/weapons/m590/m590.blend --python-exit-code 1 \
  --python tools/blender/m590/check.py
bun tools/capture.ts --port=5715 --weapon=shotgun --rail=laser \
  --muzzle=suppressor --shot=weapon --out=/tmp/m590-can-hip.png
bun tools/capture.ts --port=5715 --weapon=shotgun --rail=laser \
  --muzzle=suppressor --shot=ads --out=/tmp/m590-can-irons.png
```

`build.py -- --output /absolute/scratch` supports isolated source/export review.
`bun run assets` registers authoring and cooking; generated `.blend`/GLBs are
ignored products. Runtime URL: `/models/attachments/suppressor12g.runtime.glb`.
Gameplay, inspection and URL/capture configuration share the existing validator
and mount solver; `attachmentMuzzle=suppressor&attachmentWeapon=shotgun` needs
no new parsing path. Existing #705 shotgun-suppressed banks are reused unchanged.

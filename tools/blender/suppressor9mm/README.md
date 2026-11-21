# Compact 9mm booster suppressor

Original game art authored by `tools/blender/suppressor9mm/build.py`: a compact
graphite ceramic body with a contrasting nitrided piston waist, rear retaining ring
and ribbed booster housing, deliberately not a scaled SRD762Ti. The visible
piston/booster is a rigid exterior on the tilting barrel, not a simulation of its
internal operation.

## Frame and fit

Metres; native Blender +Y forward / +Z up, glTF -Z forward / +Y up, unit scale.
`SOCKET_mount` is the rear piston seating plane and `SOCKET_muzzle` the endcap exit.
The P320's `fits.muzzle.suppressor` names this can model (`suppressor9mm`); only the
P320 uses it.

The rear piston sleeve receives the P320 thread, with the barrel crown ending inside
it. The builder ray-tests a clear gauge through the piston, housing, body and
recessed endcap, then checks the exported exit direction. The P320-owned
[fit and sightline contract](../p320/README.md#compact-9mm-suppressor)
checks every clip against both deformed hands, slide/frame and TOR Mini; the fixed
SIGLITE sightline clears the can without raised sights.

## Build and review

```sh
blender -b -t 4 --python-exit-code 1 --python tools/blender/suppressor9mm/build.py
bun build/models.ts suppressor9mm
blender -b -t 4 .cache/blender/weapons/p320-compact/p320-compact.blend \
  --python-exit-code 1 --python tools/blender/p320/check.py
bun tools/capture.ts --weapon=pistol --muzzle=suppressor --shot=ads \
  --out=/tmp/p320-can-irons.png
```

The editable `.blend` keeps the individual parts. GLB export joins the rigid
assembly into material groups; the cook preserves geometry without simplification.

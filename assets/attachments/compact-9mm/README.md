# Compact 9mm booster suppressor

Original, non-functional game art authored by
`tools/blender/suppressor9mm/build.py`; no generated rifle model is an input.
135 mm long, maximum 28.4 mm diameter (seam rings), graphite ceramic body,
contrasting nitrided piston waist, rear retaining ring and twelve-rib booster
housing. This is deliberately a compact pistol silhouette, not a scaled
SRD762Ti. The visible piston/booster is a rigid exterior on the tilting barrel,
not a simulation or certification of internal spring/booster operation.

## Catalog and frame

`suppressor9mm` is a **can model** with its own local runtime GLB; the P320's
`fits.muzzle.suppressor` names it, so the player-facing id stays `suppressor` while
the pistol never mounts the shared rifle SRD762Ti. Only P320 uses this can.
Every suppressor fit uses the common suppression flag/exit path. No damage, handling,
audio-bank or economy changes accompany the model.

Metres; native Blender +Y forward / +Z up, glTF -Z forward / +Y up, unit scale:

| Datum | glTF position | Meaning |
| --- | --- | --- |
| `SOCKET_mount` | `[0, 0, 0]` | rear piston seating plane |
| `SOCKET_muzzle` | `[0, 0, -.135]` | front endcap exit |

The rear piston/waist has a 14.1 mm receiving opening around the P320’s
13.9 mm thread crest; the barrel crown ends inside that sleeve. Forward
annular parts have a real 10.4 mm bore. The builder ray-tests a 10.2 mm clear
gauge through the piston, housing, body and recessed endcap, then checks the
exported exit direction. This is an exterior-fit check, not authored baffles or
manufacturer-approved hardware.

## Build and acceptance

```sh
blender -b -t 4 --python-exit-code 1 --python tools/blender/suppressor9mm/build.py
bun run models:cook -- suppressor9mm
# Or build/cook all stale products:
bun run assets
blender -b -t 4 assets/weapons/p320-compact/p320-compact.blend \
  --python-exit-code 1 --python tools/blender/p320/check.py
bun tools/capture.ts --port=5714 --weapon=pistol --muzzle=suppressor \
  --rail=laser --shot=weapon --out=/tmp/p320-can.png
bun tools/capture.ts --port=5714 --weapon=pistol --muzzle=suppressor \
  --shot=ads --out=/tmp/p320-can-irons.png
```

Generated Blender/native GLB/cooked products stay ignored. The cook preserves
geometry without simplification. The P320-owned
[fit and sightline contract](../../weapons/p320-compact/README.md#compact-9mm-suppressor-714)
checks all eight clips at 120 Hz, both actual deformed hands, slide/frame,
three optics and TOR Mini. Loaded-rest SIGLITE sightline clears the top of the
can by 2.5 mm; no raised sights or runtime sightline workaround is needed.

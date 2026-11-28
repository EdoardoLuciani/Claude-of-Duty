# Foregrip exterior assets

These are original Blender game props, not functional parts or installation
resources. Each has a standalone bake and is not registered with the normal
asset build, Supply Market, or gameplay. `SOCKET_mount` is an origin for placing
the visual in a game scene (+Y forward and +Z inward in Blender), not a physical
interface. The rail-facing surfaces are closed cosmetic approximations. The
vertical grip's bottom is a shallow exterior dish, not a storage compartment.

- **Magpul AFG-2, black (MAG414-BLK, raised insert):** use the [Magpul product
  gallery][magpul] for upper and installed obliques, the [Talos gallery][talos]
  for the bare raised-insert profile, [RepMart's side photo][repmart] for the
  visible slopes around the triangular opening, and the middle sample of the
  [Magpul comparison photographs][comparison] for the underside tread and shelf.
  Gallery feature 02 includes a flat-insert sample; its insert is not the
  reference for the raised nub. The rear raised-insert sample supports the
  contrasting polygonal center mark on the opposite face, not the whole
  face. The slope depth, narrow ends and remaining opposite-face details are
  photo-inferred.
- **Daniel Defense Vertical Foregrip, black Picatinny (21-067-05028-006):** the
  [manufacturer's profile][dd] and the two [POWAIR6 obliques][powair] show the
  flared shoulder, tapered overmold, narrow flute runs and scalloped cap.
  The [third-party unboxing][video] connects the SKU label (0:12) to the same
  unit's partly obscured narrow face (0:40.5), cap lip (0:42.5) and top exterior
  (0:57.5). The shoulder mark and directional tread are hand-modeled, not
  image textures. The base dish and closed crown approximate appearance only.

Reproduce from the repository root with the stock Blender version:

```sh
review=/absolute/path/to/review
for asset in afg2 dd_vertical; do
  blender -b -t 4 --python-exit-code 1 --python tools/blender/foregrips/build.py -- \
    "$asset" --output "$review/$asset"
  blender -b -t 4 "$review/$asset/$asset.blend" --python-exit-code 1 \
    --python tools/blender/foregrips/render.py -- --output "$review/$asset/renders"
done
```

Each bake produces an editable `.blend` and a standalone `.glb` with one mesh
primitive and one opaque material. Vertex colors distinguish the finish tints
without extra primitives or textures. Neither prop includes skinning or
animation. The review cameras render isolated side, oblique, underside and end
views without changing the saved scene.

## Weapon fit review

`fit-review.json` holds cosmetic seats and left-hand poses. `fit_review.py`
checks rail contact, the catalog accessories and laser ray, and sweeps stock
hands and mechanisms through the native clips. For the DD Vertical it checks
the deformed support and firing arms while the support hand stays on the grip.
The M590 mount and wrist follow the moving forend. MCX, MPX and AX338 seat on
`MOUNT_foregrip`; `poseFrom` shares the M4A1 grip rotation and finger wrap with
an independently positioned wrist on each model. Captures compare the bare
rail, the grip with the stock glove, and the fitted pose.

| Game model | DD Vertical Blender fit                        | AFG-2 Blender fit                                                       |
| ---------- | ---------------------------------------------- | ----------------------------------------------------------------------- |
| M4A1       | Idle and firing clips                          | Idle                                                                    |
| M590       | Idle and full pump stroke                      | Idle and full pump stroke                                               |
| EVOLYS     | Idle and firing clips, with TOR Mini clearance | Every full-span groove on the existing rail conflicts with the TOR Mini |
| MCX Virtus | Idle and firing                                | Not reviewed                                                            |
| SIG MPX    | Idle and firing clips                          | Not reviewed                                                            |
| AX338      | Idle, firing, and bolt cycle                   | Not reviewed                                                            |
| P320       | No support-hand seat                           | No support-hand seat                                                    |

After running `bun tools/build-assets.ts` and baking both props to their default
output locations (omit `--output` in the bake command above), run:

```sh
for model in m4:m4a1-block-ii/m4a1-block-ii m590:m590/m590 evolys:fn-evolys-762/fn-evolys-762 \
             mcx:mcx-virtus/mcx-virtus mpx:sig-mpx/mpx ax338:ax338/ax338; do
  weapon=${model%%:*}
  asset=${model#*:}
  blender -b -t 4 ".cache/blender/weapons/$asset.blend" \
    --python-exit-code 1 --python tools/blender/foregrips/fit_review.py \
    -- "$weapon" --renders ".cache/foregrip-review/$weapon"
done
```

These are Blender-only fits; the stock wrists and gameplay are unchanged.
The MCX stock clears the mounted prop as it folds but crosses the fitted sleeve
if the hand stays on. Stock fold, draw, holster, reload and inspect need
release and regrip review in the runtime viewmodel before enabling a pair.

[magpul]: https://magpul.com/afg-2-angled-fore-grip.html
[talos]: https://www.talosdefense.com/parts-upgrades/grips-stocks/magpul-angled-fore-grip-gen-2-afg2
[repmart]: https://repmart.jp/upload/save_image/4_mpmag414blk_600.jpg
[comparison]: https://jerkingthetrigger.com/2014/11/21/magpul-afg-comparison-images/
[dd]: https://danieldefense.com/daniel-defense-vertical-foregrip.html
[powair]: https://www.powair6.com/en/foregrip/13425-daniel-defense-vertical-foregrip-black-picatinny.html
[video]: https://www.youtube.com/watch?v=OJ85sPgbQIU

# Iron sight fits

The Supply Market's **Sight** menu has one active choice. Default sights are
free; alternate irons use the weapon's physical sight axis rather than an
optical overlay or magnification. Choosing a sight never changes the weapon's
ballistic tuning. Drafts change only the inspection model until confirmed.

| Weapon       | Default                                             | TROY alternate fit                                                                                  |
| ------------ | --------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| SIG MPX      | Factory-style folding peep and guarded front post   | Yes. The pair replaces the deployed set at two grooves on its continuous top rail.                  |
| MCX VIRTUS   | Folding aperture and protected post                 | Yes. The stock leaves, feet and hinges stay together in the default or optic state, not under TROY. |
| EVOLYS       | Game-authored rail aperture and guarded post        | Yes. Both feet seat on its top rail; the kit clears the feed cover and charging controls.           |
| AX338        | Game-authored rail aperture and guarded post        | Yes. Both feet seat on its top rail; the kit clears the bolt and the authored hands.                |
| M4A1         | A2 front tower/post, MaTech rear                    | No. Keeps the A2/MaTech pair as its only iron-sight setup.                                          |
| P320 Compact | SIGLITE square-notch, three-dot pair                | No. Keeps the stock slide sights; there is no alternate or optic.                                   |
| M590         | Integrated low ghost ring and protected front blade | No. The receiver optic rail has no matching forward seat at the barrel-mounted blade.               |

## TROY art and review

The modeled variants are the black [Di-Optic folding rear SSIG-DOA-RFBT-00][rear]
and [HK folding front SSIG-FBS-FHBT-00][front]. Their aiming faces follow
TROY's straight-on C01 frames ([rear][rear-face], [front][front-face]), with
exact-SKU retailer listings ([rear][rear-envelope], [front][front-envelope]) as
checks on overall width and deployed height. The photos establish relative face
proportions, not part depths. The rear rail
seat and aim axis are game datums. The shared Blender source
[`troy_sights.py`](../tools/blender/troy_sights.py) makes original, static exterior
game art, not manufacturer geometry or usable hardware. It models the through-diamond,
wide protective rear ears, and the HK front's two curled open ears and separate
post. Each host supplies its own rail seats and finish palette. No toggle, internal
mechanism, photographic texture or new runtime attachment loader is used.

After `bun tools/build-assets.ts`, run the [TROY clearance check](../tools/blender/check_troy_sights.py)
on each fitted host's generated `.blend`. The saved previews show the stock
sights; to inspect TROY in Blender, hide the mesh children of `IRON_sights` and
show the mesh children of `IRON_troy`. The check tests the actual source meshes
and samples deformed review hands and moving parts across the native clips.
Compare both full-frame views at unchanged default FOV; for example:

```sh
bun tools/capture.ts --weapon=smg --shot=ads --out=/tmp/mpx-default.png
bun tools/capture.ts --weapon=smg --sight=troy --shot=ads --out=/tmp/mpx-troy.png
```

[rear]: https://worldoftroy.com/product/dioptic-folding-sight-blk/
[front]: https://worldoftroy.com/product/hk-folding-sight-blk/
[rear-face]: https://worldoftroy.com/wp-content/uploads/2023/11/SSIG-DOA-RFBT-00_01_R01_C01-scaled.jpg
[rear-envelope]: https://www.wingtactical.com/accessories/optics-sights/sights/troy-industries-doa-di-optic-aperture-folding-rear-battlesight/
[front-face]: https://worldoftroy.com/wp-content/uploads/2023/11/SSIG-FBS-FHBT-00_01_R01_C01-scaled.jpg
[front-envelope]: https://www.wingtactical.com/accessories/optics-sights/sights/troy-industries-hk-style-folding-front-battle-sight/

## M590 suppressor

The default ghost-ring line is open bare but blocked by the mounted expansion
can. RMR, EXPS3, ACOG and PM II all aim above the can, with or without the TOR
Mini laser. Selecting the can does not select an optic automatically; the market
warns when the draft retains the blocked default sight. A contrasting front
stripe does not restore the occluded line. The [M590 source check](../tools/blender/m590/muzzle.py)
probes the actual mounted meshes and aiming rays; the current model and fits
remain unchanged.

# TROY iron sight fits

The Supply Market's **Sight** menu has one active choice: free default irons,
the TROY set on compatible weapons, or an optic. TROY uses physical aiming
geometry without extra zoom or stat changes. Drafts change only the inspection
model until confirmed.

| Weapon     | TROY fit                                                       |
| ---------- | -------------------------------------------------------------- |
| SIG MPX    | Both feet use grooves on its continuous top rail.              |
| MCX VIRTUS | TROY replaces the stock leaves, feet and hinges.               |
| EVOLYS     | The top-rail pair clears the feed cover and charging controls. |
| AX338      | The top-rail pair clears the bolt and the authored hands.      |

The M4A1, P320 Compact and M590 do not offer TROY.

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

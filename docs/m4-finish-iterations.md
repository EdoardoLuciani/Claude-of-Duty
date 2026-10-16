# M4 Blender material iterations

Follow-up requested after #432's single-coat experiment: try several material
revisions and inspect actual Blender renders. These studies are **not shipping
material changes**, and are independent of the original-aperture restoration.

## Assessment

**The balanced third revision is the best direction of these trials.** It has a
darker body and a better-defined highlight than the original, with clearer
separation from the textured polymer. It looks more like coated metal to me,
without the strongest revision's polished appearance. This is a visual judgment,
not a measured realism score or certification of Colt anodizing.

The result is improved, not finished photorealism. Large planar faces, simplified
shape transitions and the remaining surface pattern still identify it as a game
asset. I would not try to hide those limitations with chrome-like reflections,
painted edge highlights or stronger clearcoat. A gameplay export/capture gate is
still needed before adopting the materials: studio lighting is not gameplay.

## Trials, in order

All roughness values below are **factors multiplying the existing roughness
texture**, not final pixel roughness. Metalness is unchanged: metals 1, polymer 0.
No coat was added. Geometry, UVs, pose, camera, exposure, lights and color pipeline
are identical between variants within each view.

| Variant             | Receiver roughness | Receiver normal strength | Receiver linear RGB | Result                                                                                      |
| ------------------- | ------------------ | ------------------------ | ------------------- | ------------------------------------------------------------------------------------------- |
| Baseline            | .68                | .12                      | .041/.047/.053      | Soft, broad response; weak finish distinction                                               |
| Roughness-only      | .46                | .12                      | unchanged           | Clearer metallic highlight, but shared cloudy texture becomes more apparent                 |
| Stronger separation | .38                | .08                      | .045/.046/.048      | Dark body / narrow bright highlight; too polished for my preferred black-hardcoat direction |
| Balanced refinement | .44                | .08                      | .041/.043/.046      | Better compromise; less blue and less polished, with restrained cloudy albedo variation     |

The stronger revision also uses roughness/normal factors: FDE **.48/.12**,
polymer **.82/.35**, steel **.50/.12**, magazine **.60/.14**. The polymer loses too
much of its molded texture in that trial.

The balanced revision backs those off to FDE **.56/.16**, polymer **.80/.55**,
steel **.56/.16**, magazine **.67/.18**. Receiver albedo texture deviations from
its mean are scaled to **25%** on a private image copy; the mean and UVs are
preserved. The original image is not mutated. This is a DCC texture experiment,
not yet an exported/reviewed replacement texture. Rubber, markings, green sight
paint, cartridge materials and the restrained-wear material remain unchanged.

## Evidence and reproduction

`tools/spikes/m4-finish-blender.py` opens the committed source via Blender CLI,
changes selected material-node inputs in memory, renders and exits **without
saving the blend**. It follows the linked roughness multiplier, rather than
changing an unused Principled default underneath a connected texture.

```sh
blender -b assets/weapons/m4a1-block-ii/m4a1-block-ii.blend \
  --threads 16 --python-exit-code 1 \
  --python tools/spikes/m4-finish-blender.py -- \
  --variant balanced --out /absolute/new-output-directory
```

Repeat with `baseline`, `roughness` and `separated`. Each produces the full rifle
and receiver close-up under the saved studio lighting, then the same close-up
under white area lights. Full frames and exact per-variant settings are saved.

- Twelve actual **Blender Cycles CPU** renders: 1600×1000, 96 samples, denoising,
  seed432, max8 bounces. No AI image generation and no game screenshot substitutes.
- AgX / Medium High Contrast, exposure **−2.1**, unchanged between variants.
- Source SHA256: `e7a971779cb01d170e3232d9877f0c8a3dd9b0818deadfb5d638386ef2bce1a4`.
- Machine-local Blender5.2.2 has an incompatible installed OCIO2.5 config versus
  library2.4.2. These renders explicitly use the official **Blender v4.5.3 OCIO
  configuration and its referenced LUTs**, via the process-local `OCIO` variable.
  No disabled-color-management frames are accepted. This does not modify system
  configuration or imply Blender/game AgX implementations are identical.
- Raw PNGs, logs and JSON inventories:
  `/home/edoardo/Documents/Claude-of-Duty-recovery/issue432/iterations/`.
- Real-material/reference caveats remain those in `m4-finish-spike.md`; these
  revised values are artist-directed trials, not measurements from photos.

**Recommendation:** show the balanced candidate for visual review, then test it
through normal authored export in the real game if selected. Do not silently
replace the accepted runtime asset based only on studio renders.

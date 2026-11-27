# Streamlight TLR RM 1 Laser-G (HPL)

Editable exterior reference model for [#506](https://github.com/EdoardoLuciani/Claude-of-Duty/issues/506). The barrel band, offset laser window, rail saddle, selector, pressure pad and markings are built in Blender. Surface finishes are procedural and the markings are original vector geometry; no product photo, downloaded mesh, font file or texture is required. The cable plug is hidden by default and only included to match one manufacturer photo.

## Build and review

From the repository root with Blender 5.3.0:

```sh
blender -b -t 8 --python-exit-code 1 --python tools/blender/tlr_rm1/build.py -- --render
blender .cache/blender/attachments/tlr-rm1/tlr-rm1.blend
```

`--output /tmp/tlr-rm1-review` writes to a scratch directory. `--quick` lowers render resolution and samples, not modeling detail. The output contains the editable `tlr-rm1.blend` and, with `--render`, eight standalone inspection views and an additional rear comparison with the plug visible. The studio and plug are separate collections; they are not part of the standalone module.

## Scale and references

- [Manufacturer fact sheet](https://www.streamlight.com/docs/default-source/fact-sheet/369.pdf?Status=Master): **92.5 mm long × 30.0 mm wide × 38.1 mm high**. The recipe checks the evaluated standalone envelope before saving. Model space uses metres, +Y toward the lamp and +Z toward the saddle. Use the HPL dimensions; the launch-era housing/face-cap assembly was shorter.
- Compare `profile-right.png` to [official photo 03](https://www.streamlight.com/images/default-source/product-large-images/tlr-rm-1-laser-g-rail-mounted-lighting-system/tlr-rm-1-laser-g_03.jpg?Status=Master&sfvrsn=f29f01f3_47), `front-quarter.png` to [photo 02](https://www.streamlight.com/images/default-source/product-large-images/tlr-rm-1-laser-g-rail-mounted-lighting-system/tlr-rm-1-laser-g_02.jpg?Status=Master&sfvrsn=e89f01f3_43), and `rear-quarter-with-plug.png` to [photo 04](https://www.streamlight.com/images/default-source/product-large-images/tlr-rm-1-laser-g-rail-mounted-lighting-system/tlr-rm-1-laser-g_04.jpg?Status=Master&sfvrsn=c59f01f3_43). Cameras are estimated from the photos. The orthogonal front, rear, left, top and underside renders are inspection views, not independently calibrated to manufacturer drawings.
- Internal parts are not modeled. Individual radii, the cosmetic optical surfaces, the saddle and control details are exterior estimates from photos, not manufacturer CAD or verified fit.

This is the detailed authoring source. It generates no runtime GLB and changes no existing attachments, weapon fits or gameplay. Runtime material baking, triangle/draw-call reduction and in-game fit checks are separate work.

# EOTECH EXPS3-0 — Blender-authored attachment asset

Black EXPS3-0 with the transverse CR123 housing, flared protective hood,
left-side NV/brightness controls, right-side windage/elevation adjusters,
captive scalloped cap, raised quick-detach mount and separate optical windows.
**Asset-first visual-review candidate**, not a gameplay attachment or a certified
1:1 engineering model. The M4, market, economy and equipped loadout are unchanged.

## Products and authority

- [`../../../tools/blender/exps3.py`](../../../tools/blender/exps3.py) is the
  source of truth. It constructs native Blender geometry/materials from a
  factory-empty scene; no prior blend, purchased model, scan or CAD is an input.
- `exps3-0.blend` contains separately editable components, actual machined Torx
  recesses, packed original finish maps, seven review cameras and the studio.
  It is saved **before** consolidating runtime copies. Blender 5.2 uses Zstandard
  compression; open it normally in Blender 5.2.2.
- `exps3-0.glb` is the stock native glTF export: **36,371 triangles, 11 primitives,
  10 PBR materials, two embedded 1024² maps, 4,013,976 bytes**. No studio, external
  asset URL, animation, arms or baked reticle is exported.
- `finish-normal.png` and `finish-roughness.png` are seeded original micro-finish
  maps, also packed/embedded in the blend/GLB. Reference photos are not textures.
- `manifest.json` records source/product hashes, budgets, axes and datums.
  `reference-review.json` records source URLs, photo hashes, frozen cameras,
  profile measurements, repeat-build evidence and limitations.

## Reference/profile review

Primary references:
[EOTECH product specifications and gallery](https://www.eotechinc.com/products/eotech-hws-exps3),
[EOTECH operator manual, OpticsPlanet mirror](https://www.opticsplanet.com/i/pdf/opplanet-eotech-exps3-manual.pdf),
and [higher-resolution product photos](https://www.militia-armory.com/product/eotech-exps3-0-holographic-weapon-sight/).

The manual/product page establish the nominal **96.5 × 58.4 × 73.7 mm** L/W/H
and the 68 MOA ring / 1 MOA dot variant. The manual's display-window section gives
**30 × 23 mm**, **3.17 mm front glass** and **4.76 mm rear laminate**. Its parallel
1.20 × 0.85 inch window listing is not an exact conversion; this model uses the
stated metric aperture. The glass pieces have actual thickness and share the
attachment root, so later removal need not leave floating panes behind.

Side, front, rear and top comparisons use estimated orthographic cameras with
one uniform scale per photo, not independent X/Y stretching or per-part alignment.
The camera poses are frozen in the source and review JSON. Filled-silhouette IoU
is descriptive only: **left .93545, right .91971, rear .90348, front .91590,
top .93731**. Alpha >250 excludes faint photo shadows; enclosed holes are filled
for this external-profile statistic. It does **not** assess the optical aperture,
small details, material fidelity or certify 1:1 accuracy. The smoke test separately
casts rays through a genuinely open carrier/window bore.

EOTECH's photos retain their original ownership and are not committed or embedded.
The original geometry, procedural finish and reconstructed vector markings are
not extracted photographic texture maps. EOTECH identifies the reference subject;
no endorsement is implied. Lettering uses Blender's bundled font, not an assertion
that the manufacturer's original typeface has been reproduced exactly.

## Coordinates and future M4 handoff

Native metres throughout. Blender: **+X right, +Y forward, +Z up**. Export:
**+X right, +Y up, −Z forward**; no runtime scale/axis correction is required.
All mesh parts and the following datums descend from `ATTACHMENT_exps3`:

| Node | Exported local position (metres) | Meaning |
| --- | --- | --- |
| `SOCKET_mount` | `[0, 0, 0]` | Rail-top datum, central receiver mounting region |
| `SOCKET_sight` | `[0, .046, .0231]` | Provisional optical centre at rear external surface |
| `SOCKET_lens_rear` | `[0, .046, .0231]` | Rear laminate external surface centre |
| `SOCKET_lens_front` | `[0, .046, -.0181]` | Front glass external surface centre |

The measured visual envelope is **58.540 × 73.700 × 96.470 mm** W/H/L. The raised
cap marking contributes 0.14 mm over the rounded nominal width; length is 0.03 mm
under nominal. These are measured art dimensions, **not** installation tolerances.
The jaw/channel geometry is a visual Picatinny approximation, not manufacturing data.

**The 46 mm rail-to-optical-centre datum is photo-derived and provisional.** The
published envelope does not certify it. Confirm mount height, rail seating,
rear-sight clearance, co-witness and sight picture against the M4 when implementing
ADS; do not silently turn this candidate datum into an approved gameplay alignment.
The 68/1 MOA reticle is metadata only. A holographic reticle must be projected in
runtime optics, not baked as a floating mesh that is visible from the front.

Hidden internals, holographic laminate/laser, exact threads and optical curvature
are not reconstructed. Glass uses a neutral AR-tinted PBR approximation rather
than spectral coating simulation. Runtime optic/reticle behavior, pricing and
weapon-specific run purchases are a subsequent PR, after human visual review.

## Rebuild and checks

Follow [the shared authoring workflow](../../../tools/blender/README.md).
From the repository root, with **Blender 5.2.2** and working AgX color management:

```sh
# Scratch first; no generated products are used as build inputs.
blender -b -t 8 --python-exit-code 1 --python tools/blender/exps3.py -- \
  --output /tmp/exps3-review --render
# Regenerate committed products, without adding review PNGs to the asset folder.
blender -b -t 8 --python-exit-code 1 --python tools/blender/exps3.py
node tests/smoke/smoke-exps3.mjs
npm test
npm run lint
npm run build
npm run format:check
```

`--quick` lowers review samples only; geometry/maps and camera registration are
unchanged. Cameras are `left`, `right`, `front`, `rear`, `top`, `hero` and
`rear-quarter`. Normal game builds use committed products and require no Blender.
The asset is intentionally not mounted or imported by production runtime code yet.

Two fresh independent processes in empty output directories produced byte-identical
GLBs and finish PNGs, including a build that rendered all seven views and one that
did not render. The native authored UV lattice is fixed before saving/exporting;
there are no exporter hooks or post-export GLB repairs. This is same-host evidence,
not a promise of universal cross-platform floating-point identity.

On the authoring host, the installed Blender OCIO 2.5 configuration was incompatible
with its OCIO 2.4.2 library. A process-local official Blender 4.4.3 configuration
with AgX and the installed `luts/`/`filmic/` was used via `OCIO`; see its URL/hash
in `reference-review.json`. Color management was not disabled, and the fixed
studio/cameras/exposure were preserved for initial/final comparisons.

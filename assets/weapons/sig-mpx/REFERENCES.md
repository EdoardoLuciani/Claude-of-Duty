# MPX reference authority — Gate 1 approved

The design interview approved the **labelled 8-inch base + separately sourced
accessories**, not exact-photo certification of the suppressed hero specimen.
Reference originals are disposable review inputs and must not become textures,
shipped artwork or committed manufacturer PDFs. All mesh/PBR work is original.

## Source matrix

| Source | Page / view | Authority | Not authority for |
| --- | --- | --- | --- |
| [SIG 2019 Defense catalog](https://www.sigsauer.com/pub/media/sigsauer/resources/2019_DEFENSE_CATLOG_web.pdf) | Printed p.23 / PDF p.25, labelled `SIG MPX 8” SBR` inset | Chosen 8-inch base exterior, stock deployment, five-slot M-LOK handguard, magazine, folded irons, ROMEO4T placement | Unpublished widths/depths or exact suppressor-equipped overall length |
| Same catalog | Printed pp.22–23 / PDF pp.24–25, large suppressed photo | Receiver/stock/grip/optic/SRD9 surface-feature detail | Certification that the hero specimen has the chosen barrel/handguard; copying its handstop or suppressor overlap |
| Same catalog | Printed p.43 / PDF p.45 table | `MIL-SRD9-MPX`, **175 × 35 mm with mount**; 9 mm, titanium outer tube/stainless baffles | Substitution of a generic pistol SRD9 or hidden functional mount/baffle geometry |
| [SIG 2021 LE catalog](https://www.sigsauer.com/media/sigsauer/resources/2021_LE_CATALOG_DEL.pdf) | Printed p.15 / PDF p.16 | Labelled 8-inch/4.5-inch product descriptions, material/detail reference | Identifying the large suppressed hero's barrel solely from the page heading/caption |
| Same catalog | Printed p.16 / PDF p.17 | Opposite-side base/profile, factory folding/telescoping stock, magazine, charging handle, folded iron/component detail; distinguishes 8-inch SD and 4-inch guards | Assuming an SD handguard means an 8-inch **barrel** or treating unseen contours as measured |
| [MPX operator manual, REV02](https://www.sigsauer.com/media/sigsauer/resources/OPERATORS__MANUAL_MPX_1811295-01_REV02_LR.pdf) | PDF pp.26–28 | Left/right control identification, rear ambidextrous charging handle and assemblies | MP5-style side cocking tube; exact selected specimen finish/dimensions |
| [ROMEO4T product page](https://www.sigsauer.com/romeo4t-1x20-mm.html) | Photo + published specifications | Non-PRO exterior; **85.5 × 46 × 63.5 mm** envelope; 20 mm clear aperture; 1.41-inch mount without optional spacer | ROMEO4T-PRO geometry or undocumented measurement datums |
| [ROMEO4T manual](https://www.sigsauer.com/media/sigsauer/resources/7402901-01_R00.pdf) | PDF p.5 / printed p.8; PDF p.7 / printed pp.12–13 | Selectable quad-reticle modes; published **2 MOA** dot; accessory dimensions/features supplementary to product page | Equating overall accessory envelope to body-only length or optical-axis height; certifying photographic brightness/blur |

The reference board uses these sources as five labelled panels. It is stored
locally at `.tmp-rend/mpx/references/reference-board.png` and attached to the PR,
not maintained as licensed game artwork.

## Correction to initial search results

Initial search summaries treated the suppressed hero photo as an explicitly
identified 8-inch **barrel** configuration. Inspection of the actual rendered PDF
pages did not establish that. This inference was withdrawn before modelling.
The user approved the labelled 8-inch base plus separately sourced ROMEO4T/SRD9
assembly and the documented exclusions. Do not restore the earlier claim in a
README, manifest or review caption. The 2019 table even prints `114 mm / 8.0”`
for MPX K; that unit inconsistency is not a usable modelling datum.

## Frozen configuration and review exclusions

- Labelled p.23 inset is the primary base; do not mix a short barrel with an
  extended SD guard to match the unrelated large hero silhouette.
- Replace flash hider with MPX-specific SRD9 at the true barrel endpoint; that
  change is excluded from **base-gun** photo silhouette scores and reviewed
  separately with accessory envelope checks. Do not exclude barrel/handguard
  mismatches from their own review regions.
- Keep the deployed folding/telescoping stock in the primary base pose and both
  factory backup irons folded. Use the photo's ROMEO4T placement, clear caps
  open, 1.41-inch mount with no extra spacer. Mount datum height is distinct from
  the optic's 63.5 mm overall envelope.
- Omit the hero handstop, as explicitly selected. Grip the handguard directly.
- Preserve base-photo magazine silhouette as a 30-round physical magazine; the
  game's capacity will change to 30 instead of inventing a 32-round exterior.
- Fixed-view comparison uses a single uniform scale and fixed registration;
  no independent X/Y fit, elastic warp, after-only camera changes or hidden
  exclusions to inflate a score. Whole gun RGB difference is not a fidelity
  metric without matched lighting and exposure.

Nominal barrel convention: **203.2 mm**, breech face to barrel crown, excluding
suppressor/mount. Publisher rounds to 203 mm. Base catalog overall length is a
cross-check, not an independently verified datumed CAD measurement; inferred
barrel seating, mount overlap and receiver width must remain visible caveats.

## Inferred / unverified details

Opposite-side contours/depths, wall thickness, exact small relief radii,
receiver internals visible through port, stock/grip moulding depth, magazine
translucency/loaded-round appearance, microscopic finish and exact typography
are not recovered manufacturer data. Light wear is authored, not a clone of a
unique physical specimen. Never copy the photographed optic's unique serial.
Manufacturer/model/control text can identify the subject; trademark permission
is not supplied by these links. No functioning barrel threads, chamber, fire
control or suppressor baffles are deliverables.

## ROMEO4T optical-depth audit — staged correction

The [original ROMEO4T manual](https://www.sigsauer.com/media/sigsauer/resources/7402901-01_R00.pdf),
PDF p.7 / printed pp.12–13, dimensions the **closed cover assemblies** at
84.6 mm overall. The approved product-page figure is 85.5 mm; the older
[2017 original-family sheet](https://d7rh5s3nxmpy4.cloudfront.net/CMP755/files/2/ROMEO4_SELL_SHEET_17.17.17_LR.pdf)
lists 85.7 mm for 4T. These sources differ slightly; none is a dimensioned
optical section, and PRO dimensions must not be substituted.

Read-only Blender MCP inspection found the previous bare tube was 85.5 mm,
its sheet spacing 79.5 mm and its virtually closed rims 93 mm apart. Including
the bridges gives 94 mm. Thus the overall dimension was incorrectly used as
body-only length. The staged source now measures 85.5 mm over **all** evaluated
closed-cap meshes, independently checked again in the committed GLB.

The manufacturer's side/end drawings support a shorter body, thinner ocular
rim and larger side battery cap relative to that body. The staged 70 mm housing,
27 mm rim diameter and 26 mm battery cap are drawing-guided approximations,
not independently dimensioned manufacturer numbers. Covers retain their
approved open angles and mount height; the published clear aperture remains
20 mm. Lens sheets are placed 3 mm inside the bare ends (64 mm apart), **an
explicit inference**. Available sources do not establish the actual lens-seat
positions, bore/baffle profile, refraction or exit pupil. Passing envelope tests
does not certify that this simple optical representation matches a physical 4T.

### Battery-cap thickness follow-up

The right-side part is the CR2032 battery cover, not a large adjustment knob.
The same original manual's end view shows a narrow cap rim over a longer battery
housing. Comparing its roughly 30-pixel axial band with the roughly 100-pixel
20 mm aperture in the rendered drawing supports approximately **6 mm thickness**;
the approximately 130-pixel cap height supports retaining **26 mm diameter**.
The manufacturer's [original top-view photo](https://www.sigsauer.com/media/catalog/product/r/o/romeo4t-top-new_5.jpg)
also shows a narrow knurled rim (roughly one-fifth of its diameter), not the
previous 12.4 mm thick disc. These are image-derived approximations, **not
published cap measurements**; drawing line thickness and photo projection limit
precision. Source now uses a 6 mm cap with the same outer face/overall width and
an attached, smaller neck. Diameter, lens/cover geometry and ADS tuning remain.

The earlier real aiming photograph is a ROMEO4S/CirclePlex, not the exact 4T
configuration. It guides presentation only; unknown camera distance, focal length
and foreground defocus prevent an exact photographic depth measurement.
No downloaded image, PDF or photographic texture is shipped in the asset.

## Download fingerprints

SHA-256 of reviewed inputs (the websites can replace PDFs in place):

```
2021 LE PDF      0754afb9b8418e4053a3ff5a7e52da935163d0728281cead5ee0968df8fad931
2019 defense    cf5a06d8fe47420d0c4c55a1802e216329b6137adc7d553b109972c07c9e0e24
MPX REV02       7569fcd4ddbec5e7ddc5506a79d2b65bb74322a2f8ad60e8f5cafa333517efbf
ROMEO4T manual  338b656d0f5a5eb3dfdc178c7c46092b41ec12090a30693f5c2a108ef16641f5
ROMEO4T photo   df56ee63b76ff77f28e30ec9caaf7bff7e077dae31fcdfa3437e3238a38da2cd
```

Product photo URL:
`https://www.sigsauer.com/media/catalog/product/r/o/romeo4t-hero-left-new_5.jpg`.
PDF reference images rendered with `pdftoppm -scale-to 1800 -singlefile -png`
and the one-based PDF page numbers above. Larger raster output does not recover
extra detail from the compressed catalog photographs.

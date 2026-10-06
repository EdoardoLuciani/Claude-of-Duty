# MPX reference authority — Gate 1 approved

Approved: labelled 8-inch base + separately sourced accessories, **not** exact-photo
certification of the suppressed hero. Original mesh/PBR work only; reference images/
PDFs are disposable review inputs, never shipped textures or manufacturer artwork.

## Sources

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

## Interpretation and exclusions

Use the labelled 2019 p.23 base inset. Inspection did not identify the large
suppressed hero's barrel length; the initial search-summary inference was withdrawn.
The same catalog's `114 mm / 8.0”` MPX K entry is inconsistent and unusable.
Do not substitute short barrel + SD guard to imitate the hero.

Keep deployed stock, folded irons, bare handguard, base-photo magazine silhouette,
ROMEO4T/open caps/1.41-inch mount without spacer. Replace flash hider with MPX SRD9
at the true barrel endpoint. Exclude that accessory difference from base-gun scores,
not barrel/guard errors from their own regions. Nominal barrel is 203.2 mm from
breech face to crown, excluding suppressor/mount; publisher rounds to 203 mm.

Review uses frozen uniform scale/registration, not independent X/Y fit, elastic
warping or after-only reframing. RGB depends on lighting/exposure. The local
reference board lives under `.tmp-rend/mpx/references/` and in PR attachments.

Depths, hidden seating, widths, wall thickness, reliefs, magazine translucency,
finish and typography remain inferred. Catalog overall length is not datumed CAD.
No copied specimen serials, trademark permission, functional threads/chamber/fire
control or suppressor internals are provided by these references.

## ROMEO4T uncertainties

Original manual PDF p.7 / printed pp.12–13 dimensions **closed covers** at 84.6 mm;
product page gives the approved 85.5 mm; [2017 family sheet](https://d7rh5s3nxmpy4.cloudfront.net/CMP755/files/2/ROMEO4_SELL_SHEET_17.17.17_LR.pdf)
gives 85.7 mm. None is an optical section; do not substitute PRO dimensions.
Current source/export checks measure 85.5 mm over all closed-cap meshes, correcting
the earlier body-only interpretation (93 mm rims / 94 mm bridges).

Drawing-guided, not independently dimensioned: 70 mm body, 27 mm rim, 26 mm battery
cap. The 20 mm aperture and approved mount/open angles stay fixed. Sheets 3 mm inside
each body end (64 mm spacing) are **inferred**; real seats/baffles/refraction/exit
pupil are unknown. Envelope tests do not certify a physical sight picture.

The CR2032 cover is not an adjustment knob. Manual drawing (~30-pixel band versus
100-pixel aperture) and [manufacturer top photo](https://www.sigsauer.com/media/catalog/product/r/o/romeo4t-top-new_5.jpg)
support a thin ~6 mm rim, not the old 12.4 mm disc. This estimate is limited by
line width/projection. Keep outer face/overall width and attached neck.
The earlier aiming photo is ROMEO4S/CirclePlex, not this 4T; unknown camera/defocus
make it presentation guidance only. Optic/final gameplay approval remains pending.

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

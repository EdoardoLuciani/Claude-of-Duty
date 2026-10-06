# Early Accuracy International AX338

Integrated review candidate; **human visual/reference sign-off remains pending**.
Original game art, not a scan, manufacturer CAD or certified replica. Technical
gates do not establish AAA quality, commercial branding permission or physical fidelity.

## Configuration and references

Early AX338/v02/12.10: .338 LM, 27-inch barrel, solid-carrier folding-stock exterior
(not AXMC A-frame), Dark Earth panels, black action/forend/barrel, factory brake,
10-round magazine, older PM II LP 5–25×56 and compatible AI-style one-piece mount.
No bipod; stock is not deployable. No copied specimen serial; text/turret layout
is approximate, not a calibrated optic.

Primary authority is the [early AX338 brochure](https://www.eurooptic.com/PDF/ax_brochure.pdf),
with [publicly available brochure text](https://www.scribd.com/document/207864701/Ax338-Brochure)
and its [public composite preview](https://imgv2-2-f.scribdassets.com/img/document/207864701/original/794e70b387/1?v=1).
The preview and specification text were inspected. Direct EuroOptic/Scopelist
PDF retrieval returned **429**, so the full-resolution original drawing/photo
pages were **not** inspected. The composite is only **768 × 1024**; its gun
profile is approximately 657 pixels long. Enlargement cannot recover detail.
This limitation is substantial, especially for stock relief, brake contour,
receiver transitions and fine hardware—not something the tests certify away.

The [Dutch-service photograph](https://commons.wikimedia.org/wiki/File:Accuracy_International_AX338_-_Dutch_Army.jpg)
is supplemental only: its loadout/production details do not override the early
brochure. It is attributed to Dutch Ministry of Defence / Jasper Verolme under
the Commons page's CC BY-SA 4.0 license; it is not shipped as a texture or asset.
The higher-resolution [service rail close-up](https://commons.wikimedia.org/wiki/File:AX338_netherlands_rail.png)
was inspected for KeySlot head/neck relief and panel ribbing. The
[service stock close-up](https://commons.wikimedia.org/wiki/File:AX338_netherlands_butstock.png)
shows a **different A-frame stock** and was rejected as authority for the locked
solid-carrier stock. Neither service photograph proves early-production dimensions.
Renewed full-brochure downloads (including alternate paths/mirrors) still returned 429.

Optic references: [older PM II LP listing](https://www.schmidtundbender.de/en/5-25x56-PM-II-LP-P4FL-1cm-ccw-DT-ST),
[2018–19 catalog](https://blog.scopelist.com/wp-content/uploads/2018/09/Schmidt-Bender-Catalog-EN-2018-2019.pdf),
and [AI mount listings](https://www.opticauthority.com/accuracy-international-accessories-scope-mounts.aspx).
Search-indexed older catalog specifications report **417 mm / 34 mm**; direct
catalog download returned **403**, so these are provisional catalog-listed
anchors, not inspected dimension-drawing proof. Do not substitute the revised
420 mm PM II. AI accessories literature points to a compatible 34 mm one-piece
mount (5656); exact mount relief, height and inclination have not been verified
or reproduced as certified 5656 geometry. Mount/cap/turret depth and hidden
contours remain inferred. No factory loadout claim is made for the assembled
optic/mount. Original reference images remain disposable review inputs, never
committed or shipped.

### Measurement ledger

| Datum | Authoring value | Evidence / confidence |
| --- | ---: | --- |
| Barrel length | 685.800 mm | Brochure says 27 in / 686 mm; exact inch conversion used, millimetre listing treated as rounded. |
| Overall exterior length | 1250 mm | Brochure specification; brake inclusion/stock adjustment datum is assumed, not independently calibrated. |
| Forend length | 406 mm | Brochure offers 406 / 330 mm; long depicted configuration selected, endpoint placement inferred. |
| PM II housing length | 417 mm | Provisional older-catalog anchor; full dimension drawing not retrieved. |
| Main optic tube diameter | 34 mm | Older-catalog/mount listings; provisional until primary drawing review. |
| Magazine body H × L × W | 105 × 104 × 34 mm | Provisional exterior reconstruction, not verified early-AX338 manufacturer dimensions. Floorplate is 107 × 38 mm; feed-lip-to-floor envelope is 112.5 mm high. |
| Visible cartridge overall length | 93.5 mm | Standard .338 LM visual envelope; fits the 104 mm body. The [period magazine article](https://precisionrifleblog.com/2012/12/13/detachable-magazine-dimensions-max-coal/) reports 3.764 in (95.61 mm) **interior COAL**, not an exterior AX338 drawing. |
| Action/stock/grip/magazine/brake depths | Inferred | Preview silhouette plus plausible component scale, not published manufacturing dimensions. |
| Bolt lift / rear travel | 60° / 100 mm | Visual animation datums; travel is inferred, not verified mechanism engineering. |

## Source/runtime contract

- `ax338.blend`: editable components, packed original maps, NLA actions and preview arms.
- `ax338.glb`: runtime weapon/sockets/ammo controls; no duplicate arms/casing.
- `manifest.json`: export statistics, events and saved-mesh magazine envelopes.
- `hand-reference.json`: fitted hand inputs; `grip-profile.json`: independent
  front/rear photo-traced contours; `photo-review.json`: frozen registration/
  exclusions/reference fingerprint, not a photograph.

`src/weapons/ax338.js` samples native mechanisms/wrists/fingers; shared skins/IK,
ADS, locomotion sway and reactive recoil remain. Nine clips: Idle, Fire, Last Shot,
Bolt Cycle, Tactical/Empty Reload, Inspect, Draw, Holster.
Preserve 1.1 s cycle, 2.8/3.6 s reloads, 3.6 s inspect, .88 s draw, .56 s holster
and all balance/scope/FOV/event values. Last-round ejection at .05 s without
manual cycle and empty-reload chambering at insertion are retained gameplay
simplifications. Reset/switch/death must not restore spent ammo. One pooled case
per shot; magazines drop through existing physics.

Export: 100,697 triangle instances / 30 primitives / 8 materials / three 1024²
images / 9,989,960 bytes. Caps: <150k triangles, ≤48 primitives, ≤18 materials,
three 1024² maps, ≤15 MiB. Normal builds need no Blender; procedural sniper
builder is historical test material, never a runtime fallback.

## Rebuild and review

From repository root, Blender 5.2.2 and installed Node dependencies:

```sh
npm run models  # supplies the actual shared runtime arm skin for offline fitting
# Export geometry/contact sections first, then fit hands, then bake final actions.
blender -b --threads 8 --python-exit-code 1 --python tools/blender/ax338.py
node tools/ax338-hand-reference.mjs
blender -b --threads 8 --python-exit-code 1 --python tools/blender/ax338.py
blender -b assets/weapons/ax338/ax338.blend --python-exit-code 1 \
  --python tools/blender/ax338_check.py
blender -b assets/weapons/ax338/ax338.blend --python-exit-code 1 \
  --python tools/blender/ax338_contact.py -- --out .tmp-rend/ax338/contact.json
blender -b assets/weapons/ax338/ax338.blend --python-exit-code 1 \
  --python tools/blender/ax338_contact.py -- --side right \
  --part 'Pistol grip spine' --part 'Grip stipple' --part 'Grip screw' \
  --part 'Tan trigger guard' --part 'Curved trigger' --part 'Receiver stock mount' \
  --part 'Stock hinge' --part 'Stock carrier' --part 'Hinge' \
  --part 'Steel flat-bottom action' --out .tmp-rend/ax338/right-contact.json
node tests/smoke/smoke-ax338-contact.mjs
npm test
npm run lint
npm run build
node tests/e2e/check-ax338-game.mjs --port=5221 --out=.tmp-rend/ax338/game
```

Regeneration overwrites manual source edits. Original geometry and PBR fields
are generated offline in Blender; no downloaded geometry/maps. Source and
runtime use the same UVs; original maps are packed/embedded, not maintained as
duplicate PNGs. Blender exports are not guaranteed byte-identical across versions.
On this machine the system OCIO 2.5 config cannot load in its linked OCIO 2.4.2
library. Set `OCIO` to a **complete compatible Blender 4.5 colormanagement folder's
config.ocio** for authoring/reviews. This is local offline tooling, not a game
color-management or dependency change. Reviews explicitly use Eevee rasterization,
ray tracing off, 48 samples, AgX. Do not compare with another backend/lighting.

```sh
blender -b assets/weapons/ax338/ax338.blend --python tools/blender/ax338_review.py \
  -- --out .tmp-rend/ax338/after
blender -b assets/weapons/ax338/ax338.blend --python tools/blender/ax338_review.py \
  -- --photos --out .tmp-rend/ax338/photo-after
# Same saved-source studio/backend and registration for the old GLB + seats.
blender -b assets/weapons/ax338/ax338.blend --python tools/blender/ax338_review.py \
  -- --photos --baseline OLD_SNIPER_GLB --out .tmp-rend/ax338/photo-before
python3 tools/ax338-photo-diff.py --photos REF_DIR \
  --before .tmp-rend/ax338/photo-before --after .tmp-rend/ax338/photo-after \
  --out .tmp-rend/ax338/diff
blender -b assets/weapons/ax338/ax338.blend --python tools/blender/ax338_review.py \
  -- --reel --clip Reload_Empty --view right --hands --out .tmp-rend/ax338/reel
# Same actual-game test sequence with review-only old-builder substitution.
node tests/e2e/check-ax338-game.mjs --port=5221 --baseline=1 \
  --out=.tmp-rend/ax338/game-before
```

## Contact/geometry constraints and known limits

Preserve the accepted stock outline and hash-frozen PM II geometry. Grip front/
rear straps curve independently; heel, waist, neck and conforming stipple must
not regress to a straight loft. Physical receiver → adapter → hinge connections,
panel anchors, KeySlot openings and rail web have saved-surface checks.
Guard aperture (~31 mm) and trigger (~29 mm) are inferred exterior contours.
Magazine/cartridges must fit the physical open shell; sleeve reach keeps the
support grip under the panels. Offline hand fitting uses deformed skin samples,
not joint radii, with linear fitted spans to prevent Bezier overshoot.

Current holding-finger correction preserves rifle placement, index/thumb, left
hand and event timings. Middle/ring/little fingers close against the grip;
empty-reload wrist hold delays travel until release. Reproduce only that pass:

```sh
node tools/ax338-hand-reference.mjs --holding-only
blender -b --threads 8 --python-exit-code 1 --python tools/blender/ax338.py -- --hands-only
```

Recorded sampled evidence (not continuous collision certification):
- Right distal contact: max 1.297 mm gap in eight source poses and runtime hip/ADS,
  against a 4 mm gate; no inter-finger PIP/DIP intersections in those poses.
- **Known right-hand failure remains:** 115 violating skin/component samples over
  474 poses, max 3.256 mm depth against the unchanged 1 mm allowance. Index/trigger
  and transition failures remain. Passing smoke tests does not resolve this.
- Left source sweep: 474 poses at 30 Hz plus boundaries, max .903 mm overlap
  against a 1 mm soft-contact allowance; optic/cartridges/marking ink excluded.
- Runtime: 761 poses; conservative tube depth max .979 mm. Across 96 carried-mag
  poses, distal finger/thumb envelope gaps max .624/1.006 mm. Envelope contact is
  not a contact-patch/compression simulation; retain the longer test timeout,
  not reduced physical gates.
- Historical `d48b7bd` right-side max .590 mm **does not apply** to the current
  lowered-hand candidate. `7dcdc1a` had 125 violations; history is not acceptance.

Checks cover exact event parity, bolt contacts, visibility, spare transforms,
reset/interruption, live case counts, day/night/flashlight and scope integration.
`ax338_check.py` measures saved geometry, not unpublished manufacturer dimensions.
Close-ups hiding the support hand (`--hands --hand-side right`, `grip_wrap`) must
be labelled; actual-game/action reels retain both hands.

Use identical frozen cameras, uniform scale, ROI/exclusions and backend before/
after; no X/Y warp or after-only reframing. Two-anchor zero residual is constructed,
not calibration. Brochure ink/annotations contaminate broad mask IoU; RGB depends
on lighting. Legacy material remapping is approximate. Higher-resolution references,
all-angle contact and final visual review remain necessary. Lockstep milliseconds
are simulated time, not a GPU benchmark. Historical correction narratives are in Git.

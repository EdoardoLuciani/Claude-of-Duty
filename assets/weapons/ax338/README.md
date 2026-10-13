# Early Accuracy International AX338

Early AX338/v02/12.10, .338 LM/27-inch barrel, solid-carrier folding-stock
exterior (not AXMC A-frame), Dark Earth panels, factory brake, ten-round magazine,
older PM II LP 5–25×56/34 mm and AI-style mount. No bipod/deployable stock.
Original game art, not CAD/scan or certified replica; **human sign-off pending**.

## Reference authority and limits

[Early brochure](https://www.eurooptic.com/PDF/ax_brochure.pdf),
[public text](https://www.scribd.com/document/207864701/Ax338-Brochure) /
[768×1024 preview](https://imgv2-2-f.scribdassets.com/img/document/207864701/original/794e70b387/1?v=1),
[older PM II](https://www.schmidtundbender.de/en/5-25x56-PM-II-LP-P4FL-1cm-ccw-DT-ST) /
[2018–19 catalog](https://blog.scopelist.com/wp-content/uploads/2018/09/Schmidt-Bender-Catalog-EN-2018-2019.pdf),
[AI mounts](https://www.opticauthority.com/accuracy-international-accessories-scope-mounts.aspx).
Brochure/catalog downloads returned 429/403: full-resolution drawings weren't
inspected. PM II 417 mm/34 mm anchors are provisional indexed specifications,
not drawing proof; don't substitute revised 420 mm optic.
[Dutch rail detail](https://commons.wikimedia.org/wiki/File:AX338_netherlands_rail.png)
is supplemental; service A-frame stock isn't authority for the locked stock.

Construction: 685.800 mm face-to-crown barrel, 1250 mm overall, 406 mm forend;
magazine body 105×104×34 mm, 112.5 mm feed-to-floor envelope. Depths, stock/brake/
mount seats and optical layout remain inferred. Bolt lift/travel 60°/100 mm are
animation datums, not mechanism certification. References aren't shipped textures.

## Source/runtime contract

`ax338.blend/.glb`: packed source/export, `manifest.json`: events/mesh envelopes,
`hand-reference.json`: fitted trajectories, `grip-profile.json`: traced contours,
`photo-review.json`: fixed registration/exclusions. Native adapter is `ax338.ts`.
Nine clips, shared skins/IK/ADS/sway/recoil; no duplicate arms/live casing.
Preserve 1.1 s cycle, 2.8/3.6 s reloads and all balance/scope/FOV/event values.
Last-round ejection without manual cycle and empty-insertion chambering are
gameplay simplifications. Switching/death/reset must not restore spent ammo.
Caps: <150k triangles, ≤48 primitives, ≤18 materials, three 1024² maps, ≤15 MiB.

## Rebuild/check (root, Blender 5.2.2)

```sh
npm run models # supplies actual shared arm skin
blender -b --threads 8 --python-exit-code 1 --python tools/blender/ax338.py
node tools/ax338-hand-reference.mjs
blender -b --threads 8 --python-exit-code 1 --python tools/blender/ax338.py
blender -b assets/weapons/ax338/ax338.blend --python-exit-code 1 \
  --python tools/blender/ax338_check.py
blender -b assets/weapons/ax338/ax338.blend --python-exit-code 1 \
  --python tools/blender/ax338_contact.py -- --out .tmp-rend/ax338/contact.json
node tests/smoke/smoke-ax338-contact.mjs
node tests/e2e/check-ax338-game.mjs --out=.tmp-rend/ax338/game
```

Export geometry/contact sections before fitting hands, then bake final actions.
Regeneration overwrites manual edits; normal builds need no Blender.
`ax338_review.py` supplies saved-source photos/reels with Eevee, ray tracing off.
Match uniform registration/cameras/ROI/exclusions; don't hide hands in acceptance
reels or compare old Cycles frames. Local OCIO troubleshooting/history:
[#358](https://github.com/EdoardoLuciani/Claude-of-Duty/pull/358).

## Known issues and gates

**Right-hand failure remains:** 115 violating skin/component samples over 474
poses, up to 3.256 mm depth versus the unchanged 1 mm allowance, including index/
trigger and transitions. Passing smoke tests doesn't resolve it.
Preserve curved grip/stock connections, left skin/forend/magazine sweeps, bolt
contacts, exact events, spare transforms, visibility, interruptions and case counts.
Sampled contact envelopes aren't continuous clearance or physical compression
certification; retain the longer test timeout, not relaxed tolerances.

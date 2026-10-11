# FN EVOLYS 7.62

Tan/black 7.62 exterior, revised six-position non-folding stock, no irons/bipod;
RM06 Type 2 RMR/RM33 mount and inferred 100-round pouch. Original game art,
not scan/CAD or a certified/licensed replica. **Human visual sign-off pending.**

## References and datums

[FN right](https://fnherstal.com/app/uploads/STM7402-scaled.jpg) /
[left](https://fnherstal.com/app/uploads/STM7400-scaled.jpg) studio views,
[product](https://fnherstal.com/en/defence/portable-weapons/fn-evolys-762/),
[technical sheet](https://fnherstal.com/app/uploads/technical-data-fn-evolys-762-1.pdf),
[stock revision](https://fnherstal.com/en/news/fn-evolys-gets-ergonomic-changes-based-on-user-suggestions/),
[RM06](https://www.trijicon.com/products/details/rm06-c-700672) /
[RM33](https://www.trijicon.com/products/details/rm33).
Constructed barrel face-to-crown: 406 mm; retracted exterior: about 948 mm.
RM33 axis is 19.5072 mm above rail; clamp envelope isn't riser height.
Accessory loadout, unpublished depths/cloth and mechanism internals aren't certified.

## Source/runtime contract

`fn-evolys-762.blend/.glb` own packed source/export, `manifest.json` events/belt,
`hand-reference.json` fitted hands, `photo-review.json` frozen registration.
Eight native clips in `src/weapons/evolys.ts`; shared skins/IK/ADS/recoil remain.
Reloads open cover, replace pouch/belt and close; empty reload racks.
Keep all event/balance/chamber/+1 values and one live pooled case per shot.

Eight cartridges/links, one skin/three primitives, 12.7 mm pitch: finish the last
stroke, then stop. Only insertion restores spent belt; switch/reset/interruption
cannot resurrect it. Mirror native scale keys around mixer-cached constants.
Keep physical pouch/feed passages, curve/tail enclosure and synchronized DCC skins.
Caps: <150k triangles, ≤48 primitives, ≤18 materials, three 1024² maps, ≤15 MiB.

## Rebuild/check (root, Blender 5.2.2)

```sh
node tools/evolys-hand-reference.mjs
blender -b --threads 8 --python-exit-code 1 --python tools/blender/evolys_762.py
blender -b assets/weapons/fn-evolys-762/fn-evolys-762.blend \
  --python-exit-code 1 --python tools/blender/evolys_check.py
node tests/smoke/smoke-evolys.mjs
node tests/smoke/smoke-evolys-clearance.mjs
node tests/e2e/check-evolys-game.mjs --out=.tmp-rend/evolys/game
```

Regeneration overwrites manual edits; normal builds need no Blender.
`evolys_review.py` reviews saved source/photos/reels using Eevee, ray tracing off.
Match cameras/uniform registration/ROI/exclusions; no independent axis fitting.
Preserve stock joins, 120 mm head-envelope and sleeve/pouch clearance, pitch,
contacts/events, replacement-pouch and reset gates. Sampled envelopes aren't
all-state cloth/contact certification. Stock/grip/typography/finish need review.
Evidence: [#350](https://github.com/EdoardoLuciani/Claude-of-Duty/pull/350).

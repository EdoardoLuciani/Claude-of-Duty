# Floating / unsupported placement triage

Plan for every finding after **looking at the objects**, not just the numbers.
Decisions are **remove**, **keep**, or **change**. No world edits in this PR.

## How this was reviewed

1. Ran `tools/analyze-map-issues.mjs` (collision AABB) and
   `tools/analyze-prop-support.mjs` (mesh contact) on `develop` @ `8ff79b9`.
2. Captured **462** low-angle shots, one per suspicious result.
3. Recaptured all **42** `unsupported` props from the street and from the side.
4. Recaptured remaining misses with a pullback facade framing.
5. Judged each object from the image: is it in the air, on a balcony, on a
   window cornice, or on the ground?

Numeric status is a hint. The picture wins.

Collision AABB reported **0 floats** and **0 blocked doors** because it skips
`maxY > 3.2`. That is why balcony / roof problems never appear there. 829
AABB overlaps are authored clutter (wrecks, stalls, stacks) — keep.

Mesh contact: 3837 candidates, 3375 supported, **462 suspicious**.

## Visual decision rules

| Verdict | What the screenshot showed |
|---|---|
| **REMOVE** | Object in empty air. No balcony, cornice, roof or prop under it. Wall-stuck at 3–7 m, hanging off a corner, or over a terrace void. |
| **CHANGE** | A real seat is in frame (floor, balcony slab, cornice, crate below) and the object hovers above it. Snap Y down onto that seat. Or it is seated on a kit balcony but missing `support: 'balcony'`. |
| **KEEP** | Underside is on the seat. Includes thin window cornices (no support role in the kit), sandbag walls, tyre stacks, ground scatter, interior debris. Do not churn these. |

---

## REMOVE — 14 true mid-air props

Seen in the air with no seat.

### Over the west roof void (floating cisterns + clutter)

The cisterns themselves sit in empty air off the west facade. The listed
findings ride them or hang next to them. Delete the findings; do not reseat
onto a tank that is itself floating.

| ID | File | What the shot showed |
|---|---|---|
| `crate_b/0024` | west-side.js | Crate on a cistern hanging over the terrace void |
| `planter/0009` | west-side.js | Same cistern cluster, planter in the air |
| `planter/0010` | west-side.js | Cisterns floating off the wall, no slab |
| `planter/0011` | west-side.js | Same |
| `bucket/0014` | west-side.js | Bucket in the air next to the cisterns |

### Wall-stuck / sky

| ID | File | What the shot showed |
|---|---|---|
| `tyre_small/0027` | east-side.js | Small tyre isolated in the sky, nothing under it |
| `crate_b/0053` | west-side.js | Crate glued to a blank wall, no balcony |
| `box_card_b/0022` | north-street.js | Cardboard box hanging off the north-east corner |
| `bucket/0031` | east-side.js | Cistern / bucket hanging off the pink-building corner, no slab |
| `planter/0029` | north-street.js | Same corner, cistern in empty air |
| `jerry_can/0022` | east-side.js | Same cluster C as `bucket/0031` / `planter/0029` |

### West 1F wall cluster (camera never found a slab)

Every framing of this cluster hits a blank wall. 3.5 m gap, no balcony in
any neighbouring shot.

| ID | File |
|---|---|
| `crate_b/0019` | west-side.js |
| `tyre_small/0016` | west-side.js |
| `tyre_small/0017` | west-side.js |

### Detector miss, not in the 462

The west-void **water tanks / cisterns** that the crate and planters sit on
are themselves mid-air. They did not come out `unsupported` (likely wall
contact). Worth a follow-up pass on `water_tank` at y≈3.5–6.5 on the west
facade. Out of scope for this ID list.

---

## CHANGE — 84

### C1. Tag kit-balcony seating — 52 `review-balcony` + 12 misfiled `unsupported`

The 52 `review-balcony` shots all show the prop **on a balcony slab** (laundry,
railings, plaster). Contact is real. They only lack `support: 'balcony'`.

Add `support: 'balcony'` to:

**Already `review-balcony` (52):**
`box_card_b/0010`, `box_card_b/0011`, `box_card_b/0018`, `box_card_b/0019`,
`box_card_b/0020`, `box_card_b/0021`, `bucket/0007`, `bucket/0008`,
`bucket/0009`, `bucket/0010`, `bucket/0011`, `bucket/0018`, `bucket/0019`,
`bucket/0022`, `bucket/0023`, `bucket/0024`, `bucket/0025`, `bucket/0026`,
`crate_b/0026`, `crate_b/0032`, `crate_b/0056`, `jerry_can/0006`,
`jerry_can/0007`, `jerry_can/0009`, `jerry_can/0010`, `jerry_can/0013`,
`jerry_can/0014`, `jerry_can/0017`, `jerry_can/0021`, `planter/0005`,
`planter/0006`, `planter/0007`, `planter/0013`, `planter/0015`,
`planter/0018`, `planter/0021`, `planter/0022`, `stool/0009`, `stool/0015`,
`stool/0016`, `stool/0022`, `stool/0023`, `stool/0024`, `stool/0030`,
`tyre_small/0014`, `tyre_small/0015`, `tyre_small/0022`, `tyre_small/0023`,
`tyre_small/0024`, `tyre_small/0028`, `tyre_small/0029`, `tyre_small/0030`

**Misfiled as `unsupported`, but the shot shows a balcony slab (12):**

| ID | File | Shot |
|---|---|---|
| `planter/0017` | east-side.js | On the laundry balcony with boxes |
| `bucket/0016` | east-side.js | Same balcony |
| `bucket/0017` | east-side.js | Same balcony |
| `stool/0013` | mid-street.js | On the laundry balcony |
| `box_card_b/0023` | east-side.js | On a 2F balcony with laundry |
| `stool/0029` | north-street.js | On a small balcony with a cistern |
| `jerry_can/0020` | north-street.js | Same balcony as `stool/0029` |
| `crate_b/0055` | west-side.js | Same north balcony cluster |
| `planter/0019` | east-side.js | Cistern sitting on a tiny balcony slab |
| `jerry_can/0023` | east-side.js | Same 2F balcony as `box_card_b/0023` |
| `jerry_can/0024` | east-side.js | Same |
| `bucket/0032` | east-side.js | Same |

Smoke today pins `crate_b/0056`, `box_card_b/0021`, `jerry_can/0021`,
`stool/0030`, `tyre_small/0030` as `review-balcony`. After tagging they
must expect `supported`. Drop the 12 from `PREVIOUS_UNSUPPORTED_IDS`.

### C2. Lower onto a seat that is in frame — 16

| ID | Status | Shot | Action |
|---|---|---|---|
| `stool/0021` | unsupported | Legs hover above a window cornice | Lower onto the cornice |
| `jerry_can/0012` | unsupported | Hovering above the cornice next to a box | Lower onto the cornice |
| `box_card_b/0014` | unsupported | Box in the air beside a balcony slab | Move onto the slab |
| `box_card_b/0009` | unsupported | Box hovering off the wall next to a seated stool | Move onto the cornice / balcony |
| `planter/0024` | review-gap 17 cm | Cistern hovering above a window cornice | Lower onto the cornice |
| `stool/0010` | review-gap 15 cm | Legs clearly off the terrace floor | Lower onto `roof_screed` |
| `tyre_small/0020` | review-gap 12 cm | Two tyres with air under them on the terrace | Lower |
| `box_card_b/0008` | review-gap 12 cm | Box hovering on the same terrace as the stool | Lower |
| `rock_b/0106` | review-gap 22 cm | Polyhedral rock hovering over pavement | Lower onto dirt |
| `brick_b/0100` | review-gap 4 cm | Neighbour bricks in the same shot are off the ground | Lower |
| `interior/E1/ground/sandbag_a/002` | review-gap 17 cm | Camera hit a wall; 17 cm off `floor_concrete` is a hover | Lower onto floor |
| `interior/W2/ground/sandbag_b/001` | review-gap 17 cm | Same | Lower onto floor |
| `interior/E1/ground/sandbag_b/001` | review-gap 17 cm | Same | Lower onto floor |

`brick_b/0100` is only 4 cm in the analyzer but the matching pavement shot
shows the polyhedra off the ground. Treat the visible hover, not the epsilon.

### C3. Snap stacked roof crates — 12

Every roof-stack shot shows a **clear air gap** between crates. Authored Y
does not match crate mesh height.

| ID | Status | Gap | Supporter |
|---|---|---|---|
| `crate_a/0014` | review-gap | 0.115 | `crate_b/0021` |
| `crate_b/0039` | review-gap | 0.112 | `crate_b/0038` |
| `crate_b/0037` | review-gap | 0.107 | `crate_b/0036` |
| `crate_b/0023` | review-gap | 0.098 | `crate_b/0022` |
| `crate_flat/0020` | review-gap | 0.093 | `crate_b/0047` |
| `crate_flat/0007` | review-gap | 0.092 | `crate_b/0020` |
| `crate_b/0031` | review-gap | 0.083 | `crate_b/0030` |
| `crate_a/0031` | review-gap | 0.081 | `crate_b/0050` |
| `crate_a/0019` | review-gap | 0.080 | `crate_b/0035` |
| `crate_flat/0010` | review-overhang | ~0 | stack, visible air in the shot |
| `crate_flat/0014` | review-overhang | | same |
| `crate_flat/0018` | review-overhang | | same |

Inherited flags on `crate_a/0032`, `crate_a/0037`, `crate_flat/0008`,
`crate_flat/0031` should clear after the snap. Smoke today requires
`crate_a/0019` `review-gap` > 7 cm; after the snap expect `supported`.

### C4. Optional overlap nudge

`chair/0004` × `water_tank/0017` on a roof (AABB 0.312). Not a float. Nudge
the chair if a later pass still reads as intersecting.

---

## KEEP — seated in the shot

### K1. Window-cornice dressing (unsupported in the analyzer, seated on the moulding)

The kit does not tag window cornices as support, so the analyzer reports
`unsupported` / 3 m gap to the street. The object is sitting on the
horizontal moulding. Leave them.

| ID | Shot |
|---|---|
| `box_card_b/0012` | Box on the cornice next to a planter |
| `box_card_b/0015` | Box on the cornice under a window |
| `box_card_b/0016` | Box + stool on the cornice |
| `box_card_b/0017` | Box behind a cistern on the cornice |
| `planter/0026` | Cistern on the cornice, box on top |
| `stool/0026` | Stool planted on the cornice |
| `stool/0019` | Stool on the cornice next to a cistern |
| `bucket/0012` | Bucket on the cornice |
| `bucket/0027` | Bucket on the cornice next to a jerry can |
| `bucket/0029` | Bucket on the cornice |
| `jerry_can/0011` | Jerry can on the cornice next to a cistern |
| `jerry_can/0016` | Same cornice run as `bucket/0027` |

Do **not** delete these. They read as lived-in facade dressing. A later kit
change could give cornices a support role; until then this is a detector
limit, not a world bug.

### K2. Ground / roof scatter with a numeric gap, seated in the shot

`can/0039` (20 cm to dirt) is sitting on a concrete block, not hovering.
Most 4–8 cm rocks, bricks, bottles, cans, lamp posts, interior chairs are
planted. The 4 cm contact epsilon is tighter than the picture.

Keep (review-gap < 8 cm plus the ground 8–22 cm items that are seated):

`bottle/0002`, `bottle/0009`, `bottle/0015`, `brick_a/0011`, `brick_a/0017`,
`brick_a/0022`, `brick_a/0026`, `brick_a/0027`, `brick_a/0049`, `brick_a/0077`,
`brick_b/0044`, `brick_b/0069`, `brick_b/0073`, `brick_b/0079`, `brick_b/0083`,
`brick_b/0131`, `bucket/0015`, `can/0016`,
`can/0017`, `can/0025`, `can/0029`, `can/0031`, `can/0037`, `can/0038`,
`can/0039`, `can/0041`, `can/0042`, `can/0084`, `can/0085`, `crate_a/0032`,
`crate_a/0035`, `crate_a/0036`, `crate_a/0037`, `crate_b/0018`, `crate_b/0025`,
`crate_b/0043`, `crate_b/0046`, `crate_b/0048`, `crate_b/0052`,
`crate_flat/0005`, `crate_flat/0006`, `crate_flat/0008`, `crate_flat/0016`,
`crate_flat/0023`, `crate_flat/0024`, `crate_flat/0025`, `crate_flat/0026`,
`crate_flat/0028`, `crate_flat/0031`, `generated/rock_b|4.885|0.004|-25.684`,
`interior/E1/floor-1/chair/003`, `interior/E1/floor-1/rebar/001`,
`interior/E1/floor-2/chair/003`, `interior/E1/ground/crate_a/002`,
`interior/E3/floor-1/chair/001`, `interior/E3/ground/chair/001`,
`interior/E3/ground/chair/002`, `interior/W2/floor-1/crate_b/003`,
`interior/W2/ground/crate_a/003`, `interior/W2/ground/crate_a/004`,
`interior/W2/ground/crate_flat/007`, `interior/W2/ground/crate_flat/009`,
`interior/W3/floor-1/chair/001`, `interior/W3/ground/chair/001`,
`interior/W3/ground/chair/002`, `interior/W3/ground/rebar/002`,
`interior/W3/ground/sandbag_b/003`, `jerry_can/0015`, `lamp_post/0003`,
`lamp_post/0004`, `planter/0012`, `rebar/0017`, `rock_a/0024`, `rock_a/0058`,
`rock_a/0060`, `rock_a/0061`, `rock_a/0066`, `rock_a/0069`, `rock_b/0037`,
`rock_b/0067`, `rock_b/0103`, `rock_b/0104`, `rock_b/0107`, `rock_b/0108`,
`rock_b/0109`, `rock_b/0110`, `rock_b/0111`, `rock_b/0117`, `rock_b/0118`,
`sandbag_c/0001`, `tyre_small/0018`, `tyre_small/0019`, `tyre_small/0021`

Interior chairs sit on rugs / concrete. Legs look planted. Keep.

### K3. review-overhang — 189 remaining after crate-stack snaps

Sandbag courses, slab shards, planks, lamp-post bases, tyre stacks, cans on
rims. Every shot has contact. The hull does not contain the mass centre
because the shape is a bag, shard, torus or board.

Smoke already pins the two rampart overhangs and `tyre_small/0013`. Leave it.

**slab_shard (38):** `interior/E1/floor-1/slab_shard/003`,
`interior/E1/floor-1/slab_shard/004`, `interior/E1/floor-2/slab_shard/001`,
`interior/E1/floor-2/slab_shard/002`, `interior/E3/floor-1/slab_shard/001`–
`006`, `interior/E3/ground/slab_shard/001`–`004`, `006`, `008`, `009`,
`interior/W3/floor-1/slab_shard/001`, `003`, `004`,
`interior/W3/ground/slab_shard/001`, `002`, `005`–`009`, `slab_shard/0006`,
`0009`, `0023`, `0026`, `0027`, `0032`, `0041`, `0046`, `0059`, `0064`, `0066`

**sandbag_a/b/c (72):** all remaining sandbag `review-overhang` IDs from the
analyzer, including `generated/sandbag_a|3.586|12.817|-42.514` and
`generated/sandbag_b|-0.024|7.172|-42.366`. Walls look stacked and grounded.

**tyre / tyre_small stacks:** `tyre/0011`, `0012`, `0020`–`0023`,
`tyre_small/0005`, `0010`–`0013`. Interleaved stacks, planted.

**cans on roofs (15):** `can/0006`, `0012`, `0033`, `0044`–`0053`, `0105`,
`0111`. Sitting on the roof plate.

**bricks, rocks, rebar, planks, lamp posts, leftover props:**
`brick_a/0012`, `0018`, `0021`, `0030`, `0048`, `0079`,
`generated/brick_a|-20.394|3.490|1.390`, `brick_b/0033`, `0043`, `0045`,
`0070`, `0084`, `0107`, `0132`, `0139`, `generated/rock_a|-11.146|0.060|19.831`,
`generated/rock_a|20.131|0.060|-43.960`, `rock_a/0044`, `0059`, `0091`,
`generated/rock_b|-9.461|0.060|24.480`, `generated/rock_b|21.612|0.060|-43.707`,
`rock_b/0068`, `0072`, `0125`, `0137`, `0141`,
`generated/rebar|-5.256|0.059|-60.844`, `rebar/0002`, `0005`, `0014`, `0021`,
`plank_a/0011`, `0012`, `0017`, `plank_b/0009`, `0048`, `0058`,
`lamp_post/0001`, `0002`, `0005`, `box_card_b/0003`, `0004`, `0028`, `0032`,
`crate_b/0029`, `0030`, `crate_a/0022`, `box_card_a/0016`, `palm_trunk/0001`,
`bucket/0004`, `bottle/0008`, `planter/0004`

Long boards (`plank_a/0011` margin −0.73) have one end on sand. Keep.

### K4. unclassified-seat — 60

Contact against rugs, dark wood, rusted metal, road dust, or a neighbour.
Shots show chairs on floors, bottles on the W2 table, sandbags on sandbags,
rebar in rubble.

`interior/W2/floor-1/chair/003` is planted (smoke already pins this).
`interior/W2/floor-1/table_small/002`, `bottle/002`, `can/002` sit together.

Full set: `barrel_rust/0008`, `0010`, `barrel_wood/0010`, `0011`,
`brick_b/0037`, `can/0088`, `generated/jersey|2.100|0.020|47.500`,
`generated/rebar|-3.588|0.046|-59.643`, `generated/rebar|-3.931|0.049|-59.854`,
`interior/E1/floor-1/slab_shard/001`, `002`, `interior/E1/floor-2/rebar/001`,
`interior/E1/floor-2/slab_shard/003`, `interior/E3/floor-1/rebar/001`,
`interior/E3/ground/rebar/001`, `002`, `interior/E3/ground/slab_shard/005`,
`007`, `interior/W2/floor-1/bottle/002`, `can/002`, `chair/003`,
`table_small/002`, `interior/W3/floor-1/rebar/001`,
`interior/W3/floor-1/slab_shard/002`, `interior/W3/ground/rebar/001`,
`interior/W3/ground/slab_shard/003`, `004`, `palm_trunk/0002`, `plank_a/0007`,
`plank_b/0039`, `planter/0020`, `rebar/0004`, `0008`, `0009`, `0010`, `0012`,
`rock_a/0027`, `0063`, `0090`, `rock_b/0133`–`0136`, `sandbag_a/0042`, `0045`,
`0047`, `0048`, `sandbag_b/0039`, `0041`, `sandbag_c/0043`, `0046`, `0047`,
`0049`, `0050`, `0051`, `slab_shard/0013`, `0019`, `0022`, `0028`, `0040`

### K5. review-penetration — 5 generated embeds

Rocks and jersey barriers sunk 5–13 cm into sand at the map edge. The
shots show them sitting in the dirt, not intersecting a wall. Keep.

- `generated/rock_b|22.787|0.060|-43.946`
- `generated/rock_b|23.381|0.060|-43.882`
- `generated/rock_a|22.971|0.060|-43.747`
- `generated/jersey|-2.100|0.020|47.500`
- `generated/jersey|-0.000|0.020|47.500`

### K6. Collision overlaps — 829

Wreck × jersey, stall × crate, tank × pallet, tyre × tyre. Authored.
`crate_b/0024` × `planter/0009` dies when those two are removed.

### K7. Fixtures — 7, keep as fixtures

Already deleted in PR #194. Re-injected only as analyzer true positives.
Do not restore.

### K8. Rampart sandbags — 48 supported + 2 overhang

The 50 generated bags with Y > 6. 48 look stacked on the rampart. Two
overhangs are smoke-pinned. Keep.

---

## Suggested implementation order

1. **REMOVE the 17** mid-air props. Update `PREVIOUS_UNSUPPORTED_IDS` and the
   omitted-ID list. Do not reseat them.
2. **Tag C1 balconies** (`support: 'balcony'`), including the 11 that the
   analyzer called unsupported. Flip smoke `review-balcony` examples to
   `supported`.
3. **Lower C2** onto the seat that is already in the shot.
4. **Snap C3 crate stacks.** Flip `crate_a/0019` smoke to `supported`.
5. Optional C4 chair nudge.
6. Follow-up: west-facade **water tanks** that were not in the 462 but are
   visibly floating under `crate_b/0024`.
7. `npm test` / `npm run world` only when a later PR ships the edits.

Do not loosen detector thresholds to paint cornice dressing green. Tag
balconies; leave cornices as a known unclassified seat.

## Count check (visual, not numeric)

| Bucket | Count |
|---|---|
| REMOVE (seen in empty air) | 14 |
| CHANGE C1 balcony tags | 52 + 12 misfiled = 64 |
| CHANGE C2 lower onto a visible seat | 13 |
| CHANGE C3 crate snaps | 12 |
| KEEP K1 cornice dressing | 12 |
| KEEP K2–K8 seated / detector limits | the rest of the 462 |
| Collision floats / doors | 0 / 0 |
| Collision overlaps | 829, keep |
| Fixtures | 7, keep as fixtures |

The first draft of this plan removed all 42 `unsupported` IDs from the
numbers alone. The pictures cut that to 14 and moved the rest to tag or
lower. That is the whole point of this pass.

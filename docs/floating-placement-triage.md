# Floating / unsupported placement triage

Plan for every finding from the current detectors. Decisions are **remove**,
**keep**, or **change**. No world edits in this PR — this file is the review.

## Detectors that were run

Two scripts exist. Both were run against `develop` @ `8ff79b9`.

### 1. `tools/analyze-map-issues.mjs` (collision AABB)

Raycasts cooked collision from above each prop AABB. Ground-resting prototypes
only; skips anything with `maxY > 3.2` or `minY < -0.3`. Tolerance **15 cm**.
Wedged stacks (interleaved tyres) are filtered.

```
instances=7575  buildings=20  facadeDoors=0
FLOATING (0)
DOORS WITH PROPS AT THE OPENING (0)
TOP 50 OVERLAPS (829 total, non-foliage)
```

Ground-level collision floats and blocked doorways are already clean
(PRs #187–#194). The 3.2 m cap is why balcony / roof floats never appear here.

### 2. `tools/analyze-prop-support.mjs` (mesh contact)

The current support analyzer. Samples the underside envelope against the
visual support index. Contact ≤ 4 cm, review gap ≤ 35 cm.

```
candidates     3837
supported      3375
suspicious      462
  review-overhang      192
  review-gap           111
  unclassified-seat     60
  review-balcony        52
  unsupported           42
  review-penetration     5
inherited-only          82
fixtures                 7   (already deleted; re-injected as true positives)
```

The 462 suspicious results plus the collision overlap dump are the findings
below. Every ID is assigned once.

## Decision rules

| Verdict | When |
|---|---|
| **REMOVE** | `physical=none`, nearest gap **> 0.5 m**. Mid-air at balcony/roof height with no seat. Same policy as PR #194: delete confirmed floats, do not reseat (resitting previously spawned clutter at `2*floorY`). |
| **CHANGE** | A real seat exists within ~20 cm, but the authored Y (or missing `support: 'balcony'` tag) is wrong. Snap / tag; do not delete. |
| **KEEP** | Measured contact, gap **< 8 cm**, organic debris / stack / detector limit, or intentional overlap. Do not churn these. |

8 cm is the visual threshold. 4 cm is the analyzer's contact epsilon; most
4–8 cm flags are mesh-origin / foot / torus noise, not hovering props.

---

## REMOVE — 42 true floats

All 42 are `unsupported` / `physical=none`. Authored Y is 3.58–3.60 (1F
balcony band) or 6.64–6.65 (2F / roof-edge band). Nearest hit is 2.2–6.8 m
straight down to street dirt, sand, or a wall. They are the leftover
`PREVIOUS_UNSUPPORTED_IDS` set from PR #196, minus three that were
reclassified (`jerry_can/0015`, `planter/0024`, `tyre_small/0030`).

Do **not** move them onto a balcony. Several sit over empty facade, not over
a slab. Deleting matches `CONFIRMED_FLOAT_FIXTURES` (already gone).

After deletion, drop these IDs from `PREVIOUS_UNSUPPORTED_IDS` and add them
to the "must remain omitted" list in `tools/smoke-floating-props.mjs`, the
same way `sandbag_a/0006` etc. are already handled.

### Cluster A — east 1F balcony band, xz ≈ (17.1, 7.4) — `east-side.js`

| ID | Prototype | Y | Gap | Nearest |
|---|---|---|---|---|
| `planter/0017` | planter | 3.59 | 3.50 | `plank_a/0021` |
| `box_card_b/0012` | box_card_b | 3.59 | 3.49 | `plank_a/0021` |
| `bucket/0017` | bucket | 3.59 | 3.48 | `brick_a/0113` |
| `bucket/0016` | bucket | 3.59 | 3.05 | `box_card_a/0026` |

### Cluster B — NE roof edge, xz ≈ (23.0, 43.5) — `east-side.js`

| ID | Prototype | Y | Gap | Nearest |
|---|---|---|---|---|
| `jerry_can/0023` | jerry_can | 6.64 | 3.82 | `fabric_cream` |
| `jerry_can/0024` | jerry_can | 6.64 | 3.79 | `fabric_cream` |
| `bucket/0032` | bucket | 6.64 | 3.72 | `fabric_cream` |
| `box_card_b/0023` | box_card_b | 6.64 | 3.71 | `fabric_cream` |

### Cluster C — N roof, xz ≈ (6.1, 43.4) — `east-side.js` + `north-street.js`

| ID | Prototype | Y | Gap | File |
|---|---|---|---|---|
| `bucket/0031` | bucket | 6.64 | 6.56 | east-side.js |
| `jerry_can/0022` | jerry_can | 6.64 | 6.56 | east-side.js |
| `box_card_b/0022` | box_card_b | 6.64 | 6.48 | north-street.js |
| `planter/0029` | planter | 6.64 | 6.46 | north-street.js |

### Cluster D — north 1F, xz ≈ (-6.9, 42.4) — `west-side.js` + `north-street.js`

| ID | Prototype | Y | Gap | File |
|---|---|---|---|---|
| `crate_b/0055` | crate_b | 3.58 | 3.49 | west-side.js |
| `stool/0029` | stool | 3.60 | 3.28 | north-street.js |
| `jerry_can/0020` | jerry_can | 3.59 | 3.21 | north-street.js |

### Cluster E — west 1F, xz ≈ (-14.1, -8.7) — `west-side.js`

| ID | Prototype | Y | Gap |
|---|---|---|---|
| `crate_b/0019` | crate_b | 3.58 | 3.48 |
| `tyre_small/0016` | tyre_small | 3.59 | 3.38 |
| `tyre_small/0017` | tyre_small | 3.59 | 3.16 |

### Cluster F — SW 1F, xz ≈ (-11.2, -42.6) — `west-side.js`

| ID | Prototype | Y | Gap |
|---|---|---|---|
| `bucket/0014` | bucket | 3.59 | 3.64 |
| `planter/0011` | planter | 3.59 | 3.62 |
| `planter/0010` | planter | 3.59 | 3.60 |

### Cluster G — east 1F, xz ≈ (18.8, 2.6) — `east-side.js`

| ID | Prototype | Y | Gap |
|---|---|---|---|
| `stool/0019` | stool | 3.60 | 3.54 |
| `jerry_can/0011` | jerry_can | 3.59 | 3.52 |
| `planter/0019` | planter | 3.59 | 3.15 |

### Cluster H — mid 1F, xz ≈ (-5.9, -15.2) — `mid-street.js`

| ID | Prototype | Y | Gap |
|---|---|---|---|
| `stool/0013` | stool | 3.60 | 3.46 |
| `bucket/0012` | bucket | 3.59 | 3.44 |
| `box_card_b/0009` | box_card_b | 3.59 | 3.19 |

### Cluster I — SW pair, xz ≈ (-17.4, -42.5) — `west-side.js`

| ID | Prototype | Y | Gap |
|---|---|---|---|
| `planter/0009` | planter | 3.59 | 3.63 |
| `crate_b/0024` | crate_b | 3.58 | 3.61 |

### Cluster J — east 1F, xz ≈ (10.0, -31.6) — `east-side.js`

| ID | Prototype | Y | Gap |
|---|---|---|---|
| `bucket/0027` | bucket | 3.59 | 3.70 |
| `jerry_can/0016` | jerry_can | 3.59 | 3.16 |

### Cluster K — south 2F, xz ≈ (5.9, -38.2) — `south-street.js`

| ID | Prototype | Y | Gap |
|---|---|---|---|
| `box_card_b/0017` | box_card_b | 6.64 | 3.03 |
| `planter/0026` | planter | 6.64 | 3.03 |

### Cluster L — east 2F, xz ≈ (8.4, 2.5) — `east-side.js`

| ID | Prototype | Y | Gap |
|---|---|---|---|
| `jerry_can/0012` | jerry_can | 6.64 | 3.04 |
| `box_card_b/0014` | box_card_b | 6.64 | 0.54 |

`box_card_b/0014` is the smallest unsupported gap (54 cm to `metal_dark`). Still
no contact. Remove with the pair.

### Cluster M — east roof, xz ≈ (8.0, -31.5) — `east-side.js`

| ID | Prototype | Y | Gap |
|---|---|---|---|
| `stool/0026` | stool | 6.65 | 6.75 |
| `box_card_b/0016` | box_card_b | 6.64 | 6.20 |

### Singletons

| ID | File | Y | Gap | xz |
|---|---|---|---|---|
| `crate_b/0053` | west-side.js | 3.58 | 3.51 | (-28.2, -50.1) |
| `bucket/0029` | south-street.js | 3.59 | 3.52 | (-0.1, -48.6) |
| `box_card_b/0015` | east-side.js | 6.64 | 3.99 | (12.7, -31.6) |
| `tyre_small/0027` | east-side.js | 6.64 | 6.57 | (19.8, 2.8) |
| `stool/0021` | mid-street.js | 6.65 | 2.16 | (5.6, -3.0) |

Full ID list: `box_card_b/0009`, `box_card_b/0012`, `box_card_b/0014`,
`box_card_b/0015`, `box_card_b/0016`, `box_card_b/0017`, `box_card_b/0022`,
`box_card_b/0023`, `bucket/0012`, `bucket/0014`, `bucket/0016`, `bucket/0017`,
`bucket/0027`, `bucket/0029`, `bucket/0031`, `bucket/0032`, `crate_b/0019`,
`crate_b/0024`, `crate_b/0053`, `crate_b/0055`, `jerry_can/0011`,
`jerry_can/0012`, `jerry_can/0016`, `jerry_can/0020`, `jerry_can/0022`,
`jerry_can/0023`, `jerry_can/0024`, `planter/0009`, `planter/0010`,
`planter/0011`, `planter/0017`, `planter/0019`, `planter/0026`,
`planter/0029`, `stool/0013`, `stool/0019`, `stool/0021`, `stool/0026`,
`stool/0029`, `tyre_small/0016`, `tyre_small/0017`, `tyre_small/0027`.

---

## CHANGE — 84 placements

### C1. Tag balcony seating — 52

These have **measured contact** on a kit balcony slab (`role=balcony`) but no
placement `support: 'balcony'` field. Zero placements currently declare it,
which is why the whole set is `review-balcony`. They are not floating.

Action: add `support: 'balcony'` on each object. Smoke currently pins
`crate_b/0056`, `box_card_b/0021`, `jerry_can/0021`, `stool/0030`,
`tyre_small/0030` as `review-balcony`; after tagging they must expect
`supported`.

| File | IDs |
|---|---|
| east-side.js | `box_card_b/0011`, `box_card_b/0021`, `bucket/0022`, `bucket/0024`, `bucket/0025`, `crate_b/0056`, `jerry_can/0021`, `stool/0030`, `tyre_small/0028`, `tyre_small/0030` |
| market.js | `bucket/0018`, `bucket/0019`, `jerry_can/0010`, `planter/0018` |
| mid-street.js | `bucket/0023`, `crate_b/0032`, `jerry_can/0013`, `jerry_can/0014`, `stool/0022` |
| north-street.js | `crate_b/0026`, `jerry_can/0009`, `planter/0015`, `tyre_small/0024` |
| south-street.js | `box_card_b/0018`, `bucket/0026`, `jerry_can/0017`, `planter/0021`, `planter/0022`, `stool/0023`, `stool/0024`, `tyre_small/0029` |
| west-side.js | `box_card_b/0010`, `box_card_b/0019`, `box_card_b/0020`, `bucket/0007`, `bucket/0008`, `bucket/0009`, `bucket/0010`, `bucket/0011`, `jerry_can/0006`, `jerry_can/0007`, `planter/0005`, `planter/0006`, `planter/0007`, `planter/0013`, `stool/0009`, `stool/0015`, `stool/0016`, `tyre_small/0014`, `tyre_small/0015`, `tyre_small/0022`, `tyre_small/0023` |

`stool/0030` sits on `jerry_can/0021` which sits on the slab — tag both.
`planter/0020` is `unclassified-seat` on `bucket/0023`; tagging the bucket is
enough, leave the planter in KEEP.

### C2. Lower ground scatter — 16 outdoor, gap 8–22 cm

Collision AABB missed these because the origin sits high inside the mesh
(rock/can/brick). Mesh-underside rays see 8–22 cm of air over dirt/concrete.
Visible hover. Subtract `nearestGap` from authored Y (or snap to `groundY`).

| ID | Prototype | Y | Gap | Support |
|---|---|---|---|---|
| `rock_b/0106` | rock_b | 0.35 | 0.222 | dirt |
| `rock_a/0066` | rock_a | 0.34 | 0.215 | dirt |
| `can/0039` | can | 0.28 | 0.209 | dirt |
| `rock_b/0103` | rock_b | 0.32 | 0.143 | concrete |
| `rock_a/0058` | rock_a | 0.29 | 0.135 | generated rock |
| `brick_b/0069` | brick_b | 0.33 | 0.122 | dirt |
| `brick_b/0079` | brick_b | 0.31 | 0.115 | concrete |
| `brick_a/0027` | brick_a | 0.23 | 0.106 | dirt |
| `can/0017` | can | 0.17 | 0.091 | dirt |
| `can/0016` | can | 0.17 | 0.090 | dirt |
| `bottle/0015` | bottle | 0.16 | 0.090 | dirt |
| `bottle/0002` | bottle | 0.16 | 0.090 | dirt |
| `rock_b/0110` | rock_b | 0.28 | 0.086 | `plank_a/0009` |
| `can/0084` | can | 0.16 | 0.085 | dirt |
| `can/0085` | can | 0.16 | 0.085 | dirt |
| `can/0038` | can | 0.21 | 0.082 | concrete |

### C3. Lower interior sandbags — 3, gap 17 cm

Floor concrete is ~17 cm below the authored Y. Not a detector false positive.

| ID | Prototype | Y | Gap |
|---|---|---|---|
| `interior/E1/ground/sandbag_a/002` | sandbag_a | 0.60 | 0.174 |
| `interior/W2/ground/sandbag_b/001` | sandbag_b | 0.60 | 0.170 |
| `interior/E1/ground/sandbag_b/001` | sandbag_b | 0.60 | 0.170 |

### C4. Lower terrace hoverers — 4

A seat exists (`roof_screed` or roof `concrete`) 12–17 cm below. These are
the three PR #196 reclassifications plus one neighbour.

| ID | File | Y | Gap | Seat |
|---|---|---|---|---|
| `planter/0024` | east-side.js | 6.64 | 0.171 | concrete |
| `stool/0010` | west-side.js | 3.60 | 0.150 | roof_screed |
| `tyre_small/0020` | west-side.js | 3.59 | 0.123 | roof_screed |
| `box_card_b/0008` | west-side.js | 3.59 | 0.123 | roof_screed |

Smoke currently expects `planter/0024` and `jerry_can/0015` as `review-gap`.
After lowering `planter/0024`, expect `supported`. Leave `jerry_can/0015`
(7 cm on a balcony tyre) in KEEP.

### C5. Snap stacked roof crates — 9, gap 8–12 cm

Authored stack Y does not match crate mesh height. Each already names its
supporter. Lower onto that supporter; then re-run analysis because inherited
`review-gap` on the crate sitting *above* them (`crate_a/0032`, `crate_a/0037`,
`crate_flat/0008`, `crate_flat/0031`) should clear for free.

Smoke currently requires `crate_a/0019` `review-gap` with gap > 7 cm. After
the snap, expect `supported`.

| ID | Y | Gap | Supporter |
|---|---|---|---|
| `crate_a/0014` | 7.56 | 0.115 | `crate_b/0021` |
| `crate_b/0039` | 10.08 | 0.112 | `crate_b/0038` |
| `crate_b/0037` | 10.08 | 0.107 | `crate_b/0036` |
| `crate_b/0023` | 7.03 | 0.098 | `crate_b/0022` |
| `crate_flat/0020` | 13.13 | 0.093 | `crate_b/0047` |
| `crate_flat/0007` | 7.03 | 0.092 | `crate_b/0020` |
| `crate_b/0031` | 10.61 | 0.083 | `crate_b/0030` |
| `crate_a/0031` | 7.03 | 0.081 | `crate_b/0050` |
| `crate_a/0019` | 10.61 | 0.080 | `crate_b/0035` |

### C6. Optional overlap nudge (collision script)

`chair/0004` × `water_tank/0017` at (12.25, 9.56, 19.78), AABB volume 0.312.
Both on the same roof ~0.5 m apart; the chair AABB eats the tank. Not a float.
Nudge the chair ~0.4 m away if a later visual pass still reads as intersecting.
Everything else in the overlap dump stays in KEEP.

---

## KEEP — 336 analyzer flags + collision overlaps + fixtures

Contact is real, or the flag is a known detector limit. Do not authoring-churn.

### K1. review-gap < 8 cm — 79

Analyzer epsilon is 4 cm. These 4–8 cm (and a few negative) gaps are
origin/foot/stack slack, interior chair legs, lamp-post bases, and crate
stacks that already sit close enough.

`bottle/0009`, `brick_a/0011`, `brick_a/0017`, `brick_a/0022`, `brick_a/0026`,
`brick_a/0049`, `brick_a/0077`, `brick_b/0044`, `brick_b/0073`, `brick_b/0083`,
`brick_b/0100`, `brick_b/0131`, `bucket/0015`, `can/0025`, `can/0029`,
`can/0031`, `can/0037`, `can/0041`, `can/0042`, `crate_a/0032`, `crate_a/0035`,
`crate_a/0036`, `crate_a/0037`, `crate_b/0018`, `crate_b/0025`, `crate_b/0043`,
`crate_b/0046`, `crate_b/0048`, `crate_b/0052`, `crate_flat/0005`,
`crate_flat/0006`, `crate_flat/0008`, `crate_flat/0016`, `crate_flat/0023`,
`crate_flat/0024`, `crate_flat/0025`, `crate_flat/0026`, `crate_flat/0028`,
`crate_flat/0031`, `generated/rock_b|4.885|0.004|-25.684`,
`interior/E1/floor-1/chair/003`, `interior/E1/floor-1/rebar/001`,
`interior/E1/floor-2/chair/003`, `interior/E1/ground/crate_a/002`,
`interior/E3/floor-1/chair/001`, `interior/E3/ground/chair/001`,
`interior/E3/ground/chair/002`, `interior/W2/floor-1/crate_b/003`,
`interior/W2/ground/crate_a/003`, `interior/W2/ground/crate_a/004`,
`interior/W2/ground/crate_flat/007`, `interior/W2/ground/crate_flat/009`,
`interior/W3/floor-1/chair/001`, `interior/W3/ground/chair/001`,
`interior/W3/ground/chair/002`, `interior/W3/ground/rebar/002`,
`interior/W3/ground/sandbag_b/003`, `jerry_can/0015`, `lamp_post/0003`,
`lamp_post/0004`, `planter/0012`, `rebar/0017`, `rock_a/0024`, `rock_a/0060`,
`rock_a/0061`, `rock_a/0069`, `rock_b/0037`, `rock_b/0067`, `rock_b/0104`,
`rock_b/0107`, `rock_b/0108`, `rock_b/0109`, `rock_b/0111`, `rock_b/0117`,
`rock_b/0118`, `sandbag_c/0001`, `tyre_small/0018`, `tyre_small/0019`,
`tyre_small/0021`.

`crate_a/0032`, `crate_a/0037`, `crate_flat/0008`, `crate_flat/0031` are
**inherited** from C5 stacks. They should flip to `supported` once C5 is done;
until then they stay KEEP, not a second CHANGE.

### K2. review-overhang — 192

Every one has `physical=contact`. The hull of contact points does not contain
the mass centre: sandbag courses, slab shards, planks, lamp-post bases, tyre
stacks, cans on rims. Authored look, not a float.

Smoke already requires the two rampart overhangs
(`generated/sandbag_a|3.586|12.817|-42.514`,
`generated/sandbag_b|-0.024|7.172|-42.366`) and `tyre_small/0013` as
`review-overhang`. Leave that contract.

**slab_shard (38):** `interior/E1/floor-1/slab_shard/003`,
`interior/E1/floor-1/slab_shard/004`, `interior/E1/floor-2/slab_shard/001`,
`interior/E1/floor-2/slab_shard/002`, `interior/E3/floor-1/slab_shard/001`,
`interior/E3/floor-1/slab_shard/002`, `interior/E3/floor-1/slab_shard/003`,
`interior/E3/floor-1/slab_shard/004`, `interior/E3/floor-1/slab_shard/005`,
`interior/E3/floor-1/slab_shard/006`, `interior/E3/ground/slab_shard/001`,
`interior/E3/ground/slab_shard/002`, `interior/E3/ground/slab_shard/003`,
`interior/E3/ground/slab_shard/004`, `interior/E3/ground/slab_shard/006`,
`interior/E3/ground/slab_shard/008`, `interior/E3/ground/slab_shard/009`,
`interior/W3/floor-1/slab_shard/001`, `interior/W3/floor-1/slab_shard/003`,
`interior/W3/floor-1/slab_shard/004`, `interior/W3/ground/slab_shard/001`,
`interior/W3/ground/slab_shard/002`, `interior/W3/ground/slab_shard/005`,
`interior/W3/ground/slab_shard/006`, `interior/W3/ground/slab_shard/007`,
`interior/W3/ground/slab_shard/008`, `interior/W3/ground/slab_shard/009`,
`slab_shard/0006`, `slab_shard/0009`, `slab_shard/0023`, `slab_shard/0026`,
`slab_shard/0027`, `slab_shard/0032`, `slab_shard/0041`, `slab_shard/0046`,
`slab_shard/0059`, `slab_shard/0064`, `slab_shard/0066`

**sandbag_a (26):** `generated/sandbag_a|3.586|12.817|-42.514`,
`interior/W2/ground/sandbag_a/003`, `sandbag_a/0009`, `sandbag_a/0026`,
`sandbag_a/0028`, `sandbag_a/0034`, `sandbag_a/0052`, `sandbag_a/0054`,
`sandbag_a/0056`, `sandbag_a/0058`, `sandbag_a/0062`, `sandbag_a/0064`,
`sandbag_a/0066`, `sandbag_a/0072`, `sandbag_a/0074`, `sandbag_a/0076`,
`sandbag_a/0077`, `sandbag_a/0080`, `sandbag_a/0082`, `sandbag_a/0084`,
`sandbag_a/0085`, `sandbag_a/0086`, `sandbag_a/0088`, `sandbag_a/0090`,
`sandbag_a/0091`, `sandbag_a/0092`

**sandbag_b (25):** `generated/sandbag_b|-0.024|7.172|-42.366`,
`generated/sandbag_b|-2.883|0.299|-37.809`,
`interior/W2/ground/sandbag_b/006`, `interior/W2/ground/sandbag_b/007`,
`sandbag_b/0001`, `sandbag_b/0002`, `sandbag_b/0006`, `sandbag_b/0023`,
`sandbag_b/0026`, `sandbag_b/0042`, `sandbag_b/0044`, `sandbag_b/0045`,
`sandbag_b/0047`, `sandbag_b/0048`, `sandbag_b/0050`, `sandbag_b/0053`,
`sandbag_b/0062`, `sandbag_b/0064`, `sandbag_b/0066`, `sandbag_b/0071`,
`sandbag_b/0072`, `sandbag_b/0073`, `sandbag_b/0077`, `sandbag_b/0079`,
`sandbag_b/0081`

**sandbag_c (21):** `generated/sandbag_c|2.977|0.130|-46.877`,
`sandbag_c/0009`, `sandbag_c/0015`, `sandbag_c/0024`, `sandbag_c/0026`,
`sandbag_c/0027`, `sandbag_c/0033`, `sandbag_c/0053`, `sandbag_c/0054`,
`sandbag_c/0055`, `sandbag_c/0056`, `sandbag_c/0057`, `sandbag_c/0059`,
`sandbag_c/0074`, `sandbag_c/0079`, `sandbag_c/0080`, `sandbag_c/0081`,
`sandbag_c/0082`, `sandbag_c/0086`, `sandbag_c/0089`, `sandbag_c/0090`

**can (15):** `can/0006`, `can/0012`, `can/0033`, `can/0044`, `can/0045`,
`can/0046`, `can/0047`, `can/0048`, `can/0049`, `can/0050`, `can/0051`,
`can/0052`, `can/0053`, `can/0105`, `can/0111`

**brick_b (8):** `brick_b/0033`, `brick_b/0043`, `brick_b/0045`,
`brick_b/0070`, `brick_b/0084`, `brick_b/0107`, `brick_b/0132`, `brick_b/0139`

**brick_a (7):** `brick_a/0012`, `brick_a/0018`, `brick_a/0021`,
`brick_a/0030`, `brick_a/0048`, `brick_a/0079`,
`generated/brick_a|-20.394|3.490|1.390`

**rock_b (7):** `generated/rock_b|-9.461|0.060|24.480`,
`generated/rock_b|21.612|0.060|-43.707`, `rock_b/0068`, `rock_b/0072`,
`rock_b/0125`, `rock_b/0137`, `rock_b/0141`

**tyre (6):** `tyre/0011`, `tyre/0012`, `tyre/0020`, `tyre/0021`, `tyre/0022`,
`tyre/0023`

**rock_a (5):** `generated/rock_a|-11.146|0.060|19.831`,
`generated/rock_a|20.131|0.060|-43.960`, `rock_a/0044`, `rock_a/0059`,
`rock_a/0091`

**rebar (5):** `generated/rebar|-5.256|0.059|-60.844`, `rebar/0002`,
`rebar/0005`, `rebar/0014`, `rebar/0021`

**tyre_small (5):** `tyre_small/0005`, `tyre_small/0010`, `tyre_small/0011`,
`tyre_small/0012`, `tyre_small/0013`

**box_card_b (4):** `box_card_b/0003`, `box_card_b/0004`, `box_card_b/0028`,
`box_card_b/0032`

**plank_b (3):** `plank_b/0009`, `plank_b/0048`, `plank_b/0058`

**crate_flat (3):** `crate_flat/0010`, `crate_flat/0014`, `crate_flat/0018`

**plank_a (3):** `plank_a/0011`, `plank_a/0012`, `plank_a/0017`

**lamp_post (3):** `lamp_post/0001`, `lamp_post/0002`, `lamp_post/0005`

**crate_b (2):** `crate_b/0029`, `crate_b/0030`

**singletons:** `crate_a/0022`, `box_card_a/0016`, `palm_trunk/0001`,
`bucket/0004`, `bottle/0008`, `planter/0004`

Worst margins (`plank_a/0011` −0.73, `plank_a/0012` −0.59) are long boards
with one end on sand. Keep.

### K3. unclassified-seat — 60

Contact against a surface the index does not name as floor/ground/balcony:
`fabric_cream` rugs, `wood_dark` furniture, `metal_rust` / `metal_dark`,
`road_dust`, or a neighbour prop. Includes the W2 stair chair the smoke test
already pins (`interior/W2/floor-1/chair/003`).

**slab_shard (13):** `interior/E1/floor-1/slab_shard/001`,
`interior/E1/floor-1/slab_shard/002`, `interior/E1/floor-2/slab_shard/003`,
`interior/E3/ground/slab_shard/005`, `interior/E3/ground/slab_shard/007`,
`interior/W3/floor-1/slab_shard/002`, `interior/W3/ground/slab_shard/003`,
`interior/W3/ground/slab_shard/004`, `slab_shard/0013`, `slab_shard/0019`,
`slab_shard/0022`, `slab_shard/0028`, `slab_shard/0040`

**rebar (13):** `generated/rebar|-3.588|0.046|-59.643`,
`generated/rebar|-3.931|0.049|-59.854`, `interior/E1/floor-2/rebar/001`,
`interior/E3/floor-1/rebar/001`, `interior/E3/ground/rebar/001`,
`interior/E3/ground/rebar/002`, `interior/W3/floor-1/rebar/001`,
`interior/W3/ground/rebar/001`, `rebar/0004`, `rebar/0008`, `rebar/0009`,
`rebar/0010`, `rebar/0012`

**sandbag_c (6):** `sandbag_c/0043`, `sandbag_c/0046`, `sandbag_c/0047`,
`sandbag_c/0049`, `sandbag_c/0050`, `sandbag_c/0051`

**sandbag_a (4):** `sandbag_a/0042`, `sandbag_a/0045`, `sandbag_a/0047`,
`sandbag_a/0048`

**rock_b (4):** `rock_b/0133`, `rock_b/0134`, `rock_b/0135`, `rock_b/0136`

**rock_a (3):** `rock_a/0027`, `rock_a/0063`, `rock_a/0090`

**can (2):** `can/0088`, `interior/W2/floor-1/can/002`

**sandbag_b (2):** `sandbag_b/0039`, `sandbag_b/0041`

**barrel_wood (2):** `barrel_wood/0010`, `barrel_wood/0011`

**barrel_rust (2):** `barrel_rust/0008`, `barrel_rust/0010`

**singletons:** `interior/W2/floor-1/bottle/002`,
`interior/W2/floor-1/chair/003`, `plank_b/0039`,
`interior/W2/floor-1/table_small/002`, `planter/0020`, `brick_b/0037`,
`plank_a/0007`, `palm_trunk/0002`, `generated/jersey|2.100|0.020|47.500`

### K4. review-penetration — 5 generated embeds

Rocks and jersey barriers sunk 5–13 cm into sand/dirt at the map edge.
Authored grounding, same as `barrierGrounding` / seam scatter. Keep.

- `generated/rock_b|22.787|0.060|-43.946` (−5.3 cm into sand)
- `generated/rock_b|23.381|0.060|-43.882` (−5.4 cm)
- `generated/rock_a|22.971|0.060|-43.747` (−5.7 cm)
- `generated/jersey|-2.100|0.020|47.500` (−9.4 cm)
- `generated/jersey|-0.000|0.020|47.500` (−12.5 cm)

### K5. Collision overlaps — 829, keep

`analyze-map-issues.mjs` AABB pairs. Almost all are authored:

- wreck × jersey / block / stall / rebar — barricades around burnt cars
- stall × crate / barrel / box — market goods inside the stall volume
- crate × crate_flat — stacks
- water_tank × sat_dish / roof_vent / pallet — roof kit
- tyre × tyre_small — interleaved stacks (the detector already special-cases
  these as wedged for the float check)
- `crate_b/0024` × `planter/0009` — both are REMOVE cluster I, so the overlap
  dies with them

Do not delete overlap partners to “clean” the dump. The only optional visual
nudge is C6 (`chair/0004` × `water_tank/0017`).

### K6. Detector fixtures — 7, keep as fixtures

Already deleted from the world in PR #194. Re-injected only so the analyzer
still has known true positives. Do not restore them.

| Fixture ID | Prototype | Y | Gap |
|---|---|---|---|
| `fixture/west-roof-jerry-can` | jerry_can | 6.64 | 2.90 |
| `fixture/mid-roof-stool` | stool | 6.65 | 3.06 |
| `fixture/bn2-facade-stool` | stool | 6.65 | 3.73 |
| `fixture/e1-south-tyre` | tyre_small | 6.64 | 3.04 |
| `fixture/e2-roof-box` | box_card_b | 6.64 | 3.02 |
| `fixture/west-water-tank` | water_tank | 6.52 | 2.02 |
| `fixture/w2-sandbag` | sandbag_a | 0.97 | 0.69 |

### K7. Rampart sandbags — 48 supported + 2 overhang

50 generated bags with Y > 6. 48 are `supported`/`contact`. The two overhangs
are in K2 and already smoke-pinned. Keep the whole run.

### K8. Already-supported representatives

Not in the 462. Listed so they are not “fixed” by accident:

- `water_tank/0001` — supported (roof tank on pallet)
- `box_card_a/0002` — supported
- `crate_b/0040`, `box_card_b/0027` — supported

---

## Suggested implementation order

1. **REMOVE the 42** in `tools/worldgen/placements/{east-side,west-side,north-street,south-street,mid-street}.js`. Update `PREVIOUS_UNSUPPORTED_IDS` and the omitted-ID list in `tools/smoke-floating-props.mjs` / `tools/lib/support-fixtures.mjs`.
2. **Tag the 52 balconies** with `support: 'balcony'`. Flip the five smoke `review-balcony` expectations to `supported`.
3. **Lower C2–C4** (16 + 3 + 4). Flip `planter/0024` smoke from `review-gap` to `supported`.
4. **Snap C5 crate stacks.** Flip `crate_a/0019` smoke from `review-gap` to `supported`. Re-run `analyze-prop-support.mjs --all` and confirm the four inherited crate flags cleared.
5. Optional C6 chair nudge.
6. `npm test` (especially `smoke-floating-props.mjs`) and `npm run world` only if a later PR ships the placement edits — this plan file does not regenerate assets.

Do not touch detector thresholds to make KEEP items turn green. The 4 cm
contact / overhang / unclassified-seat flags are working as designed; the
actionable bugs are the 42 mid-air props and the ~32 Y/tag mismatches.

## Count check

| Bucket | Count |
|---|---|
| REMOVE (unsupported, gap > 0.5 m) | 42 |
| CHANGE C1 balcony tags | 52 |
| CHANGE C2 ground lower | 16 |
| CHANGE C3 interior sandbags | 3 |
| CHANGE C4 terrace hover | 4 |
| CHANGE C5 crate snap | 9 |
| KEEP K1 review-gap < 8 cm | 79 |
| KEEP K2 review-overhang | 192 |
| KEEP K3 unclassified-seat | 60 |
| KEEP K4 review-penetration | 5 |
| **Analyzer suspicious total** | **462** |
| Collision floats / blocked doors | 0 / 0 |
| Collision overlaps | 829, keep (1 optional nudge) |
| Fixtures | 7, keep as fixtures |

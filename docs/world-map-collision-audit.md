# World map collision audit and fix plan

## Verdict

Both claims are valid, with one qualification:

1. **Standing door traversal is broken on two visibly open entrances:** E1's street door and E3's street door. A standing capsule stops at the lintel; the crouched capsule passes. W2's open shopfront passes while standing and is the control case. Closed decorative door leaves were not counted as traversal defects.
2. **There are 25 actionable accidental prop-overlap clusters:** 16 among stable placement records (36 objects), plus 9 involving procedurally generated instances (18 object references in the current deterministic build). The audit also found many intentional contacts—goods on shelves/stalls, debris in wrecks, stacked tyres/sandbags—which are not defects and should not be separated.

This is an audit/plan only. No game or world source has been changed.

## Evidence and method

- Built the authored world and inspected all **8,139 instances**.
- Broad-phase AABB scan produced **1,101 candidates**. Of those, **286 pairs involve at least one procedural (`_auto/*`) instance**; 13 exceed `0.10 m³` and 4 exceed `0.20 m³`.
- Because AABBs over-report rotated and intentionally nested props, I rendered and reviewed every candidate above `0.20 m³`, same-prototype near-duplicates, and all procedural candidates above `0.10 m³` plus the next material interior candidates.
- Tested doorway traversal against the shipped static collision with the real `0.32 m`-radius character controller at standing (`1.78 m`) and crouched (`1.12 m`) heights.
- Excluded micro-rubble, foliage, merchandise intentionally seated on shelves/stalls, wreck debris, and deliberate stacks. Independent furnishings occupying the same space are included.

### Door evidence

![Door clearance evidence](world-map-collision-audit/01-door-clearance.jpg)

| Opening | Standing result | Crouched result | Finding |
|---|---:|---:|---|
| W2 open shopfront | Pass | Pass | Control; no change needed |
| E1 street door | Stops after ~`1.02 m` | Passes `2.48–3.00 m` | Confirmed |
| E3 street door | Stops after ~`0.89 m` | Passes `2.66–3.07 m` | Confirmed |

**Root cause:** ground-floor door holes end at `2.16 m`, while the solid building plinth makes the effective interior floor top approximately `0.42 m`. That leaves only `1.74 m` of clearance—less than the `1.78 m` standing capsule before collision skin. The shopfront ends at `2.61 m`, so it remains passable.

### Prop evidence

![Large and duplicate prop overlaps](world-map-collision-audit/02-prop-overlaps.jpg)

![AC-unit overlap locations](world-map-collision-audit/03-ac-overlaps.jpg)

![Procedural overlap review](world-map-collision-audit/04-procedural-overlaps-review.jpg)

Dark AC faces in the second sheet are backlit façades, not missing meshes. In each frame, two authored units overlap enough to read as one widened or fused unit. The procedural sheet includes the actionable pairs below and review controls such as shelf goods and authored debris.

## Complete confirmed object list

Coordinates are level-space metres. “Move” means edit the named record in `tools/worldgen/placements/`; generated GLBs must not be hand-edited. `_auto/*` labels identify the current deterministic build only and will renumber when generator output changes.

### A. BS3 rooftop cluster — 6 objects

Source: `tools/worldgen/placements/south-street.js`

| Object | Position | Planned change |
|---|---:|---|
| `water_tank/0024` | `(-2.91, 12.62, -52.04)` | Keep as the cluster anchor |
| `water_tank/0025` | `(-3.83, 12.62, -52.40)` | Move to leave at least `0.25 m` shell clearance |
| `water_tank/0028` | `(-4.84, 12.62, -52.90)` | Move away from tank, dish, and crates |
| `sat_dish/0025` | `(-4.65, 12.62, -52.76)` | Relocate to an open roof quadrant |
| `crate_a/0026` | `(-5.28, 13.13, -52.86)` | Seat on the roof beside, not inside, the tank |
| `crate_flat/0021` | `(-5.18, 12.60, -53.00)` | Move with the crate stack or remove if redundant |

### B. Overlapping AC pairs — 20 objects in 10 locations

| Objects | Source | Location | Planned change |
|---|---|---:|---|
| `ac_unit/0009`, `ac_unit/0010` | `mid-street.js` | W4 façade | Move one along the façade; keep `≥0.20 m` gap |
| `ac_unit/0017`, `ac_unit/0018` | `west-side.js` | BW2 façade | Separate the pair |
| `ac_unit/0073`, `ac_unit/0074` | `east-side.js` | BE1 façade | Separate the pair |
| `ac_unit/0083`, `ac_unit/0084` | `east-side.js` | BE3 façade | Separate the pair |
| `ac_unit/0101`, `ac_unit/0102` | `east-side.js` | BN2 corner | Pull both away from the corner and each other |
| `ac_unit/0024`, `ac_unit/0025` | `east-side.js` | E5 corner | Pull both away from the corner and each other |
| `ac_unit/0061`, `ac_unit/0062` | `west-side.js` | BW1 façade | Separate the pair |
| `ac_unit/0080`, `ac_unit/0081` | `east-side.js` | BE2 façade | Separate the pair |
| `ac_unit/0095`, `ac_unit/0096` | `south-street.js` | BS3 façade | Separate the pair |
| `ac_unit/0006`, `ac_unit/0007` | `west-side.js` | BW2 north façade | Separate the pair |

Use one AC prototype width plus `0.20 m` as the placement pitch. Corner pairs need clearance measured against both façades, not just against each other.

### C. Other near-duplicate pairs — 10 objects in 5 locations

| Objects | Source | Evidence | Planned change |
|---|---|---|---|
| `planter/0013`, `planter/0014` | `west-side.js` | `overlap-planters-west` | Keep one or separate by one planter width |
| `planter/0022`, `planter/0023` | `south-street.js` | `overlap-planters-east` | Keep one or separate by one planter width |
| `sat_dish/0005`, `sat_dish/0006` | `west-side.js` | `overlap-sat-dishes` | Move one dish so bowls and mounts do not cross |
| `gas_bottle/0002`, `gas_bottle/0003` | `mid-street.js` | `overlap-gas-bottles` | Delete the accidental duplicate or offset it into a believable pair |
| `box_card_a/0012`, `box_card_a/0013` | `north-street.js` | `overlap-card-boxes` | Delete one duplicate or build a non-intersecting stack |

### D. Procedurally generated overlaps — 18 object references in 9 locations

These cannot be fixed by editing generated `_auto` IDs. Fix the generator rule in `tools/worldgen/interiors.js` or the set-piece rule in `tools/worldgen/dressing.js`.

| Current-build objects | Level location | Source pattern | Planned change |
|---|---:|---|---|
| `_auto/0414` (`jersey`), `block_big/0007` | `(-2.20, 0.00, -39.90)` | Perimeter/set-piece dressing | Reserve the barricade footprint before placing the jersey |
| `_auto/0165` (`barrel_wood`), `_auto/0477` (`shelf`) | `(15.12, 0.13, 15.47)` | E1 ground-floor shop furnishing | Keep the fixed barrel out of side-wall shelf spans |
| `_auto/0158` (`barrel_wood`), `_auto/0509` (`cabinet`) | `(-9.59, 3.46, 0.62)` | W2 upper-floor furnishing | Reserve the cabinet footprint before floor-row clutter |
| `_auto/0153` (`barrel_wood`), `_auto/0472` (`shelf`) | `(-13.58, 0.14, -7.09)` | W2 ground-floor furnishing | Keep barrels out of shelf footprints |
| `_auto/0462`, `_auto/0463` (`pallet`) | `(-14.74, 0.14, -13.88)` | W3 storage random spots | Reject a storage spot that overlaps an accepted large prop |
| `_auto/0075` (`box_card_a`), `_auto/0510` (`cabinet`) | `(-15.71, 3.46, -2.10)` | W2 upper-floor furnishing | Reserve cabinet clearance before adding loose boxes |
| `_auto/0079` (`box_card_a`), `_auto/0164` (`barrel_wood`) | `(-18.79, 0.14, -24.33)` | W3 ground-floor furnishing | Re-roll loose clutter outside the barrel footprint |
| `_auto/0170` (`barrel_wood`), `rebar/0003` | `(7.05, 0.14, -15.08)` | E3 ruin/street dressing | Move the generated barrel or reserve the authored rebar footprint |
| `_auto/0162` (`barrel_wood`), `_auto/0485` (`mattress`) | `(-20.87, 3.46, 3.70)` | W2 living-room furnishing | Reserve the mattress footprint before wall clutter |

The remaining procedural broad-phase pairs are expected contacts or non-actionable AABB false positives: shelf goods touching boards, stacked crates/pallet loads, multi-course sandbags, gate reinforcement, and small rotated clutter whose boxes overlap while meshes do not.

## Implementation plan

### 1. Fix the actual floor/door contract

Files: `tools/worldgen/buildings.js`, potentially `tools/worldgen/layout.js`

- Define one ground-floor surface height from the collision-producing plinth instead of authoring furnishings at `0.13 m` while collision resolves at `0.42 m`.
- Preserve door bottoms, but raise **enterable ground-floor door tops** to at least:

  ```text
  effective floor + player height + collision margin
  0.42 + 1.78 + 0.12 = 2.32 m minimum
  ```

- Use approximately `2.40 m` clear height for E1 and E3 so normal controller step-up cannot push the capsule into the lintel.
- Apply the same clearance rule to open interior partition doors. Do not turn closed decorative façade leaves into entrances.
- Keep W2's open shopfront unchanged except as a regression control.

### 2. Re-layout the 36 stable-placement props

Files:

- `tools/worldgen/placements/east-side.js`
- `tools/worldgen/placements/mid-street.js`
- `tools/worldgen/placements/north-street.js`
- `tools/worldgen/placements/south-street.js`
- `tools/worldgen/placements/west-side.js`

Order of work:

1. Spread the BS3 roof cluster while preserving its silhouette from street level.
2. Separate the 10 AC pairs using a consistent façade pitch.
3. Remove or offset exact duplicates (`gas_bottle`, `box_card_a`).
4. Separate planter and satellite-dish pairs.
5. Re-run the overlap scan after every placement group; do not “fix” deliberate stall, wreck, rubble, sandbag, or tyre contacts.

### 3. Make procedural furnishing occupancy-aware

File: `tools/worldgen/interiors.js`; set-piece exclusions in `tools/worldgen/dressing.js`

- Add a simple per-room list of accepted large-prop footprints. Before placing cabinets, shelves, mattresses, barrels, pallets, or crate stacks, reject/re-roll candidates that overlap an accepted footprint plus a small clearance.
- Place fixed anchors first (doors, cabinets, counters, shelves, mattresses), then random floor clutter. Small goods intentionally placed on a shelf/table inherit that support and bypass the floor-footprint check.
- Pass authored obstacle footprints near procedural set pieces so gate barriers and ruin rebar are not repopulated by random large props.
- Keep the implementation deterministic: rejection uses the existing seeded RNG and a bounded attempt count.

### 4. Add regression coverage

- Extend `tools/world-smoke.mjs` with character-controller traversals through E1 and E3 in both directions. Standing must pass; the W2 shopfront remains the control.
- Add an offline overlap check for both stable placements and generated large props. Use transformed geometry/OBBs or a narrow phase; raw AABBs alone create too many false positives.
- Maintain a small explicit allow-list for intentional assemblies such as wreck debris, shelf goods, and stall merchandise. New unlisted overlaps should fail with prototype names, coordinates, and stable IDs where available.

### 5. Regenerate and validate

Run:

```bash
npm run world
npm run world -- --check
npm run world:validate
npm run world:smoke
npm test
npm run lint
npm run build
node tools/capture.mjs
```

Then recapture the four audit sheets and compare:

- standing capsules cross E1/E3 without crouching or head contact;
- all 25 actionable prop clusters are separated;
- intentional stacks still look grounded;
- roof/facade silhouettes and canonical shots do not regress.

## Acceptance criteria

- E1 and E3 open street entrances pass a `1.78 m × 0.32 m` standing capsule in both directions with at least `0.12 m` vertical margin.
- No confirmed object pair listed above intersects after world generation.
- The narrow-phase audit reports no new unapproved large-prop overlap.
- World assets are deterministic and all validation/build commands pass.

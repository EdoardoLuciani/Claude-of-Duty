# World collision fixes — per-cluster before/after gallery

Each image uses the same level-space camera for the pre-fix world (`dfbae9d`, left) and a fixed revision on the right. The seven follow-up views use `5e8c9d4`; the other views use `2722528`. Procedural `_auto/*` IDs refer to the pre-fix deterministic build; generator changes renumbered or replaced some of those instances.

## Stable props

### 1. BS3 rooftop cluster

`water_tank/0024`, `water_tank/0025`, `water_tank/0028`, `sat_dish/0025`, `crate_a/0026`, `crate_flat/0021`. Follow-up: `crate_a/0027` is seated directly on the roof after its former support stack was removed.

![BS3 rooftop cluster](01-bs3-rooftop-cluster.jpg)

### 2. Satellite-dish pair

`sat_dish/0005`, `sat_dish/0006`

![Satellite-dish pair](02-satellite-dish-pair.jpg)

### 3. Gas-bottle pair

`gas_bottle/0002`, `gas_bottle/0003`

![Gas-bottle pair](03-gas-bottle-pair.jpg)

### 4. Cardboard-box pair

`box_card_a/0012`, `box_card_a/0013`

![Cardboard-box pair](04-cardboard-box-pair.jpg)

### 5. West planter pair

`planter/0013`, `planter/0014`. Resolution: retain `0013`; remove redundant `0014` rather than moving it into the next balcony.

![West planter pair](05-west-planter-pair.jpg)

### 6. East planter pair

`planter/0022`, `planter/0023`. Resolution: retain `0022`; remove redundant `0023` rather than moving it into the next balcony.

![East planter pair](06-east-planter-pair.jpg)

## AC-unit pairs

### 7. W4 façade

`ac_unit/0009`, `ac_unit/0010`

![W4 AC pair](07-ac-w4.jpg)

### 8. BW2 west façade

`ac_unit/0017`, `ac_unit/0018`

![BW2 west AC pair](08-ac-bw2-west.jpg)

### 9. BE1 façade

`ac_unit/0073`, `ac_unit/0074`. Resolution: retain the backed wall unit; remove window-obstructing `0074`.

![BE1 AC pair](09-ac-be1.jpg)

### 10. BE3 façade

`ac_unit/0083`, `ac_unit/0084`

![BE3 AC pair](10-ac-be3.jpg)

### 11. BN2 corner

`ac_unit/0101`, `ac_unit/0102`

![BN2 AC pair](11-ac-bn2.jpg)

### 12. E5 corner

`ac_unit/0024`, `ac_unit/0025`. Resolution: remove both redundant units because neither available corner position clears the windows.

![E5 AC pair](12-ac-e5.jpg)

### 13. BW1 façade

`ac_unit/0061`, `ac_unit/0062`. Resolution: remove both redundant units because the gap between windows cannot hold one cleanly.

![BW1 AC pair](13-ac-bw1.jpg)

### 14. BE2 façade

`ac_unit/0080`, `ac_unit/0081`. Resolution: retain `0080`; remove window-obstructing `0081`.

![BE2 AC pair](14-ac-be2.jpg)

### 15. BS3 façade

`ac_unit/0095`, `ac_unit/0096`

![BS3 AC pair](15-ac-bs3.jpg)

### 16. BW2 north façade

`ac_unit/0006`, `ac_unit/0007`

![BW2 north AC pair](16-ac-bw2-north.jpg)

## Procedurally generated collisions

### 17. Gate jersey and concrete block

`_auto/0414` (`jersey`), `block_big/0007`

![Gate jersey and concrete block](17-gate-jersey-block.jpg)

### 18. E1 barrel and shelf

`_auto/0165` (`barrel_wood`), `_auto/0477` (`shelf`)

![E1 barrel and shelf](18-e1-barrel-shelf.jpg)

### 19. W2 upper-floor barrel and cabinet

`_auto/0158` (`barrel_wood`), `_auto/0509` (`cabinet`)

![W2 upper-floor barrel and cabinet](19-w2-upper-barrel-cabinet.jpg)

### 20. W2 ground-floor barrel and shelf

`_auto/0153` (`barrel_wood`), `_auto/0472` (`shelf`)

![W2 ground-floor barrel and shelf](20-w2-barrel-shelf.jpg)

### 21. W3 pallet pair

`_auto/0462`, `_auto/0463` (`pallet`)

![W3 pallet pair](21-w3-pallet-pair.jpg)

### 22. W2 upper-floor box and cabinet

`_auto/0075` (`box_card_a`), `_auto/0510` (`cabinet`)

![W2 upper-floor box and cabinet](22-w2-upper-box-cabinet.jpg)

### 23. W3 box and barrel

`_auto/0079` (`box_card_a`), `_auto/0164` (`barrel_wood`)

![W3 box and barrel](23-w3-box-barrel.jpg)

### 24. E3 barrel and rebar

`_auto/0170` (`barrel_wood`), `rebar/0003`

![E3 barrel and rebar](24-e3-barrel-rebar.jpg)

### 25. W2 mattress and barrel

`_auto/0162` (`barrel_wood`), `_auto/0485` (`mattress`)

![W2 mattress and barrel](25-w2-mattress-barrel.jpg)

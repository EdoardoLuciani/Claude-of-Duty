# Shotgun — Implementation Plan

A close-range **pump-action 12-gauge** added as a market purchase that replaces
the SMG in the secondary slot. Audio, muzzle flash and sample beds already
exist; the missing work is the weapon itself: def, mesh, pellet fire, pump
cycle, tube reload, market swap, and smoke coverage.

Work lives on branch `feat/shotgun` in the worktree
`/home/edoardo/Documents/Claude-of-Duty-shotgun`.

## Locked decisions

| decision | choice |
|---|---|
| Identity | **M-590** — Mossberg 590-flavoured pump, 18.5" barrel, ghost-ring + bead, 6+1 tube, black polymer furniture |
| Slot | **secondary**. Buying it **replaces the SMG** (Digit2), mirroring LMG ↔ rifle. Spawn loadout stays rifle / smg / pistol. No 4th slot, no Digit4 |
| Cost | **1000** credits — cheaper than the EVOLYS (1200), dearer than the M4 (900). Wave-1 income (~850) cannot buy it; wave 2 can |
| Fire | **pump, semi only**. One trigger pull = one shell. The pump animation *is* the cyclic rate |
| Payload | **8 pellets of 00 buck** (Federal FliteControl). Each pellet is a real projectile. Tight cone: lethal on a torso to ~40 m, not a 10 m party trick |
| Reload | **tube, one shell at a time**, interruptible. Empty reload chambers the first shell and pumps, then fills the tube |
| Action | After every shot the support hand racks the forend. Cannot fire again until the pump finishes |
| Tracers | **none**. Buckshot has no tracer element; muzzle flash + pellet impacts carry the shot |
| Brass | 12-gauge hull via existing `weapon:shell` scale (`caseLen` / `rimR`). First pass uses the 5.56 lathe scaled fat; a dedicated hull mesh is out of scope |
| Audio / FX | **reuse**. `src/audio/weapons.js` already has `WEAPON_PROFILES.shotgun` (incl. `pellets: 6` spatters and `mechDelay: 0.16`); `src/fx/muzzle.js` already has a shotgun muzzle. Set `class: 'shotgun'` / `fxClass: 'shotgun'` and they resolve for free |
| Materials | **no new slots**. Polymer + steel + rubber from the existing weapon library. 590A1-black, not wood |

## Why these choices

**Pump, not semi-auto.** The audio profile is already a pump: `mechDelay: 0.16`
and a Mossberg Model 190 sample bed (`src/audio/samples/LICENSE.md`). A Benelli
M1014 would fight that bed and collapse into "loud rifle". The pump is also the
only new *feel* we can add — every current gun is mag-fed semi/auto.

**Replace the SMG, not a 4th slot.** `ACTIONS.swapWeapon` is Digit1/2/3 + Tab.
The LMG already established "market weapon replaces a spawn gun, no extra
key." A shotgun is the close-range complement of the MPX the same way the
EVOLYS is the heavy complement of the M4. Digit4 would collide with the radio
request keys and with the shop hotkeys.

**Pellets are real projectiles, not a hitscan cone.** `ProjectileSim` already
steps gravity + drag and hands contact to `physics.fireBullet`. Eight 20-damage
pellets with high drag and a 60 m max range *are* a shotgun: lethal inside a
room, a tickle across the street. Pool budget is 96 live rounds — six shells
in the air is 48 pellets, well inside the cap.

**Tube reload, not a Saiga mag.** A magazine-fed 12-gauge would reuse
`clips.js` as-is and play as a slow SMG. The tube is the other half of "this
is a shotgun": interruptible, one-at-a-time, you can shoot mid-reload if a
round is chambered.

**No new audio/FX work.** Those subsystems already special-case `shotgun`.
Do not add sample files, do not retune the muzzle profile unless playtest
shows the existing 330 cd / 1.5× scale flash is wrong on *this* mesh.

## Identity and numbers

All values live in `WEAPON_DEFS.shotgun`. Real 12-gauge 00 buck from an 18.5"
barrel, then game-tuned the same way the M4's 5.56 is.

```js
shotgun: {
  id: 'shotgun',
  label: 'M-590',
  class: 'shotgun',
  caliber: '12g',
  rpm: 120,                 // pump cycle ~500 ms
  modes: ['semi'],
  magSize: 6,               // tube
  reserve: 30,              // five tubes
  chambered: true,          // 6+1 when topped off
  pellets: 8,
  muzzleVelocity: 400,
  damage: 20,               // per pellet; 160 at the muzzle
  penetration: 0.28,
  dropoff: 0.55,
  maxRange: 90,
  dragK: 0.38,
  tracerEvery: 0,           // never
  spreadHip: 1.2,           // FliteControl-tight; a soldier at 25 m, not a room
  spreadAds: 0.32,
  spreadPerShot: 0.08,      // almost none — the cone is the spread
  spreadMax: 4.2,
  spreadDecay: 6.0,
  recoil: {
    pitch: 0.028,           // biggest single-shot flip in the game
    yaw: 0.0055,
    kickBack: 0.038,
    kickUp: 0.016,
    roll: 0.04,
    punch: 0.55,
    freq: 6.4,
    damping: 0.38,
    adsScale: 0.82,
    crouchScale: 0.9,
    patternLength: 7,
    patternSeed: 0x590b00,
    climbShape: [1],        // no automatic climb; each shot is its own kick
    drift: 1.1,
  },
  adsTime: 0.20,
  adsFov: 0.82,
  viewFov: 0.90,
  reloadTac: 0.55,          // seconds PER SHELL
  reloadEmpty: 0.95,        // first shell + pump, then 0.55 each
  inspectTime: 3.0,
  drawTime: 0.70,
  holsterTime: 0.45,
  action: 'pump',
  reloadStyle: 'tube',
  // pose — solved from the bore the same way as the rifle; tune in preview
  hipPos: [0.118, -0.175, -0.30],
  hipRot: [-0.05, 0.078, -0.125],
  adsCant: [0, 0, 0.003],
  eyeRelief: 0.28,          // ghost ring, not a tube optic
  sprintPos: [0.09, -0.27, -0.28],
  sprintRot: [-0.42, 0.58, 0.2],
  lowReadyPos: [0.11, -0.29, -0.29],
  lowReadyRot: [-0.48, 0.12, -0.09],
  swayScale: 1.05,
  bobScale: 1.05,
  magLen: 0.07,             // a 12g hull, used by the insert clip
}
```

Damage math, so it is not retuned later by feel:

- Unarmoured soldier ≈ 100 HP. 5 pellets connect → dead. Inside 12 m the cone
  puts 6–8 on a torso.
- Armour halves incoming while a plate remains. Close buck still strips a
  plate and leaves the target staggered; it is not a long-range plate-breaker.
- At 30 m the cone is ~1.8 m across (ADS) and drag has eaten ~40 % of damage.
  Two or three pellets land for ~25–35 — a chip, not a kill. That is the
  intended drop-off.

## Architecture

The LMG is the template. Follow it, then layer the two shotgun-only mechanics
(pellets, tube/pump) on top. Do not invent a fourth weapon slot.

```
defs.js            WEAPON_IDS += 'shotgun'; WEAPON_DEFS.shotgun = {…}
models/shotgun.js  NEW  buildShotgun() — same record shape as buildLmg()
parts.js           add pump forend, tube, receiver, stock helpers (only what
                   the mesh actually shares; do not generalise the AR kit)
clips.js           tube-reload + pump clips, gated on def.reloadStyle / action
index.js           pellet spawn in tryFire; tube reload state machine;
                   equipSecondary(); Digit2 resolves smg|shotgun
viewmodel.js       pump forend as a moving part; hand pose gripShotgun
hands.js           gripShotgun pose (thicker wrist-to-tang than grip)
export-models.mjs  builders.shotgun = buildShotgun
preview.js         register the builder
smoke-inspect.mjs  register the builder
market/index.js    catalog row + _level + equipSecondary
weapons/index.js   owned-set swap (smg ↔ shotgun), resetForNewGame
tools/smoke-shotgun.mjs   NEW — mirrors smoke-lmg.mjs
tools/smoke-market.mjs    fake weapons grow a shotgun state
tools/smoke-lmg.mjs       WEAPON_IDS assertion grows by one
package.json       test script adds smoke-shotgun.mjs
```

Do **not** touch `src/audio/**`, `src/fx/**`, `src/core/input.js`, or
`ACTIONS.swapWeapon`. Those already do the right thing once `class`/`fxClass`
is `'shotgun'` and Digit2 is remapped the same way Digit1 is remapped for the
LMG.

## Files

### 1. `src/weapons/defs.js`

Append `'shotgun'` to `WEAPON_IDS`. Add the def block above. `buildRecoilPattern`
needs no change — `climbShape: [1]` already works for the pistol.

`tracerEvery: 0` must be honoured: today's spawn does
`this.stats.fired % def.tracerEvery === 0`, which is a divide-by-zero. Guard
in `tryFire` (`def.tracerEvery > 0 && fired % def.tracerEvery === 0`). That
guard is also the right behaviour for any future weapon that does not trace.

### 2. NEW `src/weapons/models/shotgun.js` — `buildShotgun()`

Same return contract as `buildLmg()` / `buildRifle()`:

```
{ id, label, fxClass, body, moving, nodes, shell, magSize }
```

Layout (weapon-local metres, origin at the shooting-hand thumb web):

| landmark | value |
|---|---|
| bore axis | y = +0.068 |
| receiver | z = +0.05 .. −0.16, flat-sided, loading port on the belly |
| barrel | 18.5" from breech, crown at z ≈ −0.52 |
| magazine tube | under the barrel, same length as the barrel minus the cap |
| pump forend | around the tube, z = −0.18 .. −0.32 at rest |
| stock | full-length, butt at z ≈ +0.26 |
| sight | ghost ring at the rear of the receiver; bead at the muzzle |
| ejection | right-side port, 12g hull |

`moving` parts:

- `magazine` — a single 12g hull used by the insert clip (the "fresh shell"
  the support hand brings up). The tube itself is on `body`.
- `charging` / pump forend — the sliding wood-or-polymer pump. Driven by the
  same `charge` channel the SMG charging handle already uses.
- `bolt` — the elevator / bolt that comes back with the pump (short travel).
- `trigger`

`nodes` must include everything `viewmodel.addWeapon` already reads
(`muzzle`, `chamber`, `eject`, `ejectDir`, `sight`, `sightAxis`, `ironSight`,
`gripR`, `gripL`, `handguard`, `magSeat`, `magDrop`, `chargeRest`,
`chargePull`, `boltRest`, `boltTravel`, `triggerPivot`, `triggerPull`).
`handguard` is the pump forend envelope so `Arm.fitToCylinder` grounds the
support hand on the pump, not on air.

`shell: { caseLen: 0.070, rimR: 0.010 }` — a 12-gauge 2¾" hull. The FX lathe
will look more like a fat rifle case than a crimped hull; that is accepted.

Author against published 590 dimensions the same way the EVOLYS was authored
against FN's data sheet. Review in `/src/weapons/preview.html?w=shotgun`.

### 3. `src/weapons/parts.js` — only the helpers the mesh needs

Keep these local and specific. Candidates:

- `addPumpForend(asm, matPoly, matSteel, o)` — ribbed slide around a tube
- `addMagTube(asm, matSteel, o)` — underbarrel tube + spring cap
- `buildShell(asm, o)` — 12g hull (straight wall, brass head, crimp)
- `addGhostRing(asm, …)` — rear aperture; front bead can be a dome on the barrel

Do **not** extend `addUpperReceiver` / `addLowerReceiver` / `addCarbineStock`
to "also do shotguns". Those are AR parts.

### 4. `src/weapons/clips.js` — tube reload + pump

Gate on the def, leave every existing weapon on the current mag-swap clips.

**`reloadTac` (tube, chambered):** support hand leaves the pump, dips off-frame,
comes back with a hull, seats it through the loading port, returns to the
pump. Duration = `def.reloadTac` (0.55 s). Events: `start`, `shellin`, `end`.
No `magout` / `magdrop`.

**`reloadEmpty`:** open the action (pump back), insert the first hull into the
ejection port / elevator (`shellin` → goes to the chamber), pump forward
(`boltrelease`), then the same insert loop as tactical. Duration =
`def.reloadEmpty` for the first shell only.

**`pump` (new clip):** support hand rides `chargeRest → chargePull → rest`
over ~0.45 s. Events: `pump`, `end`. The weapon dips a few degrees as the
forend comes back. This clip is what `tryFire` starts after a shot when
`def.action === 'pump'`.

Inspect / draw / holster stay generic; add an `inspectPoses.shotgun` block
next to `lmg` so the long barrel fits the frame.

### 5. `src/weapons/index.js` — fire, reload, ownership

**Pellets.** In `tryFire`, if `def.pellets > 1`, spawn `def.pellets` rounds
instead of one. Each pellet gets its own disc sample in the current spread
cone (reuse `_right` / `_up` / `_disc`; do not allocate). One `weapon:fire`
event, one muzzle flash, one shell. `stats.fired` increments by 1 (shells,
not pellets) so HUD and audio stay honest.

```
const n = def.pellets ?? 1;
for (let i = 0; i < n; i++) {
  // resample dir inside the cone; spawn
}
```

Guard the tracer modulo as noted in §1.

**Pump.** After a successful shot, if `def.action === 'pump'`, start the
`pump` clip. `_fireTimer` is already `60 / rpm` = 0.5 s, which covers the
clip. `canFire` is already false while `_fireTimer > 0`. Do not add a second
lock.

**Tube reload.**

```
reload() {
  if (def.reloadStyle === 'tube') return this._startTubeReload();
  // existing mag path
}
```

- `_startTubeReload()` no-ops if mag full or reserve empty or already
  reloading / switching / cooking.
- Empty (`!chambered && mag === 0`) plays `reloadEmpty` once; its `shellin`
  chambers and its pump releases the bolt. Further shells use `reloadTac`.
- On clip `end`, if `mag < magSize && reserve > 0 && !interrupted`, replay
  `reloadTac`. That is the loop.
- Interrupt: fire (if chambered), sprint, weapon switch, grenade, radio all
  `stopClip()` — same as today. A chambered tube-gun can shoot mid-reload;
  that is the point.
- `_completeReload` is **not** called. A new `_insertShell()` does
  `reserve--; if (!chambered) chambered = true; else mag++`.

**Ownership.** Twin of `equipPrimary`:

```
equipSecondary(id) {
  if ((id !== 'smg' && id !== 'shotgun') || this.owned.has(id)) return false;
  this.owned.delete(id === 'smg' ? 'shotgun' : 'smg');
  this.owned.add(id);
  // fresh mag / chamber / reserve, then setWeaponImmediate(id)
}
```

`resetForNewGame` restores `owned = {rifle, smg, pistol}`.

Digit2 already hard-codes `'smg'`. Change it the same way Digit1 already
resolves the LMG:

```
if (input.pressed('Digit2')) this.setWeapon(this.owned.has('shotgun') ? 'shotgun' : 'smg');
```

`equipPrimary` stays rifle/lmg-only. Do not merge the two helpers — they own
different slots.

### 6. `src/weapons/viewmodel.js` + `src/weapons/hands.js`

- `rhandPose`: `model.id === 'shotgun' ? 'gripShotgun' : …`
- `lhandPose`: pump forend uses `clamp` + `fitToCylinder` on the forend
  envelope, same path as the rifle handguard.
- New `gripShotgun` pose in `hands.js`: thicker grip, wrist a little further
  back than `grip` so the fingers clear a 590 trigger guard.

The pump forend is just `parts.charging`. The existing `charge` channel
already drives it. No new viewmodel channel.

### 7. Model pipeline

`tools/export-models.mjs`:

```
import { buildShotgun } from '../src/weapons/models/shotgun.js';
const builders = { …, shotgun: buildShotgun };
```

`WEAPON_IDS` drives the export loop, so appending the id is enough.

Same one-line register in `src/weapons/preview.js` and
`src/weapons/smoke-inspect.mjs`.

After the builder exists, `npm run models` writes `public/models/weapons/shotgun.glb`
+ `.json`. Do not hand-edit those files.

### 8. `src/market/index.js`

```
{ id: 'shotgun', label: 'M-590', cost: 1000, step: 1, max: 1 },
{ id: 'smg',     label: 'MPX-9', cost: 800,  step: 1, max: 1 },
```

`_level('shotgun'|'smg')` → `owns(id) ? 1 : 0`, same as lmg/rifle.

`buy()`: `else if (itemId === 'shotgun' || itemId === 'smg') this.weapons.equipSecondary(itemId);`
Keep `equipPrimary` for rifle/lmg. The current `else this.weapons.equipPrimary(itemId)`
catch-all is what made the LMG work; do not silently send the shotgun through it.

The overlay (`src/ui/market.js`) already renders one row per catalog item and
binds DigitN hotkeys from the catalog order. Adding two rows is enough. No UI
code change.

### 9. Tests

**NEW `tools/smoke-shotgun.mjs`**, same shape as `tools/smoke-lmg.mjs`:

- `WEAPON_IDS` contains `shotgun`; def has `pellets === 8`, `reloadStyle === 'tube'`, `action === 'pump'`, `modes === ['semi']`
- recoil pattern builds and is finite
- 12g hull scale: `setCaseScale({}, 0.070, 0.010)` is fatter *and* longer than 5.56
- `equipSecondary('shotgun')` drops the SMG, refreshes ammo, sets active
- cannot re-buy; swap back to SMG works
- `resetForNewGame` restores smg, forgets shotgun
- `refillAmmo` only tops owned guns
- Digit2 / `ACTIONS.swapWeapon` still has no Digit4
- pellet spawn: stub `sim.spawn` and assert `tryFire()` calls it 8 times and
  emits one pending shot (one `weapon:fire`)
- tube reload: `_insertShell` chambers first, then fills mag; stops at
  `magSize`; no-ops when reserve is 0
- `tracerEvery: 0` does not throw

**EDIT `tools/smoke-market.mjs`:** fake `weapons` grows a shotgun state and
`equipSecondary`. Assert buy shotgun replaces SMG; buy SMG replaces shotgun;
cannot buy the one you hold.

**EDIT `tools/smoke-lmg.mjs`:** `WEAPON_IDS` assertion becomes
`['rifle', 'smg', 'pistol', 'lmg', 'shotgun']`. Do not otherwise change it.

**EDIT `package.json`:**

```
"test": "node tools/smoke-market.mjs && node tools/smoke-lmg.mjs && node tools/smoke-grenades.mjs && node tools/smoke-shotgun.mjs"
```

`tools/smoke-grenades.mjs` already iterates `WEAPON_IDS`; once the def exists
it will construct shotgun state for free. If a grenade assertion assumes the
spawn trio only, fix the assertion, not the ID list.

### 10. Hands / inspect / preview follow-through

`src/weapons/smoke-inspect.mjs` already walks every `WEAPON_IDS` builder.
Register `buildShotgun` or inspect-smoke fails.

## Out of scope

- Slug alternate ammo, selectable chokes, or a fire-mode that fires one
  projectile. One load: 00 buck.
- A dedicated 12g hull particle mesh. Scaled 5.56 lathe is enough.
- New audio samples, new muzzle profile, new input keys.
- AI using the shotgun. Soldiers keep their existing loadouts.
- World pickups unique to 12-gauge. `AmmoPickups` already tops the *active*
  weapon's reserve; that is correct.
- Changing `MAX_LIVE` (96). Revisit only if a playtest actually exhausts it.
- A 4th inventory slot, or making the shotgun a spawn-default.

## Implementation order

The mesh is the long pole; the fire/reload code can be written and smoked
against a stub model. Do not wait for the last chamfer to land the mechanics.

1. **Defs + ownership + market + smoke** (no mesh). `WEAPON_IDS`, def numbers,
   `equipSecondary`, Digit2 remap, catalog rows, `smoke-shotgun.mjs` + market
   smoke updates. `npm test` green with a builder that returns a minimal
   record *or* with tests that do not yet call `buildShotgun`.
2. **Pellet fire + tracer guard.** Extend `tryFire`; unit-test spawn count
   against a stub `sim`.
3. **Tube reload + pump clip.** `clips.js` + the state machine in `index.js`.
   Smoke the insert / interrupt / empty-then-fill path.
4. **Mesh.** `models/shotgun.js` + any `parts.js` helpers. Iterate in
   `preview.html?w=shotgun`. Hands last (`gripShotgun`, forend envelope).
5. **Export.** Register the builder, `npm run models`, confirm
   `public/models/weapons/shotgun.{glb,json}` load through `models.getWeapon`.
6. **Close the loop.** `npm test` and `npm run build` both green. Playtest
   close-range lethality, 25 m chip damage, pump cadence, interrupt-reload-
   then-shoot.

## Invariants

- `npm test` and `npm run build` stay green.
- Spawn loadout remains rifle / smg / pistol. The shotgun is earned.
- `ACTIONS.swapWeapon` stays Digit1/2/3 + Tab.
- No new runtime dependencies.
- No `Math.random()` in fire or reload.
- No per-frame allocations in `tryFire` / pellet spread.
- Do not weaken existing smokes. If `WEAPON_IDS` assertions break, update
  them to include `shotgun` and say why.
- Do not edit `AGENTS.md`, workflows, or package manifests beyond the test
  script line.

## Open questions (do not block)

These can move during implementation if the preview or a playtest contradicts
the locked table. They are not design debates.

- Hip pose will be solved from the bore once the mesh exists, the same way
  the rifle's was. The numbers in the def are a starting point.
- 8 pellets / 20 damage / 3.4° hip cone is the first playable set. If a
  point-blank ADS blast does not kill, raise pellets or damage — do not
  tighten the cone to "rifle with extra bullets".
- If the scaled 5.56 hull looks absurd in first person (12g is 2× the
  diameter), add a straight-wall hull lathe in `fx/shells.js` as a follow-up,
  not in this pass.

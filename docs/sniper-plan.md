# Sniper Rifle — Implementation Plan

A new **bolt-action primary** that replaces the M4 / EVOLYS in the existing
three-slot loadout. Same integration path the LMG already carved
(`equipPrimary`, market catalog, GLB export, smoke tests). The new work is
the **magnified scope** and the **manual bolt cycle** — neither exists today.

Worktree: `/home/edoardo/Documents/Claude-of-Duty-sniper` on `feat/sniper-rifle`
(branched from `develop` @ `0d28f6a`).

---

## Locked decisions

| decision | choice | why |
|---|---|---|
| Identity | **AX-338** — Accuracy-International-style chassis rifle, **.338 Lapua Magnum** (8.6×70), 27" fluted barrel, 5-rd AICS mag, large tube scope | The LMG already owns 7.62×51. A second 7.62 gun is just a slower EVOLYS. .338 is a different case, a different report, and a different reason to buy the slot. `resolveProfile()` already matches `/338/`. |
| Action | **Bolt-action, semi only** | The unused `WEAPON_PROFILES.sniper.mechDelay = 0.19` is bolt timing. Semi-auto DMR would just be a slower M4. Bolt cycle is the distinctive loop. |
| Slot | **Primary swap**, not a 4th weapon | Spawn loadout stays rifle / smg / pistol. Digit1 still means "owned primary". LMG already established this contract; do not add Digit4. |
| Acquisition | Market purchase, **1500 credits**, mutually exclusive with M4 and EVOLYS | LMG is 1200, M4 is 900. Sniper is the most specialised primary. |
| Optic | **Real scope mesh in hipfire; 2D scope overlay at full ADS** | Looking through a modelled 4x tube from 90 mm is a straw. CoD-style: fade the gun at `adsT ≥ 0.85`, draw a circular vignette + mil reticle, let world FOV do the zoom. |
| World zoom | **Per-weapon `adsFov`**, finally wired | `def.adsFov` is dead today. Global `config.adsFovScale = 0.62` (~1.6×) is what every gun uses. Sniper needs ~4× (`adsFov: 0.25` → 20° from 80°). Sensitivity must track the same number. |
| Ballistics | Existing projectile sim, no hitscan | `ProjectileSim` already does gravity + drag. A .338 at 880 m/s across a 60 m street is a 68 ms flight — still visible, flatter than the LMG's 7.62. |
| Enemies | Unchanged | AI keeps its own carbine / AK meshes. Do not give soldiers the AX-338. |

---

## What already exists (do not rebuild)

- `WEAPON_PROFILES.sniper` + `src/audio/samples/sniper-1.wav` / `sniper-2.wav`
- `resolveProfile()` already matches `/snip|dmr|awp|barrett|338/`
- `MUZZLE_LIGHT.sniper = 130` in `src/fx/index.js`
- Semi fire mode (`_runTrigger` `default` branch = click → `tryFire()`)
- Chambered-round model, boltHold-on-empty, tactical vs empty reload
- Primary-slot ownership (`owned` Set, `equipPrimary`, Digit1 → owned primary)
- Market catalog is data-driven — overlay iterates `getHudState().items`
- `cartridge()` / `emptyCase()` already take `caseLen` + `rimR`; LMG 7.62 stays `0.051 / 0.005975`. Sniper gets its own .338 dimensions, not a reuse.
- Viewmodel ADS solve (sight node → camera axis at `eyeRelief`)
- Recoil patterns, spread mods, inspect/draw/holster clips

---

## Feel / numbers (all live in `defs.js`)

```js
sniper: {
  id: 'sniper',
  label: 'AX-338',
  class: 'sniper',          // audio + muzzle-light resolve off this
  caliber: '8.6x70',        // .338 Lapua Magnum — NOT the LMG's 7.62x51
  rpm: 48,                  // fallback only; boltTime owns the real cadence
  modes: ['semi'],
  boltAction: true,
  boltTime: 1.1,            // s — longer throw than a 7.62 bolt: bigger case, more lift
  magSize: 5,               // AICS .338 is a 5-rd box, not a 10-rd 7.62
  reserve: 20,              // 4 spare mags
  muzzleVelocity: 880,      // 27" .338, ~250 gr — faster AND heavier than the LMG
  damage: 145,              // still a torso one-shot vs AI 100; the extra is armour / range
  penetration: 2.1,         // punches further through cover than 7.62's 1.35
  dropoff: 0.88,            // holds damage at street + plaza ranges
  maxRange: 900,
  dragK: 0.14,              // high-BC boat-tail; flatter than the LMG's 0.22
  tracerEvery: 1,           // every round is a tracer so the shot is readable
  spreadHip: 3.8,
  spreadAds: 0.06,
  spreadPerShot: 0.7,
  spreadMax: 4.6,
  spreadDecay: 2.1,
  recoil: {
    pitch: 0.038,           // one brutal shove — bigger than a 7.62 bolt would be
    yaw: 0.0062,
    kickBack: 0.048,
    kickUp: 0.022,
    roll: 0.052,
    punch: 0.82,
    freq: 5.8,
    damping: 0.34,
    adsScale: 0.86,
    crouchScale: 0.9,
    patternLength: 5,
    patternSeed: 0x3381a9,
    climbShape: [1],
    drift: 0.28,
  },
  adsTime: 0.42,            // heavier rifle, slower shoulder than the M4's 0.22
  adsFov: 0.25,             // 80° → 20° ≈ 4.0×. THIS must drive the world camera.
  viewFov: 0.72,            // viewmodel camera tightens so the scope housing frames
  adsSensScale: 0.25,       // 1:1 screen-space tracking at 4× (see camera work)
  reloadTac: 2.8,
  reloadEmpty: 3.6,         // mag + bolt close
  inspectTime: 3.6,
  drawTime: 0.88,
  holsterTime: 0.56,
  eyeRelief: 0.09,          // used for the hip→ADS blend; overlay takes over at 0.85
  // hip / sprint / low-ready poses authored against the finished mesh, same
  // bore-axis method as the M4 (see defs.js rifle comments). Numbers below
  // are starting points — tune in /src/weapons/preview.html?w=sniper.
  hipPos: [0.124, -0.200, -0.34],
  hipRot: [-0.055, 0.078, -0.13],
  adsCant: [0, 0, 0],
  sprintPos: [0.088, -0.31, -0.30],
  sprintRot: [-0.46, 0.66, 0.22],
  lowReadyPos: [0.11, -0.32, -0.31],
  lowReadyRot: [-0.52, 0.12, -0.09],
  swayScale: 1.22,          // longer, heavier gun — more idle drift
  bobScale: 1.1,
  magLen: 0.118,            // short 5-rd AICS, taller than a 7.62 ten-rounder is wide
}
```

Tuning rule from AGENTS.md: these numbers stay in the def. Logic reads them.

---

## New systems (the actual work)

### 1. Bolt-action fire

Today `tryFire()` re-chambers instantly if `mag > 0`. A bolt gun must not.

```
tryFire():
  fire the chambered round          # existing
  s.chambered = false
  if mag == 0: boltHold = 1; return
  if def.boltAction:
    start bolt clip (boltTime)
    # chamber happens on the clip's 'chamber' beat
  else:
    mag--; chambered = true         # existing auto-loaders
```

- `_fireTimer = def.boltTime` so a second click during the cycle is a no-op
  (`canFire` already rejects `_fireTimer > 0`).
- New clip `cycle` in `clips.js`, keyed like reload: support hand stays on
  the forend, shooting hand goes to the bolt knob, bolt strokes, hand returns.
  Events: `bolt:open` (shell already queued), `chamber`, `bolt:close`, `end`.
- `_onClipEvent('chamber')` does `mag--; chambered = true`.
- Last-round: no cycle clip, bolt stays locked back (existing `boltHold`).
  Empty reload already racks the charge handle / closes the bolt.
- Viewmodel `boltCycle` on fire is the auto-loader stroke — skip it when
  `boltAction` (the clip owns the bolt).
- Shell still ejects via `_queueShell`, but delay it to the `bolt:open` beat
  (~0.25 s) rather than `0.45 * fireTimer`. A bolt gun throws brass when the
  bolt lifts, not at the primer.

Do **not** invent a new fire mode. `modes: ['semi']` plus `boltAction: true`
is enough. `cycleFireMode()` already no-ops on single-mode guns.

### 2. Per-weapon ADS magnification

`def.adsFov` is written on every gun and never read. Wire it.

| layer | today | sniper |
|---|---|---|
| World camera FOV | `cfg.fov * cfg.adsFovScale` (0.62, global) | `cfg.fov * lerp(1, def.adsFov, adsT)` |
| Look sensitivity | `cfg.adsSensScale` (0.62, global) | `lerp(1, def.adsSensScale ?? def.adsFov, adsT)` |
| Viewmodel FOV | `60 * lerp(1, def.viewFov, ads)` | unchanged, already per-weapon |
| Breath / sway | `CAMERA.breath.adsScale = 1.85` | keep — scoped sway is the tax |

Implementation, smallest surface:

- `WeaponSystem.update` already pushes `viewmodel.adsT` via
  `player.setAdsProgress`. Extend the push to also publish the weapon's
  `adsFov` / `adsSensScale` onto the player (two numbers on the existing
  player object, not a new event).
- `player/camera.js` FOV line becomes
  `lerp(1, this.adsFovScale, ads)` where `adsFovScale` defaults to
  `cfg.adsFovScale` and is overwritten by the weapon each frame.
- `player/index.js` look scaling uses the same published `adsSensScale`.
- Rifle / SMG / pistol / LMG keep their current feel by setting
  `adsFov: 0.62` (or leaving the fallback as `cfg.adsFovScale`). Their
  existing unused `adsFov` values (0.74 / 0.78 / …) were never the world
  zoom — do not suddenly change them. Document that in the def comment.

No hold-breath in v1. Shift is sprint. Scoped sway from the existing breath
layer is enough.

### 3. Scope overlay

New, small, owned by `weapons` (the viewmodel already owns the red-dot
reticle). Not a UI widget — it has to sit in `viewScene` so it composites
with the weapon pass and never clips the world.

At `adsT`:

- `< 0.85` — current path. Scope is a mesh on the gun; red-dot reticle is
  hidden (`optic.kind === 'scope'`).
- `≥ 0.85` — fade `weapon` + arms (`visible` or material opacity). Show:
  1. A full-frame black quad with a circular hole (scope shadow). Soft edge.
     One preallocated `ShaderMaterial`, no per-frame allocs.
  2. A mil-hash reticle (thin cross + a few stadia) drawn as a second quad
     on the optical axis, same collimation trick as the red dot so sway
     carries it. Colour: dark, not glowing red.
- Crosshair HUD already hides on ADS (`ui/crosshair.js`) — no change.

`opticGlass` node on the model carries `{ kind: 'scope', center, apertureR, magnification }`.
`_updateReticle` branches on `kind`. Keep the red-dot path untouched.

### 4. Model — `src/weapons/models/sniper.js`

`buildSniper()`, same contract as `buildRifle` / `buildLmg`:

```
{ id, label, fxClass, body, moving, nodes, shell, magSize }
```

Silhouette (weapon-local metres, origin at the shooting-hand thumb web):

- Bore on `y = +0.075` (same as the other long guns — viewmodel math assumes it).
- Folded-ish chassis: flat-sided aluminium body, not an AR receiver.
  Reuse `box` / `blob` / `addRail`. Do **not** call `addUpperReceiver` —
  that is an AR-15. Receiver is visibly fatter than the M4: a .338 action
  is ~36 mm across the raceway, not an AR's 25 mm.
- 27" fluted heavy barrel (`addBarrel`) + large single-baffle brake
  (`addMuzzleDevice`, new `'brake_338'` kind or a scaled three-port).
  Crown around `z = -0.78` (the M4 ends at −0.50, the LMG at −0.50 —
  this gun has to read longer in hipfire or it will look like another
  carbine with a scope).
- Fixed chassis stock to `z ≈ +0.30`, rubber pad, optional rear monopod
  stub (visual only). New helper `addChassisStock` in `parts.js` if the
  existing carbine stock looks wrong; otherwise start from
  `addCarbineStock` and restyle.
- Pistol grip via `addPistolGrip`.
- 5-rd AICS mag via `buildMagazine` — shorter front-to-back than a 30-rd
  STANAG, slightly wider, with a single-stack silhouette.
- Bolt: a long turning handle on the right as its own moving group
  (`bolt`), travel mostly +Z with a small +Y lift. Stroke is longer than
  an AR BCG (`boltTravel.z ≈ 0.09`) because the 70 mm case has to clear.
  `chargeRest` / `chargePull` point at the same handle so the empty-reload
  rack reuses the existing clip beats.
- Chambered dummy: `cartridge(0.0697, 0.0074, 0.035)` — 69.7 mm case,
  14.8 mm rim, 35 mm boat-tail. Visibly longer and fatter than the LMG's
  51 × 12 mm 7.62 in the port.
- Scope: new `buildScope(asm, o)` in `parts.js` — 56 mm objective, 40 mm
  ocular, 22–24 cm tube, fat windage/elevation turrets, sunshade. Returns
  `{ kind: 'scope', center, lensZ, apertureR }`.
- Nodes the viewmodel requires: `muzzle`, `chamber`, `eject`, `ejectDir`,
  `sight` (ocular centre), `sightAxis`, `ironSight` (unused but present),
  `gripR`, `gripL`, `handguard`, `magSeat`, `magDrop`, `chargeRest`,
  `chargePull`, `boltRest`, `boltTravel`, `triggerPivot`, `triggerPull`,
  `selectorPivot`, `opticGlass`.
- `shell: { caseLen: 0.0697, rimR: 0.0074 }` — unique .338 brass. FX
  `setCaseScale` already sizes off these numbers (LMG smoke covers the
  7.62 path; sniper smoke asserts the .338 scale is *different*).
- Hands: `rhandPose: 'gripRifle'` (or a new `gripSniper` only if the
  chassis grip really needs it). Support hand `clamp` on the forend.

Author in `/src/weapons/preview.html?w=sniper&view=hero` (and `side`,
`optic`, `fp`, `ads`, `hands`). Do not tune poses against the game scene.

### 5. Market / loadout

`WeaponSystem.equipPrimary(id)` today hard-codes rifle ↔ lmg:

```js
if ((id !== 'rifle' && id !== 'lmg') || this.owned.has(id)) return false;
this.owned.delete(id === 'rifle' ? 'lmg' : 'rifle');
```

Generalise:

```js
const PRIMARIES = ['rifle', 'lmg', 'sniper'];
equipPrimary(id) {
  if (!PRIMARIES.includes(id) || this.owned.has(id)) return false;
  for (const p of PRIMARIES) if (p !== id) this.owned.delete(p);
  this.owned.add(id);
  // fresh mag + reserve, setWeaponImmediate — unchanged
}
```

`Digit1` already does `owned.has('lmg') ? 'lmg' : 'rifle'`. Extend:

```js
const primary = PRIMARIES.find((id) => this.owned.has(id)) ?? 'rifle';
if (input.pressed('Digit1')) this.setWeapon(primary);
```

Catalog row:

```js
{ id: 'sniper', label: 'AX-338', cost: 1500, step: 1, max: 1 }
```

`MarketSystem._level` already treats unknown weapon ids as `owns(id) ? 1 : 0`
once the `lmg || rifle` branch is widened to `PRIMARIES.includes(itemId)`.
`buy()` already calls `equipPrimary(itemId)` for non-consumables.

Overlay: it iterates the catalog, so the row appears for free. Hint text
says `1-6 BUY ITEMS` — bump to `1-7`. Hotkey map is built from catalog
order (`Digit${i+1}`), so Digit7 buys the new row. Fine.

`resetForNewGame` already resets `owned` to `{rifle, smg, pistol}`.

### 6. Audio / FX

- `class: 'sniper'` is enough for `resolveProfile` and `MUZZLE_LIGHT`.
- Reload beats (`start` / `magout` / `magin` / `end`) already fire
  `weapon:reload` — existing foley covers mag work.
- Bolt cycle should emit `weapon:reload { phase: 'charge' }` (or a new
  `weapon:bolt` if audio wants a dedicated layer). Check `audio/foley.js`
  before adding an event; prefer an existing phase name.
- Muzzle flash / light / tracer: no code change if `class` / `tracerEvery`
  are set. Verify the tracer is visible at 880 m/s (it is for the LMG at 780).

### 7. Export / load

`WEAPON_IDS` gains `'sniper'`. `WeaponSystem.init` already loads every id
in that list via `models.getWeapon(id)`, so the GLB **must** exist before
the game boots.

```
tools/export-models.mjs   add buildSniper to the builders map
npm run models            writes public/models/weapons/sniper.glb + .json
```

Commit the generated GLB/JSON. These are not world assets; they follow the
same rule as `lmg.glb`.

Also register the builder in:

- `src/weapons/preview.js`
- `src/weapons/smoke-inspect.mjs`
- `src/weapons/index.js` header comment (`models/*.js   the four weapons`)

---

## File-by-file

### New

| file | what |
|---|---|
| `src/weapons/models/sniper.js` | `buildSniper()` |
| `tools/smoke-sniper.mjs` | def invariants, bolt-action chamber rules, primary 3-way swap, scope overlay flags |
| `docs/sniper-plan.md` | this document |

### Edit — weapons

| file | what |
|---|---|
| `src/weapons/defs.js` | add `sniper` def; append `'sniper'` to `WEAPON_IDS`; comment that `adsFov` is now the world-zoom multiplier |
| `src/weapons/parts.js` | `buildScope()`; optionally `addChassisStock()` |
| `src/weapons/clips.js` | `cycle` clip; `inspectPoses.sniper` |
| `src/weapons/index.js` | `PRIMARIES`, `equipPrimary`, Digit1, `tryFire` bolt path, clip `chamber` beat, publish `adsFov`/`adsSensScale` |
| `src/weapons/viewmodel.js` | skip auto `boltCycle` when `boltAction`; `_updateReticle` scope branch; fade weapon at full ADS; play `cycle` after a bolt shot |
| `src/weapons/preview.js` | register builder |
| `src/weapons/smoke-inspect.mjs` | register builder; `middleRotations.size` becomes 5 |

### Edit — player / market / tools / tests

| file | what |
|---|---|
| `src/player/index.js` | accept per-weapon `adsSensScale`; default to `cfg.adsSensScale` |
| `src/player/camera.js` | accept per-weapon `adsFovScale`; default to `cfg.adsFovScale` |
| `src/market/index.js` | catalog row; `_level` primary check |
| `src/ui/market.js` | hint `1-7` |
| `tools/export-models.mjs` | import + builders map (header comment too) |
| `tools/smoke-lmg.mjs` | `WEAPON_IDS` assertion will fail — either widen it here or move the shared assertions into `smoke-sniper.mjs` and leave LMG-specific checks. Prefer **updating** the shared asserts in `smoke-lmg.mjs` (it already owns `WEAPON_IDS` / Digit4 / `equipPrimary`) and putting bolt/scope asserts in the new file. |
| `tools/smoke-market.mjs` | 3-way primary swap (rifle → sniper → lmg → rifle); stub `equipPrimary` must delete every other primary, not just rifle/lmg |
| `package.json` | `"test": "... && node tools/smoke-sniper.mjs"` |

### Do not touch

- `AGENTS.md`, `.github/workflows/*` — protected.
- `public/models/world/**` — generated world, unrelated.
- `src/ai/**` — enemies do not carry this gun.
- `src/audio/weapons.js` / `samples.js` — profile and WAVs already exist.
- `src/fx/index.js` — `MUZZLE_LIGHT.sniper` already exists.
- New npm dependencies.

`package.json` is protected-ish (AGENTS.md: "keep them minimal and
intentional"). The only edit is appending the new smoke to the `test`
script, same as the LMG.

---

## Implementation order

Do these as stacked, shippable steps. Each step leaves `npm test` and
`npm run build` green. The model can land before the overlay looks good
because hipfire does not need the overlay.

1. **Def + loadout plumbing, no mesh.** Add the def (placeholder hip pose),
   `WEAPON_IDS`, `PRIMARIES`, market row, Digit1, smoke updates. Game boots
   only after step 3 (GLB must exist), so keep the id **out** of
   `WEAPON_IDS` until the GLB is committed — or add the id and the GLB in
   the same commit. Prefer one commit for "sniper exists as a buyable
   primary with a stand-in mesh".
2. **Mesh + export.** `buildScope`, `buildSniper`, preview harness, run
   `npm run models`, commit `public/models/weapons/sniper.{glb,json}`.
   Hands / poses / inspect keys. At this point it is a slow, heavy, semi
   rifle with a red-dot-sized sight picture — playable, not yet a sniper.
3. **Bolt-action.** `boltAction` in `tryFire`, `cycle` clip, chamber beat,
   delayed shell, skip auto `boltCycle`. This is the gameplay.
4. **Magnification.** Publish `adsFov` / `adsSensScale`, wire camera +
   look. Rifle/SMG/pistol/LMG must feel identical to `develop` afterwards
   (their effective zoom stays 0.62).
5. **Scope overlay.** Fade the gun, circular mask, mil reticle. Hide the
   red-dot path for `kind === 'scope'`.
6. **Tune.** Preview `?w=sniper&view=ads`, then in-game against street
   lengths. Recoil, boltTime, eyeRelief, overlay radius, hip pose. Numbers
   only, in the def.

Commit style (from history): `feat(weapons): add AX-338 sniper — .338 Lapua, bolt, 4x scope`.

---

## Tests

`tools/smoke-sniper.mjs` (node, no browser), modelled on `smoke-lmg.mjs`:

- `WEAPON_DEFS.sniper` present; `label === 'AX-338'`; `caliber === '8.6x70'`;
  `modes === ['semi']`; `boltAction === true`; `magSize === 5`; `adsFov === 0.25`.
- Recoil pattern is finite, length `5 * 2`, and vertical-positive.
- Shell scale is *not* the LMG's 7.62: `caseLen 0.0697`, `rimR 0.0074`
  produce a different `setCaseScale` than `0.051 / 0.005975`.
- `equipPrimary('sniper')` from a rifle loadout: owned `{sniper, smg, pistol}`,
  Digit1 would pick sniper, mag/reserve reset to full.
- `equipPrimary('lmg')` from a sniper loadout drops the sniper.
- `equipPrimary('sniper')` while already owned returns false.
- `resetForNewGame` returns to `{rifle, smg, pistol}`.
- Bolt path (against a stub viewmodel, same trick as the LMG smoke):
  `tryFire` leaves `chambered === false` and does not decrement `mag`
  until a synthetic `chamber` clip event; a second `tryFire` during
  `_fireTimer` is rejected; after `chamber`, mag is one lower and
  `chambered === true`. Last round sets `boltHold` and does not play
  `cycle`.

`tools/smoke-market.mjs`:

- Stub `equipPrimary` deletes every other primary, not just rifle/lmg.
- Buy sniper for 1500, replaces M4; buy LMG replaces sniper; buy M4
  replaces LMG.
- Catalog has a `sniper` row, unaffordable when owned.

`src/weapons/smoke-inspect.mjs`:

- Builder registered; `middleRotations.size === 5`; sniper inspect yaw
  still clears 1.5 rad on the far side.

Do not weaken existing LMG / market / grenade smokes. If an assertion
names the exact `WEAPON_IDS` array, update the expected value and say
why in the commit body.

After code lands: `npm test` and `npm run build` must pass. `npm run models`
must be run in the same change that adds `'sniper'` to `WEAPON_IDS`,
otherwise a clean `npm ci && npm run dev` 404s the GLB.

---

## Risks / non-goals

- **Pose authoring is the long pole.** The M4 hip pose is a page of
  comments because the bore, not the optic, is the constraint. Budget
  time in the preview harness. Do not guess numbers in the game scene.
- **`adsFov` rename trap.** Four guns already have an unused `adsFov`
  that is *not* 0.62. Wiring it naively would zoom every gun out. Leave
  those values alone; the camera fallback is `cfg.adsFovScale`. Only the
  sniper sets a real world-zoom `adsFov`.
- **Scope overlay vs TAA / view pass.** The viewmodel renders to
  `viewRt` and composites over the world. A black mask in `viewScene`
  is the safe place. Do not draw it in `ui/` — CSS circles will disagree
  with the weapon FOV.
- **No hold-breath, no variable zoom, no ballistic drop HUD, no
  bipod, no .50 cal variant.** Street map, 60 m AI range. .338 bolt +
  4× is the whole fantasy. The calibre is the identity, not a later SKU.
- **No 4th inventory slot.** Three weapons, Digit1–3, Tab cycle. The
  LMG smoke explicitly forbids Digit4.
- **No AI snipers.** Out of scope.

---

## Acceptance

The weapon is done when:

1. Market sells AX-338 for 1500; buying it unequips M4 or EVOLYS; Digit1
   draws it; death / `game:restart` returns the M4.
2. Hipfire is a long chassis rifle with a visible 56 mm scope, fat brake,
   and a short 5-rd mag; the ejected case is visibly bigger than LMG brass;
   hands sit on grip + forend; inspect clears both flanks.
3. Click fires one .338 at 880 m/s for 145 dmg; the bolt then cycles
   for ~1.1 s (hand + handle + brass) before the next shot is live.
   Fifth shot locks the bolt; empty reload seats a mag and closes it.
4. ADS takes ~380 ms, world FOV drops to ~20°, mouse scales with the
   zoom, the gun fades, and a mil reticle sits in a circular scope
   shadow. Other weapons' ADS feel is unchanged.
5. Audio is the existing sniper sample bed; muzzle light is the existing
   sniper candela; every shot traces.
6. `npm test` (including the new smoke) and `npm run build` pass. A
   clean `npm ci` loads `models/weapons/sniper.glb`.

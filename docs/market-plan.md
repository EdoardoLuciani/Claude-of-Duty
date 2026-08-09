# Market Feature — Implementation Plan

A between-wave supply market: after every wave clear the player is prompted with a
shop overlay where they can spend **credits** on **grenade restocks** and **armour
plates**. Armour is a new gameplay mechanic (the HUD already ships its UI — plates,
`armour`/`maxArmour` state, hitmarker/audio cases — but no damage absorption exists).

## Locked decisions (final, after design review)

| decision | choice |
|---|---|
| Currency | separate **credits** pool, earned 1:1 with score rewards; **0 starting**; persists across deaths |
| Timing | **auto-open 10 s after every `wave:complete`** (even fully stocked); visible countdown during the grace window (`SUPPLIES IN Ns` in the scorebar + a draining prompt-style chip) so the player can loot ammo; sim clock frozen (`time.scale = 0`) while open, which holds the wave countdown; **one session per wave** — no reopen during the intermission |
| Buy flow | market **stays open until Skip/Esc**; buttons disabled when unaffordable/capped; hotkeys **1 = grenades, 2 = armour**; centred modal over a dimmed world |
| Death reset | grenades → 2, armour → 0 on respawn; credits persist |
| Armour | 150 max = **3 plates × 50 HP**, absorbs **everything** (bullets, explosions, fall), no regen; **per-plate purchases** (50 HP, full price even on partial fill) |
| Grenades | cap **6**, **+1 per pack** |
| Pricing | plate **250**, pack **300**, ammo refill **300** → kit ≈ 1650 ≈ 1.5 waves of income; wave 1 income ≈ 850 forces an either/or |
| Feedback | **clink on every absorbed hit, louder on plate break** + HUD plate flash; no red screen flash / direction indicator for armour-only hits; dedicated `market_buy` tick + credits pulse on purchase |
| HUD | scorebar gains a permanent CREDITS readout; grenade count stays plain `N` (cap shown in shop: `2/6`, `0/3`); game-over screen shows `· CREDITS xxxx` |
| Architecture | new `market` subsystem + `src/ui/market.js` overlay; events `market:open {wave}` / `market:close` / `market:purchase {item,cost,credits}`; zero AI changes |

## Design notes

**Why the wave countdown holds for free.** The AI wave director arms
`_nextWaveAt = elapsed + waveDelay` on `wave:complete` and spawns when
`ctx.time.elapsed >= _nextWaveAt` (`ai/index.js` `_updateWaves`). The engine's
`time.scale` multiplies `dt` for *everything* (`engine.js` step loop), so
`time.scale = 0` while the market is open freezes the countdown, the AI, physics
and HUD with **zero changes to the AI subsystem**. The overlay animates on `rawDt`
(the pattern `GameOverScreen.update(rawDt)` already establishes) so it stays alive
while the sim is frozen. Safety: `wave:complete` only fires when the field is
quiet, so no enemies exist while frozen.

**Why Esc can't conflict with the pause menu.** The pause toggle in
`ui/index.js` lateUpdate is gated on `ctx.input.enabled`, which requires pointer
lock (`input.js:173`). The market releases the pointer (cursor needed for
clicking), so the pause toggle is inert; the overlay handles its own Esc keydown,
exactly like `GameOverScreen`.

**Deterministic capture safety.** `wave:complete` never fires when
`config.deterministic` is set (`_updateWaves` is skipped), so the market can't
open during `baseline.mjs`/`imagediff.mjs` runs. The one-line
`ui.debugState('market')` addition (optional) enables a capture shot later.

## Files

### 1. NEW `src/player/health.js` changes — armour mechanic

- Constructor: `this.armour = 0; this.maxArmour = 150;` (150 matches the existing
  UI state default `maxArmour: 150` in `ui/index.js`).
- `damage(amount, from, opts)` — absorb before health:

  ```js
  const absorbed = Math.min(this.armour, amount);
  this.armour -= absorbed;
  const dealt = Math.min(this.value, amount - absorbed);   // health portion
  this.value -= dealt;
  ```

  Existing semantics preserved, with these rules:
  - **Regen reset on any damage** (armour hits also reset `lastDamageTime`) —
    armour is a buffer, not a regen enabler.
  - **Felt response** (kick, suppression, indicator severity, hitFlash) scales
    with the *health* portion (`dealt`), so a fully-absorbed hit barely flinches.
  - **Payload**: `damage:taken` keeps `amount` = health dealt (existing
    consumers — hurt arcs `ui/index.js:208`, pain audio — stay correct) and
    gains additive fields `armourAbsorbed` and `armour`.
- `addArmour(n)` → `this.armour = Math.min(this.maxArmour, this.armour + n)`.
- `reset()` → also `this.armour = 0`.
- `_emitState()` → include `armour` / `maxArmour` in the `player:health` payload.

### 2. EDIT `src/player/index.js`

- Public `addArmour(n)` delegating to `this.health.addArmour(n)`.
- `getHudState()` → add `h.armour = hp.armour; h.maxArmour = hp.maxArmour;`.
  `ui/index.js:505` already syncs `ps.armour` into HUD state — the existing
  plate UI (`ui/health.js` `ow-arm-plates`) lights up with no further UI work.

### 3. EDIT `src/weapons/index.js` — grenade purchase API

- `const GRENADES_MAX = 6;` next to `GRENADES_PER_LIFE = 2`.
- `addGrenades(n)` → `this.grenades = Math.min(GRENADES_MAX, this.grenades + n)`.
- Respawn reset stays `GRENADES_PER_LIFE` (per-life economy). HUD `lethalCount`
  already reflects `this.grenades` — no UI change.

### 4. NEW `src/market/index.js` — MarketSystem

```js
static id = 'market';
static deps = ['weapons', 'player'];   // applied to via duck-typed APIs
```

State: `credits`, `open`, `catalog`:

```js
catalog = [
  { id: 'grenade', label: 'Grenade Pack', cost: 300, step: 1, max: 6 },  // +1, cap 6
  { id: 'armour',  label: 'Armour Plate', cost: 250, step: 50, max: 150 }, // +50 HP (one plate)
];
```

Events **consumed** (mirrors `game/index.js` earning logic; constants stay in
sync with `SCORE`):
- `damage:dealt` → killed, non-player target → `credits += 100 (+50 headshot)`
- `wave:complete` → `credits += 250 × wave`, then `open()`
- `game:restart` → reset credits/state; force-close market, restore time scale

API:
- `open()` → `ctx.time.scale = 0`; `this.open = true`; emit `market:open`
- `close()` → `this.open = false`; `ctx.time.scale = 1`; emit `market:close`
  (countdown resumes with the *remaining* delay — it was frozen, not reset)
- `buy(id)` → validate open / credits / not-at-cap / not-full; deduct; apply via
  `weapons.addGrenades(step)` or `player.addArmour(step)`; emit
  `market:purchase { item, cost, credits }`; return `{ ok, reason }`
- `getHudState()` → `{ credits, open, grenades, grenadeMax, armour, armourMax }`
  (current levels so the overlay can disable at cap/full)

Events **emitted**: `market:open`, `market:close`, `market:purchase`.

### 5. NEW `src/ui/market.js` — MarketOverlay

Modeled on `GameOverScreen` (own root layer, `shown` damp animation driven by
`rawDt`, keydown Esc listener, `document.exitPointerLock()` on show /
`ctx.input?.requestPointerLock?.()` on close — same as `PauseMenu.close`):

- Panel: title `SUPPLY MARKET`, credits readout, one row per catalog item
  (label, owned/max, price, Buy button — disabled when unaffordable, at cap, or
  full), `SKIP ▸` button, hint `ESC SKIP`.
- Buy click → `ctx.get('market').buy(id)`; on success play `ui.sfx('objective')`
  (existing synth) — optional dedicated `market_buy` tick later.
- `update(rawDt)` called from `ui.lateUpdate`; hidden when `shown < 0.004`
  (same pattern as GameOverScreen), so it stays out of capture frames when idle.

### 6. EDIT `src/ui/index.js` — wiring

- deps: `static deps = ['render', 'game', 'market']`.
- Construct `this.market = new MarketOverlay(this.root, ctx)` beside
  `menu`/`gameOver`.
- `on('market:open')` → show overlay, clear the wave-clear banner (it would
  freeze mid-fade behind the overlay while `time.scale = 0`).
- `on('market:close')` → hide overlay.
- lateUpdate: poll `ctx.peek('market')?.getHudState?.()` → `s.credits`.
- No Esc gating needed (see Design notes).

### 7. EDIT `src/ui/compass.js` — ScoreBar credits readout

Add a `CREDITS` group (label + `b` value, same styling as the score group) to
`ScoreBar`; `update(s)` sets it from `s.credits`.

### 8. EDIT `src/ui/style.js` — market styles

`ow-market` overlay + panel, item rows, buy buttons (reuse `ow-btn` / existing
button language; disabled state). Matches the HUD design system.

### 9. EDIT `src/main.js`

`import { MarketSystem } from './market/index.js';` + `.add(MarketSystem)`
(registration order irrelevant — registry topo-sorts on deps).

### 10. EDIT `ARCHITECTURE.md`

- Subsystem table: `market` row (src/market/ — economy, between-wave shop).
- Event table rows: `market:open` / `market:close` / `market:purchase`
  `{ item, cost, credits }`, each emitted by `market`.

### 11. OPTIONAL — `README.md` subsystem table + `ui.debugState('market')`

For a capture-ready market shot: `debugState('market')` force-opens the market in
a scripted run (lockstep-safe: `time.scale = 0` doesn't stop the pump, it zeroes
`dt`).

## Balance (v1, tune after playtest)

| wave | income ≈ |
|---|---|
| 1 | 6 kills × 100–150 + 250 ≈ 850–1150 |
| 4 | 9 kills + 1000 ≈ 1900–2350 |

- Grenade pack **300** → +1 (cap 6).
- Armour plate **250** → +50 HP (3 plates = 150).
- Ammo refill **300** → all weapon reserves to full. Kit (3 plates + 2 packs + ammo) ≈ 1650.
- Prices and caps live in the catalog + `GRENADES_MAX` (single constants, like
  `SCORE` in `game/index.js`).

## Implementation order

1. **Armour mechanic** (`health.js`, `player/index.js`) — testable immediately:
   `player.health.addArmour(150)` via devtools, take hits, watch plates deplete.
2. **Grenade API** (`weapons/index.js`) — `addGrenades(n)`.
3. **MarketSystem** (`src/market/index.js`) — credits, catalog, open/close/buy,
   events.
4. **Overlay + wiring** (`src/ui/market.js`, `ui/index.js`, `compass.js`,
   `style.js`, `main.js`).
5. **Docs** (`ARCHITECTURE.md`, README).
6. **Verification**:
   - `npm run dev` manual pass: clear wave → market opens; buy grenades (HUD
     counter 2→4); buy armour (plates light); Skip → 9s countdown → next wave.
   - Damage pass: armour absorbs, health loss reduced, regen resets on armoured
     hits, hurt-arc amount reflects health dealt.
   - Death pass: respawn → 2 grenades, 0 armour, credits retained.
   - Edge pass: Esc closes market; pause menu unaffected after; buttons disable
     when unaffordable/capped; `game:restart` never leaves time frozen.
   - Regression: `tools/baseline.mjs` (bit-identical, market never opens in
     deterministic runs) + `tools/playtest.mjs`.

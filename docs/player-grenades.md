# Player Grenades — Implementation Plan & Status

Branch: `feature/player-grenades` (worktree: `/tmp/cod-player-grenades`)
Status: **implemented and verified headlessly** (see "Verification" below)

## Goal

Press **G** to arm a frag grenade; **hold to cook** (the fuse burns while held),
release to throw. It bounces, detonates on its fuse, and damages/kills enemies —
with a HUD count (2 per life), self-damage on your own blast, a live-grenade
drop on death while cooking, and score/kill credit for explosion kills.

## Design (settled by review)

| Decision | Choice |
|---|---|
| Scope | M1 on this branch; viewmodel throw animation, lethal pickups, bounce-clatter foley deferred to M2 |
| Interaction | CoD-style cook: fuse burns while held; hold ≥ 2.35 s → detonates in hand |
| Friendly fire | Kept — your own blast (and your in-hand detonation) can kill you |
| Blocks while cooking | Fire, ADS, reload, weapon switch, inspect; movement/sprint allowed; arming cancels an in-progress reload; no cancel once armed |
| Death while cooking | Grenade drops at your feet with the remaining fuse |
| Economy | 2 per life; refill on `player:respawn` + `game:restart`; no pickups, no wave refill |
| Balance | Exact AI match: 6.5 m radius, 120 damage, 2.35 s fuse, quadratic falloff |
| Kill credit | Explosion kills flow through `damage:dealt` → score/kills/killfeed, thrower credited (fixes: grenade kills credited nobody before) |
| Danger marker | AI throws now emit `grenade:thrown` → HUD danger marker + callout (was demo-only before) |
| HUD | `getHudState()` feeds `lethalCount` + `cooking`; panel already rendered the count; new cooking pulse class |

## What changed

### `src/weapons/grenade-mesh.js` (new)
Shared frag mesh (icosahedron + material) for AI and player; `grenadeMaterial()`
accessor so the AI prewarm can compile its shader early. Never disposed — two
tiny GPU objects, one per page load.

### `src/weapons/index.js`
- Constants: `GRENADES_PER_LIFE`, `GRENADE_FUSE`, `GRENADE_RADIUS`,
  `GRENADE_DAMAGE`, `GRENADE_SPEED`, `GRENADE_TICK_AT`.
- State: `grenades`, `cooking`, `_cookTime`, `_cookTicked`, `_grenades` (live
  list), scratch vectors.
- `_updateCook(dt, input, live)` — G press arms (decrements count, cancels
  reload, pin sfx); fuse ticks while held; release throws with remaining fuse;
  overcook emits `explosion` at the eye; tick sfx in the last 0.5 s.
- `_throwGrenade(fuse)` — eye + forward × 0.4 spawn, 16 m/s + 60 % player
  velocity inheritance, the AI's exact rigid-body sphere spec, camera trauma,
  throw whoosh.
- `_dropCookedGrenade()` — death listener drops the live grenade at your feet.
- `_updateGrenades(dt)` — fuse countdown, emits `explosion` (radius/damage
  AI-matched), removes body + mesh.
- Guards: `canFire()`, `reload()`, `setWeapon()`, `inspect()` blocked while
  cooking; ADS state gated.
- Refill on `player:respawn` + `resetForNewGame()`; cleanup in `dispose()`.
- `getHudState()`: `lethalCount`, `cooking`.

### `src/ai/index.js`
- Uses the shared grenade mesh (removed private `_ensureGrenade`).
- `throwGrenade` emits `grenade:thrown` (position + fuse) for the HUD marker.
- Explosion damage now flows through `damage:dealt` with `explosion: true`
  (pre-adjusted quadratic falloff; the listener skips its gunshot range
  falloff for explosion events) → kills credit the thrower, killfeed works.
- Prewarm patches the shared grenade material.

### `src/ui/index.js` + `src/ui/markers.js` (unchanged) + `src/ui/ammo.js` + `src/ui/style.js`
- `grenade:thrown` → `spawnGrenade()` (marker + `grenade_warn` callout).
- Ammo panel: cooking class on the lethal slot; `ow-slot.cooking` amber pulse.

### `src/audio/foley.js` + `src/audio/index.js`
- New synth cases: `grenade_pin` (metallic double-click), `grenade_tick`
  (short beep), `grenade_throw` (noise whoosh); routed to the ui bus.

## Verification (headless Chromium, `tools/dbg-grenade*.mjs`)

- A. Arm → cook 0.4 s → release → live grenade body in the world → detonates
  on the remaining fuse (explosion event, body/mesh removed).
- B. Fatal blast on an agent → `damage:dealt` (explosion) → agent dies →
  `game.kills` increments. (Also proves the pre-existing gap: grenade kills
  were credited to nobody before.)
- C. Overcook with G held → explosion at eye height (y = eye) → player dead.
- D. Death while cooking → live grenade drops at feet (y ≈ ground) →
  detonates; `player:respawn` refills the count to 2.
- E. `getHudState()` feeds `lethalCount` and `cooking` (panel class + count).

Notes on the harness: headless Chromium throttles the rAF loop hard after
heavy FX, and engine `dt` clamps at 0.1 s — so tests poll game state rather
than waiting wall-clock, and the slow paths drive weapons state directly with
G held (the release branch legitimately fires first otherwise).

## Deferred to M2 (explicitly out of scope)

- Viewmodel throw animation (grenade-in-hand, arm pose, release) via the
  existing keyframed clip system.
- Lethal pickups (`ammo-pickups.js` is weapon-ammo-only today).
- Bounce-clatter foley for the thrown grenade (surface impacts already exist).
- Hold-to-cook is DONE in M1; a HUD fuse bar is a possible polish.

## Files touched

`src/weapons/index.js`, `src/weapons/grenade-mesh.js` (new),
`src/ai/index.js`, `src/ui/index.js`, `src/ui/ammo.js`, `src/ui/style.js`,
`src/audio/index.js`, `src/audio/foley.js`.

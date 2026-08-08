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
| Danger marker | **Removed** — enemy grenade throws give no HUD marker or callout (player preference: keep it realistic). The `ui.spawnGrenade` code stays demo-only as it was before this feature |
| Throw animation | In M1: the rifle stows, a grenade sits in the right hand (left hand cups), release plays an arm throw (wind-up → release beat → follow-through), then the rifle draws back up. Release beat fires `grenade:release` → world grenade spawns from the hand's position |
| HUD | `getHudState()` feeds `lethalCount` + `cooking`; panel already rendered the count; new cooking pulse class |

## What changed

### `src/weapons/grenade-mesh.js` (new)
Shared frag mesh (icosahedron + material) for AI and player; `grenadeMaterial()`
accessor so the AI prewarm can compile its shader early. Never disposed — two
tiny GPU objects, one per page load.

### `src/weapons/index.js`
- Constants: `GRENADES_PER_LIFE`, `GRENADE_FUSE`, `GRENADE_RADIUS`,
  `GRENADE_DAMAGE`, `GRENADE_SPEED`, `GRENADE_TICK_AT`.
- State: `grenades`, `cooking`, `_cookTime`, `_cookTicked`, `_throwing`,
  `_throwFuse`, `_grenades` (live list), scratch vectors.
- `_updateCook(dt, input, live)` — G press arms (decrements count, cancels
  reload, `holdGrenade()` on the viewmodel, pin sfx); fuse ticks while held;
  release hands the throw to the viewmodel (`throwGrenade()`) and stores the
  fuse; the world grenade is spawned at the `grenade:release` clip event;
  overcook calls `endGrenade()` and emits `explosion` at the eye; tick sfx in
  the last 0.5 s.
- `_throwGrenade(fuse)` — spawns at the viewmodel hand's world position at the
  release beat (fallback: eye + forward), 16 m/s + 60 % player velocity
  inheritance, the AI's exact rigid-body sphere spec, camera trauma, throw
  whoosh.
- `_dropCookedGrenade()` — death listener drops the live grenade at your feet
  and clears the viewmodel grenade state.
- `_updateGrenades(dt)` — fuse countdown, emits `explosion` (radius/damage
  AI-matched), removes body + mesh.
- Guards: `canFire()`, `reload()`, `setWeapon()`, `inspect()` blocked while
  cooking; ADS state gated.
- Refill on `player:respawn` + `resetForNewGame()`; cleanup in `dispose()`.
- `getHudState()`: `lethalCount`, `cooking`.

### `src/weapons/viewmodel.js` (throw animation)
- A grenade mesh (shared `grenade-mesh.js`, scaled 1.35×) is parented to the
  right hand.
- `holdGrenade()` — stows the rifle, arms posed to a hand-authored hold
  (grenade cradled, left hand cupping); the pose targets are rig-space
  keyframes converted from camera-space positions so the hand sits inside the
  frustum (the hip grip sits below the frame edge — the original pose was
  invisible until measured through the real projection).
- `throwGrenade()` — 0.5 s arm timeline: wind-up → release beat (t=0.3 s,
  fires `onClipEvent('grenade:release')`, grenade hidden) → follow-through →
  rifle re-shown with a draw clip.
- `endGrenade()` — immediate reset (overcook / death / respawn / restart).

### `src/ai/index.js`
- Uses the shared grenade mesh (removed private `_ensureGrenade`).
- Explosion damage now flows through `damage:dealt` with `explosion: true`
  (pre-adjusted quadratic falloff; the listener skips its gunshot range
  falloff for explosion events) → kills credit the thrower, killfeed works.
- Prewarm patches the shared grenade material.
- (The `grenade:thrown` → danger-marker hook was added and then **removed**
  again: the player wants no HUD warning for enemy grenades.)

### `src/ui/index.js` + `src/ui/ammo.js` + `src/ui/style.js`
- Ammo panel: cooking class on the lethal slot; `ow-slot.cooking` amber pulse.
  (The `grenade:thrown` → marker subscription was added and then removed per
  the "no popup" decision.)

### `src/audio/foley.js` + `src/audio/index.js`
- New synth cases: `grenade_pin` (metallic double-click), `grenade_tick`
  (short beep), `grenade_throw` (noise whoosh); routed to the ui bus.

## Verification (headless Chromium, `tools/dbg-grenade*.mjs`)

- A. Arm → cook 0.4 s → release → **arm throw animation** (grenade visible in
  the hand, wind-up, release beat) → live grenade body spawns from the hand's
  world position → detonates on the remaining fuse.
- B. Fatal blast on an agent → `damage:dealt` (explosion) → agent dies →
  `game.kills` increments. (Also proves the pre-existing gap: grenade kills
  were credited to nobody before.)
- C. Overcook with G held → explosion at eye height (y = eye) → player dead.
- D. Death while cooking → live grenade drops at feet (y ≈ ground) →
  detonates; `player:respawn` refills the count to 2.
- E. `getHudState()` feeds `lethalCount` and `cooking` (panel class + count).
- F. Throw poses verified visually (vision-model screenshot review): hold pose
  shows the gloved hand cradling the dark grenade in the lower-right; release
  shows both arms extended with the palm open; rifle returns with a draw clip
  after the throw.

Notes on the harness: headless Chromium throttles the rAF loop hard after
heavy FX, and engine `dt` clamps at 0.1 s — so tests poll game state rather
than waiting wall-clock, and the slow paths drive weapons state directly with
G held (the release branch legitimately fires first otherwise). The original
hold pose was invisible because it sat below the frustum; pose targets are now
converted from camera-space positions through the live rig transform.

## Deferred to M2 (explicitly out of scope)

- Lethal pickups (`ammo-pickups.js` is weapon-ammo-only today).
- Bounce-clatter foley for the thrown grenade (surface impacts already exist).
- HUD fuse bar / cook progress indicator.
- Finesse passes on the throw poses (the release motion is authored; a
  viewmodel-preview pass with a human eye would tune it further).

## Files touched

`src/weapons/index.js`, `src/weapons/viewmodel.js`, `src/weapons/grenade-mesh.js` (new),
`src/ai/index.js`, `src/ui/index.js`, `src/ui/ammo.js`, `src/ui/style.js`,
`src/audio/index.js`, `src/audio/foley.js`.

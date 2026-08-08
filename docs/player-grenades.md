# Player Grenades — Implementation Plan

Branch: `feature/player-grenades` (worktree: `/tmp/cod-player-grenades`)
Status: plan — no gameplay code changed yet

## Goal

Let the player press **G** to throw a frag grenade that bounces, cooks, and
explodes, killing/damaging enemies, with a HUD count that decrements and
refills per life. Optionally (milestone 2): a viewmodel throw animation and
hold-to-cook.

## Current state (verified against `main` @ c052447)

- The action is **bound but dead**: `grenade: ['KeyG']` in `src/core/input.js`
  (line 24) has **zero consumers** anywhere in `src/player/` or `src/weapons/`.
- All grenade code is AI-side and is a complete, copyable template:
  - mesh builder `_ensureGrenade()` — `src/ai/index.js:856` (icosahedron, 4 lines)
  - throw + ballistic lob solve — `src/ai/index.js:865` (`phys.addRigidBody`
    sphere r=0.05, mass 0.42, restitution 0.28, friction 0.7, lifetime 9, `surfaceType: 'metal'`)
  - fuse tick + explosion emit — `src/ai/index.js:895` (fuse 2.35 s, radius 6.5, damage 120)
  - AI decision to throw — `src/ai/agent.js:579, 792`
- The **explosion consequence chain is fully event-driven and source-agnostic**.
  Emitting `ctx.events.emit('explosion', { position, radius, damage, source })`
  already triggers, no matter who threw it:
  | Consumer | File |
  |---|---|
  | FX (fireball/shockwave/debris/smoke/light/scorch) | `src/fx/index.js:171, 498` |
  | Audio (distance-attenuated boom) | `src/audio/samples.js:199` |
  | Physics (radial impulse, LOS-occluded) | `src/physics/index.js:750` |
  | Player damage + trauma shake | `src/player/index.js:556` |
  | AI damage / suppression / hear | `src/ai/index.js:373` |
- The **HUD already renders a grenade count**: `src/ui/ammo.js:62` builds the
  lethal slot (frag icon + count) and lines 171–173 already do
  `setText(slotLn, s.lethalCount)`. The "2" is a placeholder — the state is
  just never fed. The adapter to extend is `getHudState()` at
  `src/weapons/index.js:269` (add `h.lethalCount`).
- Weapons lifecycle hooks to mirror for refill: `player:death` /
  `player:respawn` at `src/weapons/index.js:184–185`, `game:restart` →
  `resetForNewGame()` at line 308.

## Milestone 1 — Core loop (playable)

All changes in `src/weapons/index.js` plus one HUD field.

1. **Input hook** — inside the existing `live` gate block (line ~701, next to
   `reload`):
   ```js
   if (input.actionPressed('grenade')) this.throwGrenade();
   ```
2. **Inventory** — `this.grenades = GRENADES_PER_LIFE` (2) in the constructor;
   decrement in `throwGrenade()`; refill to 2 on `player:respawn` and in
   `resetForNewGame()`.
3. **Throw** — new `throwGrenade()` method:
   - spawn: camera eye + forward × 0.4, slight right/down offset;
   - velocity: camera forward × ~16 m/s + player velocity × 0.6 + up component
     (direction-based, *not* the AI's target-lob solve);
   - body: copy the AI's `addRigidBody` sphere spec verbatim;
   - mesh: copy `_ensureGrenade()` (optionally hoist into a shared util so AI
     and player share one geometry/material).
4. **Fuse** — own list `this._grenades = [{ body, mesh, fuse }]`, ticked in
   `update()`. On expiry: emit `explosion` `{ position, radius: 5.5, damage: 100,
   source: player }`, then `phys.removeRigidBody` + remove mesh. Keep a local
   list rather than reusing the AI's (`src/ai/index.js:125`) so enemy behaviour
   (agent refs, disposal) stays untouched.
5. **HUD** — `getHudState()`: add `h.lethalCount = this.grenades`. Nothing else;
   the panel already renders it.

### Decisions locked for M1
- **Fuse**: instant throw, fixed 2.35 s (matches AI). Hold-to-cook → M2.
- **Friendly fire**: player's `_onExplosion` (`src/player/index.js:556`) has no
  source check, so your own blast hurts you — keep it (CoD behaviour). If we
  later want an exemption, add a source check in that handler only.
- **Balance**: radius 5.5 / damage 100 vs AI's 6.5 / 120 (both damage handlers
  apply quadratic falloff `f*f`, so the player nade stays survivable at range).
- **No pickups / no resupply mid-life** in M1.

### Files touched (M1)
- `src/weapons/index.js` — input hook, inventory, `throwGrenade()`, fuse tick,
  `getHudState()` field, refill hooks.
- (optional) shared grenade mesh util, e.g. `src/weapons/grenade-mesh.js`.

## Milestone 2 — Feel (optional, recommended)

- **Viewmodel throw animation** — add a keyframed throw clip to the existing
  additive clip system (`src/weapons/clips.js` + `src/weapons/viewmodel.js`,
  same machinery as reload/inspect/draw) with a grenade-in-hand mesh
  (`HAND_POSES` in `src/weapons/hands.js`), arm cock + release, small camera
  dip. Biggest single piece of work.
- **Hold-to-cook** — `G` held shortens the fuse; maybe a rising-pitch pin
  foley loop.
- **Foley** — pin-pull on throw start, metal clatter on bounce
  (`src/audio/foley.js` already handles surface impacts; check for a pin
  sample or synthesize one).
- **Pickups** — optional lethal resupply via the existing
  `src/weapons/ammo-pickups.js` pattern.

## Testing

- Manual: `npm run dev` → G throws, grenade bounces off geometry, explodes on
  fuse, AI die/ragdoll (LOS check), HUD count decrements, own blast damages
  the player, count refills on respawn and on game restart.
- Optional visual regression: `npm run shot` (`tools/capture.mjs`).

## Risks / notes

- `explosion` `source` is currently ignored by every consumer; passing the
  player object is safe but verify no consumer asserts `agent`-shaped sources.
- Do **not** push player grenades into the AI's `_grenades` list — its
  `resetForNewGame()`/`dispose()` (`src/ai/index.js:1352, 724`) assume agent
  ownership.
- The `grenade_warn` UI callout (`src/ui/index.js:405`) is driven by AI throw
  events only; confirm player throws never trigger it.

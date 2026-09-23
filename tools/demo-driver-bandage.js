/**
 * BANDAGE DEMO DRIVER — injected by tools/demo.mjs as a single expression.
 *
 *   node tools/demo.mjs --driver=tools/demo-driver-bandage.js \
 *     --frames=270 --no-audio --out=shots/bandage-wrap.mp4
 *
 * A quiet street, a wounded player and one hold-to-heal: the reel is the bandage
 * animation itself. Like tools/demo-driver.js this drives the real input layer
 * under `?capture=1&lockstep=1` — the hold is a held KeyH, so the heal
 * controller, cancel rules and viewmodel presentation all run untouched.
 *
 * Timeline (60 fps): 20 frames at the ready, then KeyH held through the whole
 * 3 s wrap (the heal completes on its own at frame ~200), then the weapon back.
 */
(() => {
  const E = window.__ENGINE__;
  if (!E) return { error: 'no engine on window' };
  const sys = (id) => E.ctx.peek(id);

  const held = new Set();
  function setHeld(codes) {
    const inp = E.input;
    for (const c of codes) if (!held.has(c) && !inp.down.has(c)) inp._pendingDown.add(c);
    for (const c of held) if (!codes.has(c)) inp._pendingUp.add(c);
    held.clear();
    for (const c of codes) held.add(c);
  }

  let frame = 0;
  const rec = [];
  E.events.on('player:heal', (p) => rec.push({ f: frame, name: 'heal', phase: p?.phase ?? '' }));

  window.__DEMO__ = {
    begin(opts) {
      if (opts?.time !== undefined) sys('sky')?.setTimeOfDay?.(opts.time);
      // Clear the board: this reel is the bandage, not a firefight. Deterministic
      // mode skips automatic waves, so nothing repopulates.
      const ai = sys('ai');
      let purged = 0;
      for (const a of (ai?.agents ?? []).slice()) {
        try {
          a.dispose?.();
        } catch {
          /* already detached */
        }
        purged++;
      }
      if (ai) {
        ai.agents.length = 0;
        ai.squads.length = 0;
        ai._stagedAgents = [];
      }
      // Wounded so a bandage is legal: 100 -> 38 HP, one hold back to 88.
      // State, not applyDamage: the spawn armour would soak the hit, and the
      // hit response (flash, kick, indicator) would open the reel off-beat.
      const player = sys('player');
      player.health.armour = 0;
      player.health.value = 38;
      return { ok: true, purged, hp: Math.round(player.health.value), bandages: player.healCtrl.bandages };
    },

    /** Advance exactly one frame of output video. */
    frame() {
      const f = frame++;
      const codes = new Set();
      if (f >= 20 && f < 210) codes.add('KeyH');
      // Slow drift keeps the sway and bob alive without moving off the arms.
      setHeld(codes);
      E.input._rawLook.x = Math.sin(f * 0.021) * 0.35 + Math.sin(f * 0.41) * 1.5;
      E.input._rawLook.y = Math.sin(f * 0.013 + 1.1) * 0.2 + Math.cos(f * 0.33 + 0.7) * 1.2;
      E.input.frozen = false;
      E.input.enabled = true;
      E.input.pointerLocked = true;
      E.step();
      const phase = f < 20 ? 'ready' : f < 210 ? 'wrap' : 'done';
      const hc = sys('player')?.healCtrl;
      return {
        f,
        phase,
        scale: 1,
        keys: [...codes].join('+'),
        alive: 0,
        kills: 0,
        ammo: 30,
        pitch: +(E.camera.rotation.x * 180 / Math.PI).toFixed(1),
        wp: 0,
        heal: hc ? (hc.active ? +hc.progress.toFixed(2) : -1) : -2,
        hp: Math.round(sys('player')?.health?.value ?? -1),
      };
    },

    events: () => rec,
    stats: () => ({ frames: frame }),
  };

  return { installed: 'bandage' };
})();

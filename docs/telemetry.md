# Gameplay telemetry

Telemetry is local and opt-in. It records gameplay state in memory and never uploads anything.

## Record a run

1. Start the game with `npm run dev`.
2. Open `http://127.0.0.1:5173/?telemetry=1`.
3. Play normally.
4. Press **F7** whenever something feels wrong or noteworthy. Type an optional note, **Enter** to save it, **Esc** to skip.
5. Press **F8** to stop and download `cod-telemetry-<timestamp>.tgz`.

The archive contains `telemetry.json` plus a JPEG of the 3D view for each mark (`marks/001.jpg`, …). The HUD is not in the shot. The bottom-centre `REC` badge confirms that recording is active. Recording continues through death and restart. Exporting stops the session; exporting again downloads the same frozen data. The page warns before closing while an unexported recording exists, but cannot download automatically during tab close.

Console API:

```js
__TELEMETRY__.mark('last enemy hidden')
__TELEMETRY__.summary()
__TELEMETRY__.stop()
__TELEMETRY__.download()
```

## Analyze a run

```bash
node tools/analyze-telemetry.mjs ~/Downloads/cod-telemetry-....tgz
```

JSON from a unpacked archive also works. Optionally write the summary to a file:

```bash
node tools/analyze-telemetry.mjs run.tgz --out run-summary.json
```

The report includes weapon outcomes, minimap contact time, compass pings, event counts, marker notes, and final-enemy movement/state/pathing diagnostics.

## Data and privacy

The archive contains player and enemy positions/states, game-action names, weapons, shots, damage, HUD contacts, waves, performance counters, optional typed mark notes, and half-resolution JPEGs of the WebGL view at each mark. It does not capture microphone/audio, network identifiers, or credentials.

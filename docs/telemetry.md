# Gameplay telemetry

Telemetry is local and opt-in. It records gameplay state in memory and never uploads anything.

## Record a run

1. Start the game with `npm run dev`.
2. Open `http://127.0.0.1:5173/?telemetry=1`.
3. Play normally.
4. Press **F7** whenever something feels wrong or noteworthy.
5. Press **F8** to stop and download `cod-telemetry-<timestamp>.json`.

The bottom-centre `REC` badge confirms that recording is active. Recording continues through death and restart. Exporting stops the session; exporting again downloads the same frozen data. The page warns before closing while an unexported recording exists, but cannot download automatically during tab close.

Console API:

```js
__TELEMETRY__.mark('last enemy hidden')
__TELEMETRY__.summary()
__TELEMETRY__.stop()
__TELEMETRY__.download()
```

## Analyze a run

```bash
node tools/analyze-telemetry.mjs ~/Downloads/cod-telemetry-....json
```

Optionally write the summary to a file:

```bash
node tools/analyze-telemetry.mjs run.json --out run-summary.json
```

The report includes weapon outcomes, minimap contact time, compass pings, event counts, marker context, and final-enemy movement/state/pathing diagnostics.

## Data and privacy

The file contains player and enemy positions/states, game-action names, weapons, shots, damage, HUD contacts, waves, and performance counters. It does not capture arbitrary typed text, microphone/audio, network identifiers, credentials, or screenshots.

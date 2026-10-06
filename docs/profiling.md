# Living-combat baseline

```sh
npm ci
node tools/profile.mjs --port=5389 --frames=1800 --warmup=120 \
  --w=1280 --h=720 --dpr=1 --quality=high --out=/tmp/combat-profile.json
```

The script owns an HMR-free Vite server and closes it/browser on success or failure.
Choose an unused port. Full managed Chromium is preferred on Linux; override with
`--executable=/path/to/chrome`. Hardware WebGPU is required, never software fallback.
On multi-GPU Mesa systems choose the adapter explicitly (e.g.
`MESA_VK_DEVICE_SELECT=1002:7550!` for the measured RX 9070 XT).

## Fixture and acceptance

`tools/lib/profile-combat.js` is the shared `living-combat-v1` fixture. Capture
lockstep fixes simulation at 60 Hz; each engine step runs on a real rAF. Normal
AI perception/navigation/firing and actual player inputs, weapons, collision,
damage and effects execute. Five non-staged soldiers occupy validated clear lanes.
Both sides start with 10,000 HP; grenades are disabled. Health is not replenished,
damage is not intercepted, and actors are not revived mid-run.

Every 900-frame cycle walks forward/back with small camera turns, fires the rifle,
reloads, switches to pistol, fires/reloads it, then switches back. Default: two
cycles (30 simulated seconds) after 120 uncredited settle frames. `--frames` accepts
900/1800/2700/3600; `--warmup` accepts 0..600. Keep both fixed when comparing runs.
An elapsed 180-second measurement deadline cancels a pending rAF on timeout.

The run fails on death/staged AI/engine or browser errors; each 300-frame block
must retain living players, active AI contact, enemy shots and actual movement.
Completed reload/switch, player fire, camera motion, impact and incoming-damage
gates reject idle, obstructed or post-death runs. Measurement/coverage failures
overwrite JSON with the `failure` reason, collected samples/coverage and `summary: null`,
then exit nonzero. Missing final intervals stay `null`, never fabricated. Accepted
runs have `failure: null`. Boot/setup failures or lost browser contexts remain stderr-only.
No hard cross-hardware frame-time threshold is imposed.

`node tests/e2e/profile-failure-e2e.mjs` checks actual warmup/mid-loop rejection,
partial-report replacement and cleanup on hardware WebGPU.

## Interpreting results

JSON includes revision/dirty state, browser/device, effective quality/resolution,
boot/prewarm data, combat coverage, every measured frame and percentile/hitch summaries.
Frame interval includes scheduling/GPU backpressure; CPU step/render submit measure
synchronous JS only. The ending interval is assigned to the step that preceded it,
including the final measured frame. GPU timestamps are **unavailable**, not zero.
`nodeBuilders` counts native builder callbacks, **not GPU pipelines, compilation
milliseconds or proof of the cause of a hitch**. Telemetry reports `dNodeBuilders`;
historical WebGL `programs/dPrograms` remain separate and unavailable native counts
are `null`. Native capture counters likewise do not invent WebGL program zeros.

Run comparisons sequentially, at least three repeats, with the same GPU/browser,
quality, resolution, fixture, frame count and power/load conditions. Compare p50,
p95, p99, max and hitch records—not just average FPS. Preserve reports externally;
closed experiments belong in PR/Git history, not another harness.

This is a controlled sustained-gunfight baseline, not unrestricted waves, normal
survival difficulty, low-health/death rendering, grenade/radio coverage or a real-time
input-latency measurement. Large HP changes health-triggered retreat/death behaviour.
Lockstep simulation duration is not measured wall or GPU time. Startup timing is
reported separately; this PR does not optimize startup or promise faster rendering.

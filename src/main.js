import { Engine } from './core/engine.js';
import { createConfig } from './core/config.js';
import { ModelSystem } from './core/models.js';

import { RenderSystem } from './render/index-webgpu.js';
import { MaterialSystem } from './materials/index.js';
import { SkySystem } from './sky/index.js';
import { WorldSystem } from './world/index.js';
import { PhysicsSystem } from './physics/index.js';
import { PlayerSystem } from './player/index.js';
import { WeaponSystem } from './weapons/index.js';
import { FxSystem } from './fx/index.js';
import { AiSystem } from './ai/index.js';
import { GameSystem } from './game/index.js';
import { MarketSystem } from './market/index.js';
import { RadioSystem } from './radio/index.js';
import { IntelSystem } from './intel/index.js';
import { UiSystem } from './ui/index.js';
import { AudioSystem } from './audio/index.js';

import { prewarm } from './core/prewarm.js';

const params = new URLSearchParams(location.search);
const capture = params.get('capture') === '1';
// Deterministic shutter for the pixel gate: the engine does not schedule its own
// frames, the driver advances exactly N of them through window.__PUMP__. Opt-in,
// because tools that measure real frame pacing (tools/perf.mjs) need the loop to
// free-run. See the long comment in src/dev/shots.js.
const lockstep = capture && params.get('lockstep') === '1';

const config = createConfig({
  // 'high' is the default (see src/core/config.js); pass ?q=ultra for the
  // full effect stack.
  quality: params.get('q') ?? 'high',
  deterministic: capture || params.has('deterministic'),
});

const canvas = document.getElementById('game');

const engine = new Engine({ canvas, config });

// Registration order is irrelevant — Registry topo-sorts on static deps.
engine
  .add(ModelSystem)
  .add(RenderSystem)
  .add(MaterialSystem)
  .add(SkySystem)
  .add(WorldSystem)
  .add(PhysicsSystem)
  .add(PlayerSystem)
  .add(WeaponSystem)
  .add(FxSystem)
  .add(AiSystem)
  .add(GameSystem)
  .add(MarketSystem)
  .add(RadioSystem)
  .add(UiSystem)
  .add(IntelSystem)
  .add(AudioSystem);

if (params.get('telemetry') === '1') {
  const { TelemetrySystem } = await import('./dev/telemetry.js');
  engine.add(TelemetrySystem);
}

function showFailure(message) {
  const panel = document.createElement('dialog');
  panel.id = 'engine-failure';
  panel.setAttribute('role', 'alertdialog');
  panel.setAttribute('aria-label', 'Gameplay stopped');
  panel.oncancel = event => event.preventDefault();
  panel.onkeydown = event => {
    if (event.code !== 'F8') event.stopPropagation(); // Block global menu hotkeys, retain telemetry export.
  };
  panel.style.cssText = 'width:80vw;max-height:80vh;padding:2rem;color:#fff;background:#170d0df2;border:1px solid #a66;font:16px/1.5 monospace;white-space:pre-wrap';
  panel.textContent = `${message}\n\nGameplay stopped. Reload to restart safely.\n\n`;
  const reload = document.createElement('button');
  reload.textContent = 'Reload game';
  reload.onclick = () => location.reload();
  panel.appendChild(reload);
  document.body.appendChild(panel);
  panel.showModal(); // Make underlying shop/menu controls inert too.
  document.exitPointerLock();
  reload.focus();
}
engine.events.on('engine:error', ({ system, method, message }) => {
  showFailure(`ENGINE FAILURE — ${system}.${method}\n${message}`);
});

try {
  await engine.init();
} catch (err) {
  console.error('[boot] init failed', err);
  if (!engine.error) showFailure(`BOOT FAILURE\n${err.stack ?? err.message}`);
  throw err;
}

// Capture tooling is not part of the normal game path. Loading it only on
// request also prevents its telemetry rAF from running during ordinary play.
let shotApi = null;
if (capture) {
  const { installShotApi } = await import('./dev/shots.js');
  shotApi = installShotApi(engine, { capture: true, lockstep });
}

// Warm native variants before starting gameplay; see src/core/prewarm.js.
// Diagnostics can opt out explicitly with ?prewarm=0.
const warmup = params.get('prewarm') === '0' ? { ok: false, reason: 'disabled by ?prewarm=0' } : await prewarm(engine);
if (!warmup.ok && params.get('prewarm') !== '0' && !engine.error)
  engine.fail('boot', 'prewarm', new Error('Native material warmup failed; reload required'));
if (engine.error) throw new Error(engine.error.message);
console.info('[boot] prewarm', warmup);
window.__PREWARM__ = warmup;
engine.ctx.peek('telemetry')?.start();

engine.start();

// Capture harness handshake: only flag ready once a frame has actually landed.
//
// BOOT_FRAMES is deliberately a frame COUNT, not a rAF race. In lockstep mode the
// engine has no loop of its own, so we hand-pump exactly this many frames and only
// then raise __READY__; the shot is therefore always applied at engine frame 3, no
// matter how long boot (or pre-warm) took in wall-clock terms.
const BOOT_FRAMES = 3;
if (lockstep) {
  await shotApi.pump(BOOT_FRAMES);
  window.__READY__ = true;
} else {
  let warm = 0;
  const readyProbe = () => {
    if (engine.error) return;
    if (++warm >= BOOT_FRAMES) {
      window.__READY__ = true;
      return;
    }
    requestAnimationFrame(readyProbe);
  };
  requestAnimationFrame(readyProbe);
}

window.__ENGINE__ = engine;

if (import.meta.hot) {
  import.meta.hot.dispose(() => engine.dispose());
}

import { AiSystem } from './ai/index.ts';
import { AudioSystem } from './audio/index.ts';
import { createConfig, QUALITY_PRESETS } from './core/config.ts';
import type { RuntimeConfig } from './core/config.ts';
import { Engine } from './core/engine.ts';
import { hasOwn } from './core/guards.ts';
import { ModelSystem } from './core/models.ts';
import { DEFAULT_PLAYABLE_MAP, SESSION_MODE_POLICY } from './core/playable-maps.ts';
import type { PlayableMap } from './core/playable-maps.ts';
import { prewarm } from './core/prewarm.ts';
import { applyDebugAttachments } from './dev/attachments.ts';
import { FxSystem } from './fx/index.ts';
import { GameSystem } from './game/index.ts';
import { IntelSystem } from './intel/index.ts';
import { MarketSystem } from './market/index.ts';
import { MaterialSystem } from './materials/index.ts';
import { PhysicsSystem } from './physics/index.ts';
import { PlayerSystem } from './player/index.ts';
import { RadioSystem } from './radio/index.ts';
import { RangeSystem } from './range/index.ts';
import { RenderSystem } from './render/index-webgpu.ts';
import { SkySystem } from './sky/index.ts';
import { UiSystem } from './ui/index.ts';
import { StartMenu } from './ui/start.ts';
import { WeaponSystem } from './weapons/index.ts';
import { WorldSystem } from './world/index.ts';

declare global {
  interface Window {
    __PREWARM__?: Awaited<ReturnType<typeof prewarm>> | { ok: false; reason: string };
    __READY__?: boolean;
    __ENGINE__?: Engine;
  }
}

const params = new URLSearchParams(location.search);
const capture = params.get('capture') === '1';
// Deterministic shutter for the pixel gate: the engine does not schedule its own
// frames, the driver advances exactly N of them through window.__PUMP__. Opt-in,
// because measuring real frame pacing needs the loop to free-run. See the long comment in src/dev/shots.ts.
const lockstep = capture && params.get('lockstep') === '1';

const quality = params.get('q');
let preferences: Pick<RuntimeConfig, 'sensitivity' | 'fov' | 'invertY' | 'firingShake'> | undefined;
let currentEngine: Engine | null = null;
let transition: Promise<void> | null = null;
let readyFrame = 0;
let failed = false;
const startMenu = capture ? null : new StartMenu(selectMap);

function showFailure(message: string): void {
  if (failed) return;
  failed = true;
  startMenu?.hide();
  cancelAnimationFrame(readyFrame);
  const panel = document.createElement('dialog');
  panel.id = 'engine-failure';
  panel.setAttribute('role', 'alertdialog');
  panel.setAttribute('aria-label', 'Gameplay stopped');
  panel.oncancel = (event): void => event.preventDefault();
  panel.onkeydown = (event): void => {
    if (event.code !== 'F8') event.stopPropagation(); // Block global menu hotkeys, retain telemetry export.
  };
  panel.style.cssText =
    'width:80vw;max-height:80vh;padding:2rem;color:#fff;background:#170d0df2;border:1px solid #a66;font:16px/1.5 monospace;white-space:pre-wrap';
  panel.textContent = `${message}\n\nGameplay stopped. Reload to restart safely.\n\n`;
  const reload = document.createElement('button');
  reload.textContent = 'Reload game';
  reload.onclick = (): void => location.reload();
  panel.appendChild(reload);
  document.body.appendChild(panel);
  panel.showModal(); // Make underlying shop/menu controls inert too.
  window.__STARTUP__.terminal(); // The existing top-layer dialog owns terminal errors.
  document.exitPointerLock();
  reload.focus();
}
function reportBootFailure(err: unknown): void {
  console.error('[boot] init failed', err);
  const message = err instanceof Error ? (err.stack ?? err.message) : String(err);
  showFailure(`BOOT FAILURE\n${message}`);
}

async function bootSession(map: PlayableMap): Promise<void> {
  const { survivalSystems } = SESSION_MODE_POLICY[map.mode];
  // Model prefetch overlaps renderer/system initialization; later hooks await it.
  window.__STARTUP__.stage('Loading world…');
  const canvas = document.getElementById('game');
  if (!(canvas instanceof HTMLCanvasElement)) throw new Error('Missing game canvas');
  const config = createConfig({
    ...preferences,
    mode: map.mode,
    quality: quality !== null && hasOwn(QUALITY_PRESETS, quality) ? quality : 'high',
    deterministic: capture || params.has('deterministic'),
  });
  const engine = new Engine({ canvas, config });
  currentEngine = engine;
  window.__READY__ = false;
  delete window.__PREWARM__;
  // The HTML shell blocks DOM input during boot; gate native/gamepad consumers too.
  engine.input.enabled = false;
  engine.setGameplaySuspended(!capture);
  engine.onFirstRender = (): void => {
    engine.input.enabled = capture;
    window.__STARTUP__.complete();
    engine.ctx.get('ui').startGate?.ready();
  };
  engine.events.on('engine:error', ({ system, method, message }): void => {
    showFailure(`ENGINE FAILURE — ${system}.${method}\n${message}`);
  });

  // Registry topo-sorts on static deps, preserving insertion order where possible.
  engine
    .add(ModelSystem, map)
    .add(RenderSystem)
    .add(MaterialSystem)
    .add(SkySystem)
    .add(WorldSystem)
    .add(PhysicsSystem)
    .add(PlayerSystem)
    .add(WeaponSystem, survivalSystems && params.get('persistentMags') === '1')
    .add(FxSystem)
    .add(MarketSystem)
    .add(RadioSystem);
  if (survivalSystems) engine.add(AiSystem).add(GameSystem);
  engine.add(UiSystem, capture ? undefined : returnToStartMenu);
  if (survivalSystems) engine.add(IntelSystem);
  engine.add(RangeSystem).add(AudioSystem);

  if (survivalSystems && params.get('telemetry') === '1') {
    const { TelemetrySystem } = await import('./dev/telemetry.ts');
    engine.add(TelemetrySystem);
  }
  engine.onSystemInit = (id): void => {
    if (id === 'weapons') window.__STARTUP__.stage('Loading weapons and equipment…');
  };
  await engine.init();

  // Apply debug/capture attachments after assets load and before native material warmup.
  applyDebugAttachments(params, engine.ctx.get('weapons'));

  // Capture tooling is not part of the normal game path; it owns its own telemetry rAF.
  const shotApi = capture
    ? (await import('./dev/shots.ts')).installShotApi(engine, { capture: true, lockstep })
    : null;

  // Warm native variants before starting gameplay; see src/core/prewarm.ts.
  // Diagnostics can opt out explicitly with ?prewarm=0.
  window.__STARTUP__.stage('Preparing graphics…');
  const warmup =
    params.get('prewarm') === '0'
      ? { ok: false, reason: 'disabled by ?prewarm=0' }
      : await prewarm(engine);
  // Publish the same report on failure too; readiness remains strictly gated below.
  window.__PREWARM__ = warmup;
  if (!warmup.ok && params.get('prewarm') !== '0' && !engine.error)
    engine.fail('boot', 'prewarm', new Error('Native material warmup failed; reload required'));
  if (engine.error) throw new Error(engine.error.message);
  console.info('[boot] prewarm', warmup);
  engine.ctx.peek('telemetry')?.start();

  if (!capture) engine.ctx.get('ui').installStartGate(map);
  engine.start();

  // The capture handshake is a frame COUNT: lockstep pumps exactly three
  // frames, independent of how long boot/warmup took in wall-clock time.
  const BOOT_FRAMES = 3;
  if (lockstep && shotApi) {
    await shotApi.pump(BOOT_FRAMES);
    window.__READY__ = true;
  } else {
    const readyProbe = (): void => {
      if (engine.error || !engine.running) return;
      if (engine.time.frame >= BOOT_FRAMES) window.__READY__ = true;
      else readyFrame = requestAnimationFrame(readyProbe);
    };
    readyFrame = requestAnimationFrame(readyProbe);
  }
  window.__ENGINE__ = engine;
}

async function disposeSession(): Promise<void> {
  const engine = currentEngine;
  if (!engine) return;
  const { sensitivity, fov, invertY, firingShake } = engine.config;
  preferences = { sensitivity, fov, invertY, firingShake };
  currentEngine = null;
  delete window.__ENGINE__;
  delete window.__PREWARM__;
  window.__READY__ = false;
  cancelAnimationFrame(readyFrame);
  engine.input.enabled = false;
  if (document.pointerLockElement === engine.canvas) document.exitPointerLock();
  await engine.dispose();
  // A fresh renderer must not inherit the old canvas's configured GPU context.
  const canvas = document.createElement('canvas');
  canvas.id = engine.canvas.id;
  engine.canvas.replaceWith(canvas);
}

function selectMap(map: PlayableMap): void {
  if (failed || transition || currentEngine) return;
  startMenu?.hide();
  transition = bootSession(map)
    .catch(reportBootFailure)
    .finally((): void => {
      transition = null;
    });
}

function returnToStartMenu(): void {
  if (failed || transition || !currentEngine) return;
  window.__STARTUP__.stage('Returning to Start Menu…');
  transition = disposeSession()
    .then((): void => {
      if (failed) return;
      window.__STARTUP__.complete();
      startMenu?.show();
    })
    .catch((err: unknown): void => {
      console.error('[engine] session teardown failed', err);
      showFailure('ENGINE FAILURE — unable to leave the current session');
    })
    .finally((): void => {
      transition = null;
    });
}

if (capture) {
  try {
    await bootSession(DEFAULT_PLAYABLE_MAP);
  } catch (error) {
    reportBootFailure(error);
    throw error;
  }
} else {
  window.__STARTUP__.complete();
  startMenu?.show();
}

if (import.meta.hot) {
  import.meta.hot.dispose(async (): Promise<void> => {
    await transition;
    startMenu?.dispose();
    await disposeSession().catch((error: unknown): void =>
      console.error('[engine] HMR disposal failed', error)
    );
  });
}

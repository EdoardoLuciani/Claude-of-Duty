#!/usr/bin/env bun
/**
 * Deterministic native-WebGPU screenshot harness.
 * Usage: bun tools/capture.ts --shot=hero --out=/tmp/hero.png
 *        bun tools/capture.ts --reload --out=/tmp/reload
 *        bun tools/capture.ts --weapon=pistol --optic=scope --shot=ads --out=/tmp/p320.png
 */
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

import type { Engine } from '../src/core/engine.ts';
import type { AttachmentConfig } from '../src/weapons/attachments.ts';
import { isWeaponId, WEAPON_DEFS } from '../src/weapons/defs.ts';
import {
  ensureDevServer,
  launchChromium,
  parseArgs,
  stopDevServer,
} from './lib/browser-harness.ts';
import { captureNative } from './lib/native-render.ts';

const args = parseArgs();
const PORT = Number(args.port ?? 5173);
const W = Number(args.w ?? 1920);
const H = Number(args.h ?? 1080);
const RELOAD = !!args.reload;
const SHOT = RELOAD ? 'weapon' : String(args.shot ?? 'default');
const OUT = resolve(String(args.out ?? (RELOAD ? 'shots/reload' : `shots/${SHOT}.png`)));
const TIMEOUT = Number(args.timeout ?? 90000);
// Let temporal effects, streaming and LOD settle before capture.
const SETTLE = Number(args.settle ?? 90);
const WEAPON = String(args.weapon ?? 'rifle');
if (!isWeaponId(WEAPON)) throw new Error(`Unknown weapon: ${WEAPON}`);
const OPTIC = args.optic;
if (args.irons !== undefined && args.irons !== 'installed' && args.irons !== 'removed')
  throw new Error(`Unknown iron-sight configuration: ${args.irons}`);
if (
  OPTIC !== undefined &&
  OPTIC !== 'none' &&
  OPTIC !== 'rmr' &&
  OPTIC !== 'acog' &&
  OPTIC !== 'scope'
)
  throw new Error(`Unknown optic: ${OPTIC}`);
if (
  OPTIC &&
  OPTIC !== 'none' &&
  args.irons !== 'removed' &&
  WEAPON_DEFS[WEAPON].removableIrons?.opticClashes.includes(OPTIC)
)
  throw new Error(`${WEAPON} with ${args.optic} requires --irons=removed.`);
const ATTACHMENTS: AttachmentConfig = {
  optic: OPTIC === undefined || OPTIC === 'none' ? null : OPTIC,
  ironSights: args.irons !== 'removed',
  muzzle: null,
  rail: null,
};

// Self-contained functions serialized by Playwright into the browser.
function pump(frames: number): Promise<number> {
  if (!window.__PUMP__) throw new Error('capture pump unavailable');
  return window.__PUMP__(frames);
}
function present(frames: number): Promise<number> {
  if (!window.__PRESENT__) throw new Error('capture presentation unavailable');
  return window.__PRESENT__(frames);
}
type ReloadStart = { weapon: string; clip: string | null; duration: number; yaw: number };
type ReloadState = {
  clip: string | null;
  clipTime: number;
  mag: number;
  reloading: boolean;
  yaw: number;
};

const server = await ensureDevServer({ port: PORT });
let browser: Awaited<ReturnType<typeof launchChromium>> | undefined;
const logs: string[] = [];
let failed: Error | null = null;
try {
  browser = await launchChromium({
    headless: true,
    ...(args.executable ? { executablePath: String(args.executable) } : {}),
    args: [
      '--ignore-gpu-blocklist',
      '--enable-gpu-rasterization',
      '--enable-zero-copy',
      '--disable-frame-rate-limit',
      '--force-color-profile=srgb',
      '--force-device-scale-factor=1',
      '--hide-scrollbars',
      '--mute-audio',
    ],
  });
  const page = await browser.newPage({ viewport: { width: W, height: H }, deviceScaleFactor: 1 });
  page.on('console', (m): void => {
    logs.push(`[${m.type()}] ${m.text()}`);
  });
  page.on('pageerror', (e): void => {
    logs.push(`[pageerror] ${e.message}\n${e.stack ?? ''}`);
  });
  try {
    const attachmentQuery =
      (args.optic ? `&attachmentOptic=${encodeURIComponent(String(args.optic))}` : '') +
      (args.irons ? `&attachmentIrons=${encodeURIComponent(String(args.irons))}` : '') +
      `&attachmentWeapon=${encodeURIComponent(WEAPON)}`;
    await page.goto(
      `http://127.0.0.1:${PORT}/?capture=1&lockstep=1&shot=${encodeURIComponent(SHOT)}${attachmentQuery}`,
      {
        waitUntil: 'domcontentloaded',
        timeout: TIMEOUT,
      }
    );
    await page.waitForFunction('window.__READY__ === true', null, { timeout: TIMEOUT });
    if (args.weapon || OPTIC || args.irons)
      await page.evaluate(
        ({ id, config }): void => {
          const weapons = window.__ENGINE__?.ctx.get('weapons');
          if (!weapons) throw new Error('weapons not ready');
          // Non-starting weapons are loaded by readiness, but URL configuration
          // before warmup can reject them because they are not owned yet.
          if (!weapons.owns(id)) {
            const equipped =
              id === 'pistol' || id === 'smg' || id === 'shotgun'
                ? weapons.equipSecondary(id)
                : weapons.equipPrimary(id);
            if (!equipped) throw new Error(`Cannot acquire ${id}`);
          }
          if (!weapons.setAttachments(id, config)) throw new Error(`Cannot configure ${id}`);
        },
        {
          id: WEAPON,
          config: ATTACHMENTS,
        }
      );
    if (args.list) {
      const shots: unknown = await page.evaluate('Object.keys(window.__SHOTS__ ?? {})');
      console.log(JSON.stringify(shots, null, 2));
    } else {
      const applied = await page.evaluate(
        ({ s, settle }): ReturnType<NonNullable<Window['__APPLY_SHOT__']>> => {
          if (s === 'default') {
            const engine = window.__ENGINE__;
            if (!engine) throw new Error('engine not ready');
            return { applied: s, pos: engine.camera.position.toArray(), fov: engine.camera.fov };
          }
          if (!window.__APPLY_SHOT__) throw new Error('capture shot API unavailable');
          const result = window.__APPLY_SHOT__(s, { grabFrame: settle });
          if ('error' in result) throw new Error(result.error);
          return result;
        },
        { s: SHOT, settle: SETTLE }
      );
      if (args.weapon)
        await page.evaluate(
          ({ id, shot }): void => {
            const e = window.__ENGINE__;
            if (!e) throw new Error('engine not ready');
            const weapons = e.ctx.get('weapons');
            // The named debug pose selects the reference rifle; switch afterwards
            // while retaining its settled hip/ADS state.
            if (!weapons.setWeaponImmediate(id)) throw new Error(`Cannot equip ${id}`);
            if (shot === 'ads') {
              e.camera.fov = e.config.fov * (weapons.current?.adsFovScale ?? e.config.adsFovScale);
              e.camera.updateProjectionMatrix();
            }
          },
          { id: WEAPON, shot: SHOT }
        );
      logs.push(`[shot] ${JSON.stringify(applied)}`);
      if (RELOAD) {
        await page.evaluate(pump, SETTLE);
        const started = await page.evaluate((): ReloadStart => {
          const e = window.__ENGINE__;
          if (!e) throw new Error('engine not ready');
          const w = e.ctx.get('weapons');
          if (!w.state) throw new Error('weapon state unavailable');
          w.state.mag = 5;
          if (!w.reload() || !w.viewmodel.clip)
            throw new Error('Cannot start scripted rifle reload');
          // Rotate before each step so the frozen player does not overwrite the camera.
          const step = e.step.bind(e);
          e.step = function (this: Engine, ...args: Parameters<Engine['step']>): void {
            this.camera.rotation.y += 0.002;
            step(...args);
          };
          return {
            weapon: w.activeId,
            clip: w.viewmodel.clipName,
            duration: w.viewmodel.clip.duration,
            yaw: e.camera.rotation.y,
          };
        });
        const captures: Array<ReloadState & { frame: number; path: string }> = [];
        let last = 0;
        for (const frame of [0, 20, 45, 70, 95, 120, 135]) {
          if (frame > last) await page.evaluate(pump, frame - last);
          await page.evaluate(present, 2);
          const state = await page.evaluate((): ReloadState => {
            const e = window.__ENGINE__;
            if (!e) throw new Error('engine not ready');
            const w = e.ctx.get('weapons');
            if (!w.state) throw new Error('weapon state unavailable');
            return {
              clip: w.viewmodel.clipName,
              clipTime: +w.viewmodel.clipT.toFixed(3),
              mag: w.state.mag,
              reloading: w.reloading,
              yaw: +e.camera.rotation.y.toFixed(4),
            };
          });
          const path = `${OUT}-${String(frame).padStart(3, '0')}.png`;
          mkdirSync(dirname(path), { recursive: true });
          await captureNative(page, path);
          captures.push({ frame, path, ...state });
          last = frame;
        }
        console.log(JSON.stringify({ ok: true, reload: started, captures, w: W, h: H }, null, 2));
      } else {
        await page.evaluate(pump, SETTLE);
        await page.evaluate(present, 2);
        mkdirSync(dirname(OUT), { recursive: true });
        await captureNative(page, OUT);
        const info: unknown = await page.evaluate('window.__RENDER_INFO__ ?? null');
        console.log(JSON.stringify({ ok: true, out: OUT, shot: SHOT, w: W, h: H, info }, null, 2));
      }
    }
  } catch (error) {
    failed = error instanceof Error ? error : new Error(String(error));
  } finally {
    if (failed || args.verbose) {
      const gpu: unknown = await page
        .evaluate(
          (): string =>
            window.__ENGINE__?.ctx.peek('render')?.renderer.backend.constructor.name ?? 'n/a'
        )
        .catch((): string => 'n/a');
      console.error('GPU:', gpu);
      console.error(logs.slice(-60).join('\n'));
    }
  }
} finally {
  try {
    await browser?.close();
  } finally {
    stopDevServer(server);
  }
}
if (failed) {
  console.error(JSON.stringify({ ok: false, error: failed.message }));
  process.exit(1);
}

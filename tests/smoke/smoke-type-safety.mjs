// Exercise the installed type-aware linter, not just configuration spelling.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const root = resolve(import.meta.dirname, '../..'),
  dir = mkdtempSync(join(tmpdir(), 'cod-types-'));
const rules = [
  'no-explicit-any',
  'no-unsafe-assignment',
  'no-unsafe-argument',
  'no-unsafe-call',
  'no-unsafe-member-access',
  'no-unsafe-return',
];
try {
  const config = join(dir, 'tsconfig.json'),
    file = join(dir, 'probe.ts');
  writeFileSync(
    config,
    JSON.stringify({
      compilerOptions: { strict: true, target: 'ES2022', noEmit: true },
      include: ['probe.ts'],
    })
  );
  const lint = (source) => {
    writeFileSync(file, source);
    return spawnSync(
      join(root, 'node_modules/.bin/oxlint'),
      [
        '--type-aware',
        '--config',
        join(root, '.oxlintrc.json'),
        '--tsconfig',
        config,
        '--format',
        'json',
        file,
      ],
      { cwd: root, encoding: 'utf8' }
    );
  };
  const unsafe = lint(`declare const leak: any;
export const copy = leak;
export const member = leak.value;
export const call = leak();
function accept(value: string) { return value; }
accept(leak);
export function unsafeReturn() { return leak; }
`);
  assert.equal(unsafe.status, 1, unsafe.stdout + unsafe.stderr);
  const diagnostics = JSON.parse(unsafe.stdout).diagnostics;
  for (const rule of rules)
    assert.ok(
      diagnostics.some((d) => d.code === `typescript(${rule})`),
      `${rule} must be enforced`
    );
  const safe = lint(`const parsed: unknown = JSON.parse('{"value":"ok"}');
export function value(): string {
  if (typeof parsed === 'object' && parsed !== null && 'value' in parsed && typeof parsed.value === 'string') return parsed.value;
  throw new Error('invalid value');
}
`);
  assert.equal(safe.status, 0, safe.stdout + safe.stderr);

  // Provider and event payload contracts must reject invalid consumers too.
  writeFileSync(
    file,
    `import type { EngineContext, EngineSystems, SystemId } from ${JSON.stringify(join(root, 'src/core/context.ts'))};
import { FxSystem } from ${JSON.stringify(join(root, 'src/fx/index.ts'))};
import type { FxContext } from ${JSON.stringify(join(root, 'src/fx/index.ts'))};
import type { Movement } from ${JSON.stringify(join(root, 'src/player/movement.ts'))};
import type { SurfaceParams } from ${JSON.stringify(join(root, 'src/materials/shader-tsl.ts'))};
import type { HazeSystem } from ${JSON.stringify(join(root, 'src/fx/haze.ts'))};
import type { EventBus } from ${JSON.stringify(join(root, 'src/core/registry.ts'))};
declare const ctx: EngineContext;
declare const events: EventBus;
ctx.get('player').setFlashlightEnabled(true);
ctx.get('render')._warmGraph().then(report => { const ms: number = report.ms; return ms; });
const fxCtx: FxContext = ctx;
const render: FxSystem['render'] = ctx.peek('render');
const fxRender: FxSystem['render'] = fxCtx.peek('render');
new FxSystem().init(ctx);
if (render && fxRender) {
  const drawGraph: Parameters<HazeSystem['prewarm']>[2] = () => render._warmGraph();
  drawGraph?.().then(report => { const ms: number = report.ms; return ms; });
  // @ts-expect-error a concrete provider's return type cannot drift to void
  const invalidWarm: typeof fxRender._warmGraph = async () => {};
  // @ts-expect-error a concrete provider's argument type cannot drift to number
  const invalidLight: typeof fxRender.addLight = (light: number) => render.activeSun;
}
type BadRender = Omit<EngineSystems['render'], '_warmGraph'> & { _warmGraph(): Promise<void> };
declare const badRender: BadRender;
// @ts-expect-error reject mismatched concrete provider returns at the FX boundary
const invalidRender: FxSystem['render'] = badRender;
declare const badLight: Omit<EngineSystems['render'], 'addLight'> & {
  addLight(light: number): ReturnType<EngineSystems['render']['addLight']>;
};
// @ts-expect-error reject mismatched concrete provider arguments at the FX boundary
const invalidLightProvider: FxSystem['render'] = badLight;
declare const badCtx: Omit<FxContext, 'peek'> & {
  peek<K extends SystemId>(id: K): (K extends 'render' ? BadRender : EngineSystems[K]) | null;
};
// @ts-expect-error generic contexts must not conceal mismatched provider returns
new FxSystem().init(badCtx);
const world: ReturnType<Movement['ctx']['peek']> = ctx.peek('world');
if (world) {
  const ladder = world.ladderAt(0, 0, 0);
  if (ladder) { const nx: number = ladder.nx; const nz: number = ladder.nz; }
  // @ts-expect-error lookup arguments are owned by WorldSystem
  world.ladderAt('invalid', 0, 0);
  // @ts-expect-error lookup results require validated numeric exit normals
  const invalidLookup: typeof world.ladderAt = () => ({ kind: 'ladder', x: 0, z: 0, y0: 0, y1: 1, radius: 1, nx: 'bad', nz: 0 });
}
const roughnessPair: SurfaceParams['roughness'] = [1, 0];
const roughnessTriple: SurfaceParams['roughness'] = [1, 0, 0.06];
// @ts-expect-error optional roughness minimum must still be numeric
const invalidRoughness: SurfaceParams['roughness'] = [1, 0, 'bad'];
events.on('player:heartbeat', event => { const strength: number = event.strength; return strength; });
// @ts-expect-error subsystem IDs are owned by registered providers
ctx.get('not-a-system');
// @ts-expect-error provider properties retain their actual types
const incorrect: string = ctx.get('player').health;
// @ts-expect-error payload fields cannot be silently untyped
events.emit('player:heartbeat', { strength: 'wrong', fraction: 1 });
// @ts-expect-error event names are canonical
events.on('not-an-event', () => {});
`
  );
  writeFileSync(
    config,
    JSON.stringify({
      extends: join(root, 'tsconfig.json'),
      include: [join(root, 'src'), file],
      exclude: [join(root, 'node_modules'), join(root, 'dist')],
    })
  );
  const contracts = spawnSync(join(root, 'node_modules/.bin/tsc'), ['--project', config], {
    cwd: root,
    encoding: 'utf8',
  });
  assert.equal(contracts.status, 0, contracts.stdout + contracts.stderr);
} finally {
  rmSync(dir, { recursive: true, force: true });
}
console.log(
  'type-safety: six unsafe patterns rejected; concrete FX/render/haze/world boundary return and argument types enforced'
);

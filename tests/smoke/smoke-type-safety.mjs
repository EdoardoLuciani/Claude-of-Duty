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

  // Every TypeScript function needs a return contract, including the rule's
  // normally exempt contextually typed callbacks and higher-order functions.
  const missingReturns = [
    'export function missing() { return 1; }',
    'export async function missing() { return 1; }',
    'export class Missing { method() { return 1; } }',
    'export class Missing { get value() { return 1; } }',
    'export const missing = function () { return 1; };',
    'export const missing = () => 1;',
    'export const missing: () => number = () => 1;',
    'export const missing = [1].map(value => value + 1);',
    'export function missing() { return (): number => 1; }',
    'export const missing = () => 1 as const;',
    'export const missing = (() => 1)();',
  ];
  for (const source of missingReturns) {
    const result = lint(source);
    assert.equal(result.status, 1, source + '\n' + result.stdout + result.stderr);
    assert.ok(
      JSON.parse(result.stdout).diagnostics.some(
        (d) => d.code === 'typescript(explicit-function-return-type)'
      ),
      `missing return annotation must be rejected: ${source}`
    );
  }
  const explicitReturns = lint(`export function value(): number { return 1; }
export async function asyncValue(): Promise<number> { return 1; }
export class Explicit {
  constructor() {}
  method(): number { return 1; }
  get value(): number { return 1; }
  set value(value: number) { void value; }
}
export const expression = function (): number { return 1; };
export const arrow = (): number => 1;
export const typed: () => number = (): number => 1;
export const mapped = [1].map((value): number => value + 1);
export function higherOrder(): () => number { return (): number => 1; }
export const constant = (): 1 => 1 as const;
export const immediate = ((): number => 1)();
`);
  assert.equal(explicitReturns.status, 0, explicitReturns.stdout + explicitReturns.stderr);

  // Exercise each newly enabled type-aware rule, including both single and
  // double assertions. Keep all fixture functions explicitly annotated.
  const safetyProbes = [
    ['no-floating-promises', 'export function ignored(): void { Promise.resolve(1); }'],
    [
      'no-misused-promises',
      'export function conditional(): void { if (Promise.resolve(false)) console.log("bad"); }',
    ],
    ['no-misused-promises', 'export const callbacks = [1].forEach(async (): Promise<void> => {});'],
    [
      'no-unsafe-type-assertion',
      'declare const input: unknown; export const narrowed = input as { health: number };',
    ],
    [
      'no-unsafe-type-assertion',
      'declare const input: number; export const narrowed = input as unknown as string;',
    ],
  ];
  for (const [rule, source] of safetyProbes) {
    const result = lint(source);
    assert.equal(result.status, 1, result.stdout + result.stderr);
    assert.ok(
      JSON.parse(result.stdout).diagnostics.some((d) => d.code === `typescript(${rule})`),
      `${rule}: ${source}`
    );
  }
  const safeAsync =
    lint(`export async function awaited(): Promise<number> { return await Promise.resolve(1); }
export function handled(): void { void Promise.resolve(1).catch((error: unknown): void => console.error(error)); }
export function checked(input: unknown): string {
  if (typeof input !== 'string') throw new Error('expected string');
  return input;
}
export const widened = { health: 1 } as object;
`);
  assert.equal(safeAsync.status, 0, safeAsync.stdout + safeAsync.stderr);

  // Use the real compiler settings, not a duplicated flag list. These probes
  // must fail if the implementation is wrong and fail this test if a flag is removed.
  writeFileSync(
    config,
    JSON.stringify({
      extends: join(root, 'tsconfig.json'),
      compilerOptions: {
        typeRoots: [join(root, 'node_modules/@types'), join(root, 'node_modules')],
      },
      include: [file],
      exclude: [],
    })
  );
  const compile = (source) => {
    writeFileSync(file, source);
    return spawnSync(join(root, 'node_modules/.bin/tsc'), ['--project', config], {
      cwd: root,
      encoding: 'utf8',
    });
  };
  const compilerProbes = [
    [
      'TS7030',
      'export function incomplete(value: boolean): number | undefined { if (value) return 1; }',
    ],
    [
      'TS4114',
      'class Base { run(): void {} } export class Derived extends Base { run(): void {} }',
    ],
    [
      'TS7029',
      'export function select(value: number): void { switch (value) { case 1: console.log(value); case 2: break; } }',
    ],
  ];
  for (const [code, source] of compilerProbes) {
    const result = compile(source);
    assert.notEqual(result.status, 0, `${code} must be enforced`);
    assert.ok((result.stdout + result.stderr).includes(code), result.stdout + result.stderr);
  }
  const safeCompiler =
    compile(`export function complete(value: boolean): number | undefined { if (value) return 1; return undefined; }
class Base { run(): void {} }
export class Derived extends Base { override run(): void {} }
export function select(value: number): void { switch (value) { case 1: console.log(value); break; case 2: break; } }
`);
  assert.equal(safeCompiler.status, 0, safeCompiler.stdout + safeCompiler.stderr);

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
      // Resolve the app's real type packages, not the temporary project's directory.
      compilerOptions: {
        typeRoots: [join(root, 'node_modules/@types'), join(root, 'node_modules')],
      },
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
  'type-safety: unsafe usage, assertions, promise misuse, missing return/override and fallthrough rejected; provider/event contracts enforced'
);

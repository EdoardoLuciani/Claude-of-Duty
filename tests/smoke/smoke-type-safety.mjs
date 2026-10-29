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

  // Only Vite's awaited disposal callback accepts promises; ordinary DOM
  // callbacks must remain covered by no-misused-promises in the same program.
  const hmrTypes = `import type {} from ${JSON.stringify(join(root, 'src/core/vite-types.d.ts'))};\n`;
  const safeHmr = lint(
    hmrTypes +
      `declare const hot: import(${JSON.stringify(join(root, 'node_modules/vite/types/hot.js'))}).ViteHotContext;
hot.dispose((): Promise<void> => Promise.resolve());
`
  );
  assert.equal(safeHmr.status, 0, safeHmr.stdout + safeHmr.stderr);
  const unsafeDom = lint(
    hmrTypes + `document.addEventListener('click', async (): Promise<void> => {});`
  );
  assert.equal(unsafeDom.status, 1, unsafeDom.stdout + unsafeDom.stderr);
  assert.ok(
    JSON.parse(unsafeDom.stdout).diagnostics.some(
      (d) => d.code === 'typescript(no-misused-promises)'
    )
  );

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
    ['TS2375', 'export const patch: { value?: number } = { value: undefined };'],
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
declare const keyedEvents: EventBus<Record<string | number, string>>;
keyedEvents.on(1, payload => { const text: string = payload; return text; });
keyedEvents.on('1', payload => { const text: string = payload; return text; });
keyedEvents.emit(1, 'numeric');
keyedEvents.emit('1', 'string');
// @ts-expect-error numeric event keys must retain their payload contract
keyedEvents.emit(1, 123);
import type { ViteHotContext } from 'vite/types/hot.js';
type DisposalResult = ReturnType<Parameters<ViteHotContext['dispose']>[0]>;
const pendingDisposal: DisposalResult = Promise.resolve();
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
declare const ambiguousEvent: 'player:heartbeat' | 'resize';
// @ts-expect-error a key union cannot accept a payload for only one possible key
events.emit(ambiguousEvent, { strength: 1, fraction: 1 });
declare const correlatedEvent:
  | ['player:heartbeat', { strength: number; fraction: number }]
  | ['resize', { width: number; height: number }];
events.emit(...correlatedEvent);

// Closed domains must survive provider/event/presentation boundaries.
import { STATE } from ${JSON.stringify(join(root, 'src/ai/agent.ts'))};
import type { Agent, AiState } from ${JSON.stringify(join(root, 'src/ai/agent.ts'))};
import type { PlayerMoveState } from ${JSON.stringify(join(root, 'src/player/movement.ts'))};
import type { PlayerState } from ${JSON.stringify(join(root, 'src/player/index.ts'))};
import type { SurfaceName } from ${JSON.stringify(join(root, 'src/physics/surfaces.ts'))};
import type { FoleyOptions } from ${JSON.stringify(join(root, 'src/audio/physical.ts'))};
import type { Mixer } from ${JSON.stringify(join(root, 'src/audio/mixer.ts'))};
declare const agent: Agent;
declare const mixer: Mixer;
declare const mesh: import('three').Mesh;
ctx.has('telemetry');
// @ts-expect-error optional provider checks must use the same IDs as get/peek
ctx.has('telemetery');
agent._setState(STATE.COMBAT);
const aiState: AiState = agent.state;
// @ts-expect-error invalid AI transitions must not silently idle the actor
agent._setState('comabt');
// @ts-expect-error direct state writes retain the same finite vocabulary
agent.state = 'typo';
const move = ctx.get('player').movement;
move._setState('climb');
const previousMove: PlayerMoveState = move.prevState;
// @ts-expect-error locomotion state is closed
move._setState('tac-sprint');
// @ts-expect-error lean is a presentation modifier, not a locomotion state
move._setState('lean');
events.on('player:state', e => {
  const state: PlayerState | undefined = e.state;
  return state;
});
const surface: SurfaceName = ctx.get('physics').raycast({ x: 0, y: 0, z: 0 }, { x: 0, y: -1, z: 0 }, 1).surface;
const materialSurface: SurfaceName = ctx.get('materials').surfaceOf('asphalt');
ctx.get('physics').addStatic(mesh, 'metal');
ctx.get('physics').addCollider({ surface: 'flesh', ballisticSurface: 'fabric' });
// @ts-expect-error explicit collision surfaces cannot be fuzzy material labels
ctx.get('physics').addStatic(mesh, 'metal_panel');
// @ts-expect-error ballistic surfaces use the same vocabulary as finishes
ctx.get('physics').addCollider({ ballisticSurface: 'metla' });
// @ts-expect-error canonical names survive the event bus
events.emit('player:land', { velocity: 1, surface: 'concret' });
const foley: FoleyOptions = { surface: 'metal' };
// @ts-expect-error audio consumes canonical surfaces, not arbitrary strings
const badFoley: FoleyOptions = { surface: 'metla' };
mixer.bus('weapons');
mixer.sendBus('foley');
// @ts-expect-error incorrect routing must not silently select foley
mixer.bus('wepaons');
// @ts-expect-error reverb sends retain the same routing domain
mixer.sendBus('foely');
// @ts-expect-error spatial emitter options retain the bus vocabulary
ctx.get('audio').play('step', null, { bus: 'foely' });
// @ts-expect-error dry playback must not widen the route
ctx.get('audio')._playDry('step', {}, 'foely');
// @ts-expect-error volume controls retain the same route vocabulary
ctx.get('audio').setBusVolume('foely', 1);
const hudMode: WeaponMode = ctx.get('weapons').getHudState().mode;
const fireMode: WeaponMode = ctx.get('weapons').fireMode;
const uiMode: WeaponMode = ctx.get('ui').state.fireMode;
events.emit('intel:secured', { id: 'case', position: ctx.camera.position, credits: 500 });
// @ts-expect-error credits remain numeric
events.emit('intel:secured', { id: 'case', position: ctx.camera.position, credits: '500' });
// @ts-expect-error UI state is semantic; casing belongs only in rendered text
ctx.get('ui').state.fireMode = 'AUTO';

type RadioWarm = Awaited<ReturnType<EngineSystems['radio']['prewarmMaterials']>>;
declare const radioWarm: RadioWarm;
if (radioWarm?.ok) {
  const milliseconds: number = radioWarm.graphWarm.ms;
  // @ts-expect-error success cannot expose an error branch
  radioWarm.error;
}
// @ts-expect-error a successful warmup must carry the provider's actual graph result
const wrongWarm: RadioWarm = { ok: true, reason: 'no renderer' };

// Weapon data, runtime state, loaders and market share the same domain.
import { WEAPON_DEFS, isWeaponId } from ${JSON.stringify(join(root, 'src/weapons/defs.ts'))};
import type { WeaponId, WeaponDef, WeaponMode } from ${JSON.stringify(join(root, 'src/weapons/defs.ts'))};
import type { AuthoredModels, WeaponModelRecord, WeaponState } from ${JSON.stringify(join(root, 'src/weapons/runtime-types.ts'))};
declare const input: unknown;
if (isWeaponId(input)) {
  const id: WeaponId = input;
  ctx.get('weapons').owns(id);
  const def: WeaponDef = WEAPON_DEFS[id];
}
ctx.get('weapons').equipPrimary('mcx');
ctx.get('weapons').equipSecondary('smg');
// @ts-expect-error internal weapon state must not widen IDs to string
ctx.get('weapons').activeId = 'typo';
// @ts-expect-error owned collections reject unknown IDs
ctx.get('weapons').owned.add('typo');
// @ts-expect-error primary and secondary are different slots
ctx.get('weapons').equipPrimary('pistol');
// @ts-expect-error primary and secondary are different slots
ctx.get('weapons').equipSecondary('rifle');
// @ts-expect-error inspection only receives validated weapon IDs, not kit IDs
ctx.get('weapons').createInspectionModel('bandage');
// @ts-expect-error market item IDs cannot silently widen to string
ctx.get('market').buy('typo');
type MarketItem = ReturnType<EngineSystems['market']['getHudState']>['items'][number];
declare const item: MarketItem;
const uiItem: Parameters<EngineSystems['ui']['shop']['_card']>[0] = item;
declare const state: WeaponState;
const mode: WeaponMode = state.mode;
// @ts-expect-error fire modes are a closed domain
state.mode = 'automatic';
// @ts-expect-error schema rejects misspelled nested fire modes
const badMode: WeaponDef = { ...WEAPON_DEFS.rifle, modes: ['automatic'] };
// @ts-expect-error every definition needs an initial fire mode
const noModes: WeaponDef = { ...WEAPON_DEFS.rifle, modes: [] };
// @ts-expect-error vectors have exactly three components
const shortVector: WeaponDef = { ...WEAPON_DEFS.rifle, hipPos: [0, 0] };
// @ts-expect-error recoil pattern construction requires a nonempty climb shape
const noClimb: WeaponDef['recoil'] = { ...WEAPON_DEFS.rifle.recoil, climbShape: [] };
// @ts-expect-error schema rejects misspelled tuning rather than inferring it as valid
const typoTuning: WeaponDef = { ...WEAPON_DEFS.rifle, spreadHpi: 2 };
const { damage, ...withoutDamage } = WEAPON_DEFS.rifle;
// @ts-expect-error authored definitions must retain mandatory tuning
const missingDamage: WeaponDef = withoutDamage;
// @ts-expect-error catalog keys and embedded IDs cannot disagree
const wrongCatalogId: typeof WEAPON_DEFS.rifle = { ...WEAPON_DEFS.rifle, id: 'pistol' };
declare const model: WeaponModelRecord;
if (model.id === 'rifle') {
  // Native discriminant narrowing, without a user-authored type predicate.
  const rifle: AuthoredModels['rifle'] = model;
}
declare const pistol: AuthoredModels['pistol'];
// @ts-expect-error loader contracts cannot associate an ID with a different adapter
const wrongAdapter: AuthoredModels['rifle'] = pistol;

// Registration must establish exactly the provider contract lookup promises.
import { Registry } from ${JSON.stringify(join(root, 'src/core/registry.ts'))};
import type { Engine } from ${JSON.stringify(join(root, 'src/core/engine.ts'))};
import { MaterialSystemNode } from ${JSON.stringify(join(root, 'src/materials/index.ts'))};
declare const engine: Engine;
const registry = new Registry<EngineSystems>();
registry.add('player', ctx.get('player'));
const player: EngineSystems['player'] = registry.get('player');
engine.add(MaterialSystemNode, { renderer: ctx.get('render').renderer });
// @ts-expect-error the provider cannot determine/widen the registration key
registry.add('player', ctx.get('audio'));
// @ts-expect-error registration IDs are as closed as lookup IDs
registry.add('not-a-system', ctx.get('player'));
declare const ambiguousId: 'player' | 'audio';
// @ts-expect-error a union key does not establish which provider is being registered
registry.add(ambiguousId, ctx.get('player'));
declare const ambiguousConstructor: {
  readonly id: 'player' | 'audio';
  new (): EngineSystems['player'];
};
// @ts-expect-error constructor identity and instance must remain correlated too
engine.add(ambiguousConstructor);
declare const badDependencies: {
  readonly id: 'player';
  readonly deps: ['wepaons'];
  new (): EngineSystems['player'];
};
// @ts-expect-error static dependency names must use the provider map too
engine.add(badDependencies);
class FakePlayer {
  static readonly id = 'player';
  update(): void {}
}
// @ts-expect-error a valid-looking static ID does not establish the instance contract
engine.add(FakePlayer);
// @ts-expect-error direct registration cannot bypass Engine.add
engine.registry.add('player', new FakePlayer());
const dynamicRegistry = new Registry();
// @ts-expect-error a dynamic registry cannot promise a concrete player implementation
dynamicRegistry.get('player').setFlashlightEnabled(true);
// @ts-expect-error lifecycle hooks cannot return arbitrary values
dynamicRegistry.add('bad', { init(): number { return 1; } });

// Authored overrides are closed, correctly typed and cannot erase required state.
import { createConfig } from ${JSON.stringify(join(root, 'src/core/config.ts'))};
import { applyDefinedPatch } from ${JSON.stringify(join(root, 'src/core/patch.ts'))};
import { LIBRARY } from ${JSON.stringify(join(root, 'src/materials/library.ts'))};
declare const materials: MaterialSystemNode;
materials.get('concrete', { scale: 2, three: { physical: true, clearcoat: 0.5 } });
materials.get('concrete', { three: { physical: false, roughness: 0.5 } });
// @ts-expect-error physical-only properties require choosing the physical constructor
materials.get('concrete', { three: { clearcoat: 0.5 } });
// @ts-expect-error selecting a standard material cannot admit physical-only properties
materials.get('concrete', { three: { physical: false, clearcoat: 0.5 } });
// @ts-expect-error color nodes belong to the surface shader, not authoring options
materials.get('concrete', { three: { colorNode: null } });
// @ts-expect-error this remains true for physical materials
materials.get('concrete', { three: { physical: true, normalNode: null } });
// @ts-expect-error cloth emission is also owned by the surface shader
materials.get('concrete', { three: { emissiveNode: null } });
// @ts-expect-error surface option typos must not be accepted by an index signature
materials.get('concrete', { normalStrenght: 0.8 });
// @ts-expect-error nested Three options are checked too
materials.get('concrete', { three: { metalnes: 1 } });
// @ts-expect-error Three values retain their real types
materials.get('concrete', { three: { roughness: 'very rough' } });
// @ts-expect-error constructor selection is boolean, not arbitrary metadata
materials.get('concrete', { three: { physical: 'false' } });
// @ts-expect-error bake shader parameters have exactly four components
materials.get('concrete', { bake: { param: [1, 0] } });
// @ts-expect-error library-owned live uniforms are not caller authoring options
materials.get('concrete', { tileNode: 2 });
// @ts-expect-error removed legacy switches must not silently do nothing
materials.get('concrete', { noGrad: true });
// @ts-expect-error explicit undefined cannot erase a required surface default
materials.get('concrete', { scale: undefined });
// @ts-expect-error explicit undefined cannot erase a required bake default
materials.get('concrete', { bake: { size: undefined } });
// @ts-expect-error config overrides must omit unset fields
createConfig({ fov: undefined });
// @ts-expect-error weather patches follow the same omission contract
ctx.get('sky').setWeather({ cloudCoverage: undefined });
const statePatch = { value: 1 };
applyDefinedPatch(statePatch, { value: 2 });
// @ts-expect-error a patch must preserve target value types
applyDefinedPatch(statePatch, { value: 'wrong' });
// @ts-expect-error a patch cannot introduce unrelated fields
applyDefinedPatch(statePatch, { other: 1 });
const { sand, ...withoutSand } = LIBRARY;
// @ts-expect-error every generated surface requires a library definition
const incompleteLibrary: typeof LIBRARY = withoutSand;

// Public options describe consumed data, not entire implementation objects.
import type { ShellSystem } from ${JSON.stringify(join(root, 'src/fx/shells.ts'))};
import type { Ambience } from ${JSON.stringify(join(root, 'src/fx/ambience.ts'))};
import type { RaycastIgnore } from ${JSON.stringify(join(root, 'src/physics/index.ts'))};
import type { ArmRig } from ${JSON.stringify(join(root, 'src/weapons/arm-asset.ts'))};
import type { SoldierMaterialFactory } from ${JSON.stringify(join(root, 'src/ai/soldier.ts'))};
declare const shells: ShellSystem;
declare const ambience: Ambience;
declare const arm: ArmRig;
declare const soldierMaterials: SoldierMaterialFactory;
shells.spawn(ctx.camera.position, { x: 1 });
ambience.addColumn(0, 0, 0, { rate: 8, life: 3 });
const ignoredContact: RaycastIgnore = { staticObject: 1, solid: 2 };
// @ts-expect-error velocity inputs do not include Vector3 methods
shells.spawn(ctx.camera.position, { normalize() { throw new Error(); } });
// @ts-expect-error emitter bookkeeping is not an authoring control
ambience.addColumn(0, 0, 0, { age: 3 });
// @ts-expect-error hit measurements are not exclusion selectors
const irrelevantContact: RaycastIgnore = { distance: 20 };
// @ts-expect-error the decal's world is owned by FX, not its callers
ctx.get('fx').addDecal(ctx.camera.position, ctx.camera.position, { world: null });
// @ts-expect-error pooled projection coordinates are not decal options
ctx.get('fx').addDecal(ctx.camera.position, ctx.camera.position, { point: ctx.camera.position });
// @ts-expect-error arm poses are named strings, not opaque values
arm.setPose(42);
// @ts-expect-error offline soldier material options use their real authoring schema
soldierMaterials.get('cloth', { normalScael: 1 });

// Compact event descriptors must identify a weapon; arbitrary strings stay at external boundaries.
import type { EventWeapon } from ${JSON.stringify(join(root, 'src/core/events.ts'))};
const compactWeapon: EventWeapon = { id: 'pistol' };
const aiWeapon: EventWeapon = 'ai_rifle';
// @ts-expect-error an empty descriptor has no identity
const emptyWeapon: EventWeapon = {};
// @ts-expect-error suppressed alone is not an identity
const unidentifiedWeapon: EventWeapon = { suppressed: true };
// @ts-expect-error gameplay events do not accept arbitrary external strings
const inventedWeapon: EventWeapon = 'not-a-weapon';

// Optional snapshots/defaulted inputs can use ordinary undefined-valued properties.
import type { QuerySample, WorkerMessage } from ${JSON.stringify(join(root, 'src/ai/attachment-types.ts'))};
import type { Arm } from ${JSON.stringify(join(root, 'src/weapons/hands.ts'))};
import type { VolumetricBuildOptions } from ${JSON.stringify(join(root, 'src/sky/volumetrics.ts'))};
const querySample: QuerySample = {
  type: 'query', actor: null, kind: null, frame: null, key: undefined,
  ms: 0, roundTripMs: null, queueMs: null, moves: 0,
};
const workerSample: WorkerMessage = {
  type: 'result', id: 1, value: true, ms: 0, moves: 0,
  repeatedStates: undefined, savedMoves: undefined, queueMs: undefined,
};
const gripOptions: Parameters<Arm['fitGrip']>[1] = { fingers: undefined, spread: undefined };
declare const fogInputs: VolumetricBuildOptions;
const fogWithoutVisibility: VolumetricBuildOptions = { ...fogInputs, visibility: undefined };

// Sparse/random inputs retain absence; nonempty choices do not invent it.
import { Rng } from ${JSON.stringify(join(root, 'src/core/rng.ts'))};
const rng = new Rng(1);
const guaranteedChoice: number = rng.pick([1, 2]);
const absentChoice: number | undefined = rng.pick([] as number[]);
// @ts-expect-error an empty/dynamic array does not guarantee a choice
const inventedChoice: number = rng.pick([] as number[]);
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

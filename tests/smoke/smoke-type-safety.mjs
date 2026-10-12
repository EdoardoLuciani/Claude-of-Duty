// Exercise the installed type-aware linter, not just configuration spelling.
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

const root = resolve(import.meta.dirname, '../..'), dir = mkdtempSync(join(tmpdir(), 'cod-types-'));
const rules = ['no-explicit-any', 'no-unsafe-assignment', 'no-unsafe-argument',
  'no-unsafe-call', 'no-unsafe-member-access', 'no-unsafe-return'];
try {
  const config = join(dir, 'tsconfig.json'), file = join(dir, 'probe.ts');
  writeFileSync(config, JSON.stringify({ compilerOptions: { strict: true, target: 'ES2022', noEmit: true }, include: ['probe.ts'] }));
  const lint = source => {
    writeFileSync(file, source);
    return spawnSync(join(root, 'node_modules/.bin/oxlint'), ['--type-aware',
      '--config', join(root, '.oxlintrc.json'), '--tsconfig', config, '--format', 'json', file],
    { cwd: root, encoding: 'utf8' });
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
  for (const rule of rules) assert.ok(diagnostics.some(d => d.code === `typescript(${rule})`), `${rule} must be enforced`);
  const safe = lint(`const parsed: unknown = JSON.parse('{"value":"ok"}');
export function value(): string {
  if (typeof parsed === 'object' && parsed !== null && 'value' in parsed && typeof parsed.value === 'string') return parsed.value;
  throw new Error('invalid value');
}
`);
  assert.equal(safe.status, 0, safe.stdout + safe.stderr);

  // Provider and event payload contracts must reject invalid consumers too.
  writeFileSync(file, `import type { EngineContext } from ${JSON.stringify(join(root, 'src/core/context.ts'))};
import type { EventBus } from ${JSON.stringify(join(root, 'src/core/registry.ts'))};
declare const ctx: EngineContext;
declare const events: EventBus;
ctx.get('player').setFlashlightEnabled(true);
ctx.get('render')._warmGraph().then(report => { const ms: number = report.ms; return ms; });
events.on('player:heartbeat', event => { const strength: number = event.strength; return strength; });
// @ts-expect-error subsystem IDs are owned by registered providers
ctx.get('not-a-system');
// @ts-expect-error provider properties retain their actual types
const incorrect: string = ctx.get('player').health;
// @ts-expect-error payload fields cannot be silently untyped
events.emit('player:heartbeat', { strength: 'wrong', fraction: 1 });
// @ts-expect-error event names are canonical
events.on('not-an-event', () => {});
`);
  writeFileSync(config, JSON.stringify({ extends: join(root, 'tsconfig.json'),
    include: [join(root, 'src'), file], exclude: [join(root, 'node_modules'), join(root, 'dist')] }));
  const contracts = spawnSync(join(root, 'node_modules/.bin/tsc'), ['--project', config], { cwd: root, encoding: 'utf8' });
  assert.equal(contracts.status, 0, contracts.stdout + contracts.stderr);
} finally { rmSync(dir, { recursive: true, force: true }); }
console.log('type-safety gates reject all six unsafe patterns and accept validated unknown');

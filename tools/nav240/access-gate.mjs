// Complete authored walking access, not ladders or planned vault routes.
import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import { SurfaceNav } from '../../src/ai/nav.js';
import { loadMap, addAccessCases } from './fixtures.mjs';
import { execute } from './harness.mjs';

export async function accessGate(modes = [{ speed: 1.5, dt: 1 / 60 }]) {
  const f = await loadMap(); addAccessCases(f);
  f.grid = await SurfaceNav.load(f.surfaceRaw, f.physics);
  const candidate = { query(from, to) {
    const points = []; f.grid.findPath(from, to, points);
    return { points, outcome: f.grid.lastOutcome, reason: f.grid.lastReason };
  } };
  const results = [];
  try {
    for (const mode of modes) for (const sample of f.cases.filter(c => c.name.startsWith('access/'))) {
      const result = execute(f, candidate, sample, true, mode);
      results.push({ ...result, speed: mode.speed, dt: mode.dt });
    }
    return { sourceHash: f.meta.sourceHash, assets: f.meta.assets, results };
  } finally { f.grid.dispose(); }
}

if (process.argv[1] === new URL(import.meta.url).pathname) {
  const report = await accessGate([{ speed: 1.5, dt: 1 / 60 }, { speed: 4.3, dt: 1 / 30 }]);
  const file = process.argv.find(a => a.startsWith('--out='))?.slice(6) ?? '/tmp/nav-access-gate.json';
  writeFileSync(file, JSON.stringify(report, null, 2) + '\n');
  for (const r of report.results) console.log(`${r.name} @ ${r.speed}: ${r.status}, recovery=${r.recoveryAttempts}`);
  assert.ok(report.results.every(r => r.arrived && r.recovery.length === 0), 'every authored walking destination must physically arrive without relocation');
}

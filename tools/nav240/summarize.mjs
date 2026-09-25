// Keep the review artifact small; the full runner JSON retains paths and 5 Hz traces.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
const [input, prefix] = process.argv.slice(2);
if (!input || !prefix) throw new Error('Usage: summarize.mjs <run.json> <output-prefix>');
const report = JSON.parse(readFileSync(input));
const rows = ['fixture,candidate,case,query,execution,corrected_execution,seconds,path_m,remaining_m,floor_error_m,max_stall_s,recoveries,waypoints,expanded,stale'];
for (const r of report.results) for (let i = 0; i < r.movement.length; i++) {
  const m = r.movement[i], q = r.queries[i];
  rows.push([r.fixture, r.candidate, m.name, m.initialOutcome, m.status, r.correctedMovement[i].status,
    m.elapsed, m.pathDistance, m.horizontalError, m.floorError, m.maxStall, m.recovery.length,
    q.waypoints, q.expanded, q.stale].map(v => typeof v === 'number' ? v.toFixed(3) : v ?? '').join(','));
}
report.results = report.results.map(({ movement, correctedMovement, queries, ...metrics }) => ({
  ...metrics,
  queryOutcomes: queries.reduce((out, q) => { out[q.outcome] = (out[q.outcome] ?? 0) + 1; return out; }, {}),
  executionOutcomes: movement.reduce((out, m) => { out[m.status] = (out[m.status] ?? 0) + 1; return out; }, {}),
  correctedOutcomes: correctedMovement.reduce((out, m) => { out[m.status] = (out[m.status] ?? 0) + 1; return out; }, {}),
}));
mkdirSync(dirname(prefix), { recursive: true });
writeFileSync(`${prefix}-results.json`, JSON.stringify(report,
  (_k, v) => typeof v === 'number' ? Math.round(v * 1000) / 1000 : v, 2) + '\n');
writeFileSync(`${prefix}-traversal.csv`, rows.join('\n') + '\n');

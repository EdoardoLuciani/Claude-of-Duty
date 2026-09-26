import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import { loadMap, addClearStairCases, OBSTRUCTED_MAP_GOALS } from './fixtures.mjs';
import { recastApi, recastMesh } from './recast.mjs';
import { execute, canConnect } from './harness.mjs';
const api = await recastApi(process.argv[2]);
const fixture = await loadMap();
const candidate = recastMesh(api, fixture.physics, Number(process.argv[3] ?? .045), {
  tiled: true, tileSize: 256, ch: .05, maxSimplificationError: 1, detailSampleDist: 1,
  ...JSON.parse(process.argv[5] ?? '{}'),
});
console.log(candidate.metrics);
addClearStairCases(fixture);
const results = [];
for (const s of fixture.cases.filter(c => !c.recorded)) {
  const q = candidate.query(s.from, s.to);
  const result = execute(fixture, candidate, s, true);
  results.push({ ...result, direct: canConnect(fixture.physics, s.from, s.to),
    from: s.from.toArray(), to: s.to.toArray(), query: q });
  console.log(s.name, result.initialOutcome, result.status, result.horizontalError.toFixed(3), result.floorError.toFixed(3));
  const invalid = OBSTRUCTED_MAP_GOALS.includes(s.name);
  if (invalid) assert.notEqual(q.outcome, 'success', `${s.name}: reject the obstructed fixture`);
  else assert.equal(result.arrived, true, `${s.name}: ${result.status}`);
  assert.equal(result.recovery.length, 0, `${s.name}: emergency repositioning is not traversal`);
}
writeFileSync(process.argv[4] ?? '/tmp/nav305-gate.json', JSON.stringify({ assets: fixture.meta.assets, sourceHash: fixture.meta.sourceHash, metrics: candidate.metrics, results }, null, 2));
candidate.dispose();

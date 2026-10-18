#!/usr/bin/env node
/** Postprocess CDP samples; no runtime instrumentation. Inclusive rows overlap. */
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { SourceMap } from 'node:module';
import { basename, resolve } from 'node:path';

import { parseArgs } from './lib/browser-harness.mjs';

const args = parseArgs();
assert(args.cpu && args.frames && args.maps && args.out, '--cpu, --frames, --maps, --out required');
const capture = JSON.parse(readFileSync(args.cpu, 'utf8'));
const frames = JSON.parse(readFileSync(args.frames, 'utf8'));
assert.equal(frames.failure, null);
const profile = capture.profile;
const navigation = capture.clock.find((m) => m.name === 'NavigationStart').value * 1e6;
const first = navigation + frames.samples[0].startAt * 1000;
const lastFrame = frames.samples.at(-1);
const last = navigation + (lastFrame.startAt + lastFrame.cpuMs) * 1000;
assert(first >= profile.startTime && last <= profile.endTime, 'CDP/document clocks do not align');
const maps = new Map();
const label = (node) => {
  const f = node.callFrame;
  if (!f.url) return f.functionName || '(anonymous/native)';
  if (f.url.startsWith('wasm:')) return `${f.url} ${f.functionName}`;
  const file = basename(new URL(f.url).pathname);
  if (!maps.has(file)) {
    const source = JSON.parse(readFileSync(resolve(args.maps, `${file}.map`), 'utf8'));
    maps.set(file, new SourceMap(source));
  }
  const original = maps.get(file).findEntry(f.lineNumber, f.columnNumber);
  assert(original.originalSource, `unmapped frame ${f.url}:${f.lineNumber}:${f.columnNumber}`);
  return `${original.originalSource.replace(/^\.\.\/\.\.\//, '')}:${original.originalLine + 1} ${f.functionName || '(anonymous)'}`;
};
const nodes = new Map(profile.nodes.map((n) => [n.id, n]));
const parents = new Map();
for (const n of profile.nodes) for (const child of n.children ?? []) parents.set(child, n.id);
const stacks = new Map();
const stack = (id) => {
  if (!stacks.has(id)) {
    const chain = parents.has(id) ? [...stack(parents.get(id)), id] : [id];
    stacks.set(id, chain);
  }
  return stacks.get(id);
};
const labels = new Map();
for (const node of profile.nodes) labels.set(node.id, label(node));
const totals = new Map();
let timestamp = profile.startTime;
let measuredUs = 0;
let renderUs = 0;
let measuredCount = 0;
let renderCount = 0;
for (let i = 0; i < profile.samples.length; i++) {
  const delta = profile.timeDeltas[i];
  timestamp += delta;
  // End-point sample assignment is approximate at the sampling interval (500us).
  if (timestamp < first || timestamp > last) continue;
  measuredUs += delta;
  measuredCount++;
  const chain = stack(profile.samples[i]);
  const boundary = chain.findIndex(
    (id) => nodes.get(id).callFrame.functionName === 'observedRender'
  );
  if (boundary < 0) continue;
  renderUs += delta;
  renderCount++;
  const leaf = labels.get(profile.samples[i]);
  const unique = new Set(chain.slice(boundary).map((id) => labels.get(id)));
  for (const name of unique) {
    let row = totals.get(name);
    if (!row) totals.set(name, (row = { name, exclusiveUs: 0, inclusiveUs: 0, hits: 0 }));
    row.inclusiveUs += delta;
    if (name === leaf) {
      row.exclusiveUs += delta;
      row.hits++;
    }
  }
}
assert(renderCount > 1000, 'insufficient render samples');
const rows = Array.from(totals.values(), (r) => ({
  ...r,
  exclusivePercent: +((r.exclusiveUs / renderUs) * 100).toFixed(2),
  inclusivePercent: +((r.inclusiveUs / renderUs) * 100).toFixed(2),
}));
const result = {
  revision: frames.revision,
  note: 'Steady measured frames only; only stacks inside observedRender. Weighted CDP samples, not exact per-method timings. Inclusive rows overlap; do not sum them. Sampling perturbs execution. Setup/warmup excluded via aligned document/CDP clocks.',
  measuredCount,
  renderCount,
  measuredUs,
  renderUs,
  sampledRenderSharePercent: +((100 * renderUs) / measuredUs).toFixed(2),
  sessionMetrics: capture.clockEnd
    ? {
        note: 'Entire CDP session, including fixture setup/warmup/serialization; NOT steady-frame timings. ThreadTime is renderer main-thread CPU, ProcessTime includes other renderer-process threads, neither is GPU execution.',
        deltasMs: Object.fromEntries(
          ['Timestamp', 'ThreadTime', 'ProcessTime', 'TaskDuration', 'ScriptDuration'].map(
            (name) => [
              name,
              1000 *
                (capture.clockEnd.find((m) => m.name === name).value -
                  capture.clock.find((m) => m.name === name).value),
            ]
          )
        ),
      }
    : null,
  exclusive: [...rows].sort((a, b) => b.exclusiveUs - a.exclusiveUs),
  inclusive: [...rows].sort((a, b) => b.inclusiveUs - a.inclusiveUs),
};
writeFileSync(args.out, JSON.stringify(result, null, 2));
console.log(
  JSON.stringify(
    {
      ...result,
      exclusive: result.exclusive.slice(0, 30),
      inclusive: result.inclusive.slice(0, 15),
    },
    null,
    2
  )
);

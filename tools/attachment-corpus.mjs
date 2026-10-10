#!/usr/bin/env node
// Frozen-query kernel comparison in Node, not a browser/frame-time benchmark.
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import * as THREE from 'three';
import { loadMap, synthetic } from './nav240/fixtures.mjs';
import { CharacterController } from '../src/physics/character.js';
import { INFANTRY } from '../src/ai/capabilities.ts';
import { canStand, checkAttachment, WALK_STEP } from '../src/ai/attachment.js';
import { parseArgs } from './lib/browser-harness.mjs';
const args = parseArgs(), out = String(args.out ?? '/tmp/attachment-corpus.json');
writeFileSync(out, JSON.stringify({ failure: 'incomplete' }));
try {
  assert(Object.keys(args).every(k => ['out','corpus','reference','rounds'].includes(k)), 'unsupported option');
  const revision = String(args.reference ?? 'bec6a54'), rounds = Number(args.rounds ?? 8);
  assert(/^[0-9a-f]{7,40}$/.test(revision) && Number.isInteger(rounds) && rounds >= 1 && rounds <= 30);
  const source = execFileSync('git', ['show', `${revision}:src/ai/attachment.js`], { encoding: 'utf8' });
  assert.equal((source.match(/export function checkAttachment\(/g) ?? []).length, 1);
  const body = source.slice(source.indexOf('export function checkAttachment')).replace('export ', '');
  const reference = new Function('INFANTRY','WALK_STEP',`${body}; return checkAttachment;`)(INFANTRY,WALK_STEP);
  const corpus = JSON.parse(readFileSync(String(args.corpus), 'utf8'));
  assert(corpus.length > 0 && corpus.length <= 10000);
  assert(corpus.every(k => k.length === 9 && k.every(Number.isFinite)));
  const make = physics => {
    const probe = new CharacterController(physics.staticWorld); let moves = 0;
    const move = probe.move; probe.move = function (...a) { moves++; return move.apply(this, a); };
    return { physics, repeatState:true, _probe: probe, _p0: new THREE.Vector3(), _p1: new THREE.Vector3(), canStand,
      stats: { endpointChecks: 0 }, moves: () => moves };
  };
  const map = await loadMap(), scene = synthetic();
  const fixtures = [{ name: 'captured-map', physics: map.physics, keys: corpus }];
  const cases = [];
  for (const c of scene.cases) for (const radius of [.2,.32,.36,.48]) for (const height of [1.2,1.8245])
    for (const steps of [0,1,2,3,20,80,400]) for (const dy of [0,1e-8])
      cases.push([c.from.x,c.from.y+dy,c.from.z,c.to.x,c.to.y,c.to.z,radius,height,steps]);
  fixtures.push({ name: 'synthetic-stairs-walls-floors', physics: scene.physics, keys: cases });
  const results = [];
  for (const f of fixtures) {
    const original = make(f.physics), optimized = make(f.physics), disabled = make(f.physics), a = new THREE.Vector3(), b = new THREE.Vector3();
    disabled.repeatState = false;
    const invoke = (fn, nav, k) => { a.set(k[0],k[1],k[2]); b.set(k[3],k[4],k[5]); return fn.call(nav,a,b,k[6],k[7],k[8]); };
    const booleans = [], details = [];
    for (const k of f.keys) {
      const before = original.moves(), after = optimized.moves();
      const expected = invoke(reference, original, k), actual = invoke(checkAttachment, optimized, k);
      assert.equal(actual, expected, `proof mismatch ${k}`);
      assert.equal(invoke(checkAttachment,disabled,k), expected, `disabled control mismatch ${k}`);
      assert(optimized.moves()-after <= original.moves()-before, 'optimization added motor moves');
      booleans.push(actual); details.push({ key:k, value:actual, originalMoves:original.moves()-before, optimizedMoves:optimized.moves()-after });
    }
    const timed = [];
    const run = (name, fn, nav) => {
      const before = nav.moves(), start = performance.now(); let accepted = 0;
      for (const k of f.keys) accepted += Number(invoke(fn,nav,k));
      timed.push({ name, ms:performance.now()-start, moves:nav.moves()-before, accepted });
    };
    // Warm both kernels, then alternate order. Entire ordered corpus is identical.
    run('warm-reference',reference,original); run('warm-repeat',checkAttachment,optimized); run('warm-disabled',checkAttachment,disabled);
    const order = [['reference',reference,original],['repeat',checkAttachment,optimized],['disabled',checkAttachment,disabled]];
    for (let r=0;r<rounds;r++) for(let j=0;j<order.length;j++) run(...order[(r+j)%order.length]);
    results.push({ name:f.name, queries:f.keys.length, accepted:booleans.filter(Boolean).length,
      repeatedStates:optimized.stats.repeatedStates ?? 0, savedMoves:optimized.stats.savedMoves ?? 0, details, timed });
  }
  const report = { failure:null, reference:revision, referenceHash:createHash('sha256').update(source).digest('hex'),
    node:process.version, v8:process.versions.v8, rounds, results };
  writeFileSync(out,JSON.stringify(report,null,2)); console.log(JSON.stringify(results.map(r=>({name:r.name,queries:r.queries,accepted:r.accepted,repeatedStates:r.repeatedStates,savedMoves:r.savedMoves,timed:r.timed})),null,2));
} catch(error) { writeFileSync(out,JSON.stringify({failure:String(error.stack??error)})); throw error; }

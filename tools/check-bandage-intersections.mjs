#!/usr/bin/env node
/** Detect actual skinned-arm triangle intersections during an in-game heal.
 * No wrist/screen-space proxies: deforms the committed GLB on the CPU at
 * every sampled pose, then tests broadphase-matched triangles on both arms.
 * node tools/check-bandage-intersections.mjs --out=/tmp/bandage-intersections.json
 */
import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { ensureViteServer, launchChromium, parseArgs, stopViteServer } from './lib/browser-harness.mjs';
const args = parseArgs();
const port = Number(args.port ?? 5199);
const out = resolve(args.out ?? '/tmp/bandage-intersections.json');
const server = await ensureViteServer({ port });
const browser = await launchChromium({ headless: true, args: ['--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const errors = [];
page.on('pageerror', e => errors.push(e.stack));
try {
  await page.goto(`http://127.0.0.1:${port}/?capture=1&lockstep=1&shot=weapon`);
  await page.waitForFunction('window.__READY__ === true', null, { timeout: 120000 });
  await page.evaluate(() => {
    window.__APPLY_SHOT__('weapon');
    const ctx = window.__ENGINE__.ctx;
    ctx.get('player').health.value = 30;
    ctx.get('player').setControlEnabled(true);
    ctx.input.enabled = true;
    ctx.input.frozen = false;
    const vm = ctx.get('weapons').viewmodel;
    // This check is only meaningful against real, deformed Blender skins.
    if (!vm.armL.skins.length || !vm.armR.skins.length) throw new Error('Bandage collision: arm GLB missing');
    const scratch = vm.armL.hand.position.clone();
    const CELL = .025;
    function vertices(mesh) {
      mesh.updateWorldMatrix(true, false);
      const n = mesh.geometry.attributes.position.count;
      const a = new Float32Array(n * 3);
      for (let i = 0; i < n; i++) {
        mesh.getVertexPosition(i, scratch).applyMatrix4(mesh.matrixWorld);
        a[i*3] = scratch.x;
        a[i*3+1] = scratch.y;
        a[i*3+2] = scratch.z;
      }
      return a;
    }
    function triangles(mesh) {
      const v = vertices(mesh), indices = mesh.geometry.index;
      const result = [];
      for (let i = 0; i < indices.count; i += 3) {
        const a = indices.getX(i) * 3, b = indices.getX(i + 1) * 3, c = indices.getX(i + 2) * 3;
        const p = [v[a], v[a+1], v[a+2], v[b], v[b+1], v[b+2], v[c], v[c+1], v[c+2]];
        const lo = [Math.min(p[0],p[3],p[6]), Math.min(p[1],p[4],p[7]), Math.min(p[2],p[5],p[8])];
        const hi = [Math.max(p[0],p[3],p[6]), Math.max(p[1],p[4],p[7]), Math.max(p[2],p[5],p[8])];
        result.push({ p, lo, hi, name: mesh.name });
      }
      return result;
    }
    // Möller–Trumbore on a finite mesh edge, both directions. Tangencies and
    // parallel/coplanar triangles are not penetration; require an interior hit.
    function edgeHits(a, b, c, p, q) {
      const dx = q[0]-p[0], dy = q[1]-p[1], dz = q[2]-p[2];
      const e1x = b[0]-a[0], e1y = b[1]-a[1], e1z = b[2]-a[2];
      const e2x = c[0]-a[0], e2y = c[1]-a[1], e2z = c[2]-a[2];
      const hx = dy*e2z-dz*e2y, hy = dz*e2x-dx*e2z, hz = dx*e2y-dy*e2x;
      const det = e1x*hx+e1y*hy+e1z*hz;
      if (Math.abs(det) < 1e-11) return false;
      const f = 1/det, sx = p[0]-a[0], sy = p[1]-a[1], sz = p[2]-a[2];
      const u = f*(sx*hx+sy*hy+sz*hz);
      if (u < .001 || u > .999) return false;
      const qx = sy*e1z-sz*e1y, qy = sz*e1x-sx*e1z, qz = sx*e1y-sy*e1x;
      const v = f*(dx*qx+dy*qy+dz*qz);
      if (v < .001 || u+v > .999) return false;
      const t = f*(e2x*qx+e2y*qy+e2z*qz);
      return t > .001 && t < .999;
    }
    function intersects(a, b) {
      for (let j = 0; j < 3; j++) {
        if (a.lo[j] >= b.hi[j] || b.lo[j] >= a.hi[j]) return false;
      }
      const A = a.p, B = b.p;
      for (let i = 0; i < 3; i++) {
        const n = (i+1)%3;
        if (edgeHits(A.slice(0,3), A.slice(3,6), A.slice(6,9), B.slice(i*3,i*3+3), B.slice(n*3,n*3+3))) return true;
        if (edgeHits(B.slice(0,3), B.slice(3,6), B.slice(6,9), A.slice(i*3,i*3+3), A.slice(n*3,n*3+3))) return true;
        // Edges (0,1), (1,2), (2,0) are covered by i and n above.
      }
      return false;
    }
    const tri = (p) => ({ p, lo:[Math.min(p[0],p[3],p[6]),Math.min(p[1],p[4],p[7]),Math.min(p[2],p[5],p[8])],
      hi:[Math.max(p[0],p[3],p[6]),Math.max(p[1],p[4],p[7]),Math.max(p[2],p[5],p[8])] });
    const flat = tri([0,0,0, 1,0,0, 0,1,0]);
    if (!intersects(flat, tri([.25,.25,-1, .25,.25,1, .4,.4,1])) ||
        intersects(flat, tri([2,2,-1, 2,2,1, 2.5,2,1]))) {
      throw new Error('Bandage collision: triangle intersection self-test failed');
    }
    function sample() {
      vm.armL.root.updateWorldMatrix(true, true);
      vm.armR.root.updateWorldMatrix(true, true);
      const left = vm.armL.skins.flatMap(triangles);
      const right = vm.armR.skins.flatMap(triangles);
      const cells = new Map();
      for (let i = 0; i < left.length; i++) {
        const t = left[i];
        const low = t.lo.map(x => Math.floor(x/CELL)), high = t.hi.map(x => Math.floor(x/CELL));
        for (let x = low[0]; x <= high[0]; x++) for (let y = low[1]; y <= high[1]; y++)
          for (let z = low[2]; z <= high[2]; z++) {
            const key = `${x},${y},${z}`;
            if (!cells.has(key)) cells.set(key, []);
            cells.get(key).push(i);
          }
      }
      const counts = {}, examples = [];
      let hits = 0;
      const seen = new Int32Array(left.length);
      for (let i = 0; i < right.length; i++) {
        const t = right[i], low = t.lo.map(x => Math.floor(x/CELL)), high = t.hi.map(x => Math.floor(x/CELL));
        for (let x = low[0]; x <= high[0]; x++) for (let y = low[1]; y <= high[1]; y++)
          for (let z = low[2]; z <= high[2]; z++) {
            for (const j of cells.get(`${x},${y},${z}`) ?? []) {
              if (seen[j] === i+1) continue;
              seen[j] = i+1;
              const l = left[j];
              if (!intersects(l,t)) continue;
              const pair = `${l.name} × ${t.name}`;
              counts[pair] = (counts[pair] ?? 0) + 1;
              hits++;
              if (examples.length < 8) {
                scratch.set(l.p[0], l.p[1], l.p[2]);
                const at = [scratch.x, scratch.y, scratch.z].map(n => +n.toFixed(3));
                scratch.project(ctx.viewCamera);
                examples.push({ pair, at, screen: [Math.round((scratch.x+1)*640), Math.round((1-scratch.y)*360)] });
              }
            }
          }
      }
      return { hits, counts, examples, triangles: [left.length, right.length] };
    }
    window.__BANDAGE_MESH_INTERSECTIONS__ = sample;
  });
  await page.evaluate(() => window.__PUMP__(25));
  await page.keyboard.down('KeyH');
  const samples = [];
  const stride = args.dense ? 1 : 6;
  for (let frame = stride; frame < 180; frame += stride) {
    await page.evaluate(n => window.__PUMP__(n), stride);
    const result = await page.evaluate(() => window.__BANDAGE_MESH_INTERSECTIONS__());
    samples.push({ frame, progress: frame/180, ...result });
  }
  await page.keyboard.up('KeyH');
  assert.deepEqual(errors, []);
  writeFileSync(out, JSON.stringify(samples, null, 2) + '\n');
  const failing = samples.filter(s => s.hits);
  console.log(`Skinned arm intersections: ${failing.length}/${samples.length} sampled poses; ${failing.reduce((n,s) => n+s.hits,0)} triangle pairs. Report: ${out}`);
  for (const s of failing.slice(0, 8)) console.log(JSON.stringify({ progress: s.progress, hits: s.hits, pairs: s.counts, examples: s.examples.slice(0, 2) }));
  if (failing.length) process.exitCode = 1;
} finally {
  await browser.close(); stopViteServer(server);
}

// Injected by profile.mjs; does not change planning inputs or admit results.
export async function measureWorkerLatency(engine, { echo = false } = {}) {
  const service = engine.ctx.get('ai').grid.worker, worker = service.worker;
  if (!service.ready) throw new Error('latency probe requires a ready worker');
  const clock = () => performance.timeOrigin + performance.now();
  const rows = [], echoes = [], frames = [], decisions = [], byId = new Map(), byKey = new Map(), waiting = new Map();
  const state = actor => {
    const a = engine.ctx.get('ai').agents.find(a => a.id === actor);
    return a ? { state: a.state, action: a.combatAction, pathPending: a.pathPending,
      repositionPlanning: !!a._positionPlan, searchPending: a._searchPending, wantFire: a.wantFire,
      position: a.position.toArray() } : null;
  };
  const probes = new Map(), restores = [];
  let next = 0, currentFrame = null;
  const wrap = (owner, name, make) => {
    const owned = Object.hasOwn(owner, name), original = owner[name], replacement = make(original);
    owner[name] = replacement;
    restores.push(() => { if (owner[name] === replacement) { if (owned) owner[name] = original; else delete owner[name]; } });
  };
  const listener = ({ data }) => {
    if (data.type !== 'latency-probe') return;
    const p = probes.get(data.id); if (!p) return;
    p.row.delivered = clock(); p.row.worker = { received: data.received, posted: data.posted };
    probes.delete(data.id); clearTimeout(p.timer); p.resolve();
  };
  worker.addEventListener('message', listener);
  const ping = (phase, frame = null) => {
    if (echoes.length >= 20000) throw new Error('latency echo sample bound exceeded');
    const id = ++next, row = { id, phase, frame, posted: clock(), delivered: null };
    echoes.push(row);
    const done = new Promise((resolve, reject) => {
      const timer = setTimeout(() => { probes.delete(id); reject(new Error('latency echo deadline exceeded')); }, 5000);
      probes.set(id, { row, resolve, reject, timer });
    });
    try {
      worker.postMessage({ type: 'latency-probe', id, trace: true, key: [1, 2, 3, 4, 5, 6, .36, 1.8, 80] });
      row.postReturned = clock();
    } catch (error) {
      const p = probes.get(id); clearTimeout(p.timer); probes.delete(id); p.reject(error);
    }
    return done;
  };
  const result = () => ({ version: 2, rows, echoes, frames, decisions, outstandingEchoes: probes.size,
    outstandingQueries: service.jobs.size, crossOriginIsolated,
    clock: 'performance.timeOrigin + performance.now(); milliseconds; retain sub-resolution negative deltas',
    timing: 'firstRetry is owning scope retry; consumed is first actual cache read, not tactical commitment' });
  try {
    // Aggregate a serial chain because individual idle RTTs are often below the
    // non-isolated browser clock resolution. Includes JS/Promise bookkeeping.
    for (let i = 0; i < 1000; i++) await ping('idle-chain');
    // Positive controls: same tiny message, with a known main-thread busy interval.
    // Balanced order avoids attributing startup/JIT warmup to one hold duration.
    for (let i = 0; i < 40; i++) for (const hold of (i % 2 ? [16, 8, 2, 0] : [0, 2, 8, 16])) {
      const done = ping(`idle-hold-${hold}`), row = echoes.at(-1);
      const start = performance.now();
      while (performance.now() - start < hold) { /* deliberate positive control, not gameplay */ }
      row.busyEnded = clock();
      await done;
    }
    wrap(worker, 'postMessage', original => function (message, ...rest) {
      if (message.type === 'queries') {
        message = { ...message, trace: true };
        for (const j of message.jobs) {
          if (rows.length >= 4096) throw new Error('latency query sample bound exceeded');
          const job = service.jobs.get(j.id);
          const row = { id: j.id, actor: j.actor, kind: job.scope.kind, key: j.key.join(','),
            frame: currentFrame?.i ?? null, created: performance.timeOrigin + job.sent,
            scopeStarted: performance.timeOrigin + job.scope.started, posted: clock(),
            delivered: null, consumed: null, firstRetry: null };
          rows.push(row); byId.set(j.id, row);
        }
      }
      const value = original.call(this, message, ...rest);
      if (message.type === 'queries') for (const j of message.jobs) byId.get(j.id).postReturned = clock();
      return value;
    });
    wrap(service, 'receive', original => function (message) {
      const at = clock(), row = byId.get(message.id), job = this.jobs.get(message.id);
      if (row && message.type === 'result') {
        row.delivered = at; row.worker = message.trace; row.ms = message.ms; row.moves = message.moves;
        row.deliveredState = state(row.actor);
        row.stale = !job || job.generation !== this.generation;
        if (!message.trace) throw new Error('worker build has no latency instrumentation');
        if (!row.stale) {
          byKey.set(row.key, row);
          const key = `${row.actor}:${row.kind}`;
          if (!waiting.has(key)) waiting.set(key, []);
          waiting.get(key).push({ row, scope: job.scope, started: job.scope.started });
        }
      }
      return original.call(this, message);
    });
    wrap(service, 'run', original => function (actor, kind, fn, ...rest) {
      return original.call(this, actor, kind, () => {
        const key = `${actor}:${kind}`, list = waiting.get(key);
        if (list) {
          const at = clock();
          for (const entry of list) {
            if (entry.scope === this.current && entry.started === this.current.started) {
              entry.row.firstRetry = at; entry.row.retryState = state(actor);
            }
            else entry.row.retryScopeReplaced = true;
          }
          waiting.delete(key);
        }
        return fn();
      }, ...rest);
    });
    wrap(service, 'request', original => function (from, to, radius, height, maxSteps, ...rest) {
      const key = [from.x, from.y, from.z, to.x, to.y, to.z, radius, height, maxSteps].join(',');
      const row = byKey.get(key);
      if (row && row.consumed === null && this.proofs.has(key)) {
        row.consumed = clock(); row.consumer = this.current?.actor ?? null;
        row.originalScopeConsumed = this.current?.actor === row.actor && this.current?.kind === row.kind
          && performance.timeOrigin + this.current.started === row.scopeStarted;
      }
      return original.call(this, from, to, radius, height, maxSteps, ...rest);
    });
    wrap(service, 'record', original => function (sample) {
      if (sample.type === 'decision') {
        if (decisions.length >= 4096) throw new Error('latency decision sample bound exceeded');
        const scope = this.scopes.get(`${sample.actor}:${sample.kind}`);
        decisions.push({ ...sample, at: clock(), scopeStarted: scope ? performance.timeOrigin + scope.started : null });
      }
      return original.call(this, sample);
    });
    let echoFailure = null;
    return {
      before(i) {
        if (echoFailure) throw echoFailure;
        if (service.worker !== worker) throw new Error('latency probe does not support worker replacement');
        if (frames.length >= 4200) throw new Error('latency frame sample bound exceeded');
        currentFrame = { i, start: clock(), end: null }; frames.push(currentFrame);
        if (echo) void ping('before-step', i).catch(error => { echoFailure ??= error; });
      },
      after() {
        currentFrame.end = clock();
        if (echo) void ping('after-step', currentFrame.i).catch(error => { echoFailure ??= error; });
      },
      async finish() {
        // Do not advance tactics while draining: unconsumed results stay censored.
        const deadline = performance.now() + 5000;
        while ((probes.size || service.jobs.size) && performance.now() < deadline)
          await new Promise(resolve => setTimeout(resolve, 10));
        if (probes.size || service.jobs.size) throw new Error('latency drain exceeded deadline');
        if (echoFailure) throw echoFailure;
        if (service.error) throw service.error;
        return result();
      },
      snapshot: result,
      dispose() {
        for (const restore of restores.reverse()) restore();
        worker.removeEventListener('message', listener);
        for (const p of probes.values()) { clearTimeout(p.timer); p.reject(new Error('latency probe disposed')); }
        probes.clear();
      },
    };
  } catch (error) {
    worker.removeEventListener('message', listener);
    for (const restore of restores.reverse()) restore();
    throw error;
  }
}

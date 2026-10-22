export function installObserver(e) {
  const p = e.ctx.get('player'),
    ai = e.ctx.get('ai'),
    camera = e.ctx.camera;
  const probe = (window.__PROBE__ = {
    generation: 0,
    events: [],
    placements: window.__ORIGINS__,
    captures: [],
    first: {},
    publication: new Map(),
  });
  const round = (x) => Math.round(x * 1e5) / 1e5;
  const vec = (v) => v.toArray().map(round);
  function snap(type, extra = {}) {
    camera.updateMatrixWorld();
    const inv = camera.quaternion.clone().invert();
    const agents = ai.agents.map((a) => {
      const eye = a.eye.clone(),
        local = eye.clone().sub(camera.position).applyQuaternion(inv),
        ndc = eye.clone().project(camera);
      const feet = a.position.clone().project(camera),
        origin = probe.publication.get(a.id);
      return {
        id: a.id,
        alive: a.alive,
        corpse: !!a.isPlayerCorpse,
        state: a.state,
        pos: vec(a.position),
        eye: vec(eye),
        distance: round(a.position.distanceTo(p.position)),
        move: origin ? round(a.position.distanceTo(origin)) : 0,
        moveXZ: origin ? round(Math.hypot(a.position.x - origin.x, a.position.z - origin.z)) : 0,
        bearing: round((Math.atan2(local.x, -local.z) * 180) / Math.PI),
        ndc: vec(ndc),
        screen: [round((ndc.x + 1) * 640), round((1 - ndc.y) * 360)],
        eyeInFrustum:
          local.z < 0 && Math.abs(ndc.x) <= 1 && Math.abs(ndc.y) <= 1 && ndc.z >= 0 && ndc.z <= 1,
        feetInFrustum: Math.abs(feet.x) <= 1 && Math.abs(feet.y) <= 1 && feet.z >= 0 && feet.z <= 1,
        los: ai.phys.lineOfSight(camera.position, eye),
      };
    });
    const c = p.hitbox;
    const s = {
      type,
      generation: probe.generation,
      frame: e.time.frame,
      t: round(e.time.elapsed),
      wall: round(performance.now() / 1000),
      enabled: e.input.enabled,
      locked: e.input.pointerLocked,
      domLocked: document.pointerLockElement === e.ctx.canvas,
      control: p.controlEnabled,
      dead: p.dead,
      hp: round(p.health.value),
      armour: round(p.health.armour),
      feet: vec(p.position),
      camera: vec(camera.position),
      quaternion: camera.quaternion.toArray().map(round),
      fov: camera.fov,
      hitbox: {
        enabled: c.enabled,
        a: [c.ax, c.ay, c.az].map(round),
        b: [c.bx, c.by, c.bz].map(round),
      },
      sample: vec(ai.playerPosition(camera.position.clone())),
      wave: { ...ai.getWaveState() },
      worker: {
        jobs: ai.grid.worker.jobs.size,
        scopes: ai.grid.worker.scopes.size,
        proofs: ai.grid.worker.proofs.size,
      },
      agents,
      ...extra,
    };
    if (probe.events.length >= 200) throw Error('bounded observer event cap');
    probe.events.push(s);
    return s;
  }
  window.__SNAP470__ = snap;
  function first(type, extra) {
    const key = probe.generation + ':' + type;
    if (probe.first[key]) return;
    probe.first[key] = true;
    snap(type, extra);
  }
  const setControl = p.setControlEnabled.bind(p);
  p.setControlEnabled = (enabled) => {
    const before = p.controlEnabled;
    setControl(enabled);
    if (before !== p.controlEnabled) snap('control-change', { before, after: p.controlEnabled });
  };
  const restart = e.ctx.get('ui').gameOver.onRestart;
  e.ctx.get('ui').gameOver.onRestart = () => {
    probe.generation++;
    snap('restart-intent');
    restart();
    snap('restart-complete');
  };
  for (const type of ['player:death', 'player:respawn', 'wave:start', 'game:restart'])
    e.events.on(type, () => {
      if (type === 'wave:start') {
        probe.publication = new Map(ai.agents.map((a) => [a.id, a.position.clone()]));
        probe.resetTime = e.time.elapsed;
      }
      snap(type);
    });
  e.events.on('weapon:fire', (event) => {
    if (event.actor !== 'player') first('first-fire', { actor: event.actor?.id ?? event.actor });
  });
  e.events.on('damage:taken', (event) => {
    first('first-damage', { amount: event.amount });
    if (event.amount > 0) first('first-hp-damage', { amount: event.amount });
  });
  document.addEventListener('pointerlockchange', () => snap('lockchange'));
  const update = ai.update.bind(ai);
  ai.update = (dt, ctx) => {
    first('first-ai-tick');
    update(dt, ctx);
    if (
      ai.agents.some(
        (a) =>
          a.alive &&
          probe.publication.has(a.id) &&
          a.position.distanceTo(probe.publication.get(a.id)) > 0.01
      )
    )
      first('first-movement');
    if (
      ai.agents.some(
        (a) =>
          a.alive &&
          probe.publication.has(a.id) &&
          Math.hypot(
            a.position.x - probe.publication.get(a.id).x,
            a.position.z - probe.publication.get(a.id).z
          ) > 0.01
      )
    )
      first('first-planar-movement');
  };
  const render = e.ctx.get('render'),
    draw = render.render.bind(render);
  render.render = (ctx) => {
    draw(ctx);
    first('first-render');
    if (probe.resetTime !== undefined)
      for (const delay of [0.25, 1, 5])
        if (e.time.elapsed - probe.resetTime >= delay) first('after-' + delay);
  };
  const enable = e.onFirstRender;
  e.onFirstRender = () => {
    snap('before-input-enable');
    enable();
    snap('after-input-enable');
  };
  probe.publication = new Map(ai.agents.map((a) => [a.id, a.position.clone()]));
  snap('before-start');
}

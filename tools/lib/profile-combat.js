// Browser-only diagnostic fixture; injected into the served checkout by profile.mjs.
// Normal AI sensing/navigation/fire and real weapon/physics/FX paths. Large finite
// HP pools keep both sides alive, without disabling damage, suppression or hit FX.
export function createCombatProfile(engine, combatLane, { realtime = false } = {}) {
  const ctx = engine.ctx, ai = ctx.get('ai'), player = ctx.get('player');
  const weapons = ctx.get('weapons'), input = engine.input;
  for (const actor of ai.agents) actor.dispose();
  ai.agents.length = 0;
  ai.squads.length = 0;
  const lane = combatLane(ai, ctx.get('world'), ctx.get('physics'),
    [[2, 0], [10, -2], [12, 2], [16, 0], [20, -2], [22, 2]]);
  const base = lane.positions[0], yaw = Math.atan2(-lane.fx, -lane.fz);
  player.teleport({ x: base.x, y: base.y + player.eyeHeight, z: base.z }, yaw);
  player.health.value = 10000;
  player.health.armour = 0;
  const squad = ai.createSquad();
  for (let i = 2; i < lane.positions.length; i++) {
    const p = lane.positions[i];
    const actor = ai.spawn(['vanguard', 'breacher', 'irregular'][i % 3], p,
      Math.atan2(base.x - p.x, base.z - p.z));
    actor.health = 10000;
    actor.hasGrenade = false; // This bounded baseline isolates gun combat.
    squad.add(actor);
  }
  input.enabled = true;
  input.frozen = false;
  player.setControlEnabled(true);
  let bucket = null, lastWeapon = weapons.activeId, previousActionFrame = -1;
  let x = player.position.x, z = player.position.z, lastYaw = player.yaw;
  const report = { fixture: realtime ? 'living-combat-realtime-v1' : 'living-combat-v1', hp: 10000, aiCount: ai.agents.length,
    simulationHz: realtime ? null : 60, ...(realtime ? { inputCycleHz: 60 } : {}), cycleFrames: 900, blockFrames: 300,
    spawn: base.toArray(), enemies: ai.agents.map(a => a.position.toArray()), blocks: [],
    reloadStarts: 0, reloadEnds: 0, switches: 0, playerShots: 0, aiShots: 0,
    impacts: 0, damageTaken: 0, distance: 0, yawTravel: 0, frames: 0 };
  const off = [
    ctx.events.on('weapon:fire', e => {
      if (!bucket) return;
      if (e.actor === 'player') { report.playerShots++; bucket.playerShots++; }
      else if (e.weapon === 'ai_rifle') { report.aiShots++; bucket.aiShots++; }
    }),
    ctx.events.on('weapon:reload', e => {
      if (!bucket || e.weapon === 'ai_rifle') return;
      if (e.phase === 'start') report.reloadStarts++;
      if (e.phase === 'end') report.reloadEnds++;
    }),
    ctx.events.on('bullet:impact', () => { if (bucket) report.impacts++; }),
    ctx.events.on('damage:taken', e => { if (bucket) report.damageTaken += e.amount; }),
  ];
  const setKey = (key, down) => {
    if (down && !input.down.has(key)) input._pendingDown.add(key);
    if (!down && input.down.has(key)) input._pendingUp.add(key);
  };
  const crossed = (frame, mark) => Math.floor((frame - mark) / report.cycleFrames) >
    Math.floor((previousActionFrame - mark) / report.cycleFrames);
  return {
    report,
    before(frame, actionFrame = frame) {
      // Warmup is not credited as measured action coverage.
      if (frame >= 0 && frame % report.blockFrames === 0) {
        bucket = { start: frame, frames: 0, livingFrames: 0, activeAiFrames: 0,
          aiShots: 0, playerShots: 0, distance: 0 };
        report.blocks.push(bucket);
      }
      const t = frame < 0 ? -1 : actionFrame % report.cycleFrames;
      setKey('KeyW', t >= 0 && t % 60 < 30);
      setKey('KeyS', t >= 0 && t % 60 >= 30);
      setKey('Mouse0', t >= 0 && (t < 90 || (t >= 450 && t < 540 && t % 12 < 6)));
      setKey('KeyR', realtime ? frame >= 0 && (crossed(actionFrame, 120) || crossed(actionFrame, 600)) : t === 120 || t === 600);
      setKey('Tab', realtime ? frame >= 0 && (crossed(actionFrame, 360) || crossed(actionFrame, 800)) : t === 360 || t === 800);
      previousActionFrame = frame < 0 ? -1 : actionFrame;
      if (frame >= 0) {
        const target = yaw + .12 * Math.sin(actionFrame * Math.PI / 180);
        const delta = Math.atan2(Math.sin(target - player.yaw), Math.cos(target - player.yaw));
        input._rawLook.x -= delta / engine.config.sensitivity;
      }
    },
    after() {
      if (engine.error) throw new Error(`engine failure: ${JSON.stringify(engine.error)}`);
      if (player.dead || !ai.agents.every(a => a.alive && !a.staged))
        throw new Error('living-combat fixture died or used staged AI');
      if (bucket) {
        const distance = Math.hypot(player.position.x - x, player.position.z - z);
        bucket.frames++;
        bucket.livingFrames++;
        if (ai.agents.some(a => a.hasTarget && a.targetVisible)) bucket.activeAiFrames++;
        bucket.distance += distance;
        report.frames++;
        report.distance += distance;
        report.yawTravel += Math.abs(Math.atan2(Math.sin(player.yaw - lastYaw), Math.cos(player.yaw - lastYaw)));
        if (weapons.activeId !== lastWeapon) report.switches++;
      }
      x = player.position.x; z = player.position.z; lastYaw = player.yaw;
      lastWeapon = weapons.activeId;
    },
    dispose() {
      for (const unsubscribe of off) unsubscribe();
      for (const key of ['KeyW', 'KeyS', 'Mouse0', 'KeyR', 'Tab']) {
        input.down.delete(key); input._pendingDown.delete(key); input._pendingUp.delete(key);
      }
      input._rawLook.x = input._rawLook.y = 0;
    },
  };
}

export function validateCombatProfile(report) {
  const require = (ok, message) => { if (!ok) throw new Error(`Invalid combat profile: ${message}`); };
  require(report.frames >= 900 && report.frames % 900 === 0, 'complete 900-frame cycles required');
  require(report.blocks.length === report.frames / 300, 'missing combat blocks');
  for (const block of report.blocks) {
    require(block.frames === 300 && block.livingFrames === block.frames, `not living throughout block ${block.start}`);
    require(block.activeAiFrames >= block.frames / 2 && block.aiShots > 0, `no sustained AI combat in block ${block.start}`);
    require(block.distance > 1, `no player movement in block ${block.start}`);
  }
  const cycles = report.fixture === 'living-combat-realtime-v1' ? Math.floor(report.simulationSeconds / 15) : report.frames / 900;
  require(Number.isInteger(cycles) && cycles >= 1, 'at least one complete action cycle required');
  require(report.playerShots >= cycles * 10, 'player did not fire');
  require(report.reloadStarts >= cycles * 2 && report.reloadEnds >= cycles * 2, 'reloads did not complete');
  require(report.switches >= cycles * 2, 'weapon switches did not complete');
  require(report.yawTravel > cycles, 'camera did not turn');
  require(report.impacts > 0 && report.damageTaken > 0, 'impact/damage effects were not exercised');
}

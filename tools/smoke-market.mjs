/**
 * Node smoke test for the MarketSystem — no browser, no three.
 * Exercises earning, the post-wave grace period, opening/closing (time
 * scale), purchasing rules and reset.
 *
 *   node tools/smoke-market.mjs
 */
import { MarketSystem, MARKET_DELAY } from '../src/market/index.js';

let failures = 0;
const check = (name, cond) => {
  if (cond) console.log(`  ok  ${name}`);
  else { failures++; console.error(`FAIL  ${name}`); }
};

// ---- fake context -------------------------------------------------------
const listeners = {};
const fakeCtx = {
  time: { scale: 1, elapsed: 0 },
  events: {
    on: (type, fn) => { (listeners[type] ??= []).push(fn); },
    emit: (type, payload) => { for (const fn of listeners[type] ?? []) fn(payload); },
  },
  weapons: { grenades: 2, addGrenades(n) { this.grenades = Math.min(6, this.grenades + n); } },
  player: {
    dead: false,
    health: { armour: 0, addArmour(n) { this.armour = Math.min(150, this.armour + n); } },
    addArmour(n) { return this.health.addArmour(n); },
  },
  get: (id) => (id === 'weapons' ? fakeCtx.weapons : fakeCtx.player),
  peek: (id) => fakeCtx.get(id),
};

const market = new MarketSystem();
await market.init(fakeCtx);
check('delay constant is 10s', MARKET_DELAY === 10);

// ---- earning ------------------------------------------------------------
const enemy = { staged: false, silentDeath: false, friendly: false, team: 1 };
fakeCtx.events.emit('damage:dealt', { killed: true, target: enemy });
check('kill pays 100', market.credits === 100);
fakeCtx.events.emit('damage:dealt', { killed: true, target: enemy, headshot: true });
check('headshot kill pays 150', market.credits === 250);
fakeCtx.events.emit('damage:dealt', { killed: true, target: { isPlayer: true } });
check('player-target kills pay nothing', market.credits === 250);
fakeCtx.events.emit('damage:dealt', { killed: false, target: enemy });
check('non-kills pay nothing', market.credits === 250);
fakeCtx.events.emit('damage:dealt', { killed: true, target: { team: 0 } });
check('team-0 kills pay nothing', market.credits === 250);

// ---- wave clear arms the grace period, then opens the shop ---------------
fakeCtx.events.emit('wave:complete', { wave: 1, nextWave: 2, delay: 20 });
check('wave 1 bonus +250', market.credits === 500);
check('shop NOT open yet (grace period)', market.open === false);
check('time still running during grace', fakeCtx.time.scale === 1);
check('countdown shows 10s', market.getHudState().marketIn === 10);
fakeCtx.time.elapsed += 9;
market.update();
check('still closed at 9s', market.open === false);
fakeCtx.time.elapsed += 1;
market.update();
check('shop opens when the window elapses', market.open === true);
check('time frozen while open', fakeCtx.time.scale === 0);
check('countdown cleared once open', market.getHudState().marketIn === 0);

// ---- purchasing ----------------------------------------------------------
let purchase = null;
listeners['market:purchase'] = [(p) => (purchase = p)];
check('buy armour ok', market.buy('armour').ok === true);
check('armour applied (+50)', fakeCtx.player.health.armour === 50);
check('credits deducted (500-250)', market.credits === 250);
check('purchase event carries item/cost/credits',
  purchase?.item === 'armour' && purchase?.cost === 250 && purchase?.credits === 250);

fakeCtx.events.emit('damage:dealt', { killed: true, target: enemy, headshot: true });
check('extra kill pays while shop open', market.credits === 400);
check('buy grenade ok (400-300)', market.buy('grenade').ok === true);
check('grenade applied (2->3)', fakeCtx.weapons.grenades === 3);
check('credits 100 left', market.credits === 100);

check('buy with no credits rejected', market.buy('armour').ok === false);
check('armour unchanged after rejection', fakeCtx.player.health.armour === 50);
check('buy while closed rejected', (market.closeShop(), market.buy('grenade').ok === false));
check('time restored on close', fakeCtx.time.scale === 1);

// ---- dead player blocks the auto-open ------------------------------------
fakeCtx.events.emit('wave:complete', { wave: 2 }); // +500, timer armed
fakeCtx.player.dead = true;
fakeCtx.time.elapsed += MARKET_DELAY;
market.update();
check('no open over the death screen', market.open === false);
fakeCtx.player.dead = false;
market.update();
check('opens once alive again', market.open === true);
market.closeShop();
fakeCtx.events.emit('game:restart', {});
check('restart clears the pending timer', market.getHudState().marketIn === 0 && market.open === false);

// ---- caps ----------------------------------------------------------------
market.credits = 99999;
market.openShop(2);
for (let i = 0; i < 3; i++) market.buy('armour');
check('armour caps at 150', fakeCtx.player.health.armour === 150);
check('buy at cap rejected', market.buy('armour').ok === false);
for (let i = 0; i < 3; i++) market.buy('grenade');
check('grenades cap at 6', fakeCtx.weapons.grenades === 6);
check('buy at cap rejected', market.buy('grenade').ok === false);
market.closeShop();

// ---- restart -------------------------------------------------------------
market.openShop(3);
fakeCtx.events.emit('game:restart', {});
check('restart zeroes credits', market.credits === 0);
check('restart force-closes an open shop', market.open === false && fakeCtx.time.scale === 1);
fakeCtx.events.emit('damage:dealt', { killed: true, target: enemy });
check('earns again after restart', market.credits === 100);

console.log(failures === 0 ? '\nALL PASS' : `\n${failures} FAILURES`);
process.exit(failures === 0 ? 0 : 1);

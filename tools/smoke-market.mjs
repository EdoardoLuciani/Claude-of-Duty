/**
 * Node smoke test for the market and armour systems — no browser.
 * Exercises the credits mirror (score:change), the post-wave grace period,
 * opening/closing (time scale), purchasing rules and reset.
 *
 *   node tools/smoke-market.mjs
 */
import { MarketSystem, MARKET_DELAY } from '../src/market/index.js';
import { Health } from '../src/player/health.js';

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
  weapons: {
    grenades: 2,
    carpetBombs: 1,
    owned: new Set(['rifle', 'smg']),
    states: new Map([
      ['rifle', { mag: 30, chambered: true, reserve: 30, def: { magSize: 30, reserve: 90 } }],
      ['smg', { mag: 32, chambered: true, reserve: 60, def: { magSize: 32, reserve: 60 } }],
      ['lmg', { mag: 100, chambered: true, reserve: 150, def: { magSize: 100, reserve: 150 } }],
      ['shotgun', { mag: 6, chambered: true, reserve: 30, def: { magSize: 6, reserve: 30 } }],
    ]),
    owns(id) { return this.owned.has(id); },
    addGrenades(n) { this.grenades = Math.min(6, this.grenades + n); },
    addCarpetBombs(n) { this.carpetBombs = Math.min(3, this.carpetBombs + n); },
    ammoFraction() {
      let have = 0, max = 0;
      this.states.forEach((s, id) => {
        if (!this.owned.has(id)) return;
        have += s.reserve; max += s.def.reserve;
      });
      return max > 0 ? have / max : 1;
    },
    refillAmmo() {
      this.states.forEach((s, id) => { if (this.owned.has(id)) s.reserve = s.def.reserve; });
    },
    equipPrimary(id) {
      if (this.owned.has(id)) return false;
      this.owned.delete(id === 'rifle' ? 'lmg' : 'rifle');
      this.owned.add(id);
      const s = this.states.get(id);
      s.mag = s.def.magSize; s.chambered = true; s.reserve = s.def.reserve;
      return true;
    },
    equipSecondary(id) {
      if (this.owned.has(id)) return false;
      this.owned.delete(id === 'smg' ? 'shotgun' : 'smg');
      this.owned.add(id);
      const s = this.states.get(id);
      s.mag = s.def.magSize; s.chambered = true; s.reserve = s.def.reserve;
      return true;
    },
  },
  player: {
    dead: false,
    controlEnabled: true,
    setControlEnabled(on) { this.controlEnabled = on; },
    health: { armour: 0, addArmour(n) { this.armour = Math.min(150, this.armour + n); } },
  },
  get: (id) => (id === 'weapons' ? fakeCtx.weapons : fakeCtx.player),
  peek: (id) => fakeCtx.get(id),
};

const market = new MarketSystem();
await market.init(fakeCtx);
check('delay constant is 10s', MARKET_DELAY === 10);

// ---- credits mirror score:change 1:1 ------------------------------------
const earn = (delta) => fakeCtx.events.emit('score:change', { delta });
earn(100); earn(150); earn(0); earn(-10);
check('credits mirror positive score deltas', market.credits === 250);

// ---- wave clear arms the grace period, then opens the shop ---------------
earn(250);
fakeCtx.events.emit('wave:complete', { wave: 1, nextWave: 2, delay: 20 });
check('wave bonus +250 (via score:change)', market.credits === 500);
check('shop NOT open yet (grace period)', market.open === false);
check('time still running during grace', fakeCtx.time.scale === 1);
check('countdown shows 10s', market.getHudState().marketIn === 10);
fakeCtx.time.elapsed += 9;
market.update();
check('still closed at 9s', market.open === false);
fakeCtx.time.elapsed += 1;
market.update();
check('shop opens when the window elapses', market.open === true);
check('time and controls frozen while open',
  fakeCtx.time.scale === 0 && fakeCtx.player.controlEnabled === false);
check('countdown cleared once open', market.getHudState().marketIn === 0);

// ---- purchasing ----------------------------------------------------------
check('buy armour applies +50 for 250 credits',
  market.buy('armour') && fakeCtx.player.health.armour === 50 && market.credits === 250);
earn(150);
check('buy grenade applies +1 for 200 credits',
  market.buy('grenade') && fakeCtx.weapons.grenades === 3 && market.credits === 200);
check('unaffordable purchase is unchanged',
  !market.buy('armour') && fakeCtx.player.health.armour === 50);

// ---- ammo refill ---------------------------------------------------------
check('ammo reports 60% and rejects insufficient credits',
  market.getHudState().items[2].level === 60 && !market.buy('ammo'));
market.credits = 99999;
check('ammo is buyable below full', market.getHudState().items[2].affordable && market.buy('ammo'));
check('refill tops reserves and disables itself',
  fakeCtx.weapons.states.get('rifle').reserve === 90 &&
  fakeCtx.weapons.states.get('smg').reserve === 60 &&
  !market.getHudState().items[2].affordable && !market.buy('ammo'));
market.closeShop();
check('closed purchases fail and time/controls resume', !market.buy('grenade') &&
  fakeCtx.time.scale === 1 && fakeCtx.player.controlEnabled);

// ---- dead player blocks the auto-open ------------------------------------
fakeCtx.events.emit('wave:complete', { wave: 2 }); // arm the timer
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
fakeCtx.time.scale = 0.5;
market.openShop(2);
for (let i = 0; i < 3; i++) market.buy('armour');
check('armour caps at 150', fakeCtx.player.health.armour === 150);
check('buy at cap rejected', market.buy('armour') === false);
for (let i = 0; i < 3; i++) market.buy('grenade');
check('grenades cap at 6', fakeCtx.weapons.grenades === 6);
check('buy at cap rejected', market.buy('grenade') === false);

// ---- primary weapon purchases (LMG replaces the M4, and back) ------------
market.credits = 99999;
check('spawn loadout: M4 owned, LMG not', fakeCtx.weapons.owns('rifle') && !fakeCtx.weapons.owns('lmg'));
check('LMG buyable while M4 equipped', market.getHudState().items[4].affordable);
check('M4 not buyable while equipped', market.getHudState().items[5].affordable === false);
check('buy LMG replaces M4 and deducts 1200',
  market.buy('lmg') && fakeCtx.weapons.owns('lmg') && !fakeCtx.weapons.owns('rifle') &&
  market.credits === 99999 - 1200);
check('cannot buy a weapon already equipped', !market.buy('lmg') && !market.getHudState().items[4].affordable);
check('M4 becomes buyable with LMG equipped', market.getHudState().items[5].affordable);
check('buy M4 replaces LMG', market.buy('rifle') && fakeCtx.weapons.owns('rifle') && !fakeCtx.weapons.owns('lmg'));
check('M4 purchase rejected when equipped again', !market.buy('rifle'));

// ---- secondary weapon purchases (shotgun replaces the SMG, and back) -----
check('spawn loadout: SMG owned, shotgun not', fakeCtx.weapons.owns('smg') && !fakeCtx.weapons.owns('shotgun'));
check('shotgun buyable while SMG equipped', market.getHudState().items[6].affordable);
check('SMG not buyable while equipped', market.getHudState().items[7].affordable === false);
const beforeShotgun = market.credits;
check('buy shotgun replaces SMG and deducts 1000',
  market.buy('shotgun') && fakeCtx.weapons.owns('shotgun') && !fakeCtx.weapons.owns('smg') &&
  market.credits === beforeShotgun - 1000);
check('cannot rebuy the shotgun', !market.buy('shotgun'));
check('SMG becomes buyable with shotgun equipped', market.getHudState().items[7].affordable);
check('buy SMG replaces shotgun', market.buy('smg') && fakeCtx.weapons.owns('smg') && !fakeCtx.weapons.owns('shotgun'));

// ---- carpet-bomb strike charges (radio request 1) ------------------------
// The catalog row sits between ammo and the primaries: index 3.
check('carpet row is the 4th item (after grenade/armour/ammo)',
  market.getHudState().items[3].id === 'carpet');
check('spawns with 1 strike, caps at 3',
  market.getHudState().items[3].level === 1 && market.getHudState().items[3].max === 3);
market.credits = 99999;
check('carpet strike buyable for 1500', market.getHudState().items[3].affordable);
check('buy adds a charge and deducts 1500',
  market.buy('carpet') && fakeCtx.weapons.carpetBombs === 2 && market.credits === 99999 - 1500);
market.buy('carpet');
check('charges cap at 3', fakeCtx.weapons.carpetBombs === 3);
check('buy at cap rejected', market.buy('carpet') === false);
market.closeShop();
check('close restores the previous time scale', fakeCtx.time.scale === 0.5);
fakeCtx.time.scale = 1;
market.credits = 99999;
check('carpet unbuyable with the shop closed', market.buy('carpet') === false);

// ---- armour damage -------------------------------------------------------
let damage;
const health = new Health({
  time: { elapsed: 0 }, camera: { rotation: { y: 0 }, position: { x: 0, y: 0, z: 0 } },
  events: { emit: (type, p) => { if (type === 'damage:taken') damage = { ...p }; } },
}, null);
health.addArmour(50);
health.damage(20, null);
const absorbed = health.armour === 40 && health.value === 100 &&
  damage.amount === 0 && damage.armourAbsorbed === 10 && health.hitFlash === 0;
health.damage(90, null);
check('armour halves incoming, then overflow breaks a plate', absorbed &&
  health.armour === 0 && health.value === 95 && damage.amount === 5 && damage.plateBreak);
health.damage(20, null);
check('bare health takes full damage after plates are gone',
  health.armour === 0 && health.value === 75 && damage.amount === 20 && !damage.plateBreak);

// ---- restart -------------------------------------------------------------
market.openShop(3);
fakeCtx.events.emit('game:restart', {});
check('restart zeroes credits', market.credits === 0);
check('restart force-closes an open shop', market.open === false && fakeCtx.time.scale === 1);
earn(100);
check('earns again after restart', market.credits === 100);

console.log(failures === 0 ? '\nALL PASS' : `\n${failures} FAILURES`);
process.exit(failures === 0 ? 0 : 1);

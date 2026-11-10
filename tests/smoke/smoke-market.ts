import assert from 'node:assert/strict';

/**
 * Bun smoke test for the market and armour systems — no browser.
 * Exercises the credits mirror (score:change), the post-wave grace period,
 * opening/closing (time scale), purchasing rules and reset.
 *
 *   bun test ./tests/smoke/smoke-market.ts
 */
import { MarketSystem, MARKET_DELAY } from '../../src/market/index.ts';
import { Health } from '../../src/player/health.ts';
import { WEAPON_IDS, PRIMARY_IDS } from '../../src/weapons/defs.ts';
import type { WeaponId } from '../../src/weapons/defs.ts';
import { WeaponSystem } from '../../src/weapons/index.ts';
import { createTestContext } from '../lib/context.ts';
import type { TestProviders } from '../lib/context.ts';
import { UiPlayer, captureMethod } from '../lib/ui-fixture.ts';

let failures = 0;
const check = (name: string, cond: unknown): void => {
  if (cond) console.log(`  ok  ${name}`);
  else {
    failures++;
    console.error(`FAIL  ${name}`);
  }
};

// ---- real providers -------------------------------------------------------
const providers: TestProviders = {};
const context = createTestContext({ providers });
const player = new UiPlayer(context);
const weapons = new WeaponSystem();
weapons.ctx = context;
weapons.player = player;
weapons._hasMesh = (): boolean => true;
weapons.setWeaponImmediate = (): boolean => true;
const reserves: Record<WeaponId, [number, number]> = {
  rifle: [30, 90],
  mcx: [180, 180],
  pistol: [40, 68],
  smg: [60, 224],
  lmg: [150, 150],
  shotgun: [30, 30],
  sniper: [30, 30],
};
for (const id of WEAPON_IDS) {
  const state = weapons._makeState(id);
  state.reserve = reserves[id][0];
  state.def = { ...state.def, reserve: reserves[id][1] };
  weapons.states.set(id, state);
}
providers.weapons = weapons;
providers.player = player;

const market = new MarketSystem();
await market.init(context);
type MarketItem = ReturnType<MarketSystem['getHudState']>['items'][number];
const item = (id: MarketItem['id']): MarketItem => {
  const found = market.getHudState().items.find((it): boolean => it.id === id);
  assert(found);
  return found;
};
const weaponState = (id: WeaponId): ReturnType<WeaponSystem['_makeState']> => {
  const state = weapons.states.get(id);
  assert(state);
  return state;
};
check('delay constant is 10s', MARKET_DELAY === 10);
check(
  'catalog is resupply / secondary / primary / ordnance',
  market
    .getHudState()
    .items.map((it): MarketItem['id'] => it.id)
    .join() === 'ammo,grenade,armour,bandage,pistol,smg,shotgun,rifle,mcx,lmg,sniper,carpet'
);
check(
  'every row has a blurb and slot',
  market.getHudState().items.every((it): boolean => Boolean(it.blurb && it.slot && it.action))
);
check('bandage card advertises H hold-to-heal', item('bandage').blurb.includes('hold H'));
check(
  'spawn guns: M4 + pistol, other guns available to swap',
  weapons.owns('rifle') &&
    weapons.owns('pistol') &&
    !weapons.owns('smg') &&
    item('rifle').action === 'equipped' &&
    item('smg').action === 'swap' &&
    item('lmg').action === 'swap' &&
    item('shotgun').action === 'swap' &&
    item('sniper').action === 'swap'
);

// ---- credits mirror score:change 1:1 ------------------------------------
const earn = (delta: number): void =>
  context.events.emit('score:change', { score: 0, delta, reason: 'test', kills: 0 });
earn(100);
earn(150);
earn(0);
earn(-10);
check('credits mirror positive score deltas', market.credits === 250);

// ---- wave clear arms the grace period, then opens the shop ---------------
earn(250);
context.events.emit('wave:complete', { wave: 1, nextWave: 2, delay: 20 });
check('wave bonus +250 (via score:change)', market.credits === 500);
check('shop NOT open yet (grace period)', market.open === false);
check('time still running during grace', context.time.scale === 1);
check('countdown shows 10s', market.getHudState().marketIn === 10);
context.time.elapsed += 9;
market.update();
check('still closed at 9s', market.open === false);
context.time.elapsed += 1;
market.update();
check('shop opens when the window elapses', market.open === true);
check(
  'time and controls frozen while open',
  context.time.scale === 0 && player.controlEnabled === false
);
check('countdown cleared once open', market.getHudState().marketIn === 0);

// ---- purchasing ----------------------------------------------------------
check(
  'buy armour applies +50 for 250 credits',
  market.buy('armour') && player.health.armour === 50 && market.credits === 250
);
earn(100);
check(
  'buy bandage adds inventory and does not heal',
  market.buy('bandage') &&
    player.bandages === 3 &&
    market.credits === 250 &&
    player.health.armour === 50
);
earn(150);
check(
  'buy grenade applies +1 for 200 credits',
  market.buy('grenade') && weapons.grenades === 3 && market.credits === 200
);
check('unaffordable purchase is unchanged', !market.buy('armour') && player.health.armour === 50);

// ---- ammo refill ---------------------------------------------------------
check(
  'ammo reports 44% and rejects insufficient credits',
  item('ammo').level === 44 && !market.buy('ammo')
);
market.credits = 99999;
check('ammo is buyable below full', item('ammo').affordable && market.buy('ammo'));
check(
  'refill tops reserves and disables itself',
  weaponState('rifle').reserve === 90 &&
    weaponState('pistol').reserve === 68 &&
    !item('ammo').affordable &&
    !market.buy('ammo') &&
    item('ammo').action === 'max'
);
market.closeShop();
check(
  'closed purchases fail and time/controls resume',
  !market.buy('grenade') && context.time.scale === 1 && player.controlEnabled
);

// ---- dead player blocks the auto-open ------------------------------------
context.events.emit('wave:complete', { wave: 2, nextWave: 3, delay: 20 }); // arm the timer
player.dead = true;
context.time.elapsed += MARKET_DELAY;
market.update();
check('no open over the death screen', market.open === false);
player.dead = false;
market.update();
check('opens once alive again', market.open === true);
market.closeShop();
context.events.emit('game:restart', {});
check(
  'restart clears the pending timer',
  market.getHudState().marketIn === 0 && market.open === false
);

// ---- caps ----------------------------------------------------------------
market.credits = 99999;
context.time.scale = 0.5;
market.openShop(2);
for (let i = 0; i < 3; i++) market.buy('armour');
check('armour caps at 150', player.health.armour === 150);
check('buy at cap rejected', market.buy('armour') === false);
for (let i = 0; i < 3; i++) market.buy('grenade');
check('grenades cap at 6', weapons.grenades === 6);
check('buy at cap rejected', market.buy('grenade') === false);
const bandageCredits = market.credits;
while (player.bandages < 4) {
  if (!market.buy('bandage')) break;
}
check('bandages cap at 4', player.bandages === 4);
check(
  'bandage buy at cap rejected without charging',
  market.buy('bandage') === false && market.credits === bandageCredits - 100
);

// ---- primary weapon purchases (LMG replaces the M4, and back) ------------
market.credits = 99999;
check('spawn loadout: M4 owned, LMG not', weapons.owns('rifle') && !weapons.owns('lmg'));
check('LMG buyable while M4 equipped', item('lmg').affordable && item('lmg').action === 'swap');
check(
  'M4 not buyable while equipped',
  item('rifle').affordable === false && item('rifle').action === 'equipped'
);
check(
  'buy LMG replaces M4 and deducts 1200',
  market.buy('lmg') &&
    weapons.owns('lmg') &&
    !weapons.owns('rifle') &&
    market.credits === 99999 - 1200
);
check('cannot buy a weapon already equipped', !market.buy('lmg') && !item('lmg').affordable);
check(
  'M4 becomes buyable with LMG equipped',
  item('rifle').affordable && item('rifle').action === 'swap'
);
check('buy M4 replaces LMG', market.buy('rifle') && weapons.owns('rifle') && !weapons.owns('lmg'));
check('M4 purchase rejected when equipped again', !market.buy('rifle'));
check('carpet is the last catalog row', market.getHudState().items.at(-1)?.id === 'carpet');
check(
  'buy AX-338 replaces M4 and deducts 1500',
  market.buy('sniper') &&
    weapons.owns('sniper') &&
    !weapons.owns('rifle') &&
    !weapons.owns('lmg') &&
    market.credits === 99999 - 1200 - 900 - 1500
);
check(
  'buy LMG replaces AX-338',
  market.buy('lmg') && weapons.owns('lmg') && !weapons.owns('sniper')
);

const beforeMCX = market.credits;
check(
  'buy MCX replaces LMG and deducts 1100',
  market.buy('mcx') &&
    weapons.owns('mcx') &&
    !weapons.owns('lmg') &&
    market.credits === beforeMCX - 1100
);
check(
  'MCX remains a separate primary, M4 still offered',
  item('mcx').slot === 'primary' && item('rifle').action === 'swap'
);
check('cannot buy MCX twice', !market.buy('mcx'));
check('M4 can replace MCX', market.buy('rifle') && weapons.owns('rifle') && !weapons.owns('mcx'));
{
  const real = weapons.equipPrimary.bind(weapons);
  weapons.equipPrimary = (): false => false;
  const credits = market.credits;
  check('failed gun buy does not charge', !market.buy('lmg') && market.credits === credits);
  check('failed gun buy leaves ownership', weapons.owns('rifle') && !weapons.owns('lmg'));
  weapons.equipPrimary = real;
}

// ---- secondary weapon purchases replace the equipped secondary -----------
check(
  'spawn loadout: pistol owned, SMG and shotgun not',
  weapons.owns('pistol') && !weapons.owns('smg') && !weapons.owns('shotgun')
);
check(
  'P320 offered as a 400-credit secondary',
  item('pistol').label === 'P320 Compact' &&
    item('pistol').cost === 400 &&
    item('pistol').slot === 'secondary'
);
const beforeOwnedPistol = market.credits;
check(
  'starting pistol is equipped and cannot be repurchased',
  item('pistol').action === 'equipped' &&
    !item('pistol').affordable &&
    !market.buy('pistol') &&
    market.credits === beforeOwnedPistol
);
check('MPX buyable while pistol equipped', item('smg').affordable && item('smg').action === 'swap');
const beforeSmg = market.credits;
check(
  'buy MPX replaces pistol and deducts 800',
  market.buy('smg') &&
    weapons.owns('smg') &&
    !weapons.owns('pistol') &&
    market.credits === beforeSmg - 800
);
check('cannot rebuy the equipped MPX', !market.buy('smg'));
check('shotgun buyable while MPX equipped', item('shotgun').affordable);
const beforeShotgun = market.credits;
check(
  'buy shotgun replaces MPX and deducts 1000',
  market.buy('shotgun') &&
    weapons.owns('shotgun') &&
    !weapons.owns('smg') &&
    !weapons.owns('pistol') &&
    market.credits === beforeShotgun - 1000
);
check('cannot rebuy the shotgun', !market.buy('shotgun'));
check('MPX becomes buyable with shotgun equipped', item('smg').affordable);
check(
  'buy MPX replaces shotgun',
  market.buy('smg') && weapons.owns('smg') && !weapons.owns('shotgun')
);

// ---- pistol can be bought back after either secondary upgrade ------------
for (const previous of ['smg', 'shotgun'] as const) {
  if (!weapons.owns(previous)) weapons.equipSecondary(previous);
  const primary = PRIMARY_IDS.find((id): boolean => weapons.owns(id));
  assert(primary);
  const pistol = weaponState('pistol');
  pistol.mag = 0;
  pistol.chambered = false;
  pistol.reserve = 0;
  market.credits = 399;
  check(
    'P320 unaffordable below 400 without charging or swapping',
    item('pistol').action === 'swap' &&
      !item('pistol').affordable &&
      !market.buy('pistol') &&
      market.credits === 399 &&
      weapons.owns(previous) &&
      !weapons.owns('pistol')
  );
  market.credits = 400;
  check('P320 buyable at exactly 400', item('pistol').affordable);
  check(
    `buy P320 replaces ${previous}, preserves primary, and deducts 400`,
    market.buy('pistol') &&
      weapons.owns('pistol') &&
      !weapons.owns('smg') &&
      !weapons.owns('shotgun') &&
      weapons.owns(primary) &&
      market.credits === 0
  );
  check(
    'P320 purchase refreshes ammo and disables duplicate purchase',
    pistol.mag === pistol.def.magSize &&
      pistol.chambered &&
      pistol.reserve === pistol.def.reserve &&
      item('pistol').action === 'equipped' &&
      !item('pistol').affordable &&
      !market.buy('pistol')
  );
}
weapons.equipSecondary('smg');
market.credits = 400;
{
  const real = captureMethod(weapons, 'equipSecondary');
  weapons.equipSecondary = (): false => false;
  check(
    'failed pistol equip does not charge or change ownership',
    !market.buy('pistol') &&
      market.credits === 400 &&
      weapons.owns('smg') &&
      !weapons.owns('pistol')
  );
  weapons.equipSecondary = real;
}
market.closeShop();
check(
  'pistol cannot be bought with the market closed',
  !market.buy('pistol') && market.credits === 400
);
market.openShop(2);

// ---- carpet-bomb strike charges (radio request 1) ------------------------
check('carpet sits in ordnance, last in the catalog', item('carpet').slot === 'strike');
check('spawns with 1 strike, caps at 3', item('carpet').level === 1 && item('carpet').max === 3);
market.credits = 99999;
check('carpet strike buyable for 1500', item('carpet').affordable);
check(
  'buy adds a charge and deducts 1500',
  market.buy('carpet') && weapons.carpetBombs === 2 && market.credits === 99999 - 1500
);
market.buy('carpet');
check('charges cap at 3', weapons.carpetBombs === 3);
check('buy at cap rejected', market.buy('carpet') === false);
market.closeShop();
check('close restores the previous time scale', context.time.scale === 0.5);
context.time.scale = 1;
market.credits = 99999;
check('carpet unbuyable with the shop closed', market.buy('carpet') === false);

// ---- armour damage -------------------------------------------------------
let damage: import('../../src/core/events.ts').EngineEventMap['damage:taken'] | undefined;
const healthContext = createTestContext();
healthContext.events.on('damage:taken', (payload): void => {
  damage = { ...payload };
});
const health = new Health(healthContext, null);
const lastDamage = (): NonNullable<typeof damage> => {
  assert(damage);
  return damage;
};
health.addArmour(50);
health.damage(20, null);
const absorbed =
  health.armour === 35 &&
  health.value === 100 &&
  lastDamage().amount === 0 &&
  lastDamage().armourAbsorbed === 15 &&
  health.hitFlash === 0;
health.damage(80, null);
check(
  'armour strips 25% then buffers, overflow breaks a plate',
  absorbed &&
    health.armour === 0 &&
    health.value === 75 &&
    lastDamage().amount === 25 &&
    lastDamage().plateBreak
);
health.damage(20, null);
check(
  'bare health takes full damage after plates are gone',
  health.armour === 0 &&
    health.value === 55 &&
    lastDamage().amount === 20 &&
    !lastDamage().plateBreak
);

// ---- restart -------------------------------------------------------------
market.openShop(3);
context.events.emit('game:restart', {});
check('restart zeroes credits', market.credits === 0);
check('restart force-closes an open shop', market.open === false && context.time.scale === 1);
earn(100);
check('earns again after restart', market.credits === 100);

console.log(failures === 0 ? '\nALL PASS' : `\n${failures} FAILURES`);
process.exit(failures === 0 ? 0 : 1);

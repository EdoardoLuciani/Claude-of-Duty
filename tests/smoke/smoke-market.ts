import assert from 'node:assert/strict';

import * as THREE from 'three';

import { BASE_ATTACHMENTS, buildDef, OPTIC_IDS } from '../../src/weapons/attachment-rules.ts';
import type { WeaponEntry } from '../../src/weapons/runtime-types.ts';
import type { Viewmodel } from '../../src/weapons/viewmodel.ts';
import { fixture } from '../lib/fixture.ts';
import { mountableWeapon, opticAsset, rigidAsset } from '../lib/weapon-attachment-fixture.ts';

/**
 * Bun smoke test for the market and armour systems — no browser.
 * Exercises the credits mirror (score:change), the post-wave grace period,
 * opening/closing, purchasing rules and reset.
 *
 *   bun test ./tests/smoke/smoke-market.ts
 */
import { AiSystem } from '../../src/ai/index.ts';
import { MarketSystem, MARKET_DELAY } from '../../src/market/index.ts';
import { Health } from '../../src/player/health.ts';
import { WEAPON_DEFS, WEAPON_IDS, PRIMARY_IDS } from '../../src/weapons/defs.ts';
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
for (const id of WEAPON_IDS) weapons.states.set(id, weapons._makeState(id));
providers.weapons = weapons;
providers.player = player;

const market = new MarketSystem();
const buyGun = (id: WeaponId): boolean => market.beginBuild(id) && market.confirmBuild();
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
    item('smg').action === 'buy' &&
    item('lmg').action === 'buy' &&
    item('shotgun').action === 'buy' &&
    item('sniper').action === 'buy'
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
const ai = new AiSystem();
ai.ctx = context;
ai._wave = 1;
ai._updateWaves(context);
check('wave bonus +250 (via score:change)', market.credits === 500);
check('shop NOT open yet (grace period)', market.open === false);
check('time still running during grace', context.time.scale === 1);
check('shop countdown shows 15s', market.getHudState().marketIn === 15);
context.time.elapsed += 14;
market.update();
check('still closed at 14s', market.open === false);
context.time.elapsed += 1;
market.update();
check('shop opens when the window elapses', market.open === true);
check('countdown cleared once open', market.getHudState().marketIn === 0);
check('next wave countdown is paused at 15s', ai.getWaveState().nextIn === 15);

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
  'two starting spares report half capacity and reject insufficient credits',
  item('ammo').level === 50 && !market.buy('ammo')
);
market.credits = 99999;
check('ammo is buyable below full', item('ammo').affordable && market.buy('ammo'));
check(
  'refill tops reserves and disables itself',
  weaponState('rifle').spares.length === 4 &&
    weaponState('pistol').spares.length === 4 &&
    !item('ammo').affordable &&
    !market.buy('ammo') &&
    item('ammo').action === 'max'
);
market.closeShop();
check('closed purchases fail', !market.buy('grenade'));

// ---- dead player blocks the auto-open ------------------------------------
context.events.emit('wave:complete', { wave: 2, nextWave: 3, delay: ai.waveDelay }); // arm the timer
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
check('LMG buyable while M4 equipped', item('lmg').affordable && item('lmg').action === 'buy');
check(
  'M4 not buyable while equipped',
  item('rifle').affordable === false && item('rifle').action === 'equipped'
);
check(
  'buy LMG replaces M4 and deducts 1200',
  buyGun('lmg') && weapons.owns('lmg') && !weapons.owns('rifle') && market.credits === 99999 - 1200
);
check('cannot buy a weapon already equipped', !buyGun('lmg') && !item('lmg').affordable);
check(
  'M4 becomes buyable with LMG equipped',
  item('rifle').affordable && item('rifle').action === 'buy'
);
check('buy M4 replaces LMG', buyGun('rifle') && weapons.owns('rifle') && !weapons.owns('lmg'));
check('M4 purchase rejected when equipped again', !buyGun('rifle'));
check('carpet is the last catalog row', market.getHudState().items.at(-1)?.id === 'carpet');
check(
  'buy AX-338 replaces M4 and deducts 1500',
  buyGun('sniper') &&
    weapons.owns('sniper') &&
    !weapons.owns('rifle') &&
    !weapons.owns('lmg') &&
    market.credits === 99999 - 1200 - 900 - 1500
);
check('buy LMG replaces AX-338', buyGun('lmg') && weapons.owns('lmg') && !weapons.owns('sniper'));

const beforeMCX = market.credits;
check(
  'buy MCX replaces LMG and deducts 1100',
  buyGun('mcx') &&
    weapons.owns('mcx') &&
    !weapons.owns('lmg') &&
    market.credits === beforeMCX - 1100
);
check(
  'MCX remains a separate primary, M4 still offered',
  item('mcx').slot === 'primary' && item('rifle').action === 'buy'
);
check('cannot buy MCX twice', !buyGun('mcx'));
check('M4 can replace MCX', buyGun('rifle') && weapons.owns('rifle') && !weapons.owns('mcx'));
{
  const real = captureMethod(weapons, 'applyBuild');
  weapons.applyBuild = (): false => false;
  const credits = market.credits;
  check('failed gun buy does not charge', !buyGun('lmg') && market.credits === credits);
  check('failed gun buy leaves ownership', weapons.owns('rifle') && !weapons.owns('lmg'));
  weapons.applyBuild = real;
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
    !buyGun('pistol') &&
    market.credits === beforeOwnedPistol
);
check('MPX buyable while pistol equipped', item('smg').affordable && item('smg').action === 'buy');
const beforeSmg = market.credits;
check(
  'buy MPX replaces pistol and deducts 800',
  buyGun('smg') &&
    weapons.owns('smg') &&
    !weapons.owns('pistol') &&
    market.credits === beforeSmg - 800
);
check('cannot rebuy the equipped MPX', !buyGun('smg'));
check('shotgun buyable while MPX equipped', item('shotgun').affordable);
const beforeShotgun = market.credits;
check(
  'buy shotgun replaces MPX and deducts 1000',
  buyGun('shotgun') &&
    weapons.owns('shotgun') &&
    !weapons.owns('smg') &&
    !weapons.owns('pistol') &&
    market.credits === beforeShotgun - 1000
);
check('cannot rebuy the shotgun', !buyGun('shotgun'));
check('MPX becomes buyable with shotgun equipped', item('smg').affordable);
check('buy MPX replaces shotgun', buyGun('smg') && weapons.owns('smg') && !weapons.owns('shotgun'));

// ---- pistol can be bought back after either secondary upgrade ------------
for (const previous of ['smg', 'shotgun'] as const) {
  if (!weapons.owns(previous)) weapons.applyBuild(previous, BASE_ATTACHMENTS);
  const primary = PRIMARY_IDS.find((id): boolean => weapons.owns(id));
  assert(primary);
  const pistol = weaponState('pistol');
  pistol.mag = 0;
  pistol.chambered = false;
  pistol.spares.length = 0;
  market.credits = 399;
  check(
    'P320 unaffordable below 400 without charging or swapping',
    item('pistol').action === 'buy' &&
      !item('pistol').affordable &&
      !buyGun('pistol') &&
      market.credits === 399 &&
      weapons.owns(previous) &&
      !weapons.owns('pistol')
  );
  market.credits = 400;
  check('P320 buyable at exactly 400', item('pistol').affordable);
  check(
    `buy P320 replaces ${previous}, preserves primary, and deducts 400`,
    buyGun('pistol') &&
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
      pistol.reserve === 2 * pistol.def.magSize &&
      item('pistol').action === 'equipped' &&
      !item('pistol').affordable &&
      !buyGun('pistol')
  );
}
weapons.applyBuild('smg', BASE_ATTACHMENTS);
market.credits = 400;
market.closeShop();
check(
  'pistol cannot be bought with the market closed',
  !buyGun('pistol') && market.credits === 400
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
market.credits = 99999;
check('carpet unbuyable with the shop closed', market.buy('carpet') === false);

// ---- attachment builds: real mounting, no GPU or asset fetch ----------------
const entries = new Map<WeaponId, WeaponEntry>();
for (const id of ['rifle', 'lmg'] as const)
  entries.set(id, fixture<WeaponEntry>({ id, def: weaponState(id).def, ...mountableWeapon(id) }));
weapons.viewmodel = fixture<Viewmodel>({
  weapons: entries,
  reticle: new THREE.Object3D(),
  scopeOverlay: new THREE.Object3D(),
});
Object.assign(weapons, {
  _attachments: {
    railway: opticAsset(),
    acog: opticAsset(),
    laser: rigidAsset('SOCKET_laser'),
    srd762ti: rigidAsset('SOCKET_muzzle'),
    crest_brake: rigidAsset('SOCKET_muzzle'),
    vector_brake: rigidAsset('SOCKET_muzzle'),
  },
});
market.openShop();
market.credits = 1350;
assert(market.beginBuild('pistol'));
assert(
  market
    .getHudState()
    .attachments.filter((offer): boolean => offer.slot === 'optic')
    .every((offer): boolean => !offer.compatible),
  'pistol offers no optic customization'
);
for (const optic of OPTIC_IDS)
  assert(!market.setBuild({ ...BASE_ATTACHMENTS, optic }), `${optic} cannot replace pistol irons`);
assert(
  market.setBuild({ optic: null, rail: 'laser', muzzle: 'suppressor' }),
  'pistol laser and suppressor remain compatible together'
);
assert.deepEqual(
  weapons.getAttachments('pistol'),
  BASE_ATTACHMENTS,
  'draft preserves pistol irons'
);
market.cancelBuild();
const redDotLaser = { ...BASE_ATTACHMENTS, optic: 'railway', rail: 'laser' } as const;
assert(market.beginBuild('rifle') && market.setBuild(redDotLaser));
assert.equal(market.getHudState().build?.total, 450, 'owned gun charges attachments only');
assert.equal(weapons.getAttachments('rifle'), BASE_ATTACHMENTS, 'draft does not equip');
market.cancelBuild();
assert.equal(market.credits, 1350);
assert.equal(weapons.getAttachments('rifle'), BASE_ATTACHMENTS);
assert(!market.confirmBuild());

const rifle = weaponState('rifle');
const rifleBase = buildDef('rifle', BASE_ATTACHMENTS);
const { pitch, yaw } = rifleBase.recoil;
const riflePattern = rifle.pattern;
const rifleMount = entries.get('rifle')?.model.scene.getObjectByName('MOUNT_muzzle');
assert(rifleMount);
for (const muzzle of ['crest_brake', 'vector_brake'] as const) {
  const draft = { ...BASE_ATTACHMENTS, muzzle };
  assert(market.beginBuild('pistol') && !market.setBuild(draft), 'no unverified brake fits');
  assert(market.beginBuild('rifle') && market.setBuild(draft));
  assert.notEqual(rifle.attachments.muzzle, muzzle, 'draft never equips');
  const preview = buildDef('rifle', draft);
  if (muzzle === 'crest_brake') {
    assert(preview.recoil.pitch < pitch);
    assert.equal(preview.recoil.yaw, yaw);
  } else {
    assert.equal(preview.recoil.pitch, pitch);
    assert(preview.recoil.yaw < yaw);
  }
  assert(preview.adsTime > rifleBase.adsTime);
  assert.equal(preview.damage, rifleBase.damage);
  assert.equal(preview.muzzleVelocity, rifleBase.muzzleVelocity);
  assert.equal(preview.suppressed, false);
  const credits: number = market.credits;
  assert(market.confirmBuild());
  assert.equal(market.credits, credits - 300);
  assert.deepEqual(rifle.def, preview, 'market draft and gameplay share tuning');
  assert.equal(rifleMount.children.length, 1, 'replacement keeps just one muzzle mount');
  const { recoil } = rifle.def;
  assert(Math.abs(rifle.pattern[0] / riflePattern[0] - recoil.pitch / pitch) < 1e-6);
  assert(Math.abs(rifle.pattern[1] / riflePattern[1] - recoil.yaw / yaw) < 1e-6);
}
assert(market.setBuild(BASE_ATTACHMENTS) && market.confirmBuild());
assert.deepEqual(rifle.def, rifleBase);
assert.deepEqual(rifle.pattern, riflePattern);
assert.equal(rifleMount.children.length, 0);
market.credits = 1350;

assert(market.beginBuild('lmg') && market.setBuild(redDotLaser));
const hudBuild = market.getHudState().build;
assert(hudBuild);
assert.equal(hudBuild.total, 1650, 'new gun includes its base price');
assert(!hudBuild.canConfirm && !market.confirmBuild());
assert(weapons.owns('rifle') && !weapons.owns('lmg'));
assert.equal(market.credits, 1350);
market.credits = 1650;
assert.equal(market.getHudState().build, hudBuild, 'quote reuses its snapshot');
assert(market.confirmBuild());
assert.equal(market.credits, 0);
assert(weapons.owns('lmg') && !weapons.owns('rifle'));
assert.deepEqual(weapons.getAttachments('lmg'), redDotLaser);
assert.equal(market.getHudState().build?.total, 0, 'unchanged attachments are not charged twice');
assert(!market.confirmBuild(), 'unchanged build cannot be purchased twice');
market.credits = 400;
assert(market.setBuild({ ...redDotLaser, optic: 'acog' }));
assert.equal(market.getHudState().build?.total, 400);
assert.equal(market.getHudState().build?.slots[0].discarded, 'Railway');
market.cancelBuild();
assert.equal(
  weapons.getAttachments('lmg').optic,
  'railway',
  'cancel preserves replaced attachment'
);
assert(market.beginBuild('lmg') && market.setBuild({ ...redDotLaser, optic: 'acog' }));
assert(market.confirmBuild());
assert.equal(market.credits, 0, 'replacement gives no refund');
assert(market.setBuild(BASE_ATTACHMENTS) && market.confirmBuild(), 'removal costs nothing');
assert.equal(weapons.getAttachments('lmg').optic, null);
market.credits = 350;
assert(market.setBuild({ ...BASE_ATTACHMENTS, muzzle: 'suppressor' }));
assert.equal(market.getHudState().build?.total, 350);
assert(market.confirmBuild(), 'suppressor purchase resolves the weapon-specific can asset');
assert.equal(market.credits, 0);
assert(weaponState('lmg').def.suppressed, 'a mounted can suppresses fire audio/FX');
assert(market.setBuild(BASE_ATTACHMENTS) && market.confirmBuild());
assert.equal(weaponState('lmg').def.suppressed, false, 'removal restores the unsuppressed gun');
// Confirming changes handling; removal restores the same live definition in place.
const authoredLmg = structuredClone(WEAPON_DEFS.lmg);
const liveDef = weaponState('lmg').def;
const baseDef = structuredClone(liveDef);
const basePattern = weaponState('lmg').pattern;
const fullBuild = { optic: 'acog', muzzle: 'suppressor', rail: 'laser' } as const;
market.credits = 950;
assert(market.setBuild(fullBuild) && market.confirmBuild());
assert(liveDef.adsTime > baseDef.adsTime, 'fitted build takes longer to aim');
const recoilScale = liveDef.recoil.pitch / baseDef.recoil.pitch;
assert(recoilScale < 1);
assert(Math.abs(weaponState('lmg').pattern[0] / basePattern[0] - recoilScale) < 1e-6);
assert(market.setBuild(BASE_ATTACHMENTS) && market.confirmBuild());
assert.deepEqual(liveDef, baseDef, 'removal restores the base definition');
assert.deepEqual(weaponState('lmg').pattern, basePattern);
assert.deepEqual(WEAPON_DEFS.lmg, authoredLmg, 'builds never mutate shared definitions');
assert(market.setBuild(redDotLaser));
assert.equal(market.getHudState().build?.total, 450, 'discarded attachments must be bought again');
assert(market.setBuild({ ...BASE_ATTACHMENTS, optic: 'scope' }));
market.credits = 9999;
assert(!market.confirmBuild(), 'missing attachment asset cannot be purchased');
assert.equal(market.credits, 9999);
assert.equal(weapons.getAttachments('lmg').optic, null);
assert(market.beginBuild('rifle') && market.setBuild(redDotLaser));
const rifleEntry = entries.get('rifle');
assert(rifleEntry);
entries.delete('rifle');
assert(!market.confirmBuild(), 'unloaded new weapon cannot replace the owned gun');
assert(weapons.owns('lmg') && !weapons.owns('rifle'));
assert.equal(market.credits, 9999);
entries.set('rifle', rifleEntry);
assert(market.confirmBuild());
assert.equal(weapons.getAttachments('lmg'), BASE_ATTACHMENTS, 'swap discards the old build');
assert(market.beginBuild('lmg'));
assert.deepEqual(market.getHudState().build?.config, BASE_ATTACHMENTS, 'rebuy starts at base');
assert.equal(market.getHudState().build?.total, 1200);
assert(market.confirmBuild());
assert.equal(weapons.getAttachments('rifle'), BASE_ATTACHMENTS);
assert(market.beginBuild('rifle') && market.setBuild(redDotLaser));
market.closeShop();
assert.equal(market.getHudState().build, null, 'closing drops unconfirmed build');
assert(!market.confirmBuild() && !market.beginBuild('rifle'));
market.openShop();
assert(market.beginBuild('rifle'));
context.events.emit('game:restart', {});
assert.equal(market.getHudState().build, null, 'restart drops unconfirmed build');
assert.equal(market.credits, 0);

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
check('restart force-closes an open shop', market.open === false);
earn(100);
check('earns again after restart', market.credits === 100);

console.log(failures === 0 ? '\nALL PASS' : `\n${failures} FAILURES`);
process.exit(failures === 0 ? 0 : 1);

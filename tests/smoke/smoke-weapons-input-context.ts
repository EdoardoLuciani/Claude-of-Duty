// Weapon-owned canonical input contexts; real Input snapshots, no DOM/GPU.
import assert from 'node:assert/strict';

import * as THREE from 'three';

import { bindingLabel } from '../../src/core/bindings.ts';
import { Input } from '../../src/core/input.ts';
import { EventBus } from '../../src/core/registry.ts';
import { Rng } from '../../src/core/rng.ts';
import { PhysicsSystem, type PhysicsRigidBodyOptions } from '../../src/physics/index.ts';
import { CameraRig } from '../../src/player/camera.ts';
import { HealController } from '../../src/player/heal.ts';
import { Health } from '../../src/player/health.ts';
import { PlayerSystem } from '../../src/player/index.ts';
import { Movement } from '../../src/player/movement.ts';
import type { RadioSystem } from '../../src/radio/index.ts';
import type { UiSystem } from '../../src/ui/index.ts';
import { AmmoPickups } from '../../src/weapons/ammo-pickups.ts';
import { BASE_ATTACHMENTS } from '../../src/weapons/attachments.ts';
import { ProjectileSim } from '../../src/weapons/ballistics.ts';
import { Clip } from '../../src/weapons/clips.ts';
import { WEAPON_IDS } from '../../src/weapons/defs.ts';
import type { WeaponId } from '../../src/weapons/defs.ts';
import { GRENADE_FUSE, MAX_SHOTS_PER_FRAME } from '../../src/weapons/index.ts';
import type { WeaponEntry, WeaponModelRecord } from '../../src/weapons/runtime-types.ts';
import type { Viewmodel } from '../../src/weapons/viewmodel.ts';
import { ArmedWeaponSystem, weaponState } from '../lib/ballistics-fixture.ts';
import { createTestContext } from '../lib/context.ts';
import { fixture } from '../lib/fixture.ts';
import { FRAME_SOURCES } from '../lib/frame-sources.ts';

interface FrameOptions {
  down?: string[];
  up?: string[];
  wheel?: number;
  dt?: number;
}

interface WeaponHarness {
  wp: ArmedWeaponSystem;
  input: Input;
  frame(this: void, options?: FrameOptions): void;
  tap(this: void, ...codes: string[]): void;
  clips: string[];
  prompts: Array<Parameters<UiSystem['setPrompt']>[0] & { owner: unknown }>;
  cancellations: string[];
  bodies: Array<PhysicsRigidBodyOptions | undefined>;
  player: PlayerSystem;
  shots: { live: number; fired: number; impacts: number };
}
function makeHarness(): WeaponHarness {
  const input = new Input(fixture<HTMLCanvasElement>({}), { sensitivity: 1, invertY: false });
  input._pollGamepad = (): void => {};
  for (const method of ['pressed', 'held', 'released'] as const) {
    input[method] = (): never => {
      throw new Error(`weapons must not query raw ${method}`);
    };
  }
  const wp = new ArmedWeaponSystem();
  const clips: string[] = [],
    prompts: Array<Parameters<UiSystem['setPrompt']>[0] & { owner: unknown }> = [],
    cancellations: string[] = [],
    bodies: Array<PhysicsRigidBodyOptions | undefined> = [];
  const player = new PlayerSystem();
  player.ctx = createTestContext({ input });
  player.movement = new Movement(player.ctx, player);
  player.rig = new CameraRig(player.ctx);
  player.rig.eyePosition.set(0, 1.6, 0);
  player.health = new Health(player.ctx, null);
  player.healCtrl = new HealController(player);
  player.setAdsProgress = (): void => {};
  player.cancelHeal = (reason): boolean => {
    cancellations.push(reason);
    wp.endHeal();
    return true;
  };
  wp.player = player;
  wp.ui = fixture<UiSystem>({
    setPrompt(prompt, owner): void {
      prompts.push({ ...prompt, owner });
    },
    clearPrompt(): void {},
  });
  wp.ctx = createTestContext({
    input,
    scene: new THREE.Scene(),
    camera: new THREE.PerspectiveCamera(),
    events: new EventBus(),
    providers: { player, ui: wp.ui },
  });
  wp.rng = new Rng(372);
  // A projectile spawn is the only per-pellet side effect of an accepted shot,
  // so counting them measures real trigger output. `update()` copies
  // `sim.stats.fired` back into `wp.stats.fired` every frame.
  const shots = { live: 0, fired: 0, impacts: 0 };
  wp.sim = fixture<ProjectileSim>({
    spawn(): null {
      shots.fired++;
      return null;
    },
    clear(): void {},
    stats: shots,
  });
  wp.stats = { tris: 0, drawCalls: 0, live: 0, fired: 0 };
  wp.physics = new PhysicsSystem();
  const addRigidBody = wp.physics.addRigidBody.bind(wp.physics);
  wp.physics.addRigidBody = (options): ReturnType<PhysicsSystem['addRigidBody']> => {
    bodies.push(options);
    return addRigidBody(options);
  };
  wp.viewmodel = fixture<Viewmodel>({
    anchor: new THREE.Object3D(),
    weapons: new Map(
      WEAPON_IDS.map((id): [WeaponId, WeaponEntry] => [id, fixture<WeaponEntry>({ id })])
    ),
    syncToCamera(): void {},
    grenadeReleaseWorld(out): THREE.Vector3 {
      return out.copy(wp._throwOrigin());
    },
    armAsset: fixture<Viewmodel['armAsset']>({
      blood: fixture<Viewmodel['armAsset']['blood']>({ setHealthFraction(): void {} }),
    }),
    active: null,
    clip: null,
    get clipName(): string | null {
      return this.clip?.name ?? null;
    },
    adsT: 0,
    setActive(): null {
      return null;
    },
    stopClip(): void {
      this.clip = null;
    },
    play(name): number {
      this.clip = new Clip(name, 1, {});
      clips.push(name);
      return 1;
    },
    holdGrenade(): void {},
    cookGrenade(): void {},
    throwGrenade(): void {},
    endGrenade(): void {},
    holdRadio(): void {},
    endRadio(): void {},
    setRadioScreen(): void {},
    holdBandage(): void {},
    endBandage(): void {},
    addRecoil(): void {},
    muzzleWorld(out): THREE.Vector3 {
      return out.set(0, 0, 0);
    },
  });
  for (const id of WEAPON_IDS) wp.states.set(id, wp._makeState(id));
  const frame = ({ down = [], up = [], wheel = 0, dt = 1 / 60 }: FrameOptions = {}): void => {
    for (const code of down) input._pendingDown.add(code);
    for (const code of up) input._pendingUp.add(code);
    input._pendingWheel = wheel;
    input.beginFrame();
    wp.update(dt, wp.ctx);
    input.endFrame();
  };
  const tap = (...codes: string[]): void => frame({ down: codes, up: codes });
  return { wp, input, frame, tap, clips, prompts, cancellations, bodies, player, shots };
}

// Retain the real loadout boundary without separate per-weapon fake rigs.
for (const [equip, first, second] of [
  ['equipPrimary', 'lmg', 'sniper'],
  ['equipSecondary', 'smg', 'shotgun'],
] as const) {
  const { wp } = makeHarness();
  assert.deepEqual(wp.weaponIds, ['rifle', 'pistol']);
  assert(
    (equip === 'equipPrimary' ? wp.equipPrimary(first) : wp.equipSecondary(first)) &&
      !(equip === 'equipPrimary' ? wp.equipPrimary(first) : wp.equipSecondary(first)),
    'cannot rebuy the equipped weapon'
  );
  assert.deepEqual(wp.weaponIds, equip === 'equipPrimary' ? [first, 'pistol'] : ['rifle', first]);
  wp.state.mag = 1;
  assert(wp.reload());
  assert(
    (equip === 'equipPrimary' ? wp.equipPrimary(second) : wp.equipSecondary(second)) &&
      !wp.owns(first)
  );
  assert.deepEqual(wp.weaponIds, equip === 'equipPrimary' ? [second, 'pistol'] : ['rifle', second]);
  assert(!wp.reloading && wp.tryFire(), 'mid-reload purchase is immediately usable');
  weaponState(wp, first).reserve = 0;
  wp.state.reserve = 1;
  wp.refillAmmo();
  assert.equal(wp.state.reserve, wp.current.reserve);
  assert.equal(weaponState(wp, first).reserve, 0, 'refill ignores unowned weapons');
  assert.equal(wp.ammoFraction(), 1);
  wp.resetForNewGame();
  assert.deepEqual(wp.weaponIds, ['rifle', 'pistol']);
  assert.equal(wp.activeId, 'rifle');
}
// Attachments belong to the gun: dropping it or restarting returns the base build.
{
  type RifleModel = Extract<WeaponModelRecord, { id: 'rifle' }>;
  const { wp } = makeHarness();
  const scene = new THREE.Group();
  const irons = Object.assign(new THREE.Object3D(), { name: 'IRON_sights' });
  scene.add(irons, Object.assign(new THREE.Object3D(), { name: 'GASBLOCK_low' }));
  Object.assign(wp.viewmodel, {
    reticle: new THREE.Object3D(),
    scopeOverlay: new THREE.Object3D(),
  });
  Object.assign(wp.viewmodel.weapons.get('rifle') ?? {}, {
    model: fixture<RifleModel>({
      id: 'rifle',
      scene,
      root: scene,
      nodes: fixture<RifleModel['nodes']>({ sight: [0, 0.14, 0.03], muzzle: [0, 0.07, -0.5] }),
    }),
    def: weaponState(wp, 'rifle').def,
    attachmentGroup: new THREE.Group(),
    sight: new THREE.Vector3(),
    muzzle: new THREE.Vector3(),
  });
  for (const drop of [(): boolean => wp.equipPrimary('lmg'), (): void => wp.resetForNewGame()]) {
    wp.resetForNewGame();
    assert(wp.setAttachments('rifle', { ...BASE_ATTACHMENTS, ironSights: false }));
    assert(!irons.visible);
    drop();
    assert.equal(weaponState(wp, 'rifle').attachments, BASE_ATTACHMENTS);
    assert(irons.visible, 'the mounted build is reset, not only the stored config');
  }
}
{
  const { wp, shots } = makeHarness();
  assert(wp.equipSecondary('shotgun') && wp.tryFire());
  assert.equal(shots.fired, 8, 'one shotgun shell spawns eight pellets');
  assert.equal(wp._pendingShots, 1, 'pellets still produce one accepted-shot event');
}
{
  const { wp } = makeHarness();
  assert(wp.equipPrimary('sniper') && wp.tryFire());
  assert(
    !wp.state.chambered && !wp.tryFire() && !wp.setWeapon('pistol'),
    'bolt cycle blocks fire/switch'
  );
  wp.viewmodel.stopClip();
  wp._fireTimer = 0;
  assert(wp.reload(), 'interrupted bolt cycle can reload a full box with empty chamber');
  assert.equal(wp.viewmodel.clipName, 'reloadEmpty');
  wp._completeReload(true);
  assert(wp.state.chambered && wp.state.mag === wp.current.magSize - 1);
}

// Same-frame operations retain their order, independent of physical event order.
{
  const { wp, frame } = makeHarness();
  const order: string[] = [];
  for (const method of [
    'reload',
    'cycleFireMode',
    'inspect',
    'nextWeapon',
    '_runTrigger',
    '_updateGrenade',
    '_updateRadio',
  ] as const) {
    if (method === 'cycleFireMode') {
      wp.cycleFireMode = (): undefined => {
        order.push(method);
        return undefined;
      };
    } else {
      wp[method] = (): false => {
        order.push(method);
        return false;
      };
    }
  }
  wp.setWeapon = (id): boolean => {
    order.push(`slot:${id}`);
    return false;
  };
  frame({
    down: ['KeyX', 'KeyG', 'Mouse0', 'Tab', 'Digit2', 'Digit1', 'KeyI', 'KeyB', 'KeyR'],
    wheel: -1,
  });
  assert.deepEqual(order, [
    'reload',
    'cycleFireMode',
    'inspect',
    'slot:rifle',
    'slot:pistol',
    'nextWeapon',
    'nextWeapon',
    '_runTrigger',
    '_updateGrenade',
    '_updateRadio',
  ] as const);
}

// Tab and wheel remain two requests (a pending holster can refuse the second).
for (const wheel of [-1, 1]) {
  const { wp, frame } = makeHarness();
  const next = wp.nextWeapon.bind(wp);
  const results: boolean[] = [];
  wp.nextWeapon = (): boolean => {
    const result = next();
    results.push(result);
    return result;
  };
  frame({ down: ['Tab'], wheel });
  assert.deepEqual(
    results,
    [true, false],
    'both cycle requests run, with existing switching guard'
  );
  assert.equal(wp._switchTo, 'pistol');
  frame();
  assert.equal(results.length, 2, 'held Tab and expired wheel do not repeat');
}

// Slot 3 is inert normally; same-slot selection cannot stow a grenade.
{
  const { wp, tap } = makeHarness();
  tap('Digit3');
  assert.equal(wp._switchTo, null);
  tap('KeyG');
  tap('Digit1');
  assert(wp.grenadeEquipped, 'same-slot selection is a no-op, not a stow');
  tap('Digit2');
  assert(!wp.grenadeEquipped);
  assert.equal(wp._switchTo, 'pistol');
}

// Fire mode remains active on the underlying gun even with an accessory out.
for (const accessory of ['KeyG', 'KeyX']) {
  const { wp, tap, clips } = makeHarness();
  tap(accessory);
  const before = wp.fireMode;
  tap('KeyB');
  assert.notEqual(wp.fireMode, before);
  tap('KeyI', 'KeyR');
  assert(
    !clips.includes('inspect') && !clips.includes('reloadTac'),
    'busy hands block inspect/reload'
  );
  assert(!wp.canFire());
}
{
  const { wp, tap, clips } = makeHarness();
  tap('KeyI');
  assert(wp.inspecting && clips.includes('inspect'), 'inspect action starts the weapon clip');
}

/* ======================================================================== */
/*  selectable fire modes (issue 471)                                       */
/* ======================================================================== */

// Every automatic weapon offers SEMI next to AUTO, and the real B binding
// cycles the authored order without skipping or repeating a mode.
for (const id of ['rifle', 'smg', 'mcx', 'lmg'] as const) {
  const { wp, tap } = makeHarness();
  wp.activeId = id;
  const modes = wp.state.def.modes;
  assert.deepEqual(
    [...modes].sort(),
    id === 'rifle' ? ['auto', 'burst', 'semi'] : ['auto', 'semi'],
    `${id} exposes the selectable fire modes`
  );
  const seen = [];
  for (let i = 0; i < modes.length; i++) {
    tap('KeyB');
    seen.push(wp.fireMode);
    assert.equal(wp.getHudState().mode, wp.fireMode, `${id} HUD follows the selector`);
  }
  assert.deepEqual(seen, [...modes.slice(1), modes[0]], `${id} cycles through every mode`);
}

// SEMI: one shot per distinct press, holding repeats nothing, and the weapon
// cadence still gates a press that lands too early.
{
  const { wp, frame, tap, shots } = makeHarness();
  wp.activeId = 'lmg';
  tap('KeyB');
  assert.equal(wp.fireMode, 'semi', 'EVOLYS selector reaches SEMI');
  const total = (): number => wp.ammo.mag + wp.ammo.reserve;
  const ammo0 = total();
  frame({ down: ['Mouse0'] });
  assert.equal(shots.fired, 1, 'the press frame fires exactly one round');
  assert.equal(total(), ammo0 - 1, 'one round leaves the belt');
  for (let i = 0; i < 120; i++) frame({ down: ['Mouse0'] });
  assert.equal(shots.fired, 1, 'holding the trigger does not cycle the action in SEMI');
  assert.equal(total(), ammo0 - 1, 'held fire spends no extra ammunition');
  frame({ up: ['Mouse0'] });
  frame({ down: ['Mouse0'] });
  assert.equal(shots.fired, 2, 'a fresh press after release fires the next single shot');
  assert.equal(total(), ammo0 - 2);
  frame({ up: ['Mouse0'] });
  frame({ down: ['Mouse0'] });
  assert.equal(shots.fired, 2, 'a press inside the cadence window is refused');
  for (let i = 0; i < 6; i++) frame({});
  frame({ up: ['Mouse0'] });
  frame({ down: ['Mouse0'] });
  assert.equal(shots.fired, 3, 'the cadence window opens for a later press');
}

// AUTO keeps firing while held, and the ammo count follows the shot count.
{
  const { wp, frame, shots } = makeHarness();
  wp.activeId = 'lmg';
  assert.equal(wp.fireMode, 'auto');
  const total = (): number => wp.ammo.mag + wp.ammo.reserve;
  const ammo0 = total();
  for (let i = 0; i < 60; i++) frame({ down: ['Mouse0'] });
  // 700 rpm over one second: ~11 rounds, far above a single shot.
  assert(shots.fired >= 10 && shots.fired <= 13, `AUTO stays continuous (${shots.fired} rounds)`);
  assert.equal(total(), ammo0 - shots.fired, 'AUTO accounting matches the rounds fired');
}

// The M4A1 burst is unchanged: three rounds from one press, then silence.
{
  const { wp, frame, tap, shots } = makeHarness();
  tap('KeyB');
  assert.equal(wp.fireMode, 'burst');
  frame({ down: ['Mouse0'] });
  assert.equal(shots.fired, 1, 'the press frame starts the burst');
  for (let i = 0; i < 30; i++) frame({ down: ['Mouse0'] });
  assert.equal(shots.fired, 3, 'burst still delivers exactly three rounds');
  assert.equal(wp._burstLeft, 0, 'the burst queue is drained');
}

// Cycling away mid-burst drops the queue: no rounds fire after the change.
{
  const { wp, frame, tap, shots } = makeHarness();
  tap('KeyB'); // rifle: auto -> burst
  frame({ down: ['Mouse0'] });
  assert.equal(shots.fired, 1);
  assert.equal(wp._burstLeft, 2, 'two rounds are still queued');
  tap('KeyB'); // burst -> semi with the trigger down
  assert.equal(wp.fireMode, 'semi');
  assert.equal(wp._burstLeft, 0, 'the queued burst dies with the old mode');
  for (let i = 0; i < 60; i++) frame({ down: ['Mouse0'] });
  assert.equal(shots.fired, 1, 'no stale edge and no queued round fires in SEMI');
}

// AUTO -> SEMI while the trigger is down: the held pull cannot fire the new
// mode; release and press again for the deliberate single shot.
{
  const { wp, frame, shots } = makeHarness();
  wp.activeId = 'mcx'; // auto -> semi in one cycle
  frame({ down: ['Mouse0'] });
  for (let i = 0; i < 12; i++) frame({ down: ['Mouse0'] });
  const auto = shots.fired;
  assert(auto > 1, 'AUTO fired continuously before the switch');
  frame({ down: ['Mouse0', 'KeyB'], up: ['KeyB'] });
  assert.equal(wp.fireMode, 'semi');
  for (let i = 0; i < 60; i++) frame({ down: ['Mouse0'] });
  assert.equal(shots.fired, auto, 'the held pull does not fire the new SEMI mode');
  frame({ up: ['Mouse0'] });
  frame({ down: ['Mouse0'] });
  assert.equal(shots.fired, auto + 1, 'a fresh press fires the SEMI shot');
}

// SEMI -> AUTO while the trigger is down: the fresh AUTO mode waits for its
// own press instead of running away mid-pull.
{
  const { wp, frame, shots } = makeHarness();
  wp.activeId = 'lmg';
  frame({ down: ['KeyB'], up: ['KeyB'] }); // auto -> semi
  assert.equal(wp.fireMode, 'semi');
  frame({ down: ['Mouse0'] });
  assert.equal(shots.fired, 1);
  frame({ down: ['Mouse0', 'KeyB'], up: ['KeyB'] }); // semi -> auto
  assert.equal(wp.fireMode, 'auto');
  for (let i = 0; i < 60; i++) frame({ down: ['Mouse0'] });
  assert.equal(shots.fired, 1, 'the held pull does not run away in AUTO');
  frame({ up: ['Mouse0'] });
  for (let i = 0; i < 60; i++) frame({ down: ['Mouse0'] });
  assert(shots.fired > 5, 'release + press restores continuous AUTO fire');
}

// A queued burst dies at the holster: coming back to the same gun must not
// resume it. The per-weapon selection survives the swap.
{
  const { wp, frame, tap, shots } = makeHarness();
  tap('KeyB'); // rifle: auto -> burst
  frame({ down: ['Mouse0'] });
  assert.equal(shots.fired, 1);
  assert.equal(wp._burstLeft, 2);
  frame({ down: ['Tab'], up: ['Tab'] });
  assert.equal(wp._switchTo, 'pistol');
  assert.equal(wp._burstLeft, 0, 'switching drops the queued burst');
  wp._onClipEvent('end', 'holster');
  assert.equal(wp.activeId, 'pistol');
  frame({ down: ['Tab'], up: ['Tab'] });
  wp._onClipEvent('end', 'holster');
  assert.equal(wp.activeId, 'rifle');
  assert.equal(wp.fireMode, 'burst', 'the selection stays with the weapon');
  for (let i = 0; i < 40; i++) frame({ down: ['Mouse0'] });
  assert.equal(shots.fired, 1, 'the old burst does not resume on the way back up');
}

// A new run clears a dirty latch and the non-default selector on an inactive gun.
{
  const { wp, frame, tap, shots } = makeHarness();
  wp.activeId = 'lmg';
  tap('KeyB');
  assert.equal(wp.fireMode, 'semi');
  frame({ down: ['Mouse0'] });
  assert.equal(shots.fired, 1);
  tap('KeyB'); // semi -> auto, still held
  tap('KeyB'); // auto -> semi: leave the non-default selection dirty too
  assert.equal(wp._triggerLatched, true, 'restart precondition: held selector is latched');
  assert.equal(weaponState(wp, 'lmg').mode, 'semi');
  assert.equal(weaponState(wp, 'lmg').modeIndex, 1);
  wp.resetForNewGame();
  assert.equal(wp.activeId, 'rifle');
  assert.equal(wp.fireMode, 'auto', 'a new run starts on the authored first mode');
  assert.equal(wp._triggerLatched, false, 'restart clears the dirty latch');
  assert.equal(wp._burstLeft, 0);
  assert.equal(weaponState(wp, 'lmg').mode, 'auto', 'restart resets the inactive selector');
  assert.equal(weaponState(wp, 'lmg').modeIndex, 0, 'restart resets the inactive mode index');
  frame({ up: ['Mouse0'] });
  const before = shots.fired;
  frame({ down: ['Mouse0'] });
  assert.equal(shots.fired, before + 1, 'the reset loadout fires on its first fresh press');
}

// A partial burst independently dirties the restart queue (a selector clears it).
{
  const { wp, frame, tap, shots } = makeHarness();
  tap('KeyB');
  frame({ down: ['Mouse0'] });
  frame();
  assert(wp._burstLeft > 0, 'restart precondition: a partial burst is queued');
  wp.resetForNewGame();
  assert.equal(wp._burstLeft, 0, 'restart clears the dirty burst queue');
  frame({ up: ['Mouse0'] });
  tap('KeyB');
  const before = shots.fired;
  frame({ down: ['Mouse0'] });
  for (let i = 0; i < 30; i++) frame();
  assert.equal(shots.fired, before + 3, 'a fresh post-restart burst has exactly three rounds');
}

// Death clears a dirty mode-change latch without changing the selected mode.
{
  const { wp, frame, tap, shots } = makeHarness();
  wp.activeId = 'mcx';
  frame({ down: ['Mouse0'] });
  tap('KeyB'); // auto -> semi while held
  assert.equal(wp._triggerLatched, true, 'death precondition: held selector is latched');
  wp._onPlayerDeath();
  assert.equal(wp._triggerLatched, false, 'death clears the dirty latch');
  assert.equal(wp._burstLeft, 0);
  wp._setDeathDisabled(false);
  frame({ up: ['Mouse0'] });
  for (let i = 0; i < 10; i++) frame();
  const before = shots.fired;
  frame({ down: ['Mouse0'] });
  assert.equal(wp.fireMode, 'semi');
  assert.equal(shots.fired, before + 1, 'a fresh post-death SEMI press fires cleanly');
}

// Death independently clears a real partial M4A1 burst.
{
  const { wp, frame, tap, shots } = makeHarness();
  tap('KeyB');
  frame({ down: ['Mouse0'] });
  frame();
  assert(wp._burstLeft > 0, 'death precondition: a partial burst is queued');
  wp._onPlayerDeath();
  assert.equal(wp._burstLeft, 0, 'death clears the dirty burst queue');
  assert.equal(wp._triggerLatched, false);
  wp._setDeathDisabled(false);
  frame({ up: ['Mouse0'] });
  for (let i = 0; i < 10; i++) frame();
  const before = shots.fired;
  frame({ down: ['Mouse0'] });
  for (let i = 0; i < 30; i++) frame();
  assert.equal(wp.fireMode, 'burst');
  assert.equal(shots.fired, before + 3, 'a fresh post-death burst has exactly three rounds');
}

// A release hidden behind the pause/shop control gate cannot strand the next press.
{
  const { wp, player, frame, tap, shots } = makeHarness();
  wp.activeId = 'lmg';
  tap('KeyB');
  frame({ down: ['Mouse0'] });
  assert.equal(shots.fired, 1);
  tap('KeyB'); // semi -> auto while held
  assert.equal(wp._triggerLatched, true);
  player.controlEnabled = false;
  frame({ up: ['Mouse0'] });
  for (let i = 0; i < 60; i++) frame();
  // A paused frame breaks the pull even without observing its release.
  assert.equal(wp._triggerLatched, false, 'the paused frame breaks the pull');
  player.controlEnabled = true;
  frame({ down: ['Mouse0'] });
  assert.equal(shots.fired, 2, 'the first fresh post-pause press fires immediately');
  for (let i = 0; i < 60; i++) frame();
  assert(shots.fired > 8, 'holding after resume continues AUTO fire');
  frame({ up: ['Mouse0'] });
  tap('KeyB'); // auto -> semi with trigger up
  for (let i = 0; i < 10; i++) frame();
  const before = shots.fired;
  frame({ down: ['Mouse0'] });
  assert.equal(shots.fired, before + 1, 'a trigger-up mode change does not block the next press');
}

// A fresh press clears the latch even when reload refuses its shot.
{
  const { wp, player, frame, tap, shots } = makeHarness();
  wp.activeId = 'lmg';
  frame({ down: ['Mouse0'] });
  tap('KeyB'); // auto -> semi
  tap('KeyB'); // semi -> auto, still held
  assert.equal(wp.fireMode, 'auto');
  assert.equal(wp._triggerLatched, true);
  assert.equal(wp.reload(), true, 'reload accepts the spent round');
  player.controlEnabled = false;
  frame({ up: ['Mouse0'] });
  for (let i = 0; i < 10; i++) frame();
  assert.equal(wp._triggerLatched, false, 'the non-live reload frame breaks the pull');
  player.controlEnabled = true;
  const before = shots.fired;
  frame({ down: ['Mouse0'] });
  assert.equal(wp._triggerLatched, false, 'the reload-blocked fresh press clears the latch');
  assert.equal(shots.fired, before, 'reload still refuses the shot');
  wp._onClipEvent('magin', 'reloadTac');
  wp.viewmodel.stopClip(); // The stub has no mixer to finish the reload clip.
  frame();
  assert.equal(shots.fired, before + 1, 'held AUTO fires after reload without another press');
}

// Frozen/disabled handlers drop releases; the selector must survive the stuck hold.
for (const gate of ['frozen', 'disabled']) {
  const { wp, input, frame, tap, shots } = makeHarness();
  wp.activeId = 'mcx';
  tap('KeyB');
  frame({ down: ['Mouse0'] });
  assert.equal(shots.fired, 1);
  tap('KeyB'); // semi -> auto while held
  assert.equal(wp.fireMode, 'auto');
  assert.equal(wp._triggerLatched, true);
  if (gate === 'frozen') input.frozen = true;
  else input.enabled = false;
  input._onMouseUp(fixture<MouseEvent>({ button: 0 }));
  assert.equal(input.fire, true, `${gate} handler drops the physical release`);
  for (let i = 0; i < 30; i++) frame();
  assert.equal(wp._triggerLatched, false, `${gate} frames break the pull`);
  input.frozen = false;
  input.enabled = true;
  const before = shots.fired;
  for (let i = 0; i < 10; i++) frame({ down: ['Mouse0'] });
  assert(shots.fired > before, `${gate} resume continues AUTO despite the stuck hold`);
}

// A same-frame selector and fresh fire press uses the newly selected mode.
{
  const { wp, frame, tap, shots } = makeHarness();
  wp.activeId = 'lmg';
  tap('KeyB');
  assert.equal(wp.fireMode, 'semi');
  frame({ down: ['Mouse0', 'KeyB'], up: ['KeyB'] });
  assert.equal(wp.fireMode, 'auto', 'same-frame B advances to the next mode');
  assert.equal(shots.fired, 1, 'same-frame B and fresh fire press fires exactly one round');
}

// A completed burst's authored delay survives a full selector round trip.
{
  const { wp, frame, tap, shots } = makeHarness();
  tap('KeyB');
  frame({ down: ['Mouse0'] });
  for (let i = 0; i < 8; i++) frame();
  assert.equal(shots.fired, 3);
  assert.equal(wp._burstLeft, 0);
  assert(wp._burstCooldown > 0, 'completed burst establishes an inter-burst delay');
  tap('KeyB'); // burst -> semi
  tap('KeyB'); // semi -> auto
  tap('KeyB'); // auto -> burst
  assert(wp._burstCooldown > 0, 'selector preserves the completed-burst delay');
  frame({ up: ['Mouse0'] });
  frame({ down: ['Mouse0'] });
  assert.equal(shots.fired, 3, 'a press within the preserved burst delay is refused');
  frame({ up: ['Mouse0'] });
  for (let i = 0; i < 12; i++) frame();
  frame({ down: ['Mouse0'] });
  assert.equal(shots.fired, 4, 'a fresh press after the delay starts a new burst');
  assert.equal(wp._burstLeft, 2);
}

// Radio owns 1/2/3 only while open, with request priority 1 > 2 > 3.
{
  const { wp, tap, prompts } = makeHarness();
  let strikes = 0;
  wp.radioSys = fixture<RadioSystem>({
    callStrike(): boolean {
      strikes++;
      return true;
    },
  });
  tap('KeyX', 'Digit1');
  assert(wp.radioEquipped && strikes === 0, 'opening frame does not immediately select a request');
  tap('Digit2');
  assert.equal(wp._switchTo, null, 'request 2 never selects the secondary');
  assert.equal(prompts[prompts.length - 1].key, bindingLabel('slot2'));
  tap('Digit3');
  assert.equal(prompts[prompts.length - 1].key, bindingLabel('slot3'));
  tap('Digit3', 'Digit2', 'Digit1');
  assert.equal(strikes, 1);
  assert.equal(wp.carpetBombs, 0);
  assert(!wp.radioEquipped);
  tap('KeyX');
  tap('Digit1');
  assert(wp.radioEquipped);
  assert.equal(prompts[prompts.length - 1].key, bindingLabel('slot1'));
  tap('Tab', 'Digit2');
  assert(
    !wp.radioEquipped && wp._switchTo === 'pistol',
    'cycle stows radio before its request phase'
  );
}
{
  const { wp, tap } = makeHarness();
  tap('KeyX', 'Digit2');
  assert.equal(wp._switchTo, 'pistol', 'normal slot selection precedes radio opening');
  assert(!wp.radioEquipped, 'a same-frame switch blocks opening the radio');
}

// G replaces radio; X cannot replace grenade; simultaneous G/X favors grenade.
{
  const { wp, tap } = makeHarness();
  tap('KeyX');
  tap('KeyG');
  assert(wp.grenadeEquipped && !wp.radioEquipped);
  tap('KeyX');
  assert(wp.grenadeEquipped && !wp.radioEquipped);
  tap('KeyG');
  tap('KeyG', 'KeyX');
  assert(wp.grenadeEquipped && !wp.radioEquipped);
}

// Cooking retains its initiating action. Releasing the other action is inert.
for (const [code, other, action, type] of [
  ['Mouse0', 'Mouse2', 'fire', 'long'],
  ['Mouse2', 'Mouse0', 'ads', 'short'],
]) {
  const { wp, frame, tap, bodies, prompts } = makeHarness();
  tap('KeyG');
  assert.equal(prompts[prompts.length - 1].key, bindingLabel('fire'));
  assert.equal(
    prompts[prompts.length - 1].sub,
    `${bindingLabel('ads')} SHORT THROW · ${bindingLabel('grenade')} STOWS`
  );
  frame({ down: [code] });
  assert(wp.cooking);
  assert.equal(wp._cookAction, action);
  assert.equal(wp._throwType, type);
  frame({ down: [other] });
  frame({ up: [other] });
  assert(wp.cooking && wp._cookTime > 0, 'non-initiating release does not commit');
  frame({ up: [code] });
  assert(!wp.cooking && wp._throwing);
  assert.equal(wp._cookAction, null);
  assert(wp._throwFuse > 0 && wp._throwFuse < GRENADE_FUSE);
  tap('Mouse0', 'Mouse2', 'Digit2', 'Tab', 'KeyG', 'KeyX');
  assert(wp._throwing && !wp.cooking && wp.grenadeEquipped && !wp.radioEquipped);
  assert.equal(wp._switchTo, null, 'committed throw blocks switching');
  assert.equal(wp.grenades, 1, 'follow-through actions do not spend another grenade');
  wp._onClipEvent('grenade:release', 'grenadeThrow');
  wp._onClipEvent('grenade:release', 'grenadeThrow');
  assert.equal(bodies.length, 1, 'release beat spawns exactly once');
  wp._onClipEvent('grenade:done', 'grenadeThrow');
  assert(!wp.grenadeEquipped && !wp._throwing && wp.canFire());
}
{
  const { wp, tap, frame } = makeHarness();
  tap('KeyG');
  tap('Mouse0', 'Mouse2');
  assert.equal(wp._cookAction, 'fire', 'fire wins simultaneous cook edges');
  frame();
  assert(wp._throwing, 'same-frame tap commits next update via initiating action no longer held');
}
{
  const { wp, tap, frame } = makeHarness();
  tap('KeyG');
  frame({ down: ['Mouse2'] });
  // Inject an action release while its held union remains true: the approved
  // actionReleased contract must commit, not rely solely on the held query.
  const released = wp.ctx.input.actionReleased.bind(wp.ctx.input);
  wp.ctx.input.actionReleased = (action): boolean => action === 'ads' || released(action);
  frame();
  assert(wp.ctx.input.action('ads') && wp._throwing && !wp.cooking);
}

// A release during a frozen frame cannot advance the fuse/throw; resume still
// observes the initiating action no longer held after the release edge expires.
{
  const { wp, input, tap, frame } = makeHarness();
  tap('KeyG');
  frame({ down: ['Mouse0'] });
  const cookTime = wp._cookTime;
  input.frozen = true;
  frame({ up: ['Mouse0'], dt: 1 });
  assert(wp.cooking && !wp._throwing && wp._cookTime === cookTime);
  input.frozen = false;
  frame();
  assert(wp._throwing && !wp.cooking);
}

// Weapon-side healing interruptions remain synchronous and retain their reasons.
for (const [code, reason] of [
  ['KeyI', 'inspect'],
  ['KeyR', 'reload'],
  ['Digit2', 'switch'],
  ['Tab', 'switch'],
  ['KeyG', 'grenade'],
  ['KeyX', 'radio'],
  ['Mouse0', 'fire'],
  ['Mouse2', 'ads'],
]) {
  const { wp, frame, cancellations } = makeHarness();
  assert(wp.beginHeal());
  frame({ down: [code] });
  assert.deepEqual(cancellations, [reason]);
  assert(!wp.healing, `${reason} unwinds the bandage hand`);
}
{
  const { wp, frame, cancellations } = makeHarness();
  assert(wp.beginHeal());
  frame({ wheel: 1 });
  assert.deepEqual(cancellations, ['switch'], 'wheel remains a heal interruption');
}
for (const code of ['Digit1', 'Digit3', 'KeyB']) {
  const { wp, tap, cancellations } = makeHarness();
  assert(wp.beginHeal());
  tap(code);
  assert(
    wp.healing && cancellations.length === 0,
    'same-slot/unused-slot/fire-mode do not interrupt healing'
  );
}
for (const blocked of ['disabled', 'frozen', 'dead', 'controls', 'input']) {
  const { wp, input, player, tap } = makeHarness();
  if (blocked === 'disabled') wp.disabled = true;
  if (blocked === 'frozen') input.frozen = true;
  if (blocked === 'dead') player.health.dead = true;
  if (blocked === 'controls') player.controlEnabled = false;
  if (blocked === 'input') input.enabled = false;
  const mode = wp.fireMode;
  tap('KeyB', 'KeyI', 'Digit2', 'Tab', 'KeyG', 'KeyX');
  assert.equal(wp.fireMode, mode);
  assert(!wp.inspecting && !wp.switching && !wp.grenadeEquipped && !wp.radioEquipped);
}

// Ammo prompt and hold use the same canonical T binding; F does not resupply.
{
  const { wp, frame, prompts } = makeHarness();
  wp.state.reserve = 0;
  const pickups = new AmmoPickups(wp);
  wp.pickups = pickups;
  try {
    pickups.spawn(new THREE.Vector3());
    frame({ down: ['KeyF'], dt: 0.5 });
    assert.equal(wp.state.reserve, 0);
    assert.equal(prompts[prompts.length - 1].key, bindingLabel('use'));
    assert.equal(prompts[prompts.length - 1].owner, 'ammo');
    frame({ up: ['KeyF'], down: ['KeyT'], dt: 0.5 });
    assert(wp.state.reserve > 0 && pickups.items.length === 0);
  } finally {
    pickups.dispose();
  }
}

/* ======================================================================== */
/*  frame-rate independent cadence (issue 605)                              */
/* ======================================================================== */

// Real update() + lateUpdate(): record accepted rounds, fire events and seeds.
interface CadenceHarness extends WeaponHarness {
  events: { fire: number; shell: number; seeds: number[] };
  times: number[];
  step(this: void, options?: FrameOptions): number;
}
function cadenceHarness(id: WeaponId): CadenceHarness {
  const h = makeHarness();
  const { wp, frame, shots } = h;
  wp.activeId = id;
  wp.state.mag = 1e6;
  const events = { fire: 0, shell: 0, seeds: [] as number[] };
  wp.ctx.events.on('weapon:fire', (e): void => {
    events.fire++;
    events.seeds.push(e.seed);
  });
  wp.ctx.events.on('weapon:shell', (): void => {
    events.shell++;
  });
  wp.viewmodel.update = (): void => {};
  wp.viewmodel.boreDir = (out): THREE.Vector3 => out;
  wp.viewmodel.ejectWorld = (out): THREE.Vector3 => out;
  wp.viewmodel.ejectVelocity = (out): THREE.Vector3 => out;
  const pellets = Math.max(1, wp.state.def.pellets ?? 1);
  const times: number[] = [];
  let t = 0;
  const step = (opts: FrameOptions = {}): number => {
    const dt = opts.dt ?? 1 / 60;
    t += dt;
    const before = shots.fired;
    frame({ ...opts, dt });
    wp.lateUpdate(dt, wp.ctx);
    const n = (shots.fired - before) / pellets;
    for (let i = 0; i < n; i++) times.push(t);
    assert(wp._fireTimer >= 0, 'no negative cooldown survives a frame');
    return n;
  };
  return { ...h, events, times, step };
}

// Held AUTO delivers the authored rpm at any frame rate, one round's accounting each.
for (const id of ['rifle', 'smg', 'mcx', 'lmg'] as const) {
  const counts: number[] = [];
  for (const [label, nextDt] of FRAME_SOURCES) {
    const { wp, step, times, events } = cadenceHarness(id);
    const interval = 60 / wp.state.def.rpm;
    const total = (): number => wp.ammo.mag + wp.ammo.reserve;
    const ammo0 = total();
    step({ down: ['Mouse0'], dt: nextDt() });
    while (times.length < 2 || times[times.length - 1] - times[0] < 10) step({ dt: nextDt() });
    const expected = 1 + (times[times.length - 1] - times[0]) / interval;
    assert(
      Math.abs(times.length - expected) <= 1,
      `${id} @ ${label} FPS: ${times.length} rounds, expected ~${expected.toFixed(1)}`
    );
    // Carried frame remainders never let a round outrun the authored cadence.
    for (let i = 1; i < times.length; i++) {
      assert(times[i] - times[0] >= i * interval - 1e-9, `${id} @ ${label}: round ${i} early`);
    }
    assert.equal(ammo0 - total(), times.length, `${id} @ ${label}: one cartridge per round`);
    assert.equal(events.fire, times.length, `${id} @ ${label}: one fire event per round`);
    counts.push(times.length);
  }
  assert(Math.max(...counts) - Math.min(...counts) <= 1, `${id} cadence varies with FPS`);
}

// BURST keeps the burst rpm inside a burst at any frame rate; one burst per press.
for (const [label, nextDt] of FRAME_SOURCES) {
  const { wp, step, times, tap } = cadenceHarness('rifle');
  tap('KeyB');
  assert.equal(wp.fireMode, 'burst');
  const { burstRpm, burstCount: count } = wp.state.def;
  assert(burstRpm !== undefined && count !== undefined);
  const interval = 60 / burstRpm;
  for (let burst = 0; burst < 20; burst++) {
    const start = times.length;
    step({ down: ['Mouse0'], dt: nextDt() });
    let maxDt = 0;
    while (times.length < start + count) step({ dt: (maxDt = Math.max(maxDt, nextDt())) });
    const span = times[times.length - 1] - times[start];
    assert(span >= (count - 1) * interval - 1e-9, `burst @ ${label}: rounds came early`);
    assert(span < (count - 1) * interval + maxDt + 1e-9, `burst @ ${label}: rounds came late`);
    step({ up: ['Mouse0'], dt: nextDt() });
    for (let i = 0; i < 30; i++) step();
    assert.equal(times.length, start + count, `burst @ ${label}: exactly one burst per press`);
  }
}

// SEMI fires one round per press and never inside the authored interval, even
// with a press every other frame at high or jittered frame rates.
for (const [label, nextDt] of FRAME_SOURCES) {
  const { wp, step, times } = cadenceHarness('pistol');
  const interval = 60 / wp.state.def.rpm;
  for (let i = 0; i < 400; i++) {
    assert(step({ down: ['Mouse0'], dt: nextDt() }) <= 1, `semi @ ${label}: one round per press`);
    assert.equal(step({ up: ['Mouse0'], dt: nextDt() }), 0, `semi @ ${label}: release fires`);
  }
  assert(times.length > 1, `semi @ ${label}: presses fire`);
  for (let i = 1; i < times.length; i++) {
    assert(times[i] - times[i - 1] >= interval - 1e-9, `semi @ ${label}: early round`);
  }
}

// An interrupted AUTO pull never releases rounds owed for the blocked time:
// the resumed frame fires at most once, then the authored interval follows.
const INTERRUPTIONS: Array<
  [string, { dt?: number; on?(h: CadenceHarness): void; off?(h: CadenceHarness): void }]
> = [
  ['pause', { dt: 0 }],
  [
    'controls',
    {
      on: (h): void => {
        h.player.controlEnabled = false;
      },
      off: (h): void => {
        h.player.controlEnabled = true;
      },
    },
  ],
  [
    'input frozen',
    {
      on: (h): void => {
        h.input.frozen = true;
      },
      off: (h): void => {
        h.input.frozen = false;
      },
    },
  ],
  [
    'reload',
    {
      on: (h): void => {
        h.wp.state.mag = 10;
        assert(h.wp.reload());
      },
      off: (h): void => h.wp.viewmodel.stopClip(),
    },
  ],
  ['radio', { on: (h): void => h.tap('KeyX'), off: (h): void => h.tap('KeyX') }],
  [
    'switch',
    {
      on: (h): void => h.tap('Digit2'),
      off: (h): void => {
        h.wp._onClipEvent('end', 'holster');
        h.tap('Digit1');
        h.wp._onClipEvent('end', 'holster');
      },
    },
  ],
  [
    'death/restart',
    {
      on: (h): void => h.wp._setDeathDisabled(true),
      off: (h): void => {
        h.wp.resetForNewGame();
        h.wp._setDeathDisabled(false);
        h.wp.state.mag = 1e6;
      },
    },
  ],
];
for (const [name, gate] of INTERRUPTIONS) {
  const h = cadenceHarness('rifle');
  const { wp, step, times } = h;
  const interval = 60 / wp.state.def.rpm;
  step({ down: ['Mouse0'] });
  for (let i = 0; i < 20; i++) step();
  const before = times.length;
  gate.on?.(h);
  for (let i = 0; i < 60; i++) step({ dt: gate.dt ?? 1 / 60 });
  assert.equal(times.length, before, `${name}: no rounds while interrupted`);
  gate.off?.(h);
  assert.equal(wp.activeId, 'rifle', `${name}: resumes on the rifle`);
  for (let i = 0; i < 30 && times.length === before; i++) step();
  assert(times.length - before <= 1, `${name}: the resumed frame fires at most one round`);
  const resumed = times.length;
  assert(resumed > before, `${name}: the held pull resumes`);
  while (times.length === resumed) step();
  assert(
    times[resumed] - times[resumed - 1] >= interval - 1e-9,
    `${name}: no banked round follows the resume`
  );
}

// Overload: one 1 s hitch fires at most MAX_SHOTS_PER_FRAME rounds with full
// accounting and a seed each; the remainder is dropped, not banked.
{
  const { wp, step, times, events } = cadenceHarness('rifle');
  const total = (): number => wp.ammo.mag + wp.ammo.reserve;
  const ammo0 = total();
  step({ down: ['Mouse0'] });
  assert.equal(step({ dt: 1 }), MAX_SHOTS_PER_FRAME, 'a hitch catches up to the bound');
  assert.equal(wp._fireTimer, 0, 'rounds beyond the bound are dropped');
  assert.equal(step(), 1, 'the next frame resumes with one due round');
  assert.equal(step(), 0, 'and does not drain a backlog');
  step({ up: ['Mouse0'] });
  assert.equal(ammo0 - total(), times.length);
  assert.equal(events.fire, times.length);
  assert.equal(new Set(events.seeds).size, events.seeds.length, 'each round reports its own seed');
  for (let i = 0; i < 10; i++) step();
  assert.equal(events.shell, times.length, 'one ejected case per round');
}

console.log(
  'Weapon input contexts passed: canonical dispatch, ordering, accessories, cooking, committed throw, heal interruptions and ammo labels'
);

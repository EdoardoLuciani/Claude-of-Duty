// Weapon-owned canonical input contexts; real Input snapshots, no DOM/GPU.
import assert from 'node:assert/strict';

import * as THREE from 'three';

import { bindingLabel } from '../../src/core/bindings.ts';
import { GRENADE_FUSE } from '../../src/core/grenades.ts';
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
import { BASE_ATTACHMENTS } from '../../src/weapons/attachment-rules.ts';
import m590Manifest from '../../src/weapons/authored/m590/manifest.json' with { type: 'json' };
import { ProjectileSim } from '../../src/weapons/ballistics.ts';
import { buildManifestClips, Clip } from '../../src/weapons/clips.ts';
import { WEAPON_IDS } from '../../src/weapons/defs.ts';
import type { WeaponId } from '../../src/weapons/defs.ts';
import { HandEquipment } from '../../src/weapons/hand-equipment.ts';
import { MAX_SHOTS_PER_FRAME } from '../../src/weapons/index.ts';
import type { WeaponEntry } from '../../src/weapons/runtime-types.ts';
import { Viewmodel } from '../../src/weapons/viewmodel.ts';
import { ammoPickupFixture } from '../lib/ammo-pickup-fixture.ts';
import { ArmedWeaponSystem, weaponState } from '../lib/ballistics-fixture.ts';
import { createTestContext } from '../lib/context.ts';
import { fixture } from '../lib/fixture.ts';
import { FRAME_SOURCES } from '../lib/frame-sources.ts';
import { mountableWeapon, opticAsset, rigidAsset } from '../lib/weapon-attachment-fixture.ts';

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
  input.pointerLocked = true;
  input._pollGamepad = (): void => {};
  for (const method of ['pressed', 'held', 'released'] as const) {
    input[method] = (): never => {
      throw new Error(`weapons must not query raw ${method}`);
    };
  }
  const wp = new ArmedWeaponSystem();
  wp.createGrenade = (): THREE.Mesh => new THREE.Mesh();
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
      this.clip = new Clip(name, 1, []);
      clips.push(name);
      return 1;
    },
    holdGrenade(): void {},
    cookGrenade(type): void {
      clips.push(`cook:${type}`);
    },
    throwGrenade(type): void {
      clips.push(`throw:${type}`);
    },
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
    boreDir(out): THREE.Vector3 {
      return out.set(0, 0, -1);
    },
  });
  for (const id of WEAPON_IDS) wp.states.set(id, wp._makeState(id));
  const frame = ({ down = [], up = [], wheel = 0, dt = 1 / 60 }: FrameOptions = {}): void => {
    for (const code of down) {
      if (code.startsWith('Mouse'))
        input._onMouseDown(
          fixture<MouseEvent>({ target: input.canvas, button: Number(code.slice(5)) })
        );
      else
        input._onKeyDown(
          fixture<KeyboardEvent>({ code, repeat: false, preventDefault(): void {} })
        );
    }
    for (const code of up) {
      if (code.startsWith('Mouse'))
        input._onMouseUp(fixture<MouseEvent>({ button: Number(code.slice(5)) }));
      else
        input._onKeyUp(fixture<KeyboardEvent>({ code, repeat: false, preventDefault(): void {} }));
    }
    input._pendingWheel = wheel;
    input.beginFrame();
    wp.update(dt, wp.ctx);
    input.endFrame();
  };
  const tap = (...codes: string[]): void => frame({ down: codes, up: codes });
  return { wp, input, frame, tap, clips, prompts, cancellations, bodies, player, shots };
}

// Retain the real loadout boundary without separate per-weapon fake rigs.
for (const [primary, first, second] of [
  [true, 'lmg', 'sniper'],
  [false, 'smg', 'shotgun'],
] as const) {
  const { wp } = makeHarness();
  assert.deepEqual(wp.weaponIds, ['rifle', 'pistol']);
  assert(wp.applyBuild(first, BASE_ATTACHMENTS), 'a new gun replaces its own slot');
  assert.deepEqual(wp.weaponIds, primary ? [first, 'pistol'] : ['rifle', first]);
  wp.state.mag = 1;
  assert(wp.reload());
  assert(wp.applyBuild(second, BASE_ATTACHMENTS) && !wp.owns(first));
  assert.deepEqual(wp.weaponIds, primary ? [second, 'pistol'] : ['rifle', second]);
  assert(!wp.reloading && wp.tryFire(), 'mid-reload purchase is immediately usable');
  weaponState(wp, first).spareMagazines.length = 0;
  wp.state.spareMagazines.splice(0, wp.state.spareMagazines.length, 1);
  wp.refillAmmo();
  assert.equal(wp.state.spareMagazines.length, 4);
  assert.equal(weaponState(wp, first).reserve, 0, 'refill ignores unowned weapons');
  assert.equal(wp.ammoFraction(), 1);
  wp.resetForNewGame();
  assert.deepEqual(wp.weaponIds, ['rifle', 'pistol']);
  assert.equal(wp.activeId, 'rifle');
}
// Persistent magazines transfer once at the seating beat and stay with the M4.
{
  const { wp } = makeHarness();
  const capacity = wp.current.magSize;
  const fullStock = [capacity, capacity];
  assert.deepEqual(
    wp.getHudState().spareMagazines,
    fullStock,
    'the M4 starts with two full spares'
  );
  wp.state.spareMagazines.splice(0, 2, capacity, 12);
  wp.state.mag = 7;
  const total = wp.ammo.total;
  assert(wp.reload());
  wp._onClipEvent('magout', 'reloadTac');
  assert(wp.setWeaponImmediate('pistol'));
  const sidearmSize = wp.current.magSize;
  assert.deepEqual(wp.getHudState().spareMagazines, [sidearmSize, sidearmSize]);
  assert(wp.setWeaponImmediate('rifle'));
  assert.equal(wp.ammo.total, total, 'swap before seating leaves both magazines unchanged');
  assert.equal(wp.ammo.inMag, 7);

  assert(wp.reload());
  wp._onClipEvent('magin', 'reloadTac');
  wp.viewmodel.stopClip();
  assert.equal(wp.ammo.mag, capacity + 1, 'tactical reload keeps its chambered round');
  assert.equal(wp.ammo.total, total, 'partial mag is retained, not duplicated or lost');
  assert.deepEqual(wp.getHudState().spareMagazines, [12, 7], 'HUD lists spares fullest first');
  assert(wp.reload(), 'a shorter spare is still accepted');
  wp._onClipEvent('magin', 'reloadTac');
  wp.viewmodel.stopClip();
  assert.equal(wp.ammo.inMag, 12);
  assert.equal(wp.ammo.total, total, 'swapping down preserves the previous magazine');

  wp.state.mag = 0;
  wp.state.chambered = false;
  assert(wp.reload());
  assert.equal(wp.viewmodel.clipName, 'reloadEmpty');
  wp._onClipEvent('magin', 'reloadEmpty');
  wp.viewmodel.stopClip();
  assert.equal(wp.ammo.mag, capacity, 'empty reload chambers one of the selected mag’s rounds');
  assert.equal(wp.ammo.total, capacity + 7);
  assert.deepEqual(wp.getHudState().spareMagazines, [7], 'the retained partial can be used again');
  for (let i = 0; i < 3; i++) assert.equal(wp.collectAmmoBox(), capacity);
  assert.deepEqual(wp.getHudState().spareMagazines, [capacity, capacity, capacity, 7]);
  assert.equal(wp.collectAmmoBox(), capacity - 7, 'full inventory replaces its emptiest spare');
  assert.deepEqual(wp.getHudState().spareMagazines, Array<number>(4).fill(capacity));
  assert.equal(wp.collectAmmoBox(), 0, 'no box is used if all four spares are full');
  wp.refillAmmo();
  assert.equal(wp.ammoFraction(), 1, 'market fills the reserve of both owned weapons');
  assert.equal(wp.ammo.mag, capacity, 'resupply does not change the loaded magazine');
  wp.resetForNewGame();
  assert.deepEqual(wp.getHudState().spareMagazines, fullStock, 'a new run starts below the cap');
}
// Mounted laser switches belong to the gun, not the flashlight or active slot.
{
  const { wp, input, tap, frame, player } = makeHarness();
  Object.assign(wp, { _attachments: { rmr: opticAsset(), laser: rigidAsset('SOCKET_laser') } });
  Object.assign(wp.viewmodel, {
    reticle: new THREE.Object3D(),
    scopeOverlay: new THREE.Object3D(),
  });
  const rifle = wp.viewmodel.weapons.get('rifle');
  assert(rifle);
  Object.assign(rifle, { def: weaponState(wp, 'rifle').def, ...mountableWeapon('rifle') });
  const irons = rifle.model.scene.getObjectByName('IRON_sights');
  assert(irons);
  const config = { ...BASE_ATTACHMENTS, rail: 'laser' } as const;
  assert.equal(wp.state.laserEnabled, false);
  tap('KeyL');
  assert.equal(wp.state.laserEnabled, false, 'L cannot enable a missing module');
  assert(wp.setAttachments('rifle', config));
  assert(wp.state.laserEnabled, 'newly mounted module starts on');
  tap('KeyF');
  assert(wp.state.laserEnabled, 'F never toggles the laser');
  frame({ down: ['KeyL'] });
  assert(!wp.state.laserEnabled, 'L toggles independently of F');
  frame();
  assert(!wp.state.laserEnabled, 'holding L does not repeat');
  frame({ up: ['KeyL'] });
  wp.setWeaponImmediate('pistol');
  tap('KeyL');
  wp.setWeaponImmediate('rifle');
  assert(!wp.state.laserEnabled, 'switching away and back preserves the per-gun switch');
  assert(wp.setAttachments('rifle', { ...config, optic: 'rmr' }));
  assert(!wp.state.laserEnabled, 'optic changes preserve an off switch');
  for (const gate of ['frozen', 'disabled', 'dead', 'control']) {
    input.frozen = gate === 'frozen';
    input.enabled = gate !== 'disabled';
    player.health.dead = gate === 'dead';
    player.controlEnabled = gate !== 'control';
    tap('KeyL');
    assert(!wp.state.laserEnabled, `${gate} ignores L`);
  }
  player.controlEnabled = input.enabled = true;
  input.frozen = player.health.dead = false;
  for (const equip of ['KeyG', 'KeyX']) {
    tap(equip);
    assert(wp.grenadeEquipped || wp.radioEquipped);
    tap('KeyL');
    assert(!wp.state.laserEnabled, 'accessories block the laser switch');
    tap('Digit1');
  }
  assert(wp.beginHeal());
  tap('KeyL');
  assert(!wp.state.laserEnabled, 'healing blocks the laser switch');
  wp.endHeal();
  tap('KeyL');
  assert(wp.state.laserEnabled, 'a fresh live press toggles on');
  wp._onPlayerDeath();
  assert(!wp.state.laserEnabled, 'death switches off');
  wp.disabled = false;
  assert(wp.setAttachments('rifle', BASE_ATTACHMENTS));
  assert(!wp.state.laserEnabled, 'removal switches off');
  assert(wp.setAttachments('rifle', config) && wp.state.laserEnabled, 'remount starts on');
  for (const drop of [
    (): boolean => wp.applyBuild('lmg', BASE_ATTACHMENTS),
    (): void => wp.resetForNewGame(),
  ]) {
    wp.resetForNewGame();
    assert(wp.setAttachments('rifle', { ...config, optic: 'rmr' }));
    assert(wp.state.laserEnabled);
    assert(!irons.visible, 'a mounted optic replaces the removable irons');
    assert(wp.state.def.adsFovScale !== undefined, 'the stored build drives ADS magnification');
    drop();
    assert.equal(weaponState(wp, 'rifle').attachments, BASE_ATTACHMENTS);
    assert.equal(weaponState(wp, 'rifle').def.adsFovScale, undefined, 'drop/restart unzooms');
    assert(!weaponState(wp, 'rifle').laserEnabled, 'drop/restart clears the switch');
    assert(irons.visible, 'the mounted build is reset, not only the stored config');
  }
}
{
  const { wp, shots } = makeHarness();
  assert(wp.applyBuild('shotgun', BASE_ATTACHMENTS) && wp.tryFire());
  assert.equal(shots.fired, 8, 'one shotgun shell spawns eight pellets');
  assert.equal(wp._pendingShots, 1, 'pellets still produce one accepted-shot event');
}
{
  const { wp, tap } = makeHarness();
  assert(wp.applyBuild('sniper', BASE_ATTACHMENTS) && wp.tryFire());
  assert(
    !wp.state.chambered && !wp.tryFire() && !wp.setWeapon('pistol'),
    'bolt cycle blocks fire/switch'
  );
  tap('KeyX');
  tap('KeyG');
  tap('Digit1');
  assert(
    wp.cycling && !wp.radioEquipped && !wp.grenadeEquipped,
    'accessories preserve the bolt cycle'
  );
  wp.viewmodel.stopClip();
  wp._fireTimer = 0;
  assert(wp.reload(), 'interrupted bolt cycle can reload a full box with empty chamber');
  assert.equal(wp.viewmodel.clipName, 'reloadEmpty');
  wp._completeReload(true);
  assert(wp.state.chambered && wp.state.mag === wp.current.magSize - 1);
}
{
  const { wp } = makeHarness();
  assert(wp.applyBuild('sniper', BASE_ATTACHMENTS) && wp.tryFire() && wp.cycling);
  assert(wp.applyBuild('pistol', BASE_ATTACHMENTS) && wp.setWeaponImmediate('sniper'));
  assert(wp.state.chambered, 'a market swap finishes the interrupted bolt cycle');
}

// A market swap selects the new gun without drawing it over a cooking grenade.
{
  const { wp, tap, frame } = makeHarness();
  const vm = (wp.viewmodel = new Viewmodel(wp.ctx, wp.mats));
  for (const id of ['rifle', 'smg'] as const)
    vm.weapons.set(
      id,
      fixture<WeaponEntry>({
        id,
        group: new THREE.Group(),
        parts: {},
        rhandPose: 'wrap',
        lhandPose: 'wrap',
        animation: fixture<WeaponEntry['animation']>({ reset(): void {} }),
      })
    );
  vm.setActive('rifle');
  tap('KeyG');
  frame({ down: ['Mouse0'] });
  assert(wp.applyBuild('smg', BASE_ATTACHMENTS));
  assert.equal(vm.active?.id, 'smg');
  assert(wp.cooking && vm.grenade.visible && !vm.active.group.visible, 'cook keeps the gun hidden');
  frame({ dt: GRENADE_FUSE });
  assert(
    !wp.cooking && !vm.grenade.visible && vm.active.group.visible,
    'new gun returns after the cook'
  );
}

// A tube reload restarts the same authored Clip from its end callback.
{
  const { wp } = makeHarness();
  assert(wp.applyBuild('shotgun', BASE_ATTACHMENTS));
  const vm = new Viewmodel(wp.ctx, wp.mats);
  vm._solveHands = (): void => {};
  vm.active = fixture<WeaponEntry>({
    def: wp.current,
    group: new THREE.Group(),
    clips: buildManifestClips({ reloadTac: 'Reload_Tactical' }, m590Manifest.clips),
    sight: new THREE.Vector3(),
    mountedOptic: null,
    animation: fixture<WeaponEntry['animation']>({ reset(): void {}, update(): void {} }),
  });
  wp.viewmodel = vm;
  vm.onClipEvent = (name, clip): void => wp._onClipEvent(name, clip);
  wp.state.mag = 0;
  wp.state.spareMagazines.splice(0, 2, 2);
  const phases: string[] = [];
  wp.ctx.events.on('weapon:reload', ({ phase }): void => {
    phases.push(phase);
  });
  assert(wp.reload());
  for (let i = 0; i < 120 && wp.reloading; i++) vm.update(1 / 60, wp._state);
  assert(!wp.reloading, 'the repeated clip completes');
  assert.deepEqual(phases, ['start', 'shellin', 'end', 'start', 'shellin', 'end']);
  assert.equal(wp.ammo.mag, 3, 'both shells transfer alongside the chambered round');
  assert.equal(wp.state.reserve, 0);
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

// Same-slot selection stows a grenade and redraws.
{
  const { wp, tap } = makeHarness();
  tap('KeyG');
  tap('KeyG');
  assert(wp.grenadeEquipped, 'G again is a no-op, not a stow');
  tap('Digit1');
  assert(!wp.grenadeEquipped, 'same-slot selection stows the grenade');
  assert.equal(wp._switchTo, null);
  tap('KeyG');
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

// Radio: arrows move the LCD cursor and Enter sends; weapon keys keep selecting weapons.
{
  const { wp, tap, prompts } = makeHarness();
  let strikes = 0;
  wp.radioSys = fixture<RadioSystem>({
    callStrike(): boolean {
      strikes++;
      return true;
    },
  });
  tap('KeyX', 'Enter');
  assert(wp.radioEquipped && strikes === 0, 'opening frame does not immediately send a request');
  tap('KeyX');
  assert(wp.radioEquipped, 'X again keeps the radio out');
  tap('ArrowUp');
  assert.equal(wp._radioCursor, 0, 'the cursor stops at the first request');
  tap('ArrowDown');
  tap('Enter');
  assert.equal(prompts[prompts.length - 1].key, bindingLabel('radioSend'));
  assert.equal(prompts[prompts.length - 1].text, 'TOP-SECRET');
  tap('ArrowDown');
  tap('ArrowDown');
  assert.equal(wp._radioCursor, 2, 'the cursor stops at the last request');
  tap('ArrowUp');
  tap('ArrowUp');
  tap('KeyX', 'Enter');
  assert.equal(strikes, 1);
  assert.equal(wp.carpetBombs, 0);
  assert(!wp.radioEquipped);
  tap('KeyX');
  assert.equal(wp._radioCursor, 0, 'reopening starts on the carpet bomb');
  tap('Enter');
  assert(wp.radioEquipped);
  assert.equal(prompts[prompts.length - 1].text, 'NO CHARGES');
  tap('Digit1');
  assert(!wp.radioEquipped && wp._switchTo === null, 'the active slot stows the radio');
  tap('KeyX');
  tap('Digit2');
  assert(!wp.radioEquipped && wp._switchTo === 'pistol', 'the other slot stows and switches');
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

// The cook/throw rules do not need a viewmodel or a world.
{
  const hands = new HandEquipment();
  assert(hands.hold('grenade'));
  assert(!hands.hold('radio'), 'a held grenade cannot share the hand');
  assert(hands.startCook('fire'));
  assert(!hands.stow('grenade'), 'a live grenade cannot be stowed');
  assert.equal(hands.updateCook(0.5, GRENADE_FUSE, false), null);
  assert.equal(hands.dropCooked(GRENADE_FUSE), GRENADE_FUSE - 0.5);
  assert(hands.stow('grenade'));

  assert(hands.hold('grenade') && hands.startCook('ads'));
  assert.equal(hands.updateCook(0.5, GRENADE_FUSE, true), 'committed');
  assert.equal(hands.releaseThrow(), GRENADE_FUSE - 0.5);
  assert.equal(hands.releaseThrow(), null, 'release can only be consumed once');
  assert(!hands.hold('radio'), 'follow-through still owns the hand');
  assert(hands.finishThrow() && hands.hold('radio'));
}

// Cooking retains its initiating action. Releasing the other action is inert.
for (const [code, other, type] of [
  ['Mouse0', 'Mouse2', 'long'],
  ['Mouse2', 'Mouse0', 'short'],
]) {
  const { wp, frame, tap, bodies, prompts, clips } = makeHarness();
  tap('KeyG');
  assert.equal(prompts[prompts.length - 1].key, bindingLabel('fire'));
  assert.equal(
    prompts[prompts.length - 1].sub,
    `${bindingLabel('ads')} SHORT THROW · ${bindingLabel('slot1')}/${bindingLabel('slot2')} STOWS`
  );
  frame({ down: [code] });
  assert(wp.cooking);
  assert.equal(clips.at(-1), `cook:${type}`);
  frame({ down: [other] });
  frame({ up: [other] });
  assert(wp.cooking, 'non-initiating release does not commit');
  frame({ up: [code] });
  assert.equal(clips.at(-1), `throw:${type}`);
  tap('Mouse0', 'Mouse2', 'Digit2', 'Tab', 'KeyG', 'KeyX');
  assert(!wp.cooking && wp.grenadeEquipped && !wp.radioEquipped);
  assert.equal(wp._switchTo, null, 'committed throw blocks switching');
  assert.equal(wp.grenades, 1, 'follow-through actions do not spend another grenade');
  wp._onClipEvent('grenade:release', 'grenadeThrow');
  wp._onClipEvent('grenade:release', 'grenadeThrow');
  assert.equal(bodies.length, 1, 'release beat spawns exactly once');
  wp._onClipEvent('grenade:done', 'grenadeThrow');
  assert(!wp.grenadeEquipped && wp.canFire());
}
{
  const { tap, frame, clips } = makeHarness();
  tap('KeyG');
  tap('KeyG', 'Mouse0', 'Mouse2');
  assert.equal(clips.at(-1), 'cook:long', 'fire wins simultaneous cook edges');
  frame();
  assert.equal(clips.at(-1), 'throw:long', 'same-frame tap commits on the next update');
}
{
  const { wp, tap, frame, clips } = makeHarness();
  tap('KeyG');
  frame({ down: ['Mouse2'] });
  // Inject an action release while its held union remains true: the approved
  // actionReleased contract must commit, not rely solely on the held query.
  const released = wp.ctx.input.actionReleased.bind(wp.ctx.input);
  wp.ctx.input.actionReleased = (action): boolean => action === 'ads' || released(action);
  frame();
  assert(wp.ctx.input.action('ads') && !wp.cooking);
  assert.equal(clips.at(-1), 'throw:short');
}

// A release queued before a frozen frame cannot advance the fuse/throw; resume still
// observes the initiating action no longer held after the release edge expires.
{
  const { wp, input, tap, frame } = makeHarness();
  tap('KeyG');
  frame({ down: ['Mouse0'] });
  input._onMouseUp(fixture<MouseEvent>({ button: 0 }));
  input.frozen = true;
  frame({ dt: 1 });
  assert(wp.cooking);
  input.frozen = false;
  frame();
  wp._onClipEvent('grenade:release', 'grenadeThrow');
  assert.equal(wp._grenades[0]?.fuse, GRENADE_FUSE - 1 / 60, 'frozen time does not burn the fuse');
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
for (const code of ['Digit1', 'KeyB']) {
  const { wp, tap, cancellations } = makeHarness();
  assert(wp.beginHeal());
  tap(code);
  assert(wp.healing && cancellations.length === 0, 'same-slot/fire-mode do not interrupt healing');
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
  wp.state.spareMagazines.length = 0;
  const pickups = ammoPickupFixture(wp);
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

// World brass must leave the live animated port, even with separate ADS FOVs.
{
  const camera = new THREE.PerspectiveCamera(24, 1.7);
  camera.position.set(4, 2, -3);
  camera.rotation.y = 1.8;
  const viewCamera = camera.clone();
  viewCamera.fov = 52;
  viewCamera.updateProjectionMatrix();
  const anchor = new THREE.Group();
  anchor.position.copy(viewCamera.position);
  anchor.quaternion.copy(viewCamera.quaternion);
  const root = new THREE.Group();
  anchor.add(root);
  root.position.set(0.12, -0.17, -0.35);
  root.rotation.set(0.13, 0.2, -0.1);
  const port = new THREE.Object3D();
  root.add(port);
  port.position.set(0.026, 0.08, -0.02);

  const ctx = createTestContext({ camera, viewCamera });
  const ejectDir = new THREE.Vector3(1, 0.4, 0.2).normalize();
  const active = fixture<WeaponEntry>({
    ejectionSocket: port,
    model: fixture<WeaponEntry['model']>({ root }),
    ejectDir,
  });
  const position = new THREE.Vector3(),
    direction = new THREE.Vector3();
  Viewmodel.prototype.ejectCase.call(fixture<Viewmodel>({ active, ctx }), position, direction);
  const pixel = (p: THREE.Vector3, c: THREE.Camera): THREE.Vector2 => {
    const { x, y } = p.clone().project(c);
    return new THREE.Vector2(x, y);
  };
  const launch = port.getWorldPosition(new THREE.Vector3());
  const viewPixel = pixel(launch, viewCamera);
  const worldPixel = pixel(position, camera);
  assert(viewPixel.distanceTo(worldPixel) < 1e-6);
  const expected = pixel(
    launch.add(ejectDir.clone().transformDirection(root.matrixWorld)),
    viewCamera
  );
  const actual = pixel(position.add(direction), camera);
  assert(expected.sub(viewPixel).normalize().distanceTo(actual.sub(worldPixel).normalize()) < 1e-6);
}

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
  wp.viewmodel.ejectCase = (): void => {};
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
  ['radio', { on: (h): void => h.tap('KeyX'), off: (h): void => h.tap('Digit1') }],
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

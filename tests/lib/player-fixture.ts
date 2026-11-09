import { Vector3 } from 'three';

import type { EngineContext } from '../../src/core/context.ts';
import { Rng } from '../../src/core/rng.ts';
import { CameraRig } from '../../src/player/camera.ts';
import { HealController } from '../../src/player/heal.ts';
import { Health } from '../../src/player/health.ts';
import { PlayerSystem } from '../../src/player/index.ts';
import { Movement } from '../../src/player/movement.ts';
import type { ArmAsset } from '../../src/weapons/arm-asset.ts';
import { ProjectileSim } from '../../src/weapons/ballistics.ts';
import { Clip } from '../../src/weapons/clips.ts';
import { buildRecoilPattern, WEAPON_DEFS, WEAPON_IDS } from '../../src/weapons/defs.ts';
import type { WeaponDef } from '../../src/weapons/defs.ts';
import { WeaponSystem } from '../../src/weapons/index.ts';
import { ReticleMaterials } from '../../src/weapons/materials-tsl.ts';
import { Viewmodel } from '../../src/weapons/viewmodel.ts';
import * as complete from './fixture-targets.ts';
import { fixture } from './fixture.ts';

/** Real viewmodel state, with rendering/hand presentation held inert by each test. */
export function presentationViewmodel(ctx: EngineContext, calls: string[] = []): Viewmodel {
  const vm = new Viewmodel(ctx, new ReticleMaterials());
  // Arms load asynchronously in init; presentation tests only touch the blood overlay.
  vm.armAsset = fixture<ArmAsset>(
    {
      blood: fixture<ArmAsset['blood']>({ setHealthFraction(): void {} }, complete.testArmBlood()),
    },
    complete.testArmAsset()
  );
  vm.play = (name: string): number => {
    vm.clip = new Clip(name, 1, {});
    vm.clipT = 0;
    return 1;
  };
  vm.stopClip = (): void => {
    vm.clip = null;
    vm.clipT = 0;
  };
  vm.setActive = (): null => null;
  vm.holdGrenade = (): void => {
    calls.push('hold');
  };
  vm.cookGrenade = (type): void => {
    calls.push(`cook:${type}`);
  };
  vm.throwGrenade = (type): void => {
    calls.push(`throw:${type}`);
  };
  vm.endGrenade = (): void => {
    calls.push('end');
  };
  vm.holdRadio = (): void => {
    calls.push('holdRadio');
  };
  vm.endRadio = (): void => {
    calls.push('endRadio');
  };
  vm.setRadioScreen = (): void => {};
  vm.holdBandage = (): void => {
    vm._bandageState = 1;
  };
  vm.endBandage = (): void => {
    vm._bandageState = 0;
  };
  vm.setBandageProgress = (progress): void => {
    vm._bandageProgress = progress;
  };
  vm.addRecoil = (): void => {};
  vm.grenadeReleaseWorld = (out): Vector3 => out.set(0, 1.6, 0);
  vm.muzzleWorld = (out): Vector3 => out.set(0, 0, 0);
  return vm;
}

export function initializeWeaponStates(
  weapons: WeaponSystem,
  patch: Partial<WeaponDef> = {}
): void {
  // These state-machine tests intentionally do not load authored model assets.
  weapons._hasMesh = (): boolean => true;
  for (const id of WEAPON_IDS) {
    const def: WeaponDef = { ...WEAPON_DEFS[id], ...patch };
    weapons.states.set(id, {
      def,
      pattern: buildRecoilPattern(def, Rng),
      mag: def.magSize,
      chambered: true,
      reserve: def.reserve,
      mode: def.modes[0],
      modeIndex: 0,
    });
  }
}

export function inertProjectileSim(ctx: EngineContext): ProjectileSim {
  const sim = new ProjectileSim(ctx);
  sim.spawn = (): null => null;
  sim.clear = (): void => {};
  return sim;
}

export function initializePlayer(ctx: EngineContext): PlayerSystem {
  const player = new PlayerSystem();
  player.ctx = ctx;
  player.movement = new Movement(ctx, player);
  player.rig = new CameraRig(ctx);
  player.health = new Health(ctx, player.rig);
  player.healCtrl = new HealController(player);
  return player;
}

export type TestMotion = 'sprinting' | 'tacticalSprint' | 'sliding' | 'mantling' | 'airborne';
export function setPlayerMotion(player: PlayerSystem, motion: TestMotion, active: boolean): void {
  if (motion === 'mantling') player.movement.mantleMotion.active = active;
  else if (motion === 'airborne') player.movement.grounded = !active;
  else player.movement[motion] = active;
}

import { init, NavMesh, NavMeshQuery } from '@recast-navigation/core';
import { GLTFLoader, type GLTFParser, type GLTF } from 'three/addons/loaders/GLTFLoader.js';
import TRAANode from 'three/addons/tsl/display/TRAANode.js';
import { uniform } from 'three/tsl';
import * as THREE from 'three/webgpu';

import { AttachmentQueries } from '../../src/ai/attachment-queries.ts';
import { CoverMap, SurfaceNav } from '../../src/ai/nav.ts';
import { NoiseBank } from '../../src/audio/dsp.ts';
import { SpatialField } from '../../src/audio/spatial.ts';
import { createConfig } from '../../src/core/config.ts';
import type { EngineSystems } from '../../src/core/context.ts';
import { Engine } from '../../src/core/engine.ts';
import type { WorldManifest, WorldPrefetch } from '../../src/core/model-metadata.ts';
import { EventBus, Registry } from '../../src/core/registry.ts';
import { Rng } from '../../src/core/rng.ts';
import { DecalSystem } from '../../src/fx/decals.ts';
import { HazeSystem } from '../../src/fx/haze.ts';
import { FxSystem } from '../../src/fx/index.ts';
import { ParticleLayer } from '../../src/fx/particles.ts';
import { ShellSystem } from '../../src/fx/shells.ts';
import { MarketSystem } from '../../src/market/index.ts';
import { StaticWorld } from '../../src/physics/bvh.ts';
import { CharacterController } from '../../src/physics/character.ts';
import { PhysicsSystem } from '../../src/physics/index.ts';
import { Ragdoll } from '../../src/physics/ragdoll.ts';
import { RigidBody } from '../../src/physics/rigidbody.ts';
import { CameraRig } from '../../src/player/camera.ts';
import { HealController } from '../../src/player/heal.ts';
import { Health } from '../../src/player/health.ts';
import { PlayerSystem } from '../../src/player/index.ts';
import { Movement } from '../../src/player/movement.ts';
import { RadioSystem } from '../../src/radio/index.ts';
import { RenderSystem } from '../../src/render/index-webgpu.ts';
import { SkySystem } from '../../src/sky/index.ts';
import { GameOverScreen } from '../../src/ui/gameover.ts';
import { UiSystem } from '../../src/ui/index.ts';
import { MarketOverlay } from '../../src/ui/market.ts';
import { PauseMenu } from '../../src/ui/menu.ts';
import { RadioPanel } from '../../src/ui/radio.ts';
import { StartGate } from '../../src/ui/start.ts';
import type { ArmAsset } from '../../src/weapons/arm-asset.ts';
import { ProjectileSim } from '../../src/weapons/ballistics.ts';
import { WeaponSystem } from '../../src/weapons/index.ts';
import { ReticleMaterials } from '../../src/weapons/materials-tsl.ts';
import type { WeaponEntry, AuthoredWeaponModel } from '../../src/weapons/runtime-types.ts';
import { Viewmodel } from '../../src/weapons/viewmodel.ts';
import { WorldSystem } from '../../src/world/index.ts';
import { makeAgent, makeAi } from './agent-fixture.ts';
import {
  FixtureAudioBuffer,
  FixtureAudioParam,
  FixtureAudioNode,
  FixtureBufferSource,
  FixtureGainNode,
  createAudioContext,
  fixtureMixer,
} from './audio-fixture.ts';
import { createTestContext, createTestInput } from './context.ts';
import { testElement, testDocument } from './dom-fixture.ts';

// Native navigation constructors need their local WASM module, not a fake mesh.
await init();
// Parse a real empty glTF once: GLTFParser's constructor is not a runtime export.
const emptyGLTF = await new GLTFLoader().parseAsync(
  JSON.stringify({ asset: { version: '2.0' }, scenes: [{}], scene: 0 }),
  ''
);

export {
  THREE,
  FxSystem,
  Ragdoll,
  HazeSystem,
  PhysicsSystem,
  StaticWorld,
  CharacterController,
  RigidBody,
  RenderSystem,
  SkySystem,
  UiSystem,
  RadioSystem,
  WorldSystem,
  Rng,
  EventBus,
  Registry,
  GLTFLoader,
  FixtureAudioBuffer,
  FixtureAudioParam,
};
export type { EngineSystems };
export {
  testElement,
  testDocument,
  testStyle,
  testClasses,
  testKeyboardEvent,
  testMouseEvent,
  testWheelEvent,
  testPointerEvent,
} from './dom-fixture.ts';
export { createTestInput, makeAgent, makeAi, createAudioContext };

export function unavailable(member: string): never {
  throw new Error(`Test fixture is missing member ${member}`);
}
export function testEngine(): Engine {
  return new Engine({
    canvas: testElement('canvas'),
    config: createConfig({ deterministic: true }),
  });
}
class CpuRenderer extends THREE.Renderer {
  override async compileAsync(): Promise<void> {
    return unavailable('compileAsync');
  }
}
export function testRenderer(): THREE.Renderer {
  return new CpuRenderer(new THREE.WebGPUBackend({ canvas: testElement('canvas') }));
}
class TestBackend extends THREE.Backend {
  override get coordinateSystem(): THREE.CoordinateSystem {
    return THREE.WebGPUCoordinateSystem;
  }
}
export function testBackend(): THREE.Backend {
  return new TestBackend({ canvas: testElement('canvas') });
}
export function testCapableBackend(): THREE.Backend & {
  capabilities: { getUniformBufferLimit(): number };
  compatibilityMode: boolean;
} {
  return Object.assign(testBackend(), {
    capabilities: { getUniformBufferLimit: (): number => 65536 },
    compatibilityMode: false,
  });
}
class TestNodeBuilder extends THREE.NodeBuilder {}
export function testNodeBuilder(): THREE.NodeBuilder {
  return new TestNodeBuilder();
}
export function testViewmodel(): Viewmodel {
  return new Viewmodel(
    createTestContext({ canvas: testElement('canvas') }),
    new ReticleMaterials()
  );
}
export function testProjectileSim(): ProjectileSim {
  return new ProjectileSim(createTestContext());
}
export function testHealth(): Health {
  return new Health(createTestContext(), null);
}
export function testPlayer(): PlayerSystem {
  const player = new PlayerSystem();
  player.ctx = createTestContext({ input: createTestInput() });
  player.health = testHealth();
  player.movement = new Movement(player.ctx, player);
  player.rig = new CameraRig(player.ctx);
  player.healCtrl = new HealController(player);
  return player;
}
export function testNav(): SurfaceNav {
  return new SurfaceNav(new PhysicsSystem(), new NavMesh(), new Map());
}
export function testQueries(): AttachmentQueries {
  return new AttachmentQueries(testNav());
}
export function testQuery(): NavMeshQuery {
  return new NavMeshQuery(new NavMesh());
}
export function testCover(): CoverMap {
  return new CoverMap(null, new PhysicsSystem());
}
export function testMixer(): ReturnType<typeof fixtureMixer> {
  return fixtureMixer(createAudioContext());
}
export function testSpatialField(): SpatialField {
  const actx = createAudioContext();
  return new SpatialField(actx, fixtureMixer(actx), null);
}
export function testEmitter(): NonNullable<ReturnType<SpatialField['acquire']>> {
  const acquired = testSpatialField().acquire({ x: 0, y: 0, z: 0 });
  if (!acquired) return unavailable('emitter');
  return acquired;
}
export function testNoiseBank(): NoiseBank {
  return new NoiseBank(createAudioContext(), new Rng(1), 0.001);
}
export function testAudioNode(): FixtureAudioNode & { name: string } {
  return Object.assign(new FixtureAudioNode(createAudioContext()), { name: '' });
}
export function testBufferSource(): FixtureBufferSource {
  return new FixtureBufferSource(createAudioContext());
}
export function testGain(): GainNode {
  return new FixtureGainNode(createAudioContext());
}
export function testArmBlood(): ArmAsset['blood'] {
  return {
    texture: new THREE.DataTexture(),
    amount: uniform(0),
    setHealthFraction(): void {},
    decorate(): never {
      return unavailable('decorate');
    },
  };
}
export function testArmAsset(): ArmAsset {
  return { meshes: [], blood: testArmBlood(), dispose(): void {} };
}
export function testWeaponEntry(): WeaponEntry {
  return {
    get id(): never {
      return unavailable('id');
    },
    get def(): never {
      return unavailable('def');
    },
    get model(): never {
      return unavailable('model');
    },
    get group(): never {
      return unavailable('group');
    },
    get parts(): never {
      return unavailable('parts');
    },
    get meshes(): never {
      return unavailable('meshes');
    },
    get tris(): never {
      return unavailable('tris');
    },
    get animation(): never {
      return unavailable('animation');
    },
    get clips(): never {
      return unavailable('clips');
    },
    get sight(): never {
      return unavailable('sight');
    },
    get muzzle(): never {
      return unavailable('muzzle');
    },
    get eject(): never {
      return unavailable('eject');
    },
    get ejectDir(): never {
      return unavailable('ejectDir');
    },
    get optic(): never {
      return unavailable('optic');
    },
    get gripR(): never {
      return unavailable('gripR');
    },
    get gripL(): never {
      return unavailable('gripL');
    },
    get magLen(): never {
      return unavailable('magLen');
    },
    get lhandPose(): never {
      return unavailable('lhandPose');
    },
    get rhandPose(): never {
      return unavailable('rhandPose');
    },
  };
}
export function testWeaponModel(): AuthoredWeaponModel & { then?: undefined } {
  return {
    id: 'lmg',
    get label(): never {
      return unavailable('label');
    },
    get scene(): never {
      return unavailable('scene');
    },
    get root(): never {
      return unavailable('root');
    },
    get animations(): never {
      return unavailable('animations');
    },
    get nodes(): never {
      return unavailable('nodes');
    },
    get reactiveFire(): never {
      return unavailable('reactiveFire');
    },
    get handPoses(): never {
      return unavailable('handPoses');
    },
    materials: new Set(),
    textures: new Set(),
    get magSize(): never {
      return unavailable('magSize');
    },
    get shell(): never {
      return unavailable('shell');
    },
  };
}
export function testGLTFParser(): GLTFParser {
  return emptyGLTF.parser;
}
export function testGLTF(): GLTF {
  return {
    scene: new THREE.Group(),
    scenes: [],
    animations: [],
    cameras: [],
    asset: {},
    parser: testGLTFParser(),
    userData: {},
  };
}
export function testManifest(): WorldManifest {
  return {
    version: 2,
    sourceHash: '',
    assets: { visual: '', collision: '', nav: '' },
    transform: [],
    bounds: { min: [0, 0, 0], max: [0, 0, 0] },
    spawns: [],
    stats: { staticTris: 0, instTris: 0, instances: 0, drawCalls: 0, collideTris: 0 },
    lights: [],
  };
}
export function testPrefetch(): WorldPrefetch & { then?: undefined } {
  return { meta: testManifest(), visual: testGLTF(), collision: testGLTF() };
}
export function testParticleLayer(): ParticleLayer {
  return new ParticleLayer({ capacity: 16, mode: 'lit', cols: 1, atlas: new THREE.Texture() });
}
export function testDecals(): DecalSystem {
  return new DecalSystem({
    capacity: 8,
    cols: 1,
    albedo: new THREE.Texture(),
    normal: new THREE.Texture(),
    orm: new THREE.Texture(),
  });
}
export function testShells(): ShellSystem {
  const fx = new FxSystem();
  fx.ctx = createTestContext();
  fx.rng = new Rng(1);
  return new ShellSystem(fx, new THREE.BufferGeometry());
}
export function testGraph(): NonNullable<RenderSystem['_graph']> {
  return {
    get pipeline(): never {
      return unavailable('pipeline');
    },
    get worldPass(): never {
      return unavailable('worldPass');
    },
    get viewPass(): never {
      return unavailable('viewPass');
    },
    get prePass(): never {
      return unavailable('prePass');
    },
    aoPass: null,
    aoBlur: null,
    taaPass: null,
    get exposure(): never {
      return unavailable('exposure');
    },
    get linearDepth(): never {
      return unavailable('linearDepth');
    },
    detach(): never {
      return unavailable('detach');
    },
    render(): never {
      return unavailable('render');
    },
    dispose(): never {
      return unavailable('dispose');
    },
  };
}
export function testTaa(): TRAANode {
  return new TRAANode(
    new THREE.TextureNode(new THREE.Texture()),
    new THREE.TextureNode(new THREE.Texture()),
    new THREE.TextureNode(new THREE.Texture()),
    new THREE.PerspectiveCamera()
  );
}
function withDom<T>(create: () => T): T {
  const names = ['document', 'addEventListener', 'removeEventListener', 'cancelAnimationFrame'];
  const saved = names.map((name): PropertyDescriptor | undefined =>
    Object.getOwnPropertyDescriptor(globalThis, name)
  );
  const events = new EventTarget();
  Object.defineProperties(globalThis, {
    document: { configurable: true, value: testDocument() },
    addEventListener: { configurable: true, value: events.addEventListener.bind(events) },
    removeEventListener: { configurable: true, value: events.removeEventListener.bind(events) },
    cancelAnimationFrame: { configurable: true, value: (): void => {} },
  });
  try {
    return create();
  } finally {
    names.forEach((name, index): void => {
      const descriptor = saved[index];
      if (descriptor) Object.defineProperty(globalThis, name, descriptor);
      else Reflect.deleteProperty(globalThis, name);
    });
  }
}
export function testStartGate(): StartGate {
  return withDom((): StartGate => {
    const engine = testEngine();
    engine.registry.add('player', testPlayer());
    return new StartGate(engine);
  });
}
export function testPauseMenu(): PauseMenu {
  return withDom(
    (): PauseMenu =>
      new PauseMenu(testElement('div'), createTestContext({ input: createTestInput() }))
  );
}
export function testGameOver(): GameOverScreen {
  return withDom((): GameOverScreen => new GameOverScreen(testElement('div'), {}, null));
}
export function testRadioPanel(): RadioPanel {
  return withDom((): RadioPanel => new RadioPanel(testElement('div'), createTestContext()));
}
export function testMarketOverlay(): MarketOverlay {
  return withDom((): MarketOverlay => {
    const market = new MarketSystem();
    market.weapons = new WeaponSystem();
    market.player = testPlayer();
    market.health = market.player.health;
    market.weapons.ammoFraction = (): number => 1;
    const ctx = createTestContext({ providers: { market, weapons: market.weapons } });
    market.ctx = ctx;
    return new MarketOverlay(testElement('div'), ctx);
  });
}
export class TestWorker extends EventTarget implements Worker {
  onmessage: Worker['onmessage'] = null;
  onmessageerror: Worker['onmessageerror'] = null;
  onerror: Worker['onerror'] = null;
  postMessage(message: unknown): void {
    unavailable(`postMessage(${typeof message})`);
  }
  terminate(): void {}
}

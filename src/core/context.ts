import type { Scene, PerspectiveCamera } from 'three';
import type { Engine } from './engine.ts';
import type { EventBus } from './registry.ts';
import type { RuntimeConfig } from './config.ts';
import type { Input } from './input.ts';
import type { Rng } from './rng.ts';
import type { ModelSystem } from './models.ts';
import type { RenderSystem } from '../render/index-webgpu.ts';
import type { MaterialSystemNode } from '../materials/index.ts';
import type { SkySystem } from '../sky/index.ts';
import type { WorldSystem } from '../world/index.ts';
import type { PhysicsSystem } from '../physics/index.ts';
import type { PlayerSystem } from '../player/index.ts';
import type { WeaponSystem } from '../weapons/index.ts';
import type { FxSystem } from '../fx/index.ts';
import type { AiSystem } from '../ai/index.ts';
import type { GameSystem } from '../game/index.ts';
import type { MarketSystem } from '../market/index.ts';
import type { IntelSystem } from '../intel/index.ts';
import type { RadioSystem } from '../radio/index.ts';
import type { UiSystem } from '../ui/index.ts';
import type { AudioSystem } from '../audio/index.ts';
import type { TelemetrySystem } from '../dev/telemetry.ts';

/** The concrete providers registered by the application. Imports are type-only. */
export interface EngineSystems {
  models: ModelSystem;
  render: RenderSystem;
  materials: MaterialSystemNode;
  sky: SkySystem;
  world: WorldSystem;
  physics: PhysicsSystem;
  player: PlayerSystem;
  weapons: WeaponSystem;
  fx: FxSystem;
  ai: AiSystem;
  game: GameSystem;
  market: MarketSystem;
  intel: IntelSystem;
  radio: RadioSystem;
  ui: UiSystem;
  audio: AudioSystem;
  telemetry: TelemetrySystem;
}
export type SystemId = keyof EngineSystems;
export interface EngineTime {
  elapsed: number;
  raw: number;
  dt: number;
  fixed: number;
  alpha: number;
  scale: number;
  frame: number;
}
export interface EngineContext {
  engine: Engine;
  scene: Scene;
  camera: PerspectiveCamera;
  viewScene: Scene;
  viewCamera: PerspectiveCamera;
  canvas: HTMLCanvasElement;
  config: RuntimeConfig;
  events: EventBus;
  input: Input;
  time: EngineTime;
  rng: Rng;
  get<K extends SystemId>(id: K): EngineSystems[K];
  peek<K extends SystemId>(id: K): EngineSystems[K] | null;
  has(id: string): boolean;
}

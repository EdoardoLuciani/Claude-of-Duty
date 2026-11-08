import { PerspectiveCamera, Scene } from 'three';

import { createConfig, FIXED_DT } from '../../src/core/config.ts';
import type { EngineContext, EngineSystems, SystemId } from '../../src/core/context.ts';
import { Input } from '../../src/core/input.ts';
import { applyDefinedPatch } from '../../src/core/patch.ts';
import { EventBus } from '../../src/core/registry.ts';
import { Rng } from '../../src/core/rng.ts';
import { fixture } from './fixture.ts';

export type TestProviders = Partial<EngineSystems>;
export type TestContextOptions = Partial<Omit<EngineContext, 'get' | 'peek' | 'has'>> & {
  providers?: TestProviders;
};

/** Real shared state; absent browser-only dependencies fail at their first use. */
export function createTestContext(options: TestContextOptions = {}): EngineContext {
  const { providers = {}, ...overrides } = options;
  return {
    get engine(): EngineContext['engine'] {
      throw new Error('test context requires an explicit engine');
    },
    get canvas(): HTMLCanvasElement {
      throw new Error('test context requires an explicit canvas');
    },
    get input(): EngineContext['input'] {
      throw new Error('test context requires an explicit input');
    },
    scene: new Scene(),
    camera: new PerspectiveCamera(),
    viewScene: new Scene(),
    viewCamera: new PerspectiveCamera(),
    config: createConfig({ deterministic: true }),
    events: new EventBus(),
    rng: new Rng(1),
    time: { elapsed: 0, raw: 0, dt: 0, fixed: FIXED_DT, alpha: 0, scale: 1, frame: 0 },
    get<K extends SystemId>(id: K): EngineSystems[K] {
      const provider = providers[id];
      if (!provider) throw new Error(`test context requires provider: ${id}`);
      return provider;
    },
    peek<K extends SystemId>(id: K): EngineSystems[K] | null {
      return providers[id] ?? null;
    },
    has(id: SystemId): boolean {
      return providers[id] !== undefined;
    },
    ...overrides,
  };
}

/** Node-friendly real Input; canvas operations fail unless explicitly supplied. */
export function createTestInput(
  overrides: Partial<Input> = {},
  canvas: HTMLCanvasElement = fixture<HTMLCanvasElement>({})
): Input {
  const input = new Input(canvas, createConfig({ deterministic: true }));
  applyDefinedPatch(input, overrides);
  return input;
}

export { createTestContext as createContext, createTestInput as createInput };

import { createConfig } from '../../src/core/config.ts';
import { Engine } from '../../src/core/engine.ts';
import { Registry } from '../../src/core/registry.ts';
import type { Subsystem } from '../../src/core/registry.ts';
import { fixture } from './fixture.ts';

/** Synthetic lifecycle systems use the generic registry, not runtime provider IDs. */
export function createCoreFixture(): { engine: Engine; registry: Registry } {
  const engine = new Engine({
    canvas: fixture<HTMLCanvasElement>({ clientWidth: 1280, clientHeight: 720 }),
    config: createConfig({ fov: 80, deterministic: true, sensitivity: 0.001 }),
  });
  const registry = new Registry();
  Object.defineProperty(engine, 'registry', { value: registry });
  return { engine, registry };
}

export function addLifecycle(
  registry: Registry,
  id: string,
  hooks: Subsystem,
  deps: string[] = []
): void {
  const system = { ...hooks, constructor: { id, deps } };
  registry.add(id, system);
}

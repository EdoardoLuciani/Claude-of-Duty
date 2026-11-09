import assert from 'node:assert/strict';

import * as THREE from 'three';

import type { EngineContext } from '../../src/core/context.ts';
import { Input } from '../../src/core/input.ts';
import { HealController } from '../../src/player/heal.ts';
import { Health } from '../../src/player/health.ts';
import { PlayerSystem } from '../../src/player/index.ts';
import { Movement } from '../../src/player/movement.ts';
import { PixiHud } from '../../src/ui/pixi-hud.ts';
import { testDocument, testElement } from './dom-fixture.ts';

/** Real DOM elements with explicit layout and focus/removal recording. */
export function installUiDocument(): () => void {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'document');
  const documentFixture = testDocument();
  const nativeCreate = documentFixture.createElement.bind(documentFixture);
  function createElement<K extends keyof HTMLElementTagNameMap>(tag: K): HTMLElementTagNameMap[K];
  function createElement<K extends keyof HTMLElementDeprecatedTagNameMap>(
    tag: K
  ): HTMLElementDeprecatedTagNameMap[K];
  function createElement(tag: string): HTMLElement;
  function createElement(tag: string): HTMLElement {
    const element = nativeCreate(tag);
    const state = Object.assign(element, { focused: false, removed: false });
    const focus = element.focus.bind(element);
    const remove = element.remove.bind(element);
    element.focus = (): void => {
      state.focused = true;
      focus();
    };
    element.remove = (): void => {
      state.removed = true;
      remove();
    };
    Object.defineProperties(element, {
      clientWidth: { configurable: true, value: 100 },
      clientHeight: { configurable: true, value: 100 },
    });
    return element;
  }
  documentFixture.createElement = createElement;
  documentFixture.exitPointerLock = (): void => {};
  Object.defineProperty(globalThis, 'document', {
    configurable: true,
    writable: true,
    value: documentFixture,
  });
  return (): void => {
    if (descriptor) Object.defineProperty(globalThis, 'document', descriptor);
    else deleteGlobal('document');
  };
}

export function deleteGlobal(key: string): void {
  // Deleting an absent browser global is distinct from assigning undefined.
  assert(Reflect.deleteProperty(globalThis, key));
}

/** Exercise retained presenters without initializing a GPU or bypassing class state. */
export function createRetainedHud(): PixiHud {
  // The production factory requires a device; construct the actual private class for CPU tests.
  const hud: unknown = Reflect.construct(PixiHud, []);
  assert(hud instanceof PixiHud);
  return hud;
}

/** Writable eligibility/pose controls on a real provider, without initializing physics. */
export class UiPlayer extends PlayerSystem {
  private readonly feet = new THREE.Vector3();
  private readonly eye = new THREE.Vector3(0, 1.65, 0);
  private horizontal = 0;
  private inAir = false;
  private mantle = false;
  constructor(ctx: EngineContext) {
    super();
    this.ctx = ctx;
    this.movement = new Movement(ctx, this);
    this.health = new Health(ctx, null);
    this.healCtrl = new HealController(this);
  }
  override get feetPosition(): THREE.Vector3 {
    return this.feet;
  }
  override get eyePosition(): THREE.Vector3 {
    return this.eye;
  }
  override get horizontalSpeed(): number {
    return this.horizontal;
  }
  override set horizontalSpeed(value: number) {
    this.horizontal = value;
  }
  override get airborne(): boolean {
    return this.inAir;
  }
  override set airborne(value: boolean) {
    this.inAir = value;
  }
  override get mantling(): boolean {
    return this.mantle;
  }
  override set mantling(value: boolean) {
    this.mantle = value;
  }
  override get dead(): boolean {
    return this.health.dead;
  }
  override set dead(value: boolean) {
    this.health.dead = value;
  }
  override setControlEnabled(value: boolean): void {
    this.controlEnabled = value;
  }
}

export class UiInput extends Input {
  constructor() {
    super(testElement('canvas'), { sensitivity: 0.002, invertY: false });
  }
  get use(): boolean {
    return this.down.has('KeyT');
  }
  set use(value: boolean) {
    if (value) this.down.add('KeyT');
    else this.down.delete('KeyT');
  }
}

export { captureMethod } from './render-fixture.ts';

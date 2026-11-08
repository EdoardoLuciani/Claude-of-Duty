import assert from 'node:assert/strict';

import * as THREE from 'three';

import type { EngineContext } from '../../src/core/context.ts';
import { Input } from '../../src/core/input.ts';
import { HealController } from '../../src/player/heal.ts';
import { Health } from '../../src/player/health.ts';
import { PlayerSystem } from '../../src/player/index.ts';
import { Movement } from '../../src/player/movement.ts';
import { PixiHud } from '../../src/ui/pixi-hud.ts';
import { fixture } from './fixture.ts';

interface UiElementState {
  focused: boolean;
  removed: boolean;
  _owText?: string;
  _ows?: Map<string, string>;
  _owc?: Map<string, boolean>;
}

function elementStyle(): CSSStyleDeclaration {
  return fixture<CSSStyleDeclaration>({
    width: '',
    height: '',
    cssText: '',
    touchAction: '',
    setProperty(): void {},
  });
}

function elementClasses(): DOMTokenList {
  const tokens = new Set<string>();
  return fixture<DOMTokenList>({
    toggle(token: string, force?: boolean): boolean {
      const present = force ?? !tokens.has(token);
      if (present) tokens.add(token);
      else tokens.delete(token);
      return present;
    },
    contains(token: string): boolean {
      return tokens.has(token);
    },
  });
}

function isElement(node: Node): node is Element {
  return node.nodeType === 1;
}

/** Minimal native members are checked; unimplemented DOM dependencies fail on access. */
function uiElement(tag: string, ownerDocument: Document): HTMLElement {
  const children: Element[] = [];
  const attributes = new Map<string, Attr>();
  const members: Partial<HTMLElement & UiElementState> = {
    nodeType: 1,
    tagName: tag.toUpperCase(),
    id: '',
    className: '',
    textContent: '',
    tabIndex: -1,
    focused: false,
    removed: false,
    hidden: false,
    clientWidth: 100,
    clientHeight: 100,
    style: elementStyle(),
    classList: elementClasses(),
    ownerDocument,
    children: fixture<HTMLCollection>({
      get length(): number {
        return children.length;
      },
      item(index: number): Element | null {
        return children[index] ?? null;
      },
      namedItem(name: string): Element | null {
        return (
          children.find(
            (child): boolean => child.id === name || child.getAttribute('name') === name
          ) ?? null
        );
      },
      [Symbol.iterator](): ArrayIterator<Element> {
        return children.values();
      },
    }),
    attributes: fixture<NamedNodeMap>({
      get length(): number {
        return attributes.size;
      },
      item(index: number): Attr | null {
        return [...attributes.values()][index] ?? null;
      },
      getNamedItem(name: string): Attr | null {
        return attributes.get(name) ?? null;
      },
      [Symbol.iterator](): MapIterator<Attr> {
        return attributes.values();
      },
    }),
    appendChild<T extends Node>(child: T): T {
      assert(isElement(child), 'UI fixture only supports element children');
      children.push(child);
      return child;
    },
    setAttribute(name: string, value: string): void {
      attributes.set(name, fixture<Attr>({ name, value }));
    },
    getAttribute(name: string): string | null {
      return attributes.get(name)?.value ?? null;
    },
    getRootNode(): Document {
      return ownerDocument;
    },
    addEventListener(): void {},
    removeEventListener(): void {},
    focus(): void {
      this.focused = true;
    },
    remove(): void {
      this.removed = true;
    },
  };
  const optional: readonly ['_owText', '_ows', '_owc'] = ['_owText', '_ows', '_owc'];
  if (tag === 'canvas') {
    return fixture<HTMLCanvasElement & UiElementState>(
      {
        ...members,
        width: 0,
        height: 0,
        getContext(): null {
          return null;
        },
      },
      optional
    );
  }
  if (tag === 'input') {
    return fixture<HTMLInputElement & UiElementState>(
      {
        ...members,
        value: '0',
        type: 'text',
        min: '',
        max: '',
        step: '',
      },
      optional
    );
  }
  if (tag === 'button') {
    return fixture<HTMLButtonElement & UiElementState>(
      { ...members, type: 'button', value: '0' },
      optional
    );
  }
  return fixture<HTMLElement & UiElementState>(members, optional);
}

export function installUiDocument(): () => void {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'document');
  // Preserve Document's tag-specific API while checking each supported specialization above.
  function createElement<K extends keyof HTMLElementTagNameMap>(tag: K): HTMLElementTagNameMap[K];
  function createElement<K extends keyof HTMLElementDeprecatedTagNameMap>(
    tag: K
  ): HTMLElementDeprecatedTagNameMap[K];
  function createElement(tag: string): HTMLElement;
  function createElement(tag: string): HTMLElement {
    return uiElement(tag, documentFixture);
  }
  const documentFixture: Document = fixture<Document>({
    createElement,
    exitPointerLock(): void {},
    getElementById: (): null => null,
    addEventListener(): void {},
    removeEventListener(): void {},
  });
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
    super(fixture<HTMLCanvasElement>({}), { sensitivity: 0.002, invertY: false });
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

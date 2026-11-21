/**
 * Input aggregation: keyboard, mouse (pointer-locked), and movement/look gamepad axes, exposed as
 * a stable per-frame snapshot so gameplay never touches raw DOM events.
 *
 * Edge queries (`pressed`, `released`) are valid only during the frame in which
 * the transition happened — read them in update(), not fixedUpdate().
 */

import { DEFAULT_BINDINGS, type ActionId } from './bindings.ts';
import { hasOwn } from './guards.ts';

/** Gamepad stick dead zone, rescaled so output still spans 0..1. */
const stickDeadZone = (v: number): number =>
  Math.abs(v) < 0.16 ? 0 : (v - Math.sign(v) * 0.16) / 0.84;
/** Look-stick response curve: fine aim near centre, fast flicks at the edge. */
const lookCurve = (v: number): number => Math.sign(v) * Math.abs(v) ** 2.4;

const ACTION_BY_BINDING = new Map<string, ActionId>();
for (const name of Object.keys(DEFAULT_BINDINGS)) {
  if (!hasOwn(DEFAULT_BINDINGS, name)) continue;
  for (const code of DEFAULT_BINDINGS[name]) ACTION_BY_BINDING.set(code, name);
}

/**
 * Every key code the game binds. Used to swallow
 * browser shortcuts that collide with gameplay: crouch is Ctrl, so while the
 * game owns input a plain "Ctrl + W" (close tab), "Ctrl + Q" (quit Firefox),
 * "Ctrl + E" (search) or "Ctrl + A" (select all) fires the moment the player
 * crouches and walks/leans. Only keys consumed by the game are eaten, so
 * unrelated browser shortcuts such as Ctrl+N keep working, and the menu
 * (pointer unlocked) keeps its normal modified shortcuts.
 */
const GAME_KEYS: ReadonlySet<string> = new Set(
  Object.values(DEFAULT_BINDINGS)
    .flat()
    .filter((binding): boolean => !binding.startsWith('Mouse'))
);

declare global {
  // Fullscreen keyboard lock (WHATWG Fullscreen) and Chromium's Keyboard Lock
  // API are not in the bundled DOM typings yet.
  interface FullscreenOptions {
    keyboardLock?: 'none' | 'browser';
  }
  interface Navigator {
    readonly keyboard?: { lock(codes: string[]): Promise<void> };
  }
}

type InputConfig = { sensitivity: number; invertY: boolean };
type Point2 = { x: number; y: number };
type InputHandlers = {
  keydown: (event: KeyboardEvent) => void;
  keyup: (event: KeyboardEvent) => void;
  mousedown: (event: MouseEvent) => void;
  mouseup: (event: MouseEvent) => void;
  mousemove: (event: MouseEvent) => void;
  wheel: (event: WheelEvent) => void;
  lockchange: () => void;
  blur: () => void;
  contextmenu: (event: MouseEvent) => void;
};

export class Input {
  declare canvas: HTMLCanvasElement;
  declare config: InputConfig;
  declare _bound: InputHandlers;
  declare _keyboardCapture: AddEventListenerOptions;

  down: Set<string> = new Set(); // codes currently held
  _pressed: Set<string> = new Set(); // went down this frame
  _released: Set<string> = new Set(); // went up this frame
  _pendingCodes: string[] = [];
  _pendingStates: boolean[] = [];
  _started: Set<ActionId> = new Set(); // union-held action rising edges
  /** Accumulated pointer delta for this frame, in radians after sensitivity. */
  look: Point2 = { x: 0, y: 0 };
  _rawLook: Point2 = { x: 0, y: 0 };
  wheel: number = 0;
  _pendingWheel: number = 0;
  pointerLocked: boolean = false;
  // Keyboard events can still drive movement when pointer lock is denied or
  // while the pointer-lock transition is in flight. Remember that the canvas
  // was clicked so browser shortcuts are suppressed for that active game
  // session too.
  _gameplayFocus: boolean = false;
  enabled: boolean = true;
  /** Set true by capture mode so scripted shots aren't fought by real input. */
  frozen: boolean = false;
  gamepadIndex: number | null = null;
  stick: { moveX: number; moveY: number; lookX: number; lookY: number } = {
    moveX: 0,
    moveY: 0,
    lookX: 0,
    lookY: 0,
  };

  constructor(canvas: HTMLCanvasElement, config: InputConfig) {
    this.canvas = canvas;
    this.config = config;

    this._bound = {
      keydown: this._onKeyDown.bind(this),
      keyup: this._onKeyUp.bind(this),
      mousedown: this._onMouseDown.bind(this),
      mouseup: this._onMouseUp.bind(this),
      mousemove: this._onMouseMove.bind(this),
      wheel: this._onWheel.bind(this),
      lockchange: this._onLockChange.bind(this),
      blur: this._onBlur.bind(this),
      contextmenu: (e): void => e.preventDefault(),
    };
  }

  attach(): void {
    // Capture keyboard events before UI/browser-facing handlers. This matters
    // for modifier shortcuts: the browser must see preventDefault() before it
    // decides what Ctrl/Meta/Alt + a game key means.
    this._keyboardCapture = { capture: true };
    addEventListener('keydown', this._bound.keydown, this._keyboardCapture);
    addEventListener('keyup', this._bound.keyup, this._keyboardCapture);
    addEventListener('mousedown', this._bound.mousedown);
    addEventListener('mouseup', this._bound.mouseup);
    addEventListener('mousemove', this._bound.mousemove);
    addEventListener('wheel', this._bound.wheel, { passive: true });
    addEventListener('blur', this._bound.blur);
    document.addEventListener('pointerlockchange', this._bound.lockchange);
    this.canvas.addEventListener('contextmenu', this._bound.contextmenu);
  }

  detach(): void {
    removeEventListener('keydown', this._bound.keydown, this._keyboardCapture);
    removeEventListener('keyup', this._bound.keyup, this._keyboardCapture);
    removeEventListener('mousedown', this._bound.mousedown);
    removeEventListener('mouseup', this._bound.mouseup);
    removeEventListener('mousemove', this._bound.mousemove);
    removeEventListener('wheel', this._bound.wheel);
    removeEventListener('blur', this._bound.blur);
    document.removeEventListener('pointerlockchange', this._bound.lockchange);
    this.canvas.removeEventListener('contextmenu', this._bound.contextmenu);
  }

  requestPointerLock(): void {
    // Chrome returns a promise that rejects if the document is not eligible
    // (headless capture, an iframe, a lock request too soon after an exit).
    // An unhandled rejection there shows up as a page error in the harness, so
    // swallow it: failing to lock is not a game error.
    try {
      const p = this.canvas.requestPointerLock();
      void Promise.resolve(p).catch((): void => {});
    } catch {
      /* not eligible — keep running unlocked */
    }
  }

  /**
   * Enter fullscreen with keyboard lock so reserved browser shortcuts that
   * collide with game keys (Ctrl+W while crouch-walking) reach
   * preventDefault(); a held Escape exits. Request pointer lock first: this
   * consumes the click's user activation.
   */
  requestFullscreen(): void {
    if (!document.fullscreenEnabled || document.fullscreenElement) return;
    document.documentElement
      .requestFullscreen({ keyboardLock: 'browser' })
      // Chromium ignores the option and locks keys through navigator.keyboard.
      .then((): Promise<void> | undefined => navigator.keyboard?.lock([...GAME_KEYS]))
      .catch((): void => {}); // Windowed play remains supported.
  }

  /** True while keyboard input belongs to the active game rather than the menu. */
  _gameplayInputActive(): boolean {
    // Check the DOM as well as the cached flag. pointerlockchange is delivered
    // asynchronously, so the cache can briefly lag the browser's state.
    const locked =
      this.pointerLocked ||
      (typeof document !== 'undefined' && document.pointerLockElement === this.canvas);
    return locked || this._gameplayFocus;
  }

  /** Stop browser defaults for keys the game consumes. */
  _preventBrowserShortcut(e: KeyboardEvent): void {
    // Unlocked DOM controls keep all native keys (including arrows/range
    // sliders), not just Tab/Space.
    if (GAME_KEYS.has(e.code) && this._gameplayInputActive()) e.preventDefault();
  }

  _onKeyDown(e: KeyboardEvent): void {
    if (!this.enabled) return;
    this._preventBrowserShortcut(e);
    if (this.frozen) return;
    if (e.code === DEFAULT_BINDINGS.pause[0]) {
      this._onBlur();
    } else if (!this._gameplayInputActive()) {
      return;
    }
    if (e.repeat) return;
    this._queueTransition(e.code, true);
  }

  _onKeyUp(e: KeyboardEvent): void {
    if (!this.enabled) return;
    // Some browser actions are committed on keyup. Repeat the cancellation for
    // the matching release while the game is active, rather than relying only
    // on keydown.
    this._preventBrowserShortcut(e);
    if (this.frozen) return;
    this._queueTransition(e.code, false);
  }

  _onMouseDown(e: MouseEvent): void {
    if (!this.enabled || this.frozen) return;
    if (e.target !== this.canvas) {
      if (!this.pointerLocked) this._onBlur();
      return;
    }
    this._gameplayFocus = true;
    // Only the game canvas re-locks the pointer: clicking DOM UI (menus, the
    // supply market) must not grab the cursor mid-interaction.
    if (!this.pointerLocked && e.button === 0) this.requestPointerLock();
    this._queueTransition(`Mouse${e.button}`, true);
  }

  _onMouseUp(e: MouseEvent): void {
    if (!this.enabled || this.frozen) return;
    this._queueTransition(`Mouse${e.button}`, false);
  }

  _onMouseMove(e: MouseEvent): void {
    if (!this.enabled || !this.pointerLocked || this.frozen) return;
    // movementX/Y is already relative and unaffected by cursor clamping.
    this._rawLook.x += e.movementX;
    this._rawLook.y += e.movementY;
  }

  _onWheel(e: WheelEvent): void {
    // Native DOM scrolling never queues a weapon switch, even during resume.
    if (!this.enabled || this.frozen || !this._gameplayInputActive() || e.target !== this.canvas)
      return;
    this._pendingWheel += Math.sign(e.deltaY);
  }

  _onLockChange(): void {
    this.pointerLocked = document.pointerLockElement === this.canvas;
    if (!this.pointerLocked) this._onBlur();
  }

  /** Losing focus must release every held key, or the player runs forever. */
  _onBlur(): void {
    this._gameplayFocus = false;
    // Discard not-yet-snapshotted gameplay presses, but keep the modal Escape
    // intent if the browser delivers pointerlockchange before beginFrame().
    const pause = DEFAULT_BINDINGS.pause[0];
    const pausePending = this._pendingCodes.some(
      (code, index): boolean => code === pause && this._pendingStates[index]
    );
    this._pendingCodes.length = this._pendingStates.length = 0;
    if (pausePending) this._queueTransition(pause, true);
    for (const code of this.down) this._queueTransition(code, false);
    this._pendingWheel = 0;
    this._rawLook.x = 0;
    this._rawLook.y = 0;
  }

  /** Discard all gameplay state at a control handoff, without changing focus or lock. */
  clear(): void {
    this.down.clear();
    this._pressed.clear();
    this._released.clear();
    this._pendingCodes.length = this._pendingStates.length = 0;
    this._started.clear();
    this.look.x = this.look.y = this._rawLook.x = this._rawLook.y = 0;
    this.wheel = this._pendingWheel = 0;
    this.stick.moveX = this.stick.moveY = this.stick.lookX = this.stick.lookY = 0;
  }

  _queueTransition(code: string, held: boolean): void {
    this._pendingCodes.push(code);
    this._pendingStates.push(held);
  }

  beginFrame(): void {
    this._pressed.clear();
    this._released.clear();

    this._started.clear();
    for (let i = 0; i < this._pendingCodes.length; i++) {
      const code = this._pendingCodes[i];
      if (this._pendingStates[i]) {
        if (!this.down.has(code)) {
          const action = ACTION_BY_BINDING.get(code);
          if (action && !this.action(action)) this._started.add(action);
          this.down.add(code);
          this._pressed.add(code);
        }
      } else if (this.down.delete(code)) {
        this._released.add(code);
      }
    }
    this._pendingCodes.length = this._pendingStates.length = 0;

    const s = this.config.sensitivity;
    this.look.x = this.frozen ? 0 : this._rawLook.x * s;
    this.look.y = this.frozen ? 0 : this._rawLook.y * s * (this.config.invertY ? -1 : 1);
    this._rawLook.x = 0;
    this._rawLook.y = 0;

    this.wheel = this._pendingWheel;
    this._pendingWheel = 0;

    this._pollGamepad();
  }

  endFrame(): void {}

  _pollGamepad(): void {
    if (!this.enabled) {
      this.stick.moveX = this.stick.moveY = this.stick.lookX = this.stick.lookY = 0;
      return;
    }
    // Node smoke tests (and some embedded browsers) lack the Gamepad API.
    const pads = (navigator as Partial<Navigator>).getGamepads?.() ?? [];
    const pad =
      pads[this.gamepadIndex ?? 0] ??
      pads.find((candidate): candidate is Gamepad => candidate !== null);
    if (!pad) {
      this.stick.moveX = this.stick.moveY = this.stick.lookX = this.stick.lookY = 0;
      return;
    }
    this.stick.moveX = stickDeadZone(pad.axes[0] ?? 0);
    this.stick.moveY = stickDeadZone(pad.axes[1] ?? 0);
    this.stick.lookX = lookCurve(stickDeadZone(pad.axes[2] ?? 0));
    this.stick.lookY = lookCurve(stickDeadZone(pad.axes[3] ?? 0));
  }

  _actionIn(name: ActionId, snapshot: ReadonlySet<string>): boolean {
    for (const code of DEFAULT_BINDINGS[name]) if (snapshot.has(code)) return true;
    return false;
  }

  /** True while any key/button bound to the action is held. Wheel remains Input.wheel. */
  action(name: ActionId): boolean {
    return this._actionIn(name, this.down);
  }

  /** Per-physical-binding edges, preserving alias behavior; movement owns union-held stance edges. */
  actionPressed(name: ActionId): boolean {
    return this._actionIn(name, this._pressed);
  }

  /** Union-held rising edge: alias presses while the action is held do not restart it. */
  actionStarted(name: ActionId): boolean {
    return this._started.has(name);
  }

  /** Any bound key/button released this frame. */
  actionReleased(name: ActionId): boolean {
    return this._actionIn(name, this._released);
  }

  held(code: string): boolean {
    return this.down.has(code);
  }

  pressed(code: string): boolean {
    return this._pressed.has(code);
  }

  released(code: string): boolean {
    return this._released.has(code);
  }

  get fire(): boolean {
    return this.action('fire');
  }

  get firePressed(): boolean {
    return this.actionPressed('fire');
  }

  get ads(): boolean {
    return this.action('ads');
  }

  /** Normalised WASD + left-stick movement, clamped to the unit disc so
   *  diagonals aren't faster than cardinals. */
  moveVector(out: Point2 = { x: 0, y: 0 }): Point2 {
    let x = (this.action('right') ? 1 : 0) - (this.action('left') ? 1 : 0);
    let y = (this.action('forward') ? 1 : 0) - (this.action('back') ? 1 : 0);
    x += this.stick.moveX;
    y -= this.stick.moveY;
    const len = Math.hypot(x, y);
    if (len > 1) {
      x /= len;
      y /= len;
    }
    out.x = x;
    out.y = y;
    return out;
  }
}

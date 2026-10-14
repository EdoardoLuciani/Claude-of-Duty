/** Static physical defaults. Gameplay consumers own the contextual state machines. */
export const DEFAULT_BINDINGS = {
  forward: ['KeyW', 'ArrowUp'],
  back: ['KeyS', 'ArrowDown'],
  left: ['KeyA', 'ArrowLeft'],
  right: ['KeyD', 'ArrowRight'],
  jump: ['Space'],
  crouch: ['ControlLeft', 'ControlRight', 'KeyC'],
  prone: ['KeyZ'],
  sprint: ['ShiftLeft'],
  leanLeft: ['KeyQ'],
  leanRight: ['KeyE'],
  fire: ['Mouse0'],
  ads: ['Mouse2'],
  reload: ['KeyR'],
  fireMode: ['KeyB'],
  inspect: ['KeyI'],
  slot1: ['Digit1'],
  slot2: ['Digit2'],
  slot3: ['Digit3'],
  cycleWeapon: ['Tab'],
  use: ['KeyT'],
  flashlight: ['KeyF'],
  heal: ['KeyH'],
  grenade: ['KeyG'],
  radio: ['KeyX'],
  pause: ['Escape'],
} as const;

export type ActionId = keyof typeof DEFAULT_BINDINGS;
export type PhysicalBinding = (typeof DEFAULT_BINDINGS)[ActionId][number];

const BINDING_LABELS: Readonly<Record<PhysicalBinding, string>> = {
  KeyW: 'W', KeyS: 'S', KeyA: 'A', KeyD: 'D',
  ArrowUp: '↑', ArrowDown: '↓', ArrowLeft: '←', ArrowRight: '→',
  Space: 'Space', ControlLeft: 'Left Ctrl', ControlRight: 'Right Ctrl', KeyC: 'C',
  KeyZ: 'Z', ShiftLeft: 'Left Shift', KeyQ: 'Q', KeyE: 'E',
  Mouse0: 'LMB', Mouse2: 'RMB', KeyR: 'R', KeyB: 'B', KeyI: 'I',
  Digit1: '1', Digit2: '2', Digit3: '3', Tab: 'Tab',
  KeyT: 'T', KeyF: 'F', KeyH: 'H', KeyG: 'G', KeyX: 'X', Escape: 'Esc',
};

export function bindingLabels(action: ActionId): readonly string[] {
  return DEFAULT_BINDINGS[action].map((binding) => BINDING_LABELS[binding]);
}

/** Includes every alias; single-binding actions also serve as prompt keycaps. */
export function bindingLabel(action: ActionId): string {
  return bindingLabels(action).join(' / ');
}

export type ControlReferenceRow = {
  readonly action: ActionId;
  readonly label: string;
  readonly context: 'gameplay' | 'movement' | 'weapon' | 'grenade' | 'radio' | 'interaction' | 'menu';
  readonly behavior: string;
};

/**
 * Action-backed help only: native DOM navigation, mouse look, game-over,
 * terminal-error and optional telemetry help remain with their UI/dev owners.
 * Wheel is the separate Input.wheel pulse; cycleWeapon binds only the Tab press.
 * Repeated actions are intentional contextual meanings, not duplicate bindings.
 */
export const CONTROL_REFERENCE: readonly ControlReferenceRow[] = [
  { action: 'forward', label: 'Move forward', context: 'movement', behavior: 'Hold. At a ladder, enter/climb up; movement past its top dismounts.' },
  { action: 'back', label: 'Move backward', context: 'movement', behavior: 'Hold. At a ladder, climb down/dismount.' },
  { action: 'left', label: 'Strafe left', context: 'movement', behavior: 'Hold; diagonal movement is normalized.' },
  { action: 'right', label: 'Strafe right', context: 'movement', behavior: 'Hold; diagonal movement is normalized.' },
  { action: 'jump', label: 'Jump / mantle / vault', context: 'movement', behavior: 'Press for buffered jump (stands up first if ceiling fit permits), ladder jump-off or slide cancel. Hold while moving forward into a ledge to mantle/vault; existing automatic ledge rules also apply. Holding does not auto-repeat jumps.' },
  { action: 'crouch', label: 'Crouch / slide', context: 'movement', behavior: 'Toggle on press. From prone, request crouch; while sprinting, slide subject to speed/cooldown. Press again to cancel slide; ceiling fit gates standing.' },
  { action: 'prone', label: 'Prone', context: 'movement', behavior: 'Toggle on press: enter prone, or request crouch when already prone.' },
  { action: 'sprint', label: 'Sprint / tactical sprint', context: 'movement', behavior: 'Hold Left Shift while sufficiently forward, standing and not aiming. Double-tap and keep held for tactical sprint, subject to duration/recovery.' },
  { action: 'leanLeft', label: 'Lean left', context: 'movement', behavior: 'Hold; release centers. Both lean directions cancel. Grounded/non-prone only, disabled during sprint/slide.' },
  { action: 'leanRight', label: 'Lean right', context: 'movement', behavior: 'Hold; release centers. Both lean directions cancel. Grounded/non-prone only, disabled during sprint/slide.' },
  { action: 'fire', label: 'Fire', context: 'weapon', behavior: 'Auto: hold. Semi: one shot per press. Burst: press starts burst, which can continue after release. Dry trigger can reload; firing can interrupt reload/inspect.' },
  { action: 'fire', label: 'Acquire cursor lock', context: 'gameplay', behavior: 'Click the canvas to acquire/reacquire lock; this is also a gameplay fire press. DOM menu/shop clicks do not lock or fire.' },
  { action: 'ads', label: 'Aim down sights', context: 'weapon', behavior: 'Hold, not toggle; subject to player/weapon state.' },
  { action: 'reload', label: 'Reload', context: 'weapon', behavior: 'Press, subject to ammo/full/busy checks. Blocked while grenade/radio are out.' },
  { action: 'fireMode', label: 'Fire mode', context: 'weapon', behavior: 'Press to cycle supported modes; single-mode weapons do nothing. Still cycles the underlying weapon while grenade/radio are out.' },
  { action: 'inspect', label: 'Inspect', context: 'weapon', behavior: 'Press to start animation, not hold. Blocked while grenade/radio are out.' },
  { action: 'slot1', label: 'Primary weapon', context: 'weapon', behavior: 'Press to select the equipped primary, not a fixed weapon. Radio-out numbers are requests instead. An uncooked grenade stows only on a successful different-weapon switch; cooking/throw blocks switching.' },
  { action: 'slot2', label: 'Secondary weapon', context: 'weapon', behavior: 'Press to select the equipped secondary, not a fixed weapon. Radio-out numbers are requests instead. An uncooked grenade stows only on a successful different-weapon switch; cooking/throw blocks switching.' },
  { action: 'slot3', label: 'No third weapon slot', context: 'weapon', behavior: 'No action with an ordinary weapon; used only for a radio request.' },
  { action: 'cycleWeapon', label: 'Cycle equipped weapons', context: 'weapon', behavior: 'Tab press and each nonzero mouse-wheel frame independently request cycling through the equipped pair, subject to switching/busy guards. Both wheel directions request the next weapon. A successful switch stows radio; cooking/throw blocks switching.' },
  { action: 'use', label: 'Pick up ammo', context: 'interaction', behavior: 'Hold 0.45 seconds in range with reserve space. Release decays partial progress. Aimed intel has priority.' },
  { action: 'use', label: 'Secure intel', context: 'interaction', behavior: 'Hold 4 seconds while aimed, visible, stationary and hands free. Damage/motion/release/busy hands interrupt; completion requires release before ammo can use the same hold.' },
  { action: 'flashlight', label: 'Flashlight', context: 'gameplay', behavior: 'Toggle on press while live. Death/restart turn it off; pause/shop preserve state and ignore toggles.' },
  { action: 'heal', label: 'Bandage', context: 'gameplay', behavior: 'Hold 3 seconds; consume/heal only on completion. Release, combat/equipment/switch/pause, health damage, sprint, jump/fall, slide and mantle interrupt. Walking alone is allowed.' },
  { action: 'grenade', label: 'Equip / stow grenade', context: 'grenade', behavior: 'Toggle equipment, not throw. Free stow before cooking; can stow radio and equip grenade.' },
  { action: 'fire', label: 'Long grenade throw', context: 'grenade', behavior: 'Press starts cooking and spends grenade; hold burns fuse, release commits animated long throw. Overcook explodes in hand.' },
  { action: 'ads', label: 'Short grenade throw', context: 'grenade', behavior: 'Press starts cooking and spends grenade; hold burns fuse, release commits animated short throw, not ADS. Overcook explodes in hand.' },
  { action: 'radio', label: 'Equip / stow radio', context: 'radio', behavior: 'Toggle equipment, subject to busy hands. Refused while grenade is held; reliable radio stow.' },
  { action: 'slot1', label: 'Carpet-bomb request', context: 'radio', behavior: 'Press executes immediately, no click/confirm or mouse targeting. Accepted strike consumes charge and stows radio; refusal/no charge leaves it equipped.' },
  { action: 'slot2', label: 'Locked request 2', context: 'radio', behavior: 'Press gives TOP-SECRET/denied feedback, without weapon switch or charge consumption.' },
  { action: 'slot3', label: 'Locked request 3', context: 'radio', behavior: 'Press gives TOP-SECRET/denied feedback, without weapon switch or charge consumption.' },
  { action: 'pause', label: 'Pause / release cursor', context: 'menu', behavior: 'Press toggles pause outside shop/death; browser releases cursor. Loss of previously held pointer lock also pauses. Shop owns Escape to skip; resume requests lock.' },
];

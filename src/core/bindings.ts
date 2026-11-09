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
  KeyW: 'W',
  KeyS: 'S',
  KeyA: 'A',
  KeyD: 'D',
  ArrowUp: '↑',
  ArrowDown: '↓',
  ArrowLeft: '←',
  ArrowRight: '→',
  Space: 'Space',
  ControlLeft: 'Left Ctrl',
  ControlRight: 'Right Ctrl',
  KeyC: 'C',
  KeyZ: 'Z',
  ShiftLeft: 'Left Shift',
  KeyQ: 'Q',
  KeyE: 'E',
  Mouse0: 'LMB',
  Mouse2: 'RMB',
  KeyR: 'R',
  KeyB: 'B',
  KeyI: 'I',
  Digit1: '1',
  Digit2: '2',
  Digit3: '3',
  Tab: 'Tab',
  KeyT: 'T',
  KeyF: 'F',
  KeyH: 'H',
  KeyG: 'G',
  KeyX: 'X',
  Escape: 'Esc',
};

export function bindingLabels(action: ActionId): readonly string[] {
  return DEFAULT_BINDINGS[action].map((binding): string => BINDING_LABELS[binding]);
}

/** Includes every alias; single-binding actions also serve as prompt keycaps. */
export function bindingLabel(action: ActionId): string {
  return bindingLabels(action).join(' / ');
}

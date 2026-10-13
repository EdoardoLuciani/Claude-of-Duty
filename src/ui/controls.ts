import { ACTIONS } from '../core/input.ts';

interface ControlReference { keys: readonly string[]; description: string }
interface ControlSection { title: string; controls: ControlReference[] }

/** UI reference only: action bindings come from Input; direct codes mirror their consumers. */
export const CONTROL_SECTIONS: ControlSection[] = [
  { title: 'Movement & look', controls: [
    { keys: ACTIONS.forward, description: 'Hold to move forward / climb up' },
    { keys: ACTIONS.back, description: 'Hold to move backward / climb down' },
    { keys: ACTIONS.left, description: 'Hold to strafe left' },
    { keys: ACTIONS.right, description: 'Hold to strafe right' },
    { keys: ['MouseMove'], description: 'Look around' },
    { keys: ACTIONS.jump, description: 'Jump / stand up / jump off ladder / cancel slide; hold while moving into a ledge to mantle or vault' },
    { keys: ACTIONS.sprint, description: 'Hold while moving forward to sprint; double-tap then hold for tactical sprint' },
    { keys: ACTIONS.crouch, description: 'Toggle crouch; press while sprinting to slide; press again to cancel slide' },
    { keys: ACTIONS.prone, description: 'Toggle prone / crouch' },
    { keys: [...ACTIONS.leanLeft, ...ACTIONS.leanRight], description: 'Hold to lean left / right' },
  ] },
  { title: 'Weapons', controls: [
    { keys: ['Mouse0'], description: 'Fire — hold for automatic fire; press for semi-auto or burst' },
    { keys: ['Mouse2'], description: 'Hold to aim down sights' },
    { keys: ACTIONS.reload, description: 'Reload' },
    { keys: ['KeyB'], description: 'Cycle available fire modes' },
    { keys: ['KeyI'], description: 'Inspect weapon' },
    { keys: ACTIONS.swapWeapon.filter((code) => code !== 'Tab'), description: 'Select primary / secondary weapon (radio stowed)' },
    { keys: ['Tab', 'Wheel'], description: 'Cycle weapons — either scroll direction selects the next weapon' },
    { keys: ACTIONS.melee, description: 'Reserved melee binding — not implemented' },
  ] },
  { title: 'Equipment & interaction', controls: [
    { keys: ACTIONS.use, description: 'Hold near ammo to collect; hold still while aiming at a visible intel case to secure it' },
    { keys: ACTIONS.heal, description: 'Hold to bandage (walking allowed); release, sprint, jump / fall, slide, mantle, use weapons, take health damage or pause to cancel' },
    { keys: ACTIONS.flashlight, description: 'Toggle flashlight' },
    { keys: ACTIONS.grenade, description: 'Equip / stow grenade — does not throw' },
    { keys: ['Mouse0', 'Mouse2'], description: 'With grenade equipped: hold to cook long / short throw, release to throw; overcooking detonates in hand' },
    { keys: ACTIONS.radio, description: 'Equip / stow field radio' },
    { keys: ['Digit1', 'Digit2', 'Digit3'], description: 'With radio equipped: 1 requests a carpet bomb strike; 2 / 3 are locked requests (not weapon selection)' },
  ] },
  { title: 'Menus', controls: [
    { keys: ACTIONS.pause, description: 'Pause / resume; in the shop, skip and close the shop instead' },
    { keys: ['Mouse0'], description: 'Click menu buttons / shop purchases; click the game to capture the mouse' },
    { keys: ['Tab', 'ShiftTab'], description: 'In menus: focus next / previous control' },
    { keys: ['Enter', 'Space'], description: 'Activate focused buttons; after death, start a new game when prompted' },
    { keys: ['PageUp', 'PageDown'], description: 'Adjust focused settings sliders; scroll this reference when focused (or use the mouse wheel)' },
  ] },
];

const KEY_LABELS: Record<string, string> = {
  ArrowUp: '↑', ArrowDown: '↓', ArrowLeft: '←', ArrowRight: '→',
  ControlLeft: 'Left Ctrl', ControlRight: 'Right Ctrl', ShiftLeft: 'Left Shift',
  Mouse0: 'Left mouse', Mouse2: 'Right mouse', MouseMove: 'Mouse', Wheel: 'Mouse wheel',
  Escape: 'Esc', ShiftTab: 'Shift + Tab',
};

export function controlKeyLabel(code: string): string {
  return KEY_LABELS[code] ?? code.replace(/^(Key|Digit)/, '');
}

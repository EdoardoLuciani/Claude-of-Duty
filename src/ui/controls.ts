import { CONTROL_REFERENCE, bindingLabels } from '../core/bindings.ts';
import type { ControlReferenceRow } from '../core/bindings.ts';

interface ControlReference { keys: readonly string[]; description: string }
interface ControlSection { title: string; controls: ControlReference[] }

/** Presentation adapter only: gameplay meanings and key labels come from core metadata. */
function gameplayRows(contexts: readonly ControlReferenceRow['context'][]): ControlReference[] {
  return CONTROL_REFERENCE.filter(row => contexts.includes(row.context)).map(row => ({
    keys: row.action === 'cycleWeapon' ? [...bindingLabels(row.action), 'Mouse wheel'] : bindingLabels(row.action),
    description: `${row.label} — ${row.behavior}`,
  }));
}

export const CONTROL_SECTIONS: ControlSection[] = [
  { title: 'Movement & look', controls: [
    ...gameplayRows(['movement']),
    { keys: ['Mouse'], description: 'Look around; sensitivity and invert look are settings, not bindings.' },
  ] },
  { title: 'Weapons', controls: gameplayRows(['weapon']) },
  { title: 'Equipment & interaction', controls: gameplayRows(['gameplay', 'interaction', 'grenade', 'radio']) },
  { title: 'Menus', controls: [
    ...gameplayRows(['menu']),
    { keys: ['Left mouse'], description: 'Click menu buttons / shop purchases. DOM clicks do not fire or capture the cursor.' },
    { keys: ['Tab', 'Shift + Tab'], description: 'In menus: focus next / previous control (native navigation, not weapon cycling).' },
    { keys: ['Enter', 'Space'], description: 'Activate focused buttons; after death, start a new game when prompted (after 2.85 seconds).' },
    { keys: ['↑', '↓', '←', '→', 'Home', 'End', 'PageUp', 'PageDown'], description: 'Adjust focused settings sliders with native keys; arrows / PageUp / PageDown scroll this reference when focused (or use the mouse wheel).' },
    { keys: ['Left mouse', 'Enter', 'Space'], description: 'Terminal error: activate the focused Reload button; gameplay stays frozen until reload.' },
  ] },
];

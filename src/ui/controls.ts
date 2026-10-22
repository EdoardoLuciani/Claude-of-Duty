import { CONTROL_REFERENCE, bindingLabels } from '../core/bindings.ts';
import type { ActionId, ControlReferenceRow } from '../core/bindings.ts';

interface ControlReference {
  keys: readonly string[];
  description: string;
}
interface ControlSection {
  title: string;
  quickControls: ControlReference[];
  controls: ControlReference[];
}

/** Presentation adapter only: gameplay meanings and key labels come from core metadata. */
function gameplayRows(contexts: readonly ControlReferenceRow['context'][]): ControlReference[] {
  return CONTROL_REFERENCE.filter((row) => contexts.includes(row.context)).map((row) => ({
    keys:
      row.action === 'cycleWeapon'
        ? [...bindingLabels(row.action), 'Mouse wheel']
        : bindingLabels(row.action),
    description: `${row.label} — ${row.behavior}`,
  }));
}

function quick(actions: readonly ActionId[], description: string): ControlReference {
  return { keys: actions.flatMap((action) => bindingLabels(action)), description };
}

export const CONTROL_SECTIONS: ControlSection[] = [
  {
    title: 'Movement & look',
    quickControls: [
      {
        keys: [0, 1].map((alias) =>
          (['forward', 'left', 'back', 'right'] as const)
            .map((action) => bindingLabels(action)[alias])
            .join(' ')
        ),
        description: 'Move (hold)',
      },
      { keys: ['Mouse'], description: 'Look' },
      quick(['jump'], 'Jump (press) · mantle / vault (hold + move forward)'),
      quick(['crouch'], 'Crouch / slide (toggle)'),
      quick(['prone'], 'Prone (toggle)'),
      quick(['sprint'], 'Sprint (hold) · tactical sprint (double-tap + hold)'),
      quick(['leanLeft', 'leanRight'], 'Lean left / right (hold)'),
    ],
    controls: [
      ...gameplayRows(['movement']),
      {
        keys: ['Mouse'],
        description: 'Look around; sensitivity and invert look are settings, not bindings.',
      },
    ],
  },
  {
    title: 'Weapons',
    quickControls: [
      quick(['fire'], 'Fire (weapon out)'),
      quick(['ads'], 'Aim down sights (hold; weapon out)'),
      quick(['reload'], 'Reload'),
      quick(['fireMode'], 'Cycle fire mode'),
      quick(['inspect'], 'Inspect (press)'),
      quick(['slot1', 'slot2'], 'Primary / secondary (weapon out)'),
      {
        keys: [...bindingLabels('cycleWeapon'), 'Mouse wheel'],
        description: 'Request weapon cycle',
      },
    ],
    controls: gameplayRows(['weapon']),
  },
  {
    title: 'Equipment & interaction',
    quickControls: [
      quick(['use'], 'Interact (hold): ammo 0.45s / aimed intel 4s'),
      quick(['flashlight'], 'Flashlight (toggle)'),
      quick(['heal'], 'Bandage (hold 3s)'),
      quick(['grenade'], 'Equip / stow grenade (toggle)'),
      quick(['fire', 'ads'], 'Grenade out: cook long / short (hold); release to throw'),
      quick(['radio'], 'Equip / stow radio (toggle)'),
      quick(['slot1'], 'Radio out: carpet-bomb request (immediate)'),
      quick(['slot2', 'slot3'], 'Radio out: locked requests'),
    ],
    controls: gameplayRows(['gameplay', 'interaction', 'grenade', 'radio']),
  },
  {
    title: 'Menus',
    quickControls: [quick(['pause'], 'Pause / resume · in shop: close shop')],
    controls: [
      ...gameplayRows(['menu']),
      {
        keys: ['Left mouse'],
        description:
          'Click menu buttons / shop purchases. DOM clicks do not fire or capture the cursor.',
      },
      {
        keys: ['Tab', 'Shift + Tab'],
        description:
          'In menus: focus next / previous control (native navigation, not weapon cycling).',
      },
      {
        keys: ['Enter', 'Space'],
        description:
          'Activate focused buttons; after death, start a new game when prompted (after 2.85 seconds).',
      },
      {
        keys: ['↑', '↓', '←', '→', 'Home', 'End', 'PageUp', 'PageDown'],
        description:
          'Adjust focused settings sliders with native keys; arrows / PageUp / PageDown scroll this reference when focused (or use the mouse wheel).',
      },
      {
        keys: ['Left mouse', 'Enter', 'Space'],
        description:
          'Terminal error: activate the focused Reload button; gameplay stays frozen until reload.',
      },
    ],
  },
];

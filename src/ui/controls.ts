import { bindingLabels } from '../core/bindings.ts';
import type { ActionId } from '../core/bindings.ts';

interface ControlReference {
  keys: readonly string[];
  description: string;
}
interface ControlSection {
  title: string;
  controls: ControlReference[];
}

/** Concise presentation only; physical key labels come from canonical bindings. */
function quick(actions: readonly ActionId[], description: string): ControlReference {
  return { keys: actions.flatMap((action) => bindingLabels(action)), description };
}

export const CONTROL_SECTIONS: ControlSection[] = [
  {
    title: 'Movement & look',
    controls: [
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
  },
  {
    title: 'Weapons',
    controls: [
      quick(['fire'], 'Fire: auto (hold) · semi (press) · burst (press starts burst); weapon out'),
      quick(['ads'], 'Aim down sights (hold; weapon out)'),
      quick(['reload'], 'Reload (press; weapon out)'),
      quick(['fireMode'], 'Cycle fire mode'),
      quick(['inspect'], 'Inspect (press; weapon out)'),
      quick(['slot1', 'slot2'], 'Primary / secondary (weapon out)'),
      {
        keys: [...bindingLabels('cycleWeapon'), 'Mouse wheel'],
        description: 'Request weapon cycle',
      },
    ],
  },
  {
    title: 'Equipment & interaction',
    controls: [
      quick(['use'], 'Interact (hold): ammo 0.45s / aimed intel 4s'),
      quick(['flashlight'], 'Flashlight (toggle)'),
      quick(['heal'], 'Bandage (hold 3s)'),
      quick(['grenade'], 'Equip / stow grenade (toggle)'),
      quick(['fire', 'ads'], 'Grenade out: cook long / short (hold); release to throw'),
      quick(['radio'], 'Equip / stow radio (toggle)'),
      quick(['slot1'], 'Radio out: carpet-bomb request (immediate)'),
      quick(['slot2', 'slot3'], 'Radio out: locked requests'),
    ],
  },
  {
    title: 'Menus',
    controls: [quick(['pause'], 'Pause / resume · in shop: close shop')],
  },
];

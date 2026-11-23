import { bindingLabels } from '../core/bindings.ts';
import type { ActionId } from '../core/bindings.ts';
import type { RuntimeConfig } from '../core/config.ts';
import { SESSION_MODE_POLICY } from '../core/playable-maps.ts';

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
  return {
    keys: actions.flatMap((action): readonly string[] => bindingLabels(action)),
    description,
  };
}

export function controlSections(mode: RuntimeConfig['mode']): ControlSection[] {
  const counter = SESSION_MODE_POLICY[mode].freeMarket;
  return [
    {
      title: 'Movement & look',
      controls: [
        quick(['forward', 'left', 'back', 'right'], 'Move (hold)'),
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
        quick(
          ['fire'],
          'Fire: auto (hold) · semi (press) · burst (press starts burst); weapon out'
        ),
        quick(['ads'], 'Aim down sights (hold; weapon out)'),
        quick(['reload'], 'Reload (press; weapon out)'),
        quick(['fireMode'], 'Cycle fire mode'),
        quick(['inspect'], 'Inspect (press; weapon out)'),
        quick(['slot1', 'slot2'], 'Primary / secondary · stows grenade / radio'),
        {
          keys: [...bindingLabels('cycleWeapon'), 'Mouse wheel'],
          description: 'Request weapon cycle',
        },
      ],
    },
    {
      title: 'Equipment & interaction',
      controls: [
        quick(
          ['use'],
          counter
            ? 'Open the loadout counter (press nearby)'
            : 'Interact (hold): ammo 0.45s / aimed intel 4s'
        ),
        quick(['flashlight'], 'Flashlight (toggle)'),
        quick(['laser'], 'Mounted weapon laser (toggle; weapon out)'),
        quick(['heal'], 'Bandage (hold 3s)'),
        quick(['grenade'], 'Equip grenade (weapon keys stow)'),
        quick(['fire', 'ads'], 'Grenade out: cook long / short (hold); release to throw'),
        quick(['radio'], 'Equip radio (weapon keys stow)'),
        quick(['radioUp', 'radioDown'], 'Radio out: select request'),
        quick(['radioSend'], 'Radio out: send selected request'),
      ],
    },
    {
      title: 'Menus',
      controls: [
        quick(
          ['pause'],
          counter
            ? 'Pause / resume · at counter: close loadout'
            : 'Pause / resume · in shop: close shop'
        ),
      ],
    },
  ];
}

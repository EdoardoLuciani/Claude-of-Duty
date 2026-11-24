import type { Vector3Like } from 'three';

import type { EngineContext, SystemId } from '../core/context.ts';
import type { CourseGate } from '../core/model-metadata.ts';

const STATION_RADIUS = 3;
const STATION_PROMPT = { text: 'Supply market', sub: 'Loadout · Resupply · Reset targets' };
const PROMPT_OWNER = 'range';

function matchesGate(gate: CourseGate | undefined, action: string, p: Vector3Like): boolean {
  if (gate?.action !== action) return false;
  const [x, y, z] = gate.position;
  return (p.x - x) ** 2 + (p.y - y) ** 2 + (p.z - z) ** 2 <= gate.radius ** 2;
}

/** Interactions authored by the practice world's manifest. */
export class RangeSystem {
  static readonly id = 'range';
  static readonly deps: SystemId[] = ['world', 'player', 'weapons', 'market', 'ui'];
  private step = 0;
  private hints: { key: string; text: string; sub: string }[] = [];
  private off: (() => void)[] = [];

  init(ctx: EngineContext): void {
    const { course, rangeStation } = ctx.get('world').queries;
    const ui = ctx.get('ui');
    if (course.length) {
      const player = ctx.get('player');
      for (const [index, gate] of course.entries()) {
        this.hints.push({
          key: `${index + 1}/${course.length}`,
          text: 'Parkour circuit',
          sub: gate.hint,
        });
      }
      this.off.push(
        ctx.events.on('player:mantle', ({ kind }): void => this.advance(ctx, kind)),
        ctx.events.on('bullet:impact', (e): void => {
          if (!this.step || e.exit || (e.shooter !== player && e.shooter !== 'player')) return;
          const label = ctx.get('world').queries.rangeTargetAt(e.point, e.normal)?.label;
          if (label) this.advance(ctx, label);
        }),
        ctx.events.on('game:restart', (): void => {
          this.step = 0;
        })
      );
    }
    if (course.length || rangeStation) {
      this.off.push(
        ctx.events.on('market:open', (): void => ui.clearPrompt(PROMPT_OWNER)),
        ctx.events.on('ui:pause', ({ paused }): void => {
          if (paused) ui.clearPrompt(PROMPT_OWNER);
        })
      );
    }
  }

  update(_dt: number, ctx: EngineContext): void {
    const { course, rangeStation } = ctx.get('world').queries;
    const { input } = ctx;
    const ui = ctx.get('ui');
    const player = ctx.get('player');
    // PauseMenu uses the time scale. Its lateUpdate has not seen this frame's input yet.
    if (player.dead || !player.controlEnabled || input.lockLost || input.actionPressed('pause')) {
      ui.clearPrompt(PROMPT_OWNER);
      return;
    }

    // A player can enter the gate already crouched or climbing.
    if (this.step && (player.state === 'climb' || player.stance === 'crouch'))
      this.advance(ctx, player.state === 'climb' ? 'climb' : 'crouch');

    if (input.enabled && !input.frozen && !input.ads) {
      const feet = player.feetPosition;
      const near =
        rangeStation &&
        (feet.x - rangeStation.x) ** 2 + (feet.z - rangeStation.z) ** 2 <= STATION_RADIUS ** 2;
      if (near && !ctx.get('weapons').grenadeEquipped) {
        ui.setPrompt(STATION_PROMPT, PROMPT_OWNER);
        if (input.actionPressed('use')) ctx.get('market').openShop();
        return;
      }
      const next = this.step ? course.at(this.step) : undefined;
      const hint = this.hints.at(this.step);
      if (
        !near &&
        next &&
        hint &&
        Math.abs(feet.x - next.position[0]) < 10 &&
        Math.abs(feet.z - next.position[2]) < 30
      ) {
        ui.setPrompt(hint, PROMPT_OWNER);
        return;
      }
    }
    ui.clearPrompt(PROMPT_OWNER);
  }

  private advance(ctx: EngineContext, action: string): void {
    const { course } = ctx.get('world').queries;
    const feet = ctx.get('player').feetPosition;
    let index = this.step;
    if (matchesGate(course.at(0), action, feet)) index = 0;
    else if (!index || !matchesGate(course.at(index), action, feet)) return;
    this.step = index + 1 < course.length ? index + 1 : 0;
    const ui = ctx.get('ui');
    ui.clearPrompt(PROMPT_OWNER);
    if (!this.step) ui.banner.show('Circuit complete', 'Vault the start hurdle to run again', 4);
    ui.sfx('objective', 0.55);
  }

  dispose(): void {
    for (const off of this.off) off();
  }
}

import type { Vector3Like } from 'three';

import type { EngineContext, EngineSystems, SystemId } from '../core/context.ts';
import type { CourseGate } from '../core/model-metadata.ts';

const STATION_RADIUS = 3;
const STATION_PROMPT = { text: 'Supply market', sub: 'Loadout · Resupply · Reset targets' };
const PROMPT_OWNER = 'range';

function matchesGate(gate: CourseGate | undefined, action: string, p: Vector3Like): boolean {
  if (gate?.action !== action) return false;
  const [x, y, z] = gate.position;
  return (p.x - x) ** 2 + (p.y - y) ** 2 + (p.z - z) ** 2 <= gate.radius ** 2;
}

/** Optional range interactions authored by the loaded world manifest. */
export class RangeSystem {
  static readonly id = 'range';
  static readonly deps: SystemId[] = ['world', 'player', 'weapons', 'market', 'ui'];
  private step = 0;
  private hints: { key: string; text: string; sub: string }[] = [];
  private off: (() => void)[] = [];
  private queries!: EngineSystems['world']['queries'];
  private player!: EngineSystems['player'];
  private ui!: EngineSystems['ui'];
  private weapons!: EngineSystems['weapons'];
  private market!: EngineSystems['market'];

  init(ctx: EngineContext): void {
    this.queries = ctx.get('world').queries;
    this.player = ctx.get('player');
    this.ui = ctx.get('ui');
    this.weapons = ctx.get('weapons');
    this.market = ctx.get('market');
    const { course } = this.queries;
    if (!course.length) return;
    for (const [index, gate] of course.entries()) {
      this.hints.push({
        key: `${index + 1}/${course.length}`,
        text: 'Parkour circuit',
        sub: gate.hint,
      });
    }
    const player = this.player;
    this.off.push(
      ctx.events.on('player:mantle', ({ kind }): void => this.advance(kind)),
      ctx.events.on('bullet:impact', (e): void => {
        if (!this.step || e.exit || (e.shooter !== player && e.shooter !== 'player')) return;
        const label = this.queries.rangeTargetAt(e.point, e.normal)?.label;
        if (label) this.advance(label);
      }),
      ctx.events.on('game:restart', (): void => {
        this.step = 0;
      })
    );
  }

  update(_dt: number, ctx: EngineContext): void {
    const { course, rangeStation } = this.queries;
    if (!rangeStation && !course.length) return;
    const { input } = ctx;
    const { ui, player } = this;
    // PauseMenu uses the time scale. Its lateUpdate has not seen this frame's input yet.
    if (player.dead || !player.controlEnabled || input.lockLost || input.actionPressed('pause')) {
      ui.clearPrompt(PROMPT_OWNER);
      return;
    }

    // A player can enter the gate already crouched or climbing.
    if (this.step && (player.state === 'climb' || player.stance === 'crouch'))
      this.advance(player.state === 'climb' ? 'climb' : 'crouch');

    if (input.enabled && !input.frozen && !input.ads) {
      const feet = player.feetPosition;
      const near =
        rangeStation &&
        (feet.x - rangeStation.x) ** 2 + (feet.z - rangeStation.z) ** 2 <= STATION_RADIUS ** 2;
      if (near && !this.weapons.grenadeEquipped) {
        if (input.actionPressed('use')) {
          // The open market suspends gameplay, so update() cannot clear this later.
          ui.clearPrompt(PROMPT_OWNER);
          this.market.openShop();
        } else ui.setPrompt(STATION_PROMPT, PROMPT_OWNER);
        return;
      }
      const next = this.step ? course.at(this.step) : undefined;
      if (
        !near &&
        next &&
        Math.abs(feet.x - next.position[0]) < 10 &&
        Math.abs(feet.z - next.position[2]) < 30
      ) {
        // The circuit hint yields to grenade, radio and bandage messages.
        if (!ui.prompt.active || ui.promptOwner === PROMPT_OWNER)
          ui.setPrompt(this.hints[this.step], PROMPT_OWNER);
        return;
      }
    }
    ui.clearPrompt(PROMPT_OWNER);
  }

  private advance(action: string): void {
    const { course } = this.queries;
    const feet = this.player.feetPosition;
    let index = this.step;
    if (matchesGate(course.at(0), action, feet)) index = 0;
    else if (!index || !matchesGate(course.at(index), action, feet)) return;
    this.step = index + 1 < course.length ? index + 1 : 0;
    const { ui } = this;
    ui.clearPrompt(PROMPT_OWNER);
    if (!this.step) ui.banner.show('Circuit complete', 'Vault the start hurdle to run again', 4);
    ui.sfx('objective', 0.55);
  }

  dispose(): void {
    for (const off of this.off) off();
  }
}

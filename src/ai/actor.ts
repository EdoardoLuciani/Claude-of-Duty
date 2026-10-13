/** Actor metadata is structural: physics also accepts diagnostic actor records. */
export function isAliveTeammate(actor: unknown, team: number): boolean {
  return typeof actor === 'object' && actor !== null && 'alive' in actor && !!actor.alive
    && 'team' in actor && actor.team === team;
}

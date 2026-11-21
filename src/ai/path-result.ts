export type PathSolveOutcome = 'success' | 'invalid' | 'unreachable';

/** Caller-owned storage; only completed requests overwrite these diagnostics. */
export interface PathCompletion {
  outcome: PathSolveOutcome;
  count: number;
  reason: string | null;
  resolvedFloor: number;
  startSurface: number;
  goalSurface: number;
}

export type PathResult =
  | Readonly<PathCompletion>
  | { readonly outcome: 'deferred'; readonly reason: PathDeferral };

type PathDeferral = 'frame-budget' | 'attachment-pending' | 'attachment-superseded';

export const PATH_DEFERRED = {
  budget: Object.freeze({ outcome: 'deferred', reason: 'frame-budget' }),
  pending: Object.freeze({ outcome: 'deferred', reason: 'attachment-pending' }),
  superseded: Object.freeze({ outcome: 'deferred', reason: 'attachment-superseded' }),
} as const satisfies Record<string, PathResult>;

export function createPathCompletion(): PathCompletion {
  return {
    outcome: 'invalid',
    count: 0,
    reason: null,
    resolvedFloor: NaN,
    startSurface: 0,
    goalSurface: 0,
  };
}

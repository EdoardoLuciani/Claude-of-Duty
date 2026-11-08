import * as THREE from 'three';

interface AuthoredActionState {
  mixer: THREE.AnimationMixer;
  actions: Record<string, THREE.AnimationAction>;
  name: string | null;
}

export function createAuthoredActions(
  mixer: THREE.AnimationMixer,
  clips: THREE.AnimationClip[]
): Record<string, THREE.AnimationAction> {
  const actions: Record<string, THREE.AnimationAction> = {};
  for (const clip of clips) {
    const action = mixer.clipAction(clip);
    action.setLoop(THREE.LoopOnce, 1);
    action.clampWhenFinished = true;
    actions[clip.name] = action;
  }
  return actions;
}

/** Sample authored time without advancing the mixer; mechanism overrides stay in each adapter. */
export function sampleAuthoredAction(state: AuthoredActionState, name: string, time: number): void {
  if (name !== state.name) {
    if (state.name) state.actions[state.name].stop();
    state.actions[name].reset().play();
    state.name = name;
  }
  const action = state.actions[name];
  action.paused = false;
  action.time = Math.min(time, action.getClip().duration);
  state.mixer.update(0);
}

/** Detachable-magazine adapters share these authored gesture names; frozen because
 * every adapter reads the same object (extend by spreading, as AX338 does). */
export const MAGAZINE_ALIASES: Readonly<Record<string, string>> = Object.freeze({
  reloadTac: 'Reload_Tactical',
  reloadEmpty: 'Reload_Empty',
  inspect: 'Inspect',
  draw: 'Draw',
  holster: 'Holster',
});

interface AuthoredFireState {
  fireTime: number;
  _sample(name: string, time: number): void;
}

/** Advance the fire clock once, then let the adapter apply its own mechanical overrides. */
export function sampleAuthoredFire(
  state: AuthoredFireState,
  clips: { Fire: { duration: number } },
  dt: number,
  clipName: string | null,
  clipTime: number,
  empty: boolean,
  aliases: Record<string, string> = MAGAZINE_ALIASES
): string | undefined {
  state.fireTime += dt;
  const gesture = clipName === null ? undefined : aliases[clipName];
  if (gesture) state._sample(gesture, clipTime);
  else if (state.fireTime < clips.Fire.duration)
    state._sample(empty ? 'Last_Shot' : 'Fire', state.fireTime);
  else state._sample('Idle', 0);
  return gesture;
}

export function disposeAuthoredMixer(state: {
  mixer: THREE.AnimationMixer;
  root: THREE.Object3D;
}): void {
  state.mixer.stopAllAction();
  state.mixer.uncacheRoot(state.root);
}

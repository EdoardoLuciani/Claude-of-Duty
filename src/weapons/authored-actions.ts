import * as THREE from 'three';

interface AuthoredActionState {
  mixer: THREE.AnimationMixer;
  actions: Record<string, THREE.AnimationAction>;
  name: string | null;
}

export function createAuthoredActions(mixer: THREE.AnimationMixer, clips: THREE.AnimationClip[]): Record<string, THREE.AnimationAction> {
  const actions: Record<string, THREE.AnimationAction> = {};
  for (const clip of clips) {
    const action = mixer.clipAction(clip);
    action.setLoop(THREE.LoopOnce, 1); action.clampWhenFinished = true;
    actions[clip.name] = action;
  }
  return actions;
}

/** Sample authored time without advancing the mixer; mechanism overrides stay in each adapter. */
export function sampleAuthoredAction(state: AuthoredActionState, name: string, time: number): void {
  if (name !== state.name) {
    if (state.name) state.actions[state.name].stop();
    state.actions[name].reset().play(); state.name = name;
  }
  const action = state.actions[name];
  action.paused = false; action.time = Math.min(time, action.getClip().duration);
  state.mixer.update(0);
}

import { Vector3 } from 'three'

// Mutable clock shared by the scene, the beats and the HUD. Advanced inside the Canvas each
// frame while playing; the HUD mirrors it at a few hertz. No React state on the hot path.
export interface DemoState {
  /** Seconds since Play. */
  t: number
  playing: boolean
  /** True once the show has reached the end; the camera hands back to the user. */
  done: boolean
  /** Bumped by every Play so the beats know to reset. */
  run: number
  /** 0..1 camera shake requested this frame; the camera decays it. */
  shake: number
  /** Live world positions the camera can track, e.g. the kaiju. */
  subjects: Record<string, Vector3>
}

export function createDemoState(): DemoState {
  return { t: 0, playing: false, done: false, run: 0, shake: 0, subjects: {} }
}

export function startDemo(state: DemoState) {
  state.t = 0
  state.playing = true
  state.done = false
  state.shake = 0
  state.run += 1
}

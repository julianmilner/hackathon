import { forwardRef, useEffect, useImperativeHandle, useMemo } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import type { Matrix4 } from 'three'
import { KaijuActor, type KaijuActorOptions } from './KaijuActor'
import type { KaijuEvent } from './KaijuBehaviour'

export interface KaijuProps {
  options?: KaijuActorOptions
  /** Local frame (x east, y up, z south, metres) to world. Omit for identity. */
  frame?: Matrix4
  /** Footsteps, hits, roars and state changes; drive camera shake and sound from here. */
  onEvent?: (event: KaijuEvent) => void
}

/**
 * react-three-fiber wrapper. Adds the actor's group to the scene and steps it each frame.
 * Drive it through the ref: `ref.current.setTerrain(field)`, `ref.current.rise()`.
 */
export const Kaiju = forwardRef<KaijuActor, KaijuProps>(function Kaiju({ options, frame, onEvent }, ref) {
  const gl = useThree((s) => s.gl)
  // options are read once; remount with a `key` to change spawn, target or height
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const actor = useMemo(() => new KaijuActor(options, gl), [gl])

  useEffect(() => {
    if (frame) actor.setFrame(frame)
  }, [actor, frame])

  useEffect(() => (onEvent ? actor.on(onEvent) : undefined), [actor, onEvent])

  useEffect(() => () => actor.dispose(), [actor])

  useImperativeHandle(ref, () => actor, [actor])
  useFrame((_, delta) => actor.update(Math.min(delta, 0.1)))

  return <primitive object={actor.group} />
})

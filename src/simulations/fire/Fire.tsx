import { forwardRef, useEffect, useImperativeHandle, useMemo } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import type { Matrix4 } from 'three'
import { FireSimulation, type FireOptions } from './FireSimulation'

export interface FireProps {
  options?: FireOptions
  /** Local frame (x east, y up, z south, metres) to world. Omit for identity. */
  frame?: Matrix4
}

/**
 * react-three-fiber wrapper. Adds the simulation group to the scene and steps it each frame.
 * Drive it through the ref: `ref.current.sampleTerrain(target)`, `ref.current.ignite({...})`.
 */
export const Fire = forwardRef<FireSimulation, FireProps>(function Fire({ options, frame }, ref) {
  const gl = useThree((s) => s.gl)
  // options are read once; remount with a `key` to change resolution or size
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const sim = useMemo(() => new FireSimulation(gl, options), [gl])

  useEffect(() => {
    if (frame) sim.setFrame(frame)
  }, [sim, frame])

  useEffect(() => () => sim.dispose(), [sim])

  useImperativeHandle(ref, () => sim, [sim])
  useFrame((_, delta) => sim.update(delta))

  return <primitive object={sim.group} />
})

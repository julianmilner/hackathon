import { forwardRef, useEffect, useImperativeHandle, useMemo } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import type { Matrix4 } from 'three'
import { TsunamiSimulation, type TsunamiOptions } from './TsunamiSimulation'

export interface TsunamiProps {
  options?: TsunamiOptions
  /** Local frame (x east, y up, z south, metres) to world. Omit for identity. */
  frame?: Matrix4
}

/**
 * react-three-fiber wrapper. Adds the simulation group to the scene and steps it each frame.
 * Drive it through the ref: `ref.current.sampleTerrain(target)`, `ref.current.trigger({...})`.
 */
export const Tsunami = forwardRef<TsunamiSimulation, TsunamiProps>(function Tsunami({ options, frame }, ref) {
  const gl = useThree((s) => s.gl)
  // options are read once; remount with a `key` to change resolution or size
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const sim = useMemo(() => new TsunamiSimulation(gl, options), [gl])

  useEffect(() => {
    if (frame) sim.setFrame(frame)
  }, [sim, frame])

  useEffect(() => () => sim.dispose(), [sim])

  useImperativeHandle(ref, () => sim, [sim])
  useFrame((_, delta) => sim.update(delta))

  return <primitive object={sim.group} />
})

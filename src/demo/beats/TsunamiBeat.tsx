import { useMemo, useRef, type RefObject } from 'react'
import { useFrame } from '@react-three/fiber'
import { Group, Matrix4 } from 'three'
import { toLocal } from '../../geo'
import { SEA_LEVEL } from '../../scene/terrain/Ocean'
import { Tsunami } from '../../simulations/tsunami/Tsunami'
import { TsunamiSimulation } from '../../simulations/tsunami/TsunamiSimulation'
import { BEATS, PLACES } from '../script'
import type { DemoState } from '../state'

interface Props {
  state: DemoState
  terrain: RefObject<Group | null>
}

const SIZE = 4000
const RESOLUTION = 256
/** Calm water sits just above the map's own ocean plane so the wave never z-fights it. */
const WATER_LEVEL = SEA_LEVEL + 0.4
/** Simulated seconds per real second; wave timings below are in simulated seconds. */
const TIME_SCALE = 16

// Wave out of Table Bay onto the Foreshore and up into the City Bowl. The patch is sampled
// from the live terrain when the beat fires; undisturbed sea stays invisible (calmFade).
export function TsunamiBeat({ state, terrain }: Props) {
  const sim = useRef<TsunamiSimulation>(null)
  const frame = useMemo(() => {
    const c = toLocal(PLACES.tsunamiCentre.lat, PLACES.tsunamiCentre.lon)
    return new Matrix4().makeTranslation(c.x, 0, c.z)
  }, [])
  const run = useRef(-1)
  const triggered = useRef(false)
  const sampled = useRef(false)

  useFrame(() => {
    const wave = sim.current
    if (!wave) return
    if (state.run !== run.current) {
      run.current = state.run
      triggered.current = false
      wave.reset()
    }
    if (state.playing && !triggered.current && state.t >= BEATS.tsunami) {
      triggered.current = true
      if (!sampled.current && terrain.current) {
        sampled.current = true
        // Table Mountain is inside the patch, so allow heights well above the 600 m default.
        wave.sampleTerrain(terrain.current, { maxHeight: 1500, minHeight: -300, seaFloor: 'flat', shoreTolerance: 1.2 })
      }
      wave.trigger({ amplitude: 18, drawbackTime: 16, riseTime: 30, holdTime: 420, fallTime: 200 })
    }
  })

  return (
    <Tsunami
      ref={sim}
      frame={frame}
      options={{
        size: SIZE,
        resolution: RESOLUTION,
        seaLevel: WATER_LEVEL,
        seaDepth: 12,
        sourceEdge: 'north',
        timeScale: TIME_SCALE,
        maxSpeed: 16,
        heightScale: 1.25,
        drainRate: 0.004,
        calmFade: 1,
      }}
    />
  )
}

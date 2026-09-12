import { useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import { latToMercY, lonToMercX, toLocal } from '../../geo'
import type { SimState } from '../../scene/koeberg/Accident'
import { Koeberg } from '../../scene/koeberg/Koeberg'
import type { ProcessState } from '../../scene/koeberg/ProcessFlow'
import { EXPLOSION_T, KOEBERG, WIND_PRESETS } from '../../scene/koeberg/site'
import type { HeightField } from '../../scene/terrain/heightfield'
import { groundHeight } from '../../scene/terrain/tileGeometry'
import { BEATS } from '../script'
import type { DemoState } from '../state'

interface Props {
  state: DemoState
  heightField: HeightField | null
}

// The station on its real site, 30 km up the coast. The accident timeline sits at "normal
// operation" until the camera arrives, then jumps to the seconds before the detonation.
export function KoebergBeat({ state, heightField }: Props) {
  const sim = useMemo<SimState>(
    () => ({ t: 0, playing: false, speed: 1, wind: WIND_PRESETS[0], shake: 0, storySeconds: 0, plumeFront: 0 }),
    [],
  )
  const process = useMemo<ProcessState>(() => ({ flow: 1, coreHeat: 0, spin: 1 }), [])
  const local = useMemo(() => toLocal(KOEBERG.lat, KOEBERG.lon), [])
  const y = heightField
    ? Math.max(groundHeight(heightField, lonToMercX(KOEBERG.lon), latToMercY(KOEBERG.lat)), 2)
    : KOEBERG.platformAboveSea
  const run = useRef(-1)
  const started = useRef(false)

  useFrame(() => {
    if (state.run !== run.current) {
      run.current = state.run
      started.current = false
      sim.t = 0
      sim.playing = false
    }
    if (state.playing && !started.current && state.t >= BEATS.koebergArrive) {
      started.current = true
      sim.t = Math.max(0, EXPLOSION_T - (BEATS.explosion - BEATS.koebergArrive))
      sim.playing = true
    }
    state.shake = Math.max(state.shake, sim.shake)
  })

  return <Koeberg mode="accident" sim={sim} process={process} region={false} position={[local.x, y, local.z]} />
}

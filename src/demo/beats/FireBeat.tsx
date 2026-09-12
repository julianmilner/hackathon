import { useMemo, useRef, type RefObject } from 'react'
import { useFrame, useLoader } from '@react-three/fiber'
import { Group, Matrix4 } from 'three'
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js'
import { toLocal } from '../../geo'
import { Fire } from '../../simulations/fire/Fire'
import { FireSimulation } from '../../simulations/fire/FireSimulation'
import { Fynbos } from '../../simulations/fire/Fynbos'
import { BEATS, PLACES } from '../script'
import type { DemoState } from '../state'

interface Props {
  state: DemoState
  /** The terrain group to sample heights from; must be loaded before the beat fires. */
  terrain: RefObject<Group | null>
}

const SIZE = 3000
const RESOLUTION = 256

// Wildfire on the Devil's Peak slopes above District Six. Terrain is sampled from the live
// map the first time the beat fires; fynbos is scattered over the fuel cells at the same time.
export function FireBeat({ state, terrain }: Props) {
  const sim = useRef<FireSimulation>(null)
  const centre = useMemo(() => toLocal(PLACES.fireCentre.lat, PLACES.fireCentre.lon), [])
  const frame = useMemo(() => new Matrix4().makeTranslation(centre.x, 0, centre.z), [centre])
  const gltf = useLoader(GLTFLoader, `${import.meta.env.BASE_URL}models/fynbos.glb`)
  const fynbos = useRef<Fynbos | null>(null)
  const run = useRef(-1)
  const lit = useRef(false)
  const sampled = useRef(false)

  useFrame(() => {
    const fire = sim.current
    if (!fire) return
    if (state.run !== run.current) {
      run.current = state.run
      lit.current = false
      fire.reset()
    }
    if (state.playing && !lit.current && state.t >= BEATS.fire) {
      lit.current = true
      if (!sampled.current && terrain.current) {
        sampled.current = true
        fire.sampleTerrain(terrain.current)
        fynbos.current = new Fynbos(fire, gltf.scene, { count: 18000 })
      }
      for (const p of PLACES.fireIgnitions) {
        const l = toLocal(p.lat, p.lon)
        fire.ignite({ x: l.x - centre.x, z: l.z - centre.z, radius: 45, windFrom: 135, windSpeed: 12, humidity: 0.15 })
      }
    }
    fynbos.current?.update()
  })

  return (
    <Fire
      ref={sim}
      frame={frame}
      options={{ size: SIZE, resolution: RESOLUTION, fuelMinHeight: 60, timeScale: 90, light: false, seed: 3, flameCount: 4000, smokeCount: 3000 }}
    />
  )
}

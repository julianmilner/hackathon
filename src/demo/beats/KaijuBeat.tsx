import { useCallback, useEffect, useMemo, useRef, type RefObject } from 'react'
import { useFrame } from '@react-three/fiber'
import { Vector3 } from 'three'
import { latToMercY, lonToMercX, toLatLon, toLocal } from '../../geo'
import { SEA_LEVEL } from '../../scene/terrain/Ocean'
import type { HeightField } from '../../scene/terrain/heightfield'
import { groundHeight } from '../../scene/terrain/tileGeometry'
import { Kaiju } from '../../simulations/kaiju/Kaiju'
import { KaijuActor } from '../../simulations/kaiju/KaijuActor'
import type { KaijuEvent } from '../../simulations/kaiju/KaijuBehaviour'
import { BEATS, PLACES } from '../script'
import type { DemoState } from '../state'
import type { TargetHandle } from './Target'

interface Props {
  state: DemoState
  heightField: HeightField | null
  target: RefObject<TargetHandle | null>
}

const HEIGHT = 300

// The Claude kaiju surfaces in Table Bay and walks the real ground (the map's height field)
// to Harrington Street. Its footsteps and hits shake the camera and crumble the building.
export function KaijuBeat({ state, heightField, target }: Props) {
  const actor = useRef<KaijuActor>(null)
  const spawn = useMemo(() => toLocal(PLACES.kaijuSpawn.lat, PLACES.kaijuSpawn.lon), [])
  const goal = useMemo(() => toLocal(PLACES.roamwork.lat, PLACES.roamwork.lon), [])
  const run = useRef(-1)
  const risen = useRef(false)
  const hfRef = useRef<HeightField | null>(null)

  useEffect(() => {
    hfRef.current = heightField
    state.subjects.kaiju ??= new Vector3(spawn.x, SEA_LEVEL, spawn.z)
    const k = actor.current
    if (!k || !heightField) return
    k.setGround((x, z) => {
      const ll = toLatLon(x, z)
      return groundHeight(heightField, lonToMercX(ll.lon), latToMercY(ll.lat))
    })
  }, [heightField, state, spawn])

  const onEvent = useCallback(
    (e: KaijuEvent) => {
      if (e.type === 'footstep') state.shake = Math.max(state.shake, 0.35)
      if (e.type === 'roar') state.shake = Math.max(state.shake, 0.45)
      if (e.type === 'hit') {
        state.shake = Math.max(state.shake, 0.8)
        const t = target.current
        if (t && Math.hypot(e.x - t.position.x, e.z - t.position.z) < 0.6 * HEIGHT) t.hit()
      }
    },
    [state, target],
  )

  useFrame(() => {
    const k = actor.current
    if (!k) return
    if (state.run !== run.current) {
      run.current = state.run
      risen.current = false
      k.reset()
      target.current?.reset()
      state.subjects.kaiju?.set(spawn.x, SEA_LEVEL, spawn.z)
    }
    if (state.playing && !risen.current && state.t >= BEATS.kaiju) {
      risen.current = true
      k.rise({ x: goal.x, z: goal.z })
    }
    if (k.behaviour.active) {
      const p = k.behaviour.pose
      // Look at the chest, not the feet.
      state.subjects.kaiju?.set(p.x, Math.max(p.ground, SEA_LEVEL) + 0.45 * HEIGHT - p.sink * 0.5, p.z)
    }
  })

  return (
    <Kaiju
      ref={actor}
      onEvent={onEvent}
      options={{
        spawn: { x: spawn.x, z: spawn.z },
        target: { x: goal.x, z: goal.z },
        height: HEIGHT,
        speed: 230,
        turnRate: 1.2,
        attackRange: 0.62 * HEIGHT,
        seaLevel: SEA_LEVEL,
        arrivalSequence: ['Attack', 'Roar', 'Attack', 'Stomp', 'Roar'],
        idleTauntInterval: 5,
      }}
    />
  )
}

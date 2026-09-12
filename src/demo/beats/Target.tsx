import { forwardRef, useImperativeHandle, useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import { Color, Group, Mesh, MeshBasicMaterial, MeshStandardMaterial } from 'three'
import { latToMercY, lonToMercX, toLocal } from '../../geo'
import { Labels } from '../../scene/koeberg/Labels'
import type { HeightField } from '../../scene/terrain/heightfield'
import { groundHeight } from '../../scene/terrain/tileGeometry'
import { PLACES } from '../script'

export interface TargetHandle {
  /** One kaiju hit: the building crumbles a step. */
  hit(): void
  reset(): void
  /** World position of the building's centre. */
  readonly position: { x: number; y: number; z: number }
}

interface Props {
  heightField: HeightField | null
  labelContainer: HTMLElement | null
}

const CREAM = new Color('#f0eee6')
const TERRACOTTA = new Color('#d97757')
const RUBBLE = new Color('#2a2622')

// Roamwork, 50 Harrington Street: a stand-in building (the map has none) with a beacon so it
// reads from three kilometres away, and a label. It crumbles as the kaiju hits it.
export const Target = forwardRef<TargetHandle, Props>(function Target({ heightField, labelContainer }, ref) {
  const group = useRef<Group>(null)
  const building = useRef<Group>(null)
  const beacon = useRef<Mesh>(null)
  const ring = useRef<Mesh>(null)
  const walls = useMemo(() => new MeshStandardMaterial({ color: CREAM.clone(), roughness: 0.85 }), [])
  const roof = useMemo(() => new MeshStandardMaterial({ color: TERRACOTTA.clone(), roughness: 0.8 }), [])
  const beaconMat = useMemo(
    () => new MeshBasicMaterial({ color: '#ffd9a8', transparent: true, opacity: 0.35, depthWrite: false }),
    [],
  )
  const ringMat = useMemo(
    () => new MeshBasicMaterial({ color: '#ffb64a', transparent: true, opacity: 0.6, depthWrite: false }),
    [],
  )
  const local = useMemo(() => toLocal(PLACES.roamwork.lat, PLACES.roamwork.lon), [])
  const y = heightField
    ? Math.max(groundHeight(heightField, lonToMercX(PLACES.roamwork.lon), latToMercY(PLACES.roamwork.lat)), 0)
    : 40
  const hits = useRef(0)
  const wobble = useRef(0)

  const applyDamage = () => {
    const b = building.current
    if (!b) return
    const n = hits.current
    const k = Math.min(n / 3, 1)
    b.scale.y = Math.max(0.12, 1 - 0.3 * n)
    b.rotation.z = (n % 2 === 0 ? 1 : -1) * 0.06 * n
    b.rotation.x = 0.04 * n
    walls.color.copy(CREAM).lerp(RUBBLE, k)
    roof.color.copy(TERRACOTTA).lerp(RUBBLE, k)
    beaconMat.opacity = n >= 3 ? 0 : 0.35 * (1 - k)
    ringMat.opacity = n >= 3 ? 0 : 0.6
  }

  useImperativeHandle(
    ref,
    () => ({
      hit() {
        hits.current += 1
        wobble.current = 1
        applyDamage()
      },
      reset() {
        hits.current = 0
        applyDamage()
      },
      get position() {
        return { x: local.x, y, z: local.z }
      },
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [local, y],
  )

  useFrame(({ clock }, delta) => {
    const t = clock.elapsedTime
    if (ring.current) {
      const s = 60 + 50 * (0.5 + 0.5 * Math.sin(t * 2.2))
      ring.current.scale.set(s, s, 1)
    }
    if (beacon.current) beaconMat.opacity = hits.current >= 3 ? 0 : 0.25 + 0.12 * Math.sin(t * 3)
    if (wobble.current > 0 && building.current) {
      wobble.current = Math.max(0, wobble.current - delta / 0.5)
      building.current.position.x = (Math.random() - 0.5) * 3 * wobble.current
      building.current.position.z = (Math.random() - 0.5) * 3 * wobble.current
    }
  })

  const labels = useMemo(
    () => [{ id: 'roamwork', text: 'Roamwork', sub: '50 Harrington St · District Six', position: [0, 42, 0] as [number, number, number], maxDist: 6000 }],
    [],
  )

  return (
    <group ref={group} position={[local.x, y, local.z]}>
      <group ref={building}>
        <mesh position={[0, 11, 0]} material={walls}>
          <boxGeometry args={[36, 22, 28]} />
        </mesh>
        <mesh position={[0, 23, 0]} material={roof}>
          <boxGeometry args={[38, 2, 30]} />
        </mesh>
        <mesh position={[0, 26.5, 0]} material={roof}>
          <boxGeometry args={[10, 5, 10]} />
        </mesh>
      </group>
      <mesh ref={beacon} position={[0, 220, 0]} material={beaconMat} renderOrder={12}>
        <cylinderGeometry args={[2.5, 6, 440, 12, 1, true]} />
      </mesh>
      <mesh ref={ring} rotation-x={-Math.PI / 2} position-y={1.5} material={ringMat} renderOrder={12}>
        <ringGeometry args={[0.9, 1, 64]} />
      </mesh>
      <Labels items={labels} container={labelContainer} parent={group} />
    </group>
  )
})

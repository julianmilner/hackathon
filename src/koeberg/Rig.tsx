import { useEffect, useMemo, useRef } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import { MathUtils, Vector3 } from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import type { SimState } from '../scene/koeberg/Accident'

const easeInOutCubic = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2)

export interface View {
  id: string
  name: string
  position: [number, number, number]
  target: [number, number, number]
  durationMs?: number
}

// Plant axes in the true frame (x east, z south): u runs ENE across the site, v runs NNW along it.
const U = new Vector3(Math.cos((22 * Math.PI) / 180), 0, -Math.sin((22 * Math.PI) / 180))
const V = new Vector3(-Math.sin((22 * Math.PI) / 180), 0, -Math.cos((22 * Math.PI) / 180))
const at = (u: number, v: number, y: number): [number, number, number] => [U.x * u + V.x * v, y, U.z * u + V.z * v]

export const VIEWS: View[] = [
  { id: 'photo', name: 'Front', position: at(500, -60, 16), target: at(20, 0, 24) },
  { id: 'aerial', name: 'Aerial', position: at(720, -640, 380), target: at(-20, 20, 12) },
  { id: 'domes', name: 'Domes', position: at(130, -190, 78), target: at(0, 10, 36) },
  { id: 'sea', name: 'From the sea', position: at(-620, 260, 110), target: at(-40, 0, 20) },
  { id: 'inside', name: 'Inside Unit 1', position: at(62, -2, 46), target: at(0, 44, 17) },
  { id: 'turbine', name: 'Turbine hall', position: at(140, 110, 70), target: at(58, 20, 16) },
]

// Views that depend on where the plume is going.
export function plumeView(fromDeg: number): View {
  const a = ((fromDeg + 180) * Math.PI) / 180
  const dx = Math.sin(a), dz = -Math.cos(a)           // plume travel direction
  const cx = -dz, cz = dx                              // crosswind
  return {
    id: 'plume', name: 'Plume', durationMs: 3200,
    position: [cx * 720 - dx * 520, 280, cz * 720 - dz * 520],
    target: [dx * 650, 180, dz * 650],
  }
}

export function regionView(fromDeg: number): View {
  const a = ((fromDeg + 180) * Math.PI) / 180
  const dx = Math.sin(a), dz = -Math.cos(a)
  const cx = -dz, cz = dx
  return {
    id: 'region', name: 'Region', durationMs: 4200,
    position: [-dx * 9000 + cx * 7000, 16000, -dz * 9000 + cz * 7000],
    target: [dx * 13000, 0, dz * 13000],
  }
}

// Close on the Unit 1 containment: the hydrogen collecting under the dome, then the breach.
export const U1_DOME_VIEW: View = { id: 'u1dome', name: 'Unit 1 dome', position: at(78, -30, 74), target: at(0, 44, 42) }

export function findView(id: string | null | undefined) {
  return VIEWS.find((v) => v.id === id)
}

interface Flight {
  fromPos: Vector3
  fromTarget: Vector3
  toPos: Vector3
  toTarget: Vector3
  start: number
  duration: number
}

interface Props {
  view: View
  sim: SimState
  // Bumps whenever the same view is requested again.
  viewNonce: number
  onControls?: (c: OrbitControls) => void
  // Fired when the user starts dragging or zooming, so guided camera moves can stand down.
  onUserInteract?: () => void
}

export function Rig({ view, sim, viewNonce, onControls, onUserInteract }: Props) {
  const camera = useThree((s) => s.camera)
  const gl = useThree((s) => s.gl)
  const flight = useRef<Flight | null>(null)
  const first = useRef(true)

  const controls = useMemo(() => {
    const c = new OrbitControls(camera, gl.domElement)
    c.enableDamping = true
    c.dampingFactor = 0.08
    c.minDistance = 15
    c.maxDistance = 60000
    c.maxPolarAngle = Math.PI / 2 - 0.02
    c.screenSpacePanning = false
    return c
  }, [camera, gl])

  useEffect(() => {
    onControls?.(controls)
    const onStart = () => { if (controls.enabled) onUserInteract?.() }
    controls.addEventListener('start', onStart)
    return () => {
      controls.removeEventListener('start', onStart)
      controls.dispose()
    }
  }, [controls, onControls, onUserInteract])

  useEffect(() => {
    const toPos = new Vector3(...view.position)
    const toTarget = new Vector3(...view.target)
    if (first.current) {
      first.current = false
      camera.position.copy(toPos)
      controls.target.copy(toTarget)
      controls.update()
      return
    }
    flight.current = {
      fromPos: camera.position.clone(),
      fromTarget: controls.target.clone(),
      toPos,
      toTarget,
      start: performance.now(),
      duration: view.durationMs ?? 2400,
    }
  }, [view, viewNonce, camera, controls])

  useFrame(() => {
    const f = flight.current
    if (f) {
      const t = MathUtils.clamp((performance.now() - f.start) / f.duration, 0, 1)
      const s = easeInOutCubic(t)
      camera.position.lerpVectors(f.fromPos, f.toPos, s)
      controls.target.lerpVectors(f.fromTarget, f.toTarget, s)
      controls.enabled = false
      if (t >= 1) {
        flight.current = null
        controls.enabled = true
      }
    }
    controls.update()
    if (sim.shake > 0.001) {
      const k = sim.shake * sim.shake * 1.6
      camera.position.x += (Math.random() - 0.5) * k
      camera.position.y += (Math.random() - 0.5) * k
      camera.position.z += (Math.random() - 0.5) * k
    }
    camera.lookAt(controls.target)
  })

  return null
}

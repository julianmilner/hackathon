import { useEffect, useMemo, useRef } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import { AdditiveBlending, BufferAttribute, BufferGeometry, Color, Points, PointsMaterial } from 'three'
import type { ModelParts } from './KoebergModel'
import { buildFlowPath, FLOW_STYLES, particleSprite, PRIMARY_TEMPS, SECONDARY_TEMPS, TERTIARY_TEMPS, type FlowPath, type FlowStyle } from './flow'

// Shared mutable state driven by the accident timeline and read here every frame.
export interface ProcessState {
  // 1 = pumps running at full flow, 0 = stopped.
  flow: number
  // 0 = normal operating temperature, 1 = white-hot melting core.
  coreHeat: number
  // Turbine speed fraction.
  spin: number
}

interface Props {
  parts: ModelParts
  state: ProcessState
  visible: boolean
}

interface System {
  points: Points
  geometry: BufferGeometry
  paths: { path: FlowPath; offsets: Float32Array; count: number }[]
  style: FlowStyle
  phase: number
}

const tmp = new Color()

function buildSystem(paths: FlowPath[], style: FlowStyle): System {
  const per = paths.map((p) => {
    const count = Math.max(8, Math.round(p.length * style.density))
    const offsets = new Float32Array(count)
    for (let i = 0; i < count; i++) offsets[i] = (i / count) * p.length + Math.random() * 0.4
    return { path: p, offsets, count }
  })
  const total = per.reduce((s, p) => s + p.count, 0)
  const geometry = new BufferGeometry()
  geometry.setAttribute('position', new BufferAttribute(new Float32Array(total * 3), 3))
  geometry.setAttribute('color', new BufferAttribute(new Float32Array(total * 3), 3))
  const material = new PointsMaterial({
    size: style.size,
    map: particleSprite(),
    vertexColors: true,
    transparent: true,
    depthWrite: false,
    blending: AdditiveBlending,
    sizeAttenuation: true,
  })
  const points = new Points(geometry, material)
  points.frustumCulled = false
  points.renderOrder = 20
  return { points, geometry, paths: per, style, phase: 0 }
}

// Glowing particles travelling along the primary, secondary and tertiary loops of both units.
export function ProcessFlow({ parts, state, visible }: Props) {
  const systems = useMemo(() => {
    const P = parts.anchors.paths
    const prim: FlowPath[] = []
    const sec: FlowPath[] = []
    const ter: FlowPath[] = []
    for (const [name, pts] of Object.entries(P)) {
      if (name.includes('primary')) prim.push(buildFlowPath(pts, PRIMARY_TEMPS, true, 300))
      else if (name.includes('secondary')) sec.push(buildFlowPath(pts, SECONDARY_TEMPS, false, 600))
      else if (name.includes('tertiary')) ter.push(buildFlowPath(pts, TERTIARY_TEMPS, false, 900))
    }
    return [buildSystem(prim, FLOW_STYLES.primary), buildSystem(sec, FLOW_STYLES.secondary), buildSystem(ter, FLOW_STYLES.tertiary)]
  }, [parts])

  useEffect(() => () => systems.forEach((s) => { s.geometry.dispose(); (s.points.material as PointsMaterial).dispose() }), [systems])

  const groupRef = useRef<Points[]>([])
  const invalidate = useThree((s) => s.invalidate)

  useFrame((_, delta) => {
    if (!visible) return
    // The city canvas renders on demand; keep asking for frames while the flow animates.
    invalidate()
    const dt = Math.min(delta, 0.05)
    for (const sys of systems) {
      sys.phase += dt * sys.style.speed * state.flow
      const pos = sys.geometry.getAttribute('position') as BufferAttribute
      const col = sys.geometry.getAttribute('color') as BufferAttribute
      let k = 0
      for (const { path, offsets, count } of sys.paths) {
        const L = path.length
        for (let i = 0; i < count; i++) {
          let d = (offsets[i] + sys.phase) % L
          if (d < 0) d += L
          const u = d / L
          const s = u * (path.closed ? path.samples : path.samples - 1)
          const i0 = Math.floor(s) % path.samples
          const i1 = (i0 + 1) % path.samples
          const f = s - Math.floor(s)
          const x = path.positions[i0 * 3] * (1 - f) + path.positions[i1 * 3] * f
          const y = path.positions[i0 * 3 + 1] * (1 - f) + path.positions[i1 * 3 + 1] * f
          const z = path.positions[i0 * 3 + 2] * (1 - f) + path.positions[i1 * 3 + 2] * f
          pos.setXYZ(k, x, y, z)
          const t = Math.min(1, path.temps[i0] * (1 - f) + path.temps[i1] * f + state.coreHeat * 0.6)
          tmp.copy(sys.style.cold).lerp(sys.style.hot, t)
          // dim when the flow stalls so a stopped loop reads as "dead"
          const dim = 0.35 + 0.65 * state.flow
          col.setXYZ(k, tmp.r * dim, tmp.g * dim, tmp.b * dim)
          k++
        }
      }
      pos.needsUpdate = true
      col.needsUpdate = true
    }
    // turbine rotors spin about their own axis (the shaft runs along local Z after glTF export)
    for (const r of parts.rotors) r.rotateZ(dt * 3.5 * state.spin)
    // the core glows brighter as it overheats
    for (const c of parts.cores) {
      const m = c.solid
      const h = state.coreHeat
      m.emissive.setRGB(1.0, 0.45 + 0.55 * h, 0.1 + 0.8 * h)
      m.emissiveIntensity = 2.2 + h * 9 + Math.sin(performance.now() * 0.004) * 0.3
    }
  })

  return (
    <group visible={visible}>
      {systems.map((s, i) => (
        <primitive key={i} object={s.points} ref={(p: Points) => { groupRef.current[i] = p }} />
      ))}
    </group>
  )
}

import { useEffect, useMemo, useRef } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import {
  AdditiveBlending, type Blending, BufferAttribute, BufferGeometry, Color, DoubleSide, Mesh, MeshBasicMaterial, MeshStandardMaterial,
  NormalBlending, PlaneGeometry, Points, Quaternion, RingGeometry, ShaderMaterial, SphereGeometry, Vector3,
} from 'three'
import type { ModelParts } from './KoebergModel'
import type { ProcessState } from './ProcessFlow'
import { smokeSprite } from './flow'
import { EXPLOSION_T, KOEBERG, plumeDirection, type WindPreset } from './site'

// Mutable timeline state shared with the HUD. Advanced here every frame while playing.
export interface SimState {
  t: number
  playing: boolean
  speed: number
  wind: WindPreset
  // Camera shake intensity, read by the camera rig.
  shake: number
  // Story clock: seconds after the explosion, compressed (1 sim second = STORY_RATE seconds).
  storySeconds: number
  plumeFront: number // metres downwind
}

export const STORY_RATE = 120 // one sim second after the explosion = two minutes of story time

interface Props {
  parts: ModelParts
  sim: SimState
  process: ProcessState
  active: boolean
}

// ------------------------------------------------------------------ particle system
const particleVert = /* glsl */ `
  attribute float aSize;
  attribute float aAlpha;
  varying float vAlpha;
  varying vec3 vColor;
  void main() {
    vColor = color;
    vAlpha = aAlpha;
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    gl_PointSize = aSize * (600.0 / max(1.0, -mv.z));
    gl_Position = projectionMatrix * mv;
  }
`
const particleFrag = /* glsl */ `
  uniform sampler2D uMap;
  varying float vAlpha;
  varying vec3 vColor;
  void main() {
    vec4 t = texture2D(uMap, gl_PointCoord);
    gl_FragColor = vec4(vColor, t.a * vAlpha);
    if (gl_FragColor.a < 0.003) discard;
  }
`

interface ParticleSystem {
  points: Points
  geometry: BufferGeometry
  n: number
  pos: Float32Array
  vel: Float32Array
  age: Float32Array
  life: Float32Array
  kind: Uint8Array // 0 dead, 1 fire, 2 smoke, 3 steam, 4 hydrogen, 5 plume
  color: BufferAttribute
  size: BufferAttribute
  alpha: BufferAttribute
  next: number
}

function makeParticles(n: number, blending: Blending): ParticleSystem {
  const geometry = new BufferGeometry()
  const pos = new Float32Array(n * 3)
  geometry.setAttribute('position', new BufferAttribute(pos, 3))
  const color = new BufferAttribute(new Float32Array(n * 3), 3)
  const size = new BufferAttribute(new Float32Array(n), 1)
  const alpha = new BufferAttribute(new Float32Array(n), 1)
  geometry.setAttribute('color', color)
  geometry.setAttribute('aSize', size)
  geometry.setAttribute('aAlpha', alpha)
  const material = new ShaderMaterial({
    vertexShader: particleVert,
    fragmentShader: particleFrag,
    uniforms: { uMap: { value: smokeSprite() } },
    vertexColors: true,
    transparent: true,
    depthWrite: false,
    blending,
  })
  const points = new Points(geometry, material)
  points.frustumCulled = false
  points.renderOrder = 30
  return { points, geometry, n, pos, vel: new Float32Array(n * 3), age: new Float32Array(n), life: new Float32Array(n), kind: new Uint8Array(n), color, size, alpha, next: 0 }
}

function emit(ps: ParticleSystem, kind: number, p: Vector3, spread: number, v: Vector3, vSpread: number, life: number) {
  const i = ps.next
  ps.next = (ps.next + 1) % ps.n
  ps.pos[i * 3] = p.x + (Math.random() - 0.5) * spread
  ps.pos[i * 3 + 1] = p.y + (Math.random() - 0.5) * spread
  ps.pos[i * 3 + 2] = p.z + (Math.random() - 0.5) * spread
  ps.vel[i * 3] = v.x + (Math.random() - 0.5) * vSpread
  ps.vel[i * 3 + 1] = v.y + (Math.random() - 0.5) * vSpread
  ps.vel[i * 3 + 2] = v.z + (Math.random() - 0.5) * vSpread
  ps.age[i] = 0
  ps.life[i] = life * (0.7 + Math.random() * 0.6)
  ps.kind[i] = kind
}

function clearParticles(ps: ParticleSystem) {
  ps.kind.fill(0)
  ps.alpha.array.fill(0)
  ps.alpha.needsUpdate = true
}

// ------------------------------------------------------------------ footprint shader
// Gaussian plume, Pasquill-Gifford class D, effective release height 300 m. Indicative only:
// it shows where fallout would concentrate for a given wind, not a dose calculation.
const footprintVert = /* glsl */ `
  varying vec2 vLocal;
  void main() {
    vLocal = position.xy;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`
const footprintFrag = /* glsl */ `
  uniform vec2 uDir;      // plume travel direction in plane coordinates
  uniform float uFront;   // metres the plume has travelled
  uniform float uOpacity;
  uniform float uChiRef;  // centreline maximum, computed on the CPU with the same formula
  varying vec2 vLocal;
  void main() {
    // plane is rotated flat: local x = east, local y = north
    vec2 p = vLocal;
    float x = dot(p, uDir);          // downwind
    float y = dot(p, vec2(-uDir.y, uDir.x)); // crosswind
    if (x < 300.0) discard;
    float sy = 0.08 * x / sqrt(1.0 + 0.0001 * x);
    float sz = 0.06 * x / sqrt(1.0 + 0.0015 * x);
    float H = 300.0;
    // elevated release from the fire plume plus a ground-level leak from the breached building
    // deposition depletes the plume as it travels (e-folding length 30 km)
    float chi = exp(-0.5 * y * y / (sy * sy)) * (exp(-0.5 * H * H / (sz * sz)) + 0.25) / (sy * sz) * exp(-x / 30000.0);
    float lc = log(chi / uChiRef) / log(10.0);
    vec3 col; float a;
    if (lc > -0.5)       { col = vec3(0.86, 0.12, 0.10); a = 0.55; }
    else if (lc > -1.2)  { col = vec3(0.95, 0.48, 0.10); a = 0.45; }
    else if (lc > -1.8)  { col = vec3(0.98, 0.85, 0.25); a = 0.32; }
    else discard;
    // reveal as the front advances
    a *= 1.0 - smoothstep(uFront - 1500.0, uFront + 500.0, x);
    gl_FragColor = vec4(col, a * uOpacity);
    if (gl_FragColor.a < 0.01) discard;
  }
`

// Reference concentration: the footprint formula on the centreline 3 km downwind. Bands are
// decades below this, so red reaches roughly 8 km, orange 30 km and yellow 50 km.
function centrelineMax() {
  const x = 3000
  const sy = (0.08 * x) / Math.sqrt(1 + 0.0001 * x)
  const sz = (0.06 * x) / Math.sqrt(1 + 0.0015 * x)
  return ((Math.exp((-0.5 * 300 * 300) / (sz * sz)) + 0.25) / (sy * sz)) * Math.exp(-x / 30000)
}

// ------------------------------------------------------------------ component
const _v = new Vector3()
const _v2 = new Vector3()
const _q = new Quaternion()
const _axis = new Vector3()
const COL = new Color()

export function Accident({ parts, sim, process, active }: Props) {
  const camera = useThree((s) => s.camera)
  const invalidate = useThree((s) => s.invalidate)
  const apex = useMemo(() => new Vector3(...parts.anchors.points.u1_dome_apex), [parts])
  const u1 = useMemo(() => new Vector3(...parts.anchors.meta.units.u1), [parts])
  const stackTop = useMemo(() => new Vector3(...parts.anchors.points.stack_top), [parts])
  const site = useMemo(() => makeParticles(4000, NormalBlending), [])
  const plume = useMemo(() => makeParticles(2500, NormalBlending), [])
  const flash = useMemo(() => new Mesh(new SphereGeometry(1, 24, 16), new MeshBasicMaterial({ color: '#fff6d8', transparent: true, opacity: 0, depthWrite: false, blending: AdditiveBlending })), [])
  const ring = useMemo(() => {
    const m = new Mesh(new RingGeometry(0.92, 1, 96), new MeshBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0, depthWrite: false, side: DoubleSide }))
    m.rotation.x = -Math.PI / 2
    return m
  }, [])
  const footprint = useMemo(() => {
    const geo = new PlaneGeometry(120000, 120000, 1, 1)
    const mat = new ShaderMaterial({
      vertexShader: footprintVert,
      fragmentShader: footprintFrag,
      uniforms: { uDir: { value: [0, -1] }, uFront: { value: 0 }, uOpacity: { value: 0 }, uChiRef: { value: centrelineMax() } },
      transparent: true,
      depthWrite: false,
      side: DoubleSide,
    })
    const m = new Mesh(geo, mat)
    m.rotation.x = -Math.PI / 2 // plane local y -> world -z (north)
    m.position.y = 2.5
    m.renderOrder = 10
    m.frustumCulled = false
    return m
  }, [])
  const epz = useMemo(() => {
    const mk = (r: number, w: number, c: string) => {
      const m = new Mesh(new RingGeometry(r - w, r, 256), new MeshBasicMaterial({ color: c, transparent: true, opacity: 0.55, depthWrite: false, side: DoubleSide }))
      m.rotation.x = -Math.PI / 2
      m.position.y = 3
      m.renderOrder = 11
      m.frustumCulled = false
      return m
    }
    return [mk(KOEBERG.paz, 70, '#ff6b4a'), mk(KOEBERG.upz, 180, '#ffb347')]
  }, [])

  // Per-part ghost materials so only Unit 1's containment goes see-through.
  const u1Ghost = useMemo(() => {
    const map = new Map<Mesh, { solid: MeshStandardMaterial; ghost: MeshStandardMaterial }>()
    for (const p of parts.exterior) {
      const n = p.mesh.name
      if (n.includes('_u1_') && (n.includes('cylinder') || n.includes('ringbeam') || n.includes('dome') || n.startsWith('shard_'))) {
        const g = p.solid.clone()
        g.transparent = true
        g.opacity = 1
        g.depthWrite = false
        map.set(p.mesh, { solid: p.solid, ghost: g })
      }
    }
    return map
  }, [parts])

  const state = useRef({ lastT: -1, launched: false, shardVel: [] as Vector3[], shardAng: [] as Vector3[], landed: [] as boolean[], smokeAcc: 0, plumeAcc: 0, steamAcc: 0, h2Acc: 0 })

  useEffect(() => () => {
    site.geometry.dispose(); plume.geometry.dispose(); flash.geometry.dispose(); ring.geometry.dispose(); footprint.geometry.dispose()
  }, [site, plume, flash, ring, footprint])

  // Reset when the mode is left or the timeline is scrubbed backwards.
  const reset = () => {
    const s = state.current
    s.launched = false
    s.shardVel = []
    for (const sh of parts.shards) {
      sh.mesh.position.copy(sh.restPosition)
      sh.mesh.quaternion.copy(sh.restQuaternion)
      sh.mesh.visible = true
    }
    for (const [mesh, mats] of u1Ghost) mesh.material = mats.solid
    clearParticles(site)
    clearParticles(plume)
    ;(flash.material as MeshBasicMaterial).opacity = 0
    ;(ring.material as MeshBasicMaterial).opacity = 0
    ;(footprint.material as ShaderMaterial).uniforms.uOpacity.value = 0
    sim.shake = 0
    sim.storySeconds = 0
    sim.plumeFront = 0
  }

  useEffect(() => {
    if (!active) {
      reset()
      process.flow = 1
      process.coreHeat = 0
      process.spin = 1
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active])

  useFrame((_, delta) => {
    if (!active) return
    invalidate() // demand-rendered canvases need a frame request while the timeline runs
    const dt = Math.min(delta, 0.05)
    const s = state.current
    if (sim.playing) sim.t = Math.min(sim.t + dt * sim.speed, 90)
    const t = sim.t
    if (t < s.lastT - 0.001) reset()
    s.lastT = t

    // --- process state driven by the timeline
    process.flow = t < 2 ? 1 : Math.max(0, 1 - (t - 2) / 5)
    process.spin = t < 2 ? 1 : Math.max(0, 1 - (t - 2) / 14)
    process.coreHeat = t < 8 ? 0 : t < EXPLOSION_T ? Math.min(1, (t - 8) / 13) : Math.max(0.55, 1 - (t - EXPLOSION_T) / 60)

    // --- containment ghosting from the hydrogen phase until the blast
    const ghostAmt = t < 13 ? 0 : t < 15 ? (t - 13) / 2 : t < EXPLOSION_T ? 1 : Math.max(0, 1 - (t - EXPLOSION_T) / 1.5)
    for (const [mesh, mats] of u1Ghost) {
      if (ghostAmt > 0.001) {
        mesh.material = mats.ghost
        mats.ghost.opacity = 1 - 0.78 * ghostAmt
        mesh.castShadow = false
      } else {
        mesh.material = mats.solid
        mesh.castShadow = true
      }
    }

    // --- relief valve steam (phase 2) and hydrogen haze under the dome (phase 3)
    if (t > 8 && t < EXPLOSION_T) {
      s.steamAcc += dt * 40
      while (s.steamAcc > 1) {
        s.steamAcc -= 1
        _v.copy(stackTop)
        emit(site, 3, _v, 1.5, _v2.set(0, 9, 0), 3, 4)
      }
    }
    if (t > 14 && t < EXPLOSION_T) {
      s.h2Acc += dt * 60
      while (s.h2Acc > 1) {
        s.h2Acc -= 1
        _v.set(u1.x + (Math.random() - 0.5) * 30, 34 + Math.random() * 15, u1.z + (Math.random() - 0.5) * 30)
        emit(site, 4, _v, 2, _v2.set(0, 0.6, 0), 0.6, 6)
      }
    }

    // --- detonation
    const te = t - EXPLOSION_T
    if (te >= 0 && !s.launched) {
      s.launched = true
      s.shardVel = parts.shards.map((sh) => {
        const d = _v.copy(sh.restPosition).sub(u1).setY(0)
        const r = Math.max(1, d.length())
        d.multiplyScalar(1 / r)
        const v = new Vector3(d.x * (30 + Math.random() * 40), 38 + Math.random() * 40, d.z * (30 + Math.random() * 40))
        return v
      })
      s.shardAng = parts.shards.map(() => new Vector3((Math.random() - 0.5) * 6, (Math.random() - 0.5) * 6, (Math.random() - 0.5) * 6))
      s.landed = parts.shards.map(() => false)
      // fireball
      for (let i = 0; i < 900; i++) {
        _v.copy(apex)
        _v2.set((Math.random() - 0.5) * 2, 0.6 + Math.random() * 0.8, (Math.random() - 0.5) * 2).normalize().multiplyScalar(35 + Math.random() * 55)
        emit(site, 1, _v, 12, _v2, 10, 2.2)
      }
      sim.shake = 1
    }
    if (te >= 0) {
      // flash and shock ring
      const fm = flash.material as MeshBasicMaterial
      const fs = Math.min(1, te / 0.7)
      flash.position.copy(apex)
      flash.scale.setScalar(4 + fs * 110)
      fm.opacity = Math.max(0, 1 - te / 0.8) * 0.95
      const rm = ring.material as MeshBasicMaterial
      const rs = Math.min(1, te / 3.2)
      ring.position.set(u1.x, 1.5, u1.z)
      ring.scale.setScalar(10 + rs * 900)
      rm.opacity = Math.max(0, 0.7 - rs * 0.7)
      sim.shake = Math.max(0, 1 - te / 2.2)

      // shards fly and tumble under gravity
      parts.shards.forEach((sh, i) => {
        if (s.landed[i]) return
        const v = s.shardVel[i]
        v.y -= 9.81 * dt
        sh.mesh.position.addScaledVector(v, dt)
        const w = s.shardAng[i]
        _axis.copy(w).normalize()
        _q.setFromAxisAngle(_axis, w.length() * dt)
        sh.mesh.quaternion.premultiply(_q)
        if (sh.mesh.position.y < 1.0) {
          sh.mesh.position.y = 1.0
          s.landed[i] = true
        }
      })

      // burning wreck: smoke for the next 40 seconds, thinning
      const burn = Math.max(0, 1 - te / 45)
      s.smokeAcc += dt * (140 * burn + 10)
      while (s.smokeAcc > 1) {
        s.smokeAcc -= 1
        _v.copy(apex).setY(apex.y - 6)
        emit(site, te < 1.5 ? 1 : 2, _v, 14, _v2.set(0, 14 + 10 * burn, 0), 6, 26)
      }

      // regional plume, emitted from the top of the column in story time
      const dir = plumeDirection(sim.wind.fromDeg)
      sim.storySeconds = Math.max(0, te - 1.5) * STORY_RATE
      sim.plumeFront = sim.storySeconds * sim.wind.speed
      placePlume(plume, u1, dir, sim.wind.speed, sim.storySeconds, camera.position.distanceTo(_v2.set(u1.x, 0, u1.z)) < 2500 ? 0.5 : 1)
      const fp = footprint.material as ShaderMaterial
      fp.uniforms.uDir.value = [dir.x, -dir.z] // plane local y is north
      fp.uniforms.uFront.value = sim.plumeFront
      fp.uniforms.uOpacity.value = Math.min(1, Math.max(0, (te - 1.5) / 3))
    }

    // --- integrate site-scale particles (real time)
    const windDir = plumeDirection(sim.wind.fromDeg)
    const wx = windDir.x * sim.wind.speed
    const wz = windDir.z * sim.wind.speed
    updateSite(site, dt, wx, wz)
  })

  const showRegion = active
  return (
    <group visible={active}>
      <primitive object={site.points} />
      <primitive object={plume.points} />
      <primitive object={flash} />
      <primitive object={ring} />
      <primitive object={footprint} />
      {showRegion && epz.map((m, i) => <primitive key={i} object={m} />)}
    </group>
  )
}

const FIRE = new Color('#ffb545')
const FIRE2 = new Color('#ff5a1a')
const SMOKE_DARK = new Color('#2a2622')
const SMOKE_LIGHT = new Color('#8a8580')
const STEAM = new Color('#ffffff')
const H2 = new Color('#b9d8ff')
const PLUME = new Color('#8f9377')

function updateSite(ps: ParticleSystem, dt: number, wx: number, wz: number) {
  const { pos, vel, age, life, kind, color, size, alpha, n } = ps
  const c = color.array as Float32Array
  const sz = size.array as Float32Array
  const al = alpha.array as Float32Array
  for (let i = 0; i < n; i++) {
    const k = kind[i]
    if (k === 0) { al[i] = 0; continue }
    age[i] += dt
    const a = age[i]
    const f = a / life[i]
    if (f >= 1) { kind[i] = 0; al[i] = 0; continue }
    const i3 = i * 3
    if (k === 1) {
      // fireball: fast, decelerating, buoyant
      vel[i3] *= 1 - 1.6 * dt; vel[i3 + 2] *= 1 - 1.6 * dt
      vel[i3 + 1] = vel[i3 + 1] * (1 - 1.2 * dt) + 12 * dt
      COL.copy(FIRE).lerp(FIRE2, f).lerp(SMOKE_DARK, Math.max(0, f - 0.5) * 2)
      sz[i] = 6 + a * 18
      al[i] = 0.9 * (1 - f)
    } else if (k === 2) {
      // smoke: rises, drifts with the wind, thins and lightens
      vel[i3 + 1] = vel[i3 + 1] * (1 - 0.5 * dt) + 4 * dt
      vel[i3] += (wx * 0.9 - vel[i3]) * 0.5 * dt + (Math.random() - 0.5) * 3 * dt
      vel[i3 + 2] += (wz * 0.9 - vel[i3 + 2]) * 0.5 * dt + (Math.random() - 0.5) * 3 * dt
      COL.copy(SMOKE_DARK).lerp(SMOKE_LIGHT, Math.min(1, f * 1.5))
      sz[i] = 8 + a * 4.5
      al[i] = 0.55 * (1 - f) * Math.min(1, a * 2)
    } else if (k === 3) {
      // steam puff
      vel[i3 + 1] = vel[i3 + 1] * (1 - 0.8 * dt) + 3 * dt
      vel[i3] += (wx - vel[i3]) * 0.8 * dt
      vel[i3 + 2] += (wz - vel[i3 + 2]) * 0.8 * dt
      COL.copy(STEAM)
      sz[i] = 3 + a * 6
      al[i] = 0.5 * (1 - f)
    } else if (k === 4) {
      // hydrogen haze inside the dome: gently rising, capped under the dome
      if (pos[i3 + 1] > 50) vel[i3 + 1] = 0
      COL.copy(H2)
      sz[i] = 5 + a * 1.5
      al[i] = 0.22 * Math.sin(Math.PI * f)
    }
    pos[i3] += vel[i3] * dt
    pos[i3 + 1] += vel[i3 + 1] * dt
    pos[i3 + 2] += vel[i3 + 2] * dt
    c[i3] = COL.r; c[i3 + 1] = COL.g; c[i3 + 2] = COL.b
  }
  ;(ps.geometry.getAttribute('position') as BufferAttribute).needsUpdate = true
  color.needsUpdate = true
  size.needsUpdate = true
  alpha.needsUpdate = true
}

// Regional plume: each particle is a puff released at a fixed story time during the first hour
// after the breach. Its position follows from the wind and its age, so jumping the timeline works.
const RELEASE_SECONDS = 3600
function placePlume(ps: ParticleSystem, origin: Vector3, dir: { x: number; z: number }, speed: number, storySeconds: number, fade: number) {
  const { pos, vel, age, kind, color, size, alpha, n } = ps
  const c = color.array as Float32Array
  const sz = size.array as Float32Array
  const al = alpha.array as Float32Array
  if (kind[0] === 0) {
    // one-off: birth time and two fixed normal deviates per puff (crosswind, vertical)
    for (let i = 0; i < n; i++) {
      kind[i] = 5
      age[i] = (i / n) * RELEASE_SECONDS
      const u1 = Math.random() || 1e-6, u2 = Math.random()
      const r = Math.sqrt(-2 * Math.log(u1))
      vel[i * 3] = r * Math.cos(2 * Math.PI * u2)
      vel[i * 3 + 1] = r * Math.sin(2 * Math.PI * u2)
      vel[i * 3 + 2] = Math.random()
    }
  }
  const cx = -dir.z, cz = dir.x // crosswind unit vector
  for (let i = 0; i < n; i++) {
    const t = storySeconds - age[i]
    if (t <= 0) { al[i] = 0; continue }
    const x = speed * t + 150
    const sy = (0.08 * x) / Math.sqrt(1 + 0.0001 * x)
    const szz = (0.06 * x) / Math.sqrt(1 + 0.0015 * x)
    const cross = vel[i * 3] * sy * 0.8
    const i3 = i * 3
    pos[i3] = origin.x + dir.x * x + cx * cross
    pos[i3 + 1] = Math.max(120, 320 + vel[i3 + 1] * szz * 0.5)
    pos[i3 + 2] = origin.z + dir.z * x + cz * cross
    sz[i] = 180 + sy * 1.4
    // release rate tails off over the hour; puffs thin with distance
    const strength = 1 - age[i] / RELEASE_SECONDS
    al[i] = 0.14 * fade * (0.4 + 0.6 * strength) / (1 + x / 25000)
    c[i3] = PLUME.r; c[i3 + 1] = PLUME.g; c[i3 + 2] = PLUME.b
  }
  ;(ps.geometry.getAttribute('position') as BufferAttribute).needsUpdate = true
  color.needsUpdate = true
  size.needsUpdate = true
  alpha.needsUpdate = true
}

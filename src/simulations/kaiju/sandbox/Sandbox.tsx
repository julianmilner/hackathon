import { useCallback, useEffect, useRef, useState } from 'react'
import { Canvas, useFrame, useThree } from '@react-three/fiber'
import { Group, Vector3 } from 'three'
import { OrbitControls } from 'three/addons/controls/OrbitControls.js'
import { Tsunami } from '../../tsunami/Tsunami'
import { TsunamiSimulation } from '../../tsunami/TsunamiSimulation'
import { FakeCity } from '../../tsunami/sandbox/FakeCity'
import { CITY_SIZE, SEA_LEVEL, groundHeight } from '../../tsunami/sandbox/city'
import { Kaiju } from '../Kaiju'
import { KaijuActor } from '../KaijuActor'
import type { KaijuEvent } from '../KaijuBehaviour'

const RESOLUTION = 256
const HEIGHT = 300 // comically large on purpose
const SPAWN = { x: -540, z: 80 }
const HOUSE = { x: 150, z: -40 }

interface Shake {
  x: number
  z: number
  amplitude: number
  /** Seconds the shake lasts, measured from `at`. */
  ttl: number
  /** performance.now() in seconds when the shake started. */
  at: number
}

const now = () => performance.now() / 1000

function Controls({ shakeRef }: { shakeRef: React.RefObject<Shake | null> }) {
  const { camera, gl } = useThree()
  const controls = useRef<OrbitControls | null>(null)
  const jitter = useRef(new Vector3())
  useEffect(() => {
    const c = new OrbitControls(camera, gl.domElement)
    c.target.set(-150, 90, 20)
    c.maxPolarAngle = Math.PI / 2 - 0.02
    c.minDistance = 40
    c.maxDistance = 4000
    c.enableDamping = true
    c.update()
    controls.current = c
    return () => c.dispose()
  }, [camera, gl])
  useFrame(() => {
    camera.position.sub(jitter.current)
    controls.current?.update()
    const s = shakeRef.current
    const remaining = s ? s.ttl - (now() - s.at) : 0
    if (s && remaining > 0) {
      const dist = Math.hypot(camera.position.x - s.x, camera.position.z - s.z)
      const falloff = Math.max(0, 1 - dist / 1400)
      const a = s.amplitude * falloff * remaining
      jitter.current.set((Math.random() - 0.5) * a, (Math.random() - 0.5) * a, (Math.random() - 0.5) * a)
    } else {
      jitter.current.set(0, 0, 0)
    }
    camera.position.add(jitter.current)
  })
  return null
}

function House() {
  const y = groundHeight(HOUSE.x, HOUSE.z)
  return (
    <group position={[HOUSE.x, y, HOUSE.z]}>
      <mesh position={[0, 5, 0]}>
        <boxGeometry args={[16, 10, 16]} />
        <meshStandardMaterial color="#f0eee6" />
      </mesh>
      <mesh position={[0, 13, 0]} rotation={[0, Math.PI / 4, 0]}>
        <coneGeometry args={[13, 6, 4]} />
        <meshStandardMaterial color="#d97757" />
      </mesh>
    </group>
  )
}

interface SceneProps {
  simRef: React.RefObject<TsunamiSimulation | null>
  kaijuRef: React.RefObject<KaijuActor | null>
  armedRef: React.RefObject<boolean>
  onEvent: (e: KaijuEvent) => void
  onReady: () => void
}

function SceneContent({ simRef, kaijuRef, armedRef, onEvent, onReady }: SceneProps) {
  const city = useRef<Group>(null)
  const sampled = useRef(false)
  useFrame(() => {
    const sim = simRef.current
    const kaiju = kaijuRef.current
    if (!sampled.current && city.current && sim && kaiju) {
      sampled.current = true
      sim.sampleTerrain(city.current, { seaFloor: 'keep' })
      if (sim.terrain) kaiju.setTerrain(sim.terrain)
      onReady()
    }
    // Demo beat: the kaiju surfaces once the wave has peaked and begun to hold.
    if (armedRef.current && sim && kaiju && sim.running) {
      const { drawbackTime, riseTime, holdTime } = sim.wave
      if (sim.time > drawbackTime + riseTime + holdTime * 0.35) {
        armedRef.current = false
        kaiju.rise(HOUSE)
      }
    }
  })
  return (
    <>
      <hemisphereLight args={['#dfe9f5', '#3a3f4a', 0.9]} />
      <directionalLight position={[300, 500, 200]} intensity={1.8} />
      <FakeCity ref={city} />
      <House />
      <Tsunami
        ref={simRef}
        options={{ size: CITY_SIZE, resolution: RESOLUTION, seaLevel: SEA_LEVEL, seaDepth: 12, sourceEdge: 'west', timeScale: 4 }}
      />
      <Kaiju
        ref={kaijuRef}
        options={{ spawn: SPAWN, target: HOUSE, height: HEIGHT, seaLevel: SEA_LEVEL }}
        onEvent={onEvent}
      />
    </>
  )
}

function Hud({ kaijuRef, log }: { kaijuRef: React.RefObject<KaijuActor | null>; log: string[] }) {
  const [text, setText] = useState('')
  useEffect(() => {
    const id = setInterval(() => {
      const k = kaijuRef.current
      if (!k) return
      const b = k.behaviour
      setText(
        b.active
          ? `${b.state}   clip ${b.clip.name} ×${b.clip.timeScale.toFixed(2)}   ${b.distanceToDestination.toFixed(0)} m to go`
          : 'hidden',
      )
    }, 200)
    return () => clearInterval(id)
  }, [kaijuRef])
  return (
    <div className="hud">
      {text}
      {log.map((line, i) => (
        <div key={i}>{line}</div>
      ))}
    </div>
  )
}

export function Sandbox() {
  const simRef = useRef<TsunamiSimulation | null>(null)
  const kaijuRef = useRef<KaijuActor | null>(null)
  const shakeRef = useRef<Shake | null>(null)
  const armedRef = useRef(false)
  const [ready, setReady] = useState(false)
  const [log, setLog] = useState<string[]>([])

  const onEvent = useCallback((e: KaijuEvent) => {
    if (e.type === 'footstep') shakeRef.current = { x: e.x, z: e.z, amplitude: 0.03 * HEIGHT, ttl: 0.35, at: now() }
    if (e.type === 'hit') shakeRef.current = { x: e.x, z: e.z, amplitude: 0.08 * HEIGHT, ttl: 0.6, at: now() }
    if (e.type === 'roar') shakeRef.current = { x: e.x, z: e.z, amplitude: 0.02 * HEIGHT, ttl: 1.2, at: now() }
    if (e.type === 'state' || e.type === 'arrived' || e.type === 'gone') {
      const line = e.type === 'state' ? `${e.previous} → ${e.state}` : e.type
      setLog((l) => [line, ...l].slice(0, 4))
    }
  }, [])

  const playBeat = useCallback(() => {
    kaijuRef.current?.reset()
    simRef.current?.reset()
    simRef.current?.trigger({ amplitude: 7, drawbackTime: 6, riseTime: 10, holdTime: 40, fallTime: 40 })
    armedRef.current = true
  }, [])
  const rise = useCallback(() => {
    armedRef.current = false
    kaijuRef.current?.rise(HOUSE)
  }, [])
  const reset = useCallback(() => {
    armedRef.current = false
    kaijuRef.current?.reset()
    simRef.current?.reset()
  }, [])

  return (
    <div className="sandbox">
      <Canvas
        camera={{ position: new Vector3(-420, 420, 1050), fov: 50, near: 1, far: 8000 }}
        gl={{ antialias: true }}
        dpr={[1, 1.5]}
      >
        <color attach="background" args={['#0f1a2b']} />
        <Controls shakeRef={shakeRef} />
        <SceneContent simRef={simRef} kaijuRef={kaijuRef} armedRef={armedRef} onEvent={onEvent} onReady={() => setReady(true)} />
      </Canvas>

      <aside className="panel">
        <p className="eyebrow">Simulation sandbox</p>
        <h1>Kaiju</h1>
        <p className="hint">
          A Claude-themed kaiju surfaces from the sea, wades ashore on the same height field the
          tsunami uses, and smashes the cream house. Built from code in Blender; see tools/blender/kaiju.py.
        </p>
        <div className="actions">
          <button className="primary" onClick={playBeat} disabled={!ready}>Tsunami, then kaiju</button>
          <button onClick={rise} disabled={!ready}>Kaiju rises</button>
        </div>
        <div className="actions">
          <button onClick={() => kaijuRef.current?.attack()} disabled={!ready}>Attack</button>
          <button onClick={() => kaijuRef.current?.roar()} disabled={!ready}>Roar</button>
          <button onClick={() => kaijuRef.current?.stomp()} disabled={!ready}>Stomp</button>
        </div>
        <div className="actions">
          <button onClick={() => kaijuRef.current?.retreat()} disabled={!ready}>Retreat</button>
          <button onClick={reset} disabled={!ready}>Reset</button>
        </div>
        <Hud kaijuRef={kaijuRef} log={log} />
        <p className="footnote">Drag to orbit, scroll to zoom, right-drag to pan. Footsteps and hits shake the camera.</p>
      </aside>
    </div>
  )
}

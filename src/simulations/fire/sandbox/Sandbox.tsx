import { Suspense, useCallback, useEffect, useRef, useState } from 'react'
import { Canvas, useFrame, useLoader, useThree } from '@react-three/fiber'
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js'
import { Fynbos } from '../Fynbos'
import { Group, Vector3 } from 'three'
import { OrbitControls } from 'three/addons/controls/OrbitControls.js'
import { Fire } from '../Fire'
import { FireSimulation, defaultFire, type FireParams } from '../FireSimulation'
import { FakeMountain } from './FakeMountain'
import { FUEL_MIN_HEIGHT, IGNITION_POINT, SIZE } from './mountain'

const RESOLUTION = 256
const COMPASS = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW']

function compass(deg: number) {
  return COMPASS[Math.round((((deg % 360) + 360) % 360) / 45) % 8]
}

function Controls() {
  const { camera, gl } = useThree()
  const controls = useRef<OrbitControls | null>(null)
  useEffect(() => {
    const c = new OrbitControls(camera, gl.domElement)
    c.target.set(350, 200, -100)
    c.maxPolarAngle = Math.PI / 2 - 0.02
    c.minDistance = 60
    c.maxDistance = 6000
    c.enableDamping = true
    c.update()
    controls.current = c
    return () => c.dispose()
  }, [camera, gl])
  useFrame(() => controls.current?.update())
  return null
}

/** Loads the Blender-made plants and scatters them once the terrain has been sampled. */
function FynbosLayer({ simRef, ready }: { simRef: React.RefObject<FireSimulation | null>; ready: boolean }) {
  const gltf = useLoader(GLTFLoader, '/models/fynbos.glb')
  const layer = useRef<Fynbos | null>(null)
  useEffect(() => {
    const sim = simRef.current
    if (!ready || !sim) return
    const fynbos = new Fynbos(sim, gltf.scene, { count: 30000 })
    layer.current = fynbos
    return () => {
      fynbos.dispose()
      layer.current = null
    }
  }, [ready, gltf, simRef])
  useFrame(() => layer.current?.update())
  return null
}

interface SceneProps {
  simRef: React.RefObject<FireSimulation | null>
  ready: boolean
  onReady: () => void
  onGroundClick: (x: number, z: number) => void
}

function SceneContent({ simRef, ready, onReady, onGroundClick }: SceneProps) {
  const mountain = useRef<Group>(null)
  const sampled = useRef(false)
  useFrame(() => {
    // sample the terrain once the mountain has rendered at least once
    if (!sampled.current && mountain.current && simRef.current) {
      sampled.current = true
      simRef.current.sampleTerrain(mountain.current)
      onReady()
    }
  })
  return (
    <>
      {/* dusk, so the fire reads against the slope */}
      <hemisphereLight args={['#6f84ad', '#2a2622', 0.9]} />
      <directionalLight position={[-800, 300, 300]} color="#ffd9b0" intensity={1.3} />
      <FakeMountain ref={mountain} onGroundClick={onGroundClick} />
      <Fire
        ref={simRef}
        options={{ size: SIZE, resolution: RESOLUTION, fuelMinHeight: FUEL_MIN_HEIGHT, timeScale: 20 }}
      />
      <Suspense fallback={null}>
        <FynbosLayer simRef={simRef} ready={ready} />
      </Suspense>
    </>
  )
}

function Hud({ simRef }: { simRef: React.RefObject<FireSimulation | null> }) {
  const [text, setText] = useState('')
  useEffect(() => {
    const id = setInterval(() => {
      const sim = simRef.current
      if (!sim) return
      if (sim.time < 0) {
        setText('idle')
        return
      }
      const minutes = Math.floor(sim.time / 60)
      setText(
        `t = ${minutes} min   ${sim.running ? 'burning' : 'burnt out'}   ` +
          `${sim.burningCells} cells alight   ${sim.burntAreaHa.toFixed(1)} ha burnt`,
      )
    }, 200)
    return () => clearInterval(id)
  }, [simRef])
  return <div className="hud">{text}</div>
}

export function Sandbox() {
  const simRef = useRef<FireSimulation | null>(null)
  const [ready, setReady] = useState(false)
  const [fire, setFire] = useState<FireParams>({ ...defaultFire, ...IGNITION_POINT })
  const [timeScale, setTimeScale] = useState(20)

  const ignitePreset = useCallback(() => simRef.current?.ignite({ ...fire, ...IGNITION_POINT }), [fire])
  const igniteAt = useCallback((x: number, z: number) => simRef.current?.ignite({ ...fire, x, z }), [fire])
  const reset = useCallback(() => simRef.current?.reset(), [])

  useEffect(() => {
    if (simRef.current) simRef.current.options.timeScale = timeScale
  }, [timeScale])

  // wind and humidity changes apply immediately to a running fire
  useEffect(() => {
    const sim = simRef.current
    if (!sim) return
    sim.setWind(fire.windFrom, fire.windSpeed)
    sim.params.humidity = fire.humidity
  }, [fire.windFrom, fire.windSpeed, fire.humidity])

  return (
    <div className="sandbox">
      <Canvas
        camera={{ position: new Vector3(1100, 520, 1500), fov: 50, near: 1, far: 12000 }}
        gl={{ antialias: true }}
        dpr={[1, 1.5]}
      >
        <color attach="background" args={['#0f1a2b']} />
        <Controls />
        <SceneContent simRef={simRef} ready={ready} onReady={() => setReady(true)} onGroundClick={igniteAt} />
      </Canvas>

      <aside className="panel">
        <p className="eyebrow">Simulation sandbox</p>
        <h1>Wildfire</h1>
        <p className="hint">
          Stand-in mountain covered in Blender-made fynbos, suburb below. The fire spreads cell by cell
          over a height field of the scene, faster uphill and downwind. Plants burn down and leave
          charred remnants. Click anywhere on the slope to light it.
        </p>
        <div className="actions">
          <button className="primary" onClick={ignitePreset} disabled={!ready}>Ignite lower slope</button>
          <button onClick={reset} disabled={!ready}>Reset</button>
        </div>
        <label>
          Wind from <span>{fire.windFrom.toFixed(0)}° {compass(fire.windFrom)}</span>
          <input type="range" min={0} max={359} step={1} value={fire.windFrom}
            onChange={(e) => setFire({ ...fire, windFrom: Number(e.target.value) })} />
        </label>
        <label>
          Wind speed <span>{fire.windSpeed.toFixed(0)} m/s</span>
          <input type="range" min={0} max={20} step={1} value={fire.windSpeed}
            onChange={(e) => setFire({ ...fire, windSpeed: Number(e.target.value) })} />
        </label>
        <label>
          Humidity <span>{Math.round(fire.humidity * 100)}%</span>
          <input type="range" min={0} max={1} step={0.05} value={fire.humidity}
            onChange={(e) => setFire({ ...fire, humidity: Number(e.target.value) })} />
        </label>
        <label>
          Speed <span>{timeScale.toFixed(0)}x</span>
          <input type="range" min={1} max={60} step={1} value={timeScale}
            onChange={(e) => setTimeScale(Number(e.target.value))} />
        </label>
        <Hud simRef={simRef} />
        <p className="footnote">Drag to orbit, scroll to zoom, right-drag to pan, click the slope to ignite.</p>
      </aside>
    </div>
  )
}

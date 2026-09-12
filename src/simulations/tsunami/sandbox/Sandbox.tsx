import { useCallback, useEffect, useRef, useState } from 'react'
import { Canvas, useFrame, useThree } from '@react-three/fiber'
import { Group, Vector3 } from 'three'
import { OrbitControls } from 'three/addons/controls/OrbitControls.js'
import { Tsunami } from '../Tsunami'
import { TsunamiSimulation, defaultWave, type WaveParams } from '../TsunamiSimulation'
import { FakeCity } from './FakeCity'
import { CITY_SIZE, SEA_LEVEL } from './city'

const RESOLUTION = 256

function Controls({ simRef }: { simRef: React.RefObject<TsunamiSimulation | null> }) {
  const { camera, gl } = useThree()
  const controls = useRef<OrbitControls | null>(null)
  useEffect(() => {
    const c = new OrbitControls(camera, gl.domElement)
    c.target.set(-120, 0, 0)
    c.maxPolarAngle = Math.PI / 2 - 0.02
    c.minDistance = 40
    c.maxDistance = 2500
    c.enableDamping = true
    c.update()
    controls.current = c
    return () => c.dispose()
  }, [camera, gl])
  useFrame(({ camera: cam, clock }) => {
    controls.current?.update()
    // Camera shake while the wave is up: scales with the wave height at the source.
    const sim = simRef.current
    if (sim?.running) {
      const level = Math.max(0, sim.waveLevel(sim.time)) / Math.max(sim.wave.amplitude, 1)
      const dist = cam.position.distanceTo(controls.current?.target ?? cam.position)
      const amp = level * dist * 0.004
      const t = clock.elapsedTime * 37
      cam.position.x += Math.sin(t) * amp
      cam.position.y += Math.sin(t * 1.3 + 1.0) * amp * 0.6
      cam.position.z += Math.cos(t * 0.8) * amp
    }
  })
  return null
}

function SceneContent({ simRef, onReady }: { simRef: React.RefObject<TsunamiSimulation | null>; onReady: () => void }) {
  const city = useRef<Group>(null)
  const sampled = useRef(false)
  useFrame(() => {
    // sample the terrain once the city has rendered at least once
    if (!sampled.current && city.current && simRef.current) {
      sampled.current = true
      simRef.current.sampleTerrain(city.current, { seaFloor: 'keep' })
      // expose for debugging from the browser console / automation
      ;(window as unknown as { tsunami?: TsunamiSimulation }).tsunami = simRef.current
      onReady()
    }
  })
  return (
    <>
      <hemisphereLight args={['#dfe9f5', '#3a3f4a', 0.9]} />
      <directionalLight position={[300, 500, 200]} intensity={1.8} />
      <FakeCity ref={city} />
      <Tsunami
        ref={simRef}
        options={{ size: CITY_SIZE, resolution: RESOLUTION, seaLevel: SEA_LEVEL, seaDepth: 12, sourceEdge: 'west', timeScale: 4 }}
      />
    </>
  )
}

/** Greyscale view of the sampled terrain so integration with the real mesh can be checked. */
function TerrainDebug({ simRef, ready }: { simRef: React.RefObject<TsunamiSimulation | null>; ready: boolean }) {
  const canvas = useRef<HTMLCanvasElement>(null)
  useEffect(() => {
    const sim = simRef.current
    const field = sim?.terrain
    const el = canvas.current
    if (!ready || !sim || !field || !el) return
    const res = field.resolution
    el.width = res
    el.height = res
    const ctx = el.getContext('2d')!
    const img = ctx.createImageData(res, res)
    const range = Math.max(1, field.max - field.min)
    for (let j = 0; j < res; j++) {
      for (let i = 0; i < res; i++) {
        const h = field.heights[j * res + i]
        const v = Math.round(((h - field.min) / range) * 255)
        const k = ((res - 1 - j) * res + i) * 4 // row 0 is the south edge; draw north up
        const sea = h < sim.options.seaLevel
        img.data[k] = sea ? 20 : v
        img.data[k + 1] = sea ? 60 + v * 0.4 : v
        img.data[k + 2] = sea ? 120 + v * 0.5 : v
        img.data[k + 3] = 255
      }
    }
    ctx.putImageData(img, 0, 0)
  }, [simRef, ready])
  return <canvas ref={canvas} className="terrain" title="Sampled terrain height field (north up)" />
}

function Hud({ simRef }: { simRef: React.RefObject<TsunamiSimulation | null> }) {
  const [text, setText] = useState('')
  useEffect(() => {
    const id = setInterval(() => {
      const sim = simRef.current
      if (!sim) return
      const t = sim.time
      setText(
        sim.running
          ? `t = ${t.toFixed(0)} s   wave at source ${sim.waveLevel(t).toFixed(1)} m`
          : 'idle',
      )
    }, 200)
    return () => clearInterval(id)
  }, [simRef])
  return <div className="hud">{text}</div>
}

export function Sandbox() {
  const simRef = useRef<TsunamiSimulation | null>(null)
  const [ready, setReady] = useState(false)
  const [wave, setWave] = useState<WaveParams>({ ...defaultWave })
  const [timeScale, setTimeScale] = useState(4)

  const trigger = useCallback(() => simRef.current?.trigger(wave), [wave])
  const reset = useCallback(() => simRef.current?.reset(), [])

  useEffect(() => {
    if (simRef.current) simRef.current.options.timeScale = timeScale
  }, [timeScale])

  return (
    <div className="sandbox">
      <Canvas
        camera={{ position: new Vector3(-520, 230, 520), fov: 50, near: 1, far: 8000 }}
        gl={{ antialias: true }}
        dpr={[1, 1.5]}
      >
        <color attach="background" args={['#0f1a2b']} />
        <Controls simRef={simRef} />
        <SceneContent simRef={simRef} onReady={() => setReady(true)} />
      </Canvas>

      <aside className="panel">
        <p className="eyebrow">Simulation sandbox</p>
        <h1>Tsunami</h1>
        <p className="hint">
          Stand-in city, sea to the west. A GPU shallow-water simulation reads a top-down height
          field of the scene, so the wall of water funnels up streets, slams into facades and
          pools behind buildings. Tuned for drama, not for the insurance report.
        </p>
        <div className="actions">
          <button className="primary" onClick={trigger} disabled={!ready}>Trigger tsunami</button>
          <button onClick={reset} disabled={!ready}>Reset</button>
        </div>
        <label>
          Wave height <span>{wave.amplitude.toFixed(1)} m</span>
          <input type="range" min={1} max={30} step={0.5} value={wave.amplitude}
            onChange={(e) => setWave({ ...wave, amplitude: Number(e.target.value) })} />
        </label>
        <label>
          Drawback <span>{wave.drawbackTime.toFixed(0)} s</span>
          <input type="range" min={0} max={30} step={1} value={wave.drawbackTime}
            onChange={(e) => setWave({ ...wave, drawbackTime: Number(e.target.value) })} />
        </label>
        <label>
          Hold at peak <span>{wave.holdTime.toFixed(0)} s</span>
          <input type="range" min={0} max={90} step={5} value={wave.holdTime}
            onChange={(e) => setWave({ ...wave, holdTime: Number(e.target.value) })} />
        </label>
        <label>
          Speed <span>{timeScale.toFixed(0)}x</span>
          <input type="range" min={1} max={12} step={1} value={timeScale}
            onChange={(e) => setTimeScale(Number(e.target.value))} />
        </label>
        <Hud simRef={simRef} />
        <TerrainDebug simRef={simRef} ready={ready} />
        <p className="footnote">Drag to orbit, scroll to zoom, right-drag to pan.</p>
      </aside>
    </div>
  )
}

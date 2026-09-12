import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Canvas } from '@react-three/fiber'
import { ACESFilmicToneMapping, Vector3 } from 'three'
import { deg2rad } from '../geo'
import type { SimState } from '../scene/koeberg/Accident'
import { Koeberg } from '../scene/koeberg/Koeberg'
import type { ViewMode } from '../scene/koeberg/KoebergModel'
import type { ProcessState } from '../scene/koeberg/ProcessFlow'
import { ACCIDENT_PHASES, EXPLOSION_T, FACTS, KOEBERG, PHASE_VIEWS, phaseAt, PROCESS_STEPS, WIND_PRESETS } from '../scene/koeberg/site'
import { Ocean } from '../scene/terrain/Ocean'
import { SkyDome } from '../scene/terrain/SkyDome'
import { findView, plumeView, regionView, Rig, U1_DOME_VIEW, VIEWS, type View } from './Rig'

// Morning sun from the east-north-east so the turbine hall façade and domes are lit in the front view.
const SUN_AZIMUTH = 75
const SUN_ELEVATION = 46
const SUN_DIR = new Vector3(
  Math.sin(deg2rad(SUN_AZIMUTH)) * Math.cos(deg2rad(SUN_ELEVATION)),
  Math.sin(deg2rad(SUN_ELEVATION)),
  -Math.cos(deg2rad(SUN_AZIMUTH)) * Math.cos(deg2rad(SUN_ELEVATION)),
).normalize()
const SKY_ZENITH = '#2b6ab8'
const SKY_HORIZON = '#cfdde9'
const FOG_COLOR = '#c9d7e3'

declare global {
  interface Window {
    __koeberg?: {
      ready: boolean
      setMode(m: ViewMode): void
      setView(id: string): void
      setTime(t: number, playing?: boolean): void
      setWind(id: string): void
    }
  }
}

function storyClock(t: number) {
  const seconds = t < EXPLOSION_T ? (t / EXPLOSION_T) * 5 * 3600 : 5 * 3600 + (t - EXPLOSION_T) * 120
  const h = Math.floor(seconds / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  return `T + ${h} h ${m.toString().padStart(2, '0')} min`
}

export function KoebergApp() {
  const params = useMemo(() => new URLSearchParams(window.location.search), [])
  const [mode, setMode] = useState<ViewMode>((params.get('mode') as ViewMode) || 'exterior')
  const [view, setView] = useState<View>(findView(params.get('view')) ?? VIEWS[0])
  const [viewNonce, setViewNonce] = useState(0)
  const [activeStep, setActiveStep] = useState<string | null>(null)
  const [windId, setWindId] = useState(params.get('wind') ?? WIND_PRESETS[0].id)
  const [labelsOn, setLabelsOn] = useState(params.get('labels') !== '0')
  const [ready, setReady] = useState(false)
  const labelLayer = useRef<HTMLDivElement>(null)
  const [labelEl, setLabelEl] = useState<HTMLDivElement | null>(null)
  useEffect(() => setLabelEl(labelLayer.current), [])

  const wind = WIND_PRESETS.find((w) => w.id === windId) ?? WIND_PRESETS[0]
  const sim = useMemo<SimState>(() => ({ t: Number(params.get('t') ?? 0), playing: params.get('play') !== '0', speed: 1, wind: WIND_PRESETS[0], shake: 0, storySeconds: 0, plumeFront: 0 }), [params])
  sim.wind = wind
  const process = useMemo<ProcessState>(() => ({ flow: 1, coreHeat: 0, spin: 1 }), [])

  // Cheap 8 Hz mirror of the sim clock for the HUD.
  const [hudT, setHudT] = useState(sim.t)
  const [hudPlaying, setHudPlaying] = useState(sim.playing)

  const resolveView = useCallback((id: string): View | undefined => {
    if (id === 'plume') return plumeView(wind.fromDeg)
    if (id === 'region') return regionView(wind.fromDeg)
    if (id === 'u1dome') return U1_DOME_VIEW
    return findView(id)
  }, [wind])

  const goView = useCallback((id: string) => {
    const v = resolveView(id)
    if (!v) return
    setView(v)
    setViewNonce((n) => n + 1)
  }, [resolveView])

  // Guided camera: the accident timeline flies to whatever each phase needs the viewer to see,
  // until the user takes the controls.
  const [follow, setFollow] = useState(true)
  const guided = useRef<{ lastPhase: number; lastT: number }>({ lastPhase: -1, lastT: 0 })
  const takeControl = useCallback(() => setFollow(false), [])
  const guide = useCallback((t: number) => {
    const g = guided.current
    if (t < g.lastT - 0.2) g.lastPhase = -1 // scrubbed backwards: allow the phase view again
    g.lastT = t
    // fly 1.5 s early so the camera arrives before the moment
    const ph = phaseAt(t + 1.5)
    if (ph.t0 !== g.lastPhase) {
      g.lastPhase = ph.t0
      const id = PHASE_VIEWS[ph.t0]
      if (id) goView(id)
    }
  }, [goView])

  useEffect(() => {
    const id = window.setInterval(() => {
      setHudT(sim.t)
      setHudPlaying(sim.playing)
      if (mode === 'accident' && follow) guide(sim.t)
    }, 125)
    return () => window.clearInterval(id)
  }, [sim, mode, follow, guide])

  const chooseMode = useCallback((m: ViewMode) => {
    setMode(m)
    setActiveStep(null)
    if (m === 'inside') goView('inside')
    if (m === 'accident') { sim.t = 0; sim.playing = true; setFollow(true); guided.current.lastPhase = -1 }
    if (m === 'exterior') goView('photo')
  }, [goView, sim])

  useEffect(() => {
    window.__koeberg = {
      ready,
      setMode: chooseMode,
      setView: goView,
      setTime: (t, playing = false) => { sim.t = t; sim.playing = playing },
      setWind: setWindId,
    }
  }, [ready, chooseMode, goView, sim])

  const phase = phaseAt(hudT)
  const explosion = hudT >= EXPLOSION_T
  const ghostShells = mode === 'accident' && hudT >= 2 && hudT < EXPLOSION_T

  return (
    <div className="k-app">
      <Canvas
        shadows
        dpr={[1, 2]}
        gl={{ antialias: true, logarithmicDepthBuffer: true, toneMapping: ACESFilmicToneMapping, toneMappingExposure: 1.0 }}
        camera={{ fov: 45, near: 1, far: 400000, position: view.position }}
        onCreated={() => setReady(true)}
      >
        <color attach="background" args={[FOG_COLOR]} />
        <fogExp2 attach="fog" args={[FOG_COLOR, 1.6e-5]} />
        <SkyDome sunDir={SUN_DIR} zenith={SKY_ZENITH} horizon={SKY_HORIZON} ground={FOG_COLOR} />
        <hemisphereLight args={['#dfe9f5', '#6a6b58', 1.1]} />
        <directionalLight
          position={SUN_DIR.clone().multiplyScalar(1400)}
          intensity={2.6}
          color="#fff2dc"
          castShadow
          shadow-mapSize={[4096, 4096]}
          shadow-bias={-0.0004}
          shadow-normalBias={0.6}
          shadow-camera-near={200}
          shadow-camera-far={3200}
          shadow-camera-left={-700}
          shadow-camera-right={700}
          shadow-camera-top={700}
          shadow-camera-bottom={-700}
        />
        <group position-y={-KOEBERG.platformAboveSea - 0.6}>
          <Ocean sunDir={SUN_DIR} skyColor={SKY_HORIZON} heightField={null} deepColor="#0e4a70" />
        </group>
        <Suspense fallback={null}>
          <Koeberg mode={mode} sim={sim} process={process} ghost={ghostShells} labelContainer={labelsOn ? labelEl : null} activeStep={activeStep} />
        </Suspense>
        <Rig view={view} viewNonce={viewNonce} sim={sim} onUserInteract={takeControl} />
      </Canvas>
      <div className="k-labels" ref={labelLayer} />

      <header className="k-title">
        <p className="k-eyebrow">Eskom · Melkbosstrand · 30 km north of Cape Town</p>
        <h1>{KOEBERG.name}</h1>
        <p className="k-sub">Two 970 MW pressurised water reactors. Africa’s only nuclear power station.</p>
      </header>

      <nav className="k-modes" aria-label="View mode">
        {(['exterior', 'inside', 'accident'] as ViewMode[]).map((m) => (
          <button key={m} className={m === mode ? 'is-active' : ''} onClick={() => chooseMode(m)}>
            {m === 'exterior' ? 'The station' : m === 'inside' ? 'Inside the process' : 'If it fails'}
          </button>
        ))}
      </nav>

      <aside className="k-panel">
        {mode === 'exterior' && (
          <div className="k-facts">
            {FACTS.map((f) => (
              <div key={f.label} className="k-fact">
                <span className="k-fact-label">{f.label}</span>
                <span className="k-fact-value">{f.value}</span>
                <p>{f.detail}</p>
              </div>
            ))}
          </div>
        )}
        {mode === 'inside' && (
          <ol className="k-steps">
            {PROCESS_STEPS.map((s) => (
              <li key={s.id} className={s.id === activeStep ? 'is-active' : ''}>
                <button onClick={() => { setActiveStep(s.id); goView(s.id === 'core' || s.id === 'sg' || s.id === 'rcp' || s.id === 'prz' ? 'inside' : s.id === 'sea' ? 'sea' : 'turbine') }}>
                  <strong>{s.title}</strong>
                  <span>{s.body}</span>
                </button>
              </li>
            ))}
            <li className="k-loops">
              <span><i className="k-swatch k-swatch--primary" /> Primary loop: 155 bar water, hot leg orange, cold leg blue</span>
              <span><i className="k-swatch k-swatch--secondary" /> Secondary loop: steam white, condensate teal</span>
              <span><i className="k-swatch k-swatch--tertiary" /> Tertiary loop: Atlantic seawater</span>
            </li>
          </ol>
        )}
        {mode === 'accident' && (
          <div className="k-accident">
            <div className="k-phase">
              <span className="k-phase-clock">{storyClock(hudT)}</span>
              <h2>{phase.title}</h2>
              <p>{phase.body}</p>
            </div>
            <div className="k-timeline">
              <button className="k-play" onClick={() => { sim.playing = !sim.playing; setHudPlaying(sim.playing) }} aria-label={hudPlaying ? 'Pause' : 'Play'}>
                {hudPlaying ? '❚❚' : '▶'}
              </button>
              <button className={'k-follow' + (follow ? ' is-active' : '')} onClick={() => { setFollow(!follow); guided.current.lastPhase = -1 }} title="Fly the camera to what each phase needs you to see">
                {follow ? 'Camera follows the story' : 'Follow the story'}
              </button>
              <input
                type="range" min={0} max={90} step={0.1} value={hudT}
                onChange={(e) => { sim.t = Number(e.target.value); setHudT(sim.t) }}
                aria-label="Timeline"
              />
              <div className="k-ticks">
                {ACCIDENT_PHASES.map((p) => (
                  <button key={p.t0} style={{ left: `${(p.t0 / 90) * 100}%` }} title={p.title} onClick={() => { sim.t = p.t0; setHudT(p.t0) }} />
                ))}
              </div>
            </div>
            <label className="k-wind">
              <span>Wind</span>
              <select value={windId} onChange={(e) => setWindId(e.target.value)}>
                {WIND_PRESETS.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
              </select>
              <small>{wind.note}</small>
            </label>
            {explosion && (
              <div className="k-legend">
                <span><i style={{ background: '#db1f1a' }} /> Heavy fallout: long-term exclusion</span>
                <span><i style={{ background: '#f27a1a' }} /> Evacuate, iodine tablets</span>
                <span><i style={{ background: '#f9d940' }} /> Shelter, food and water restrictions</span>
                <span><i className="k-ring k-ring--paz" /> 5 km PAZ · <i className="k-ring k-ring--upz" /> 16 km UPZ</span>
                <small>Gaussian plume, neutral stability, 300 m release height. Indicative footprint, not a dose model.</small>
              </div>
            )}
            <p className="k-note">A power reactor cannot explode like a bomb: 4.4 % enriched fuel and no way to compress it. What fails is cooling. This timeline follows a station blackout like Fukushima Daiichi, compressed from hours into seconds.</p>
          </div>
        )}
      </aside>

      <nav className="k-views" aria-label="Camera">
        {VIEWS.map((v) => (
          <button key={v.id} className={v.id === view.id ? 'is-active' : ''} onClick={() => { takeControl(); goView(v.id) }}>{v.name}</button>
        ))}
        <button className={view.id === 'region' ? 'is-active' : ''} onClick={() => { takeControl(); goView('region') }}>Region</button>
        <button className={labelsOn ? 'is-active' : ''} onClick={() => setLabelsOn((l) => !l)}>Labels</button>
      </nav>

      <footer className="k-credit">
        Model built to measured dimensions from imagery, Eskom fact sheet NU 0001 and the French 900 MWe CP1 design. Left-drag orbit, right-drag pan, wheel zoom.
      </footer>
    </div>
  )
}

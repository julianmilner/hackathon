import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { DemoScene } from './DemoScene'
import { captionAt, DURATION, MARKERS } from './script'
import { createDemoState, startDemo, type DemoState } from './state'

declare global {
  interface Window {
    __demo?: { state: DemoState; play(): void }
  }
}

function clockLabel(t: number) {
  const m = Math.floor(t / 60)
  const s = Math.floor(t % 60)
  return `${m}:${s.toString().padStart(2, '0')}`
}

// The one-minute show: press Play, watch Koeberg blow up, the mountain burn, the bay flood
// and the kaiju come for the coworking space. Everything is one 3D map; the HUD is glass.
export function DemoApp() {
  const state = useMemo(() => createDemoState(), [])
  const params = useMemo(() => new URLSearchParams(window.location.search), [])
  const [progress, setProgress] = useState(0)
  const [ready, setReady] = useState(false)
  const [armed, setArmed] = useState(false)
  const [hud, setHud] = useState({ t: 0, playing: false, done: false, run: 0 })
  const labelLayer = useRef<HTMLDivElement>(null)
  const [labelEl, setLabelEl] = useState<HTMLDivElement | null>(null)
  useEffect(() => setLabelEl(labelLayer.current), [])

  const handleProgress = useCallback((f: number) => setProgress(f), [])
  const handleReady = useCallback(() => setReady(true), [])

  // Do not keep the presenter waiting forever on slow Wi-Fi.
  useEffect(() => {
    const id = window.setTimeout(() => setArmed(true), 30000)
    return () => window.clearTimeout(id)
  }, [])
  useEffect(() => {
    if (ready) setArmed(true)
  }, [ready])

  const play = useCallback(() => {
    startDemo(state)
    setHud({ t: 0, playing: true, done: false, run: state.run })
  }, [state])

  // Mirror the clock for the HUD at 10 Hz.
  useEffect(() => {
    const id = window.setInterval(() => setHud({ t: state.t, playing: state.playing, done: state.done, run: state.run }), 100)
    return () => window.clearInterval(id)
  }, [state])

  useEffect(() => {
    window.__demo = { state, play }
    return () => {
      delete window.__demo
    }
  }, [state, play])

  const autoplayed = useRef(false)
  useEffect(() => {
    if (armed && params.has('autoplay') && !autoplayed.current) {
      autoplayed.current = true
      play()
    }
  }, [armed, params, play])

  const caption = captionAt(hud.t)
  const started = hud.playing || hud.done
  const pct = Math.round(progress * 100)

  return (
    <div className="d-app">
      <DemoScene state={state} labelContainer={labelEl} onProgress={handleProgress} onReady={handleReady} />
      <div className="d-labels" ref={labelLayer} />

      <div className={`loadbar ${ready ? 'loadbar-done' : ''}`} style={{ transform: `scaleX(${Math.max(progress, 0.02)})` }} />

      <header className="d-title">
        <p className="d-eyebrow">Cape Town · a disaster fantasy</p>
        <h1>What if Koeberg blew up?</h1>
        <p className="d-sub">…and everything that follows came for Roamwork, District Six.</p>
      </header>

      {started && (
        <div className={`d-caption ${hud.done ? 'is-done' : ''}`} key={caption.t + ':' + hud.run}>
          <p className="d-caption-text">{caption.text}</p>
          {caption.sub && <p className="d-caption-sub">{caption.sub}</p>}
        </div>
      )}

      {hud.done && (
        <div className="d-verdict">
          <p className="d-eyebrow">Verdict for Roamwork, District Six</p>
          <h2>Work from home today.</h2>
          <p>Fallout from the north, fire from the mountain, the bay through the front door, and a 300 m kaiju with a meeting. Look around: drag to pan, right-drag to orbit.</p>
          <button className="d-play" onClick={play}>▶ Replay</button>
        </div>
      )}

      <footer className="d-controls">
        <button className="d-play" onClick={play} disabled={!armed}>
          {!armed ? `Streaming the city… ${pct}%` : started ? '↺ Replay' : '▶ Play the scenario'}
        </button>
        <div className="d-timeline" aria-label="Timeline">
          <div className="d-timeline-fill" style={{ width: `${(hud.t / DURATION) * 100}%` }} />
          {MARKERS.map((m) => (
            <span key={m.label} className={`d-marker ${hud.t >= m.t ? 'is-past' : ''}`} style={{ left: `${(m.t / DURATION) * 100}%` }}>
              <i />
              {m.label}
            </span>
          ))}
        </div>
        <span className="d-clock">{clockLabel(hud.t)} / {clockLabel(DURATION)}</span>
      </footer>

      <p className="d-attribution">
        Imagery © Esri, Maxar, Earthstar Geographics · Elevation: Mapzen Terrarium on AWS Open Data (SRTM) · Koeberg model built to measured dimensions · Kaiju and fynbos generated in Blender
      </p>
    </div>
  )
}

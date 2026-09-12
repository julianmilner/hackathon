import { useEffect, useState } from 'react'
import type { RendererMode } from '../CityApp'
import { VIEWPOINTS, type Viewpoint } from '../viewpoints'

interface Props {
  mode: RendererMode
  canSwitch: boolean
  onSwitchMode: (mode: RendererMode) => void
  progress: number
  ready: boolean
  notice: string | null
  onDismissNotice: () => void
  onFlyTo: (v: Viewpoint) => void
}

export function Hud({ mode, canSwitch, onSwitchMode, progress, ready, notice, onDismissNotice, onFlyTo }: Props) {
  const [active, setActive] = useState<string>(VIEWPOINTS[0].id)
  const [showHint, setShowHint] = useState(true)

  useEffect(() => {
    if (!ready) return
    const id = window.setTimeout(() => setShowHint(false), 9000)
    return () => window.clearTimeout(id)
  }, [ready])

  // Notices explain the fallback; they should not sit over the city for the whole demo.
  useEffect(() => {
    if (!notice) return
    const id = window.setTimeout(onDismissNotice, 14000)
    return () => window.clearTimeout(id)
  }, [notice, onDismissNotice])

  const pct = Math.round(progress * 100)

  return (
    <>
      <div className={`loadbar ${ready ? 'loadbar-done' : ''}`} style={{ transform: `scaleX(${Math.max(progress, 0.02)})` }} />

      <header className="hud hud-top-left">
        <p className="eyebrow">Cape Town</p>
        <h1>{mode === 'photoreal' ? 'Photoreal 3D city' : 'Terrain preview'}</h1>
        <p className="hud-sub">
          {ready
            ? mode === 'photoreal'
              ? 'Google Photorealistic 3D Tiles'
              : 'Satellite imagery draped over SRTM elevation'
            : `Streaming the city… ${pct}%`}
        </p>
        <a className="hud-link" href={`${import.meta.env.BASE_URL}crime.html`}>
          2D crime heatmap →
        </a>
      </header>

      {canSwitch && (
        <div className="hud hud-top-right segmented" role="group" aria-label="Renderer">
          <button className={mode === 'photoreal' ? 'on' : ''} onClick={() => onSwitchMode('photoreal')}>
            Photoreal
          </button>
          <button className={mode === 'terrain' ? 'on' : ''} onClick={() => onSwitchMode('terrain')}>
            Terrain
          </button>
        </div>
      )}

      <nav className="hud hud-bottom-left chips" aria-label="Viewpoints">
        {VIEWPOINTS.map((v) => (
          <button
            key={v.id}
            className={active === v.id ? 'on' : ''}
            onClick={() => {
              setActive(v.id)
              onFlyTo(v)
            }}
          >
            {v.name}
          </button>
        ))}
      </nav>

      {mode === 'terrain' && (
        <p className="hud hud-bottom-right attribution">
          Imagery © Esri, Maxar, Earthstar Geographics · Elevation: Mapzen Terrarium on AWS Open Data (SRTM)
        </p>
      )}

      {showHint && ready && <p className="hud hud-bottom-centre hint">Drag to pan · Right-drag to orbit · Scroll to zoom</p>}

      {notice && (
        <div className="hud notice" role="status">
          <span>{notice}</span>
          <button onClick={onDismissNotice} aria-label="Dismiss">
            ×
          </button>
        </div>
      )}
    </>
  )
}

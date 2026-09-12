import { useCallback, useEffect, useRef, useState } from 'react'
import { GOOGLE_TILES_KEY } from './config'
import { Hud } from './hud/Hud'
import type { SceneApi } from './sceneApi'
import { GoogleCity } from './scene/google/GoogleCity'
import { TerrainCity } from './scene/terrain/TerrainCity'
import { findViewpoint, type Viewpoint } from './viewpoints'

export type RendererMode = 'photoreal' | 'terrain'

// The 3D Cape Town view: Google Photorealistic 3D Tiles when a key is configured,
// otherwise (or on failure) the keyless terrain preview.
export default function CityApp() {
  const hasKey = GOOGLE_TILES_KEY.length > 0
  const [mode, setMode] = useState<RendererMode>(hasKey ? 'photoreal' : 'terrain')
  const [progress, setProgress] = useState(0)
  const [ready, setReady] = useState(false)
  const [notice, setNotice] = useState<string | null>(
    hasKey ? null : 'No Google Map Tiles key found. Showing the terrain preview; add VITE_GOOGLE_MAPS_TILES_KEY to .env.local for the photoreal mesh.',
  )
  const apiRef = useRef<SceneApi | null>(null)

  const handleProgress = useCallback((fraction: number) => setProgress(fraction), [])
  const handleReady = useCallback(() => setReady(true), [])
  const handleGoogleError = useCallback((message: string) => {
    const hint = /403/.test(message)
      ? ' The key was refused: check that its website restrictions allow this origin and that the Map Tiles API is enabled.'
      : ''
    setNotice(`Google 3D Tiles unavailable (${message}).${hint} Showing the terrain preview.`)
    setProgress(0)
    setReady(false)
    setMode('terrain')
  }, [])

  const switchMode = useCallback((next: RendererMode) => {
    setProgress(0)
    setReady(false)
    setMode(next)
  }, [])

  const flyTo = useCallback((v: Viewpoint) => apiRef.current?.flyTo(v), [])

  // Console and screenshot hook.
  useEffect(() => {
    window.__city = {
      ready,
      flyTo: (id, durationMs) => {
        const v = findViewpoint(id)
        if (v) apiRef.current?.flyTo(v, durationMs)
      },
      jumpTo: (id) => {
        const v = findViewpoint(id)
        if (v) apiRef.current?.jumpTo(v)
      },
    }
    return () => {
      delete window.__city
    }
  }, [ready])

  return (
    <div className="app">
      {mode === 'photoreal' ? (
        <GoogleCity key="photoreal" apiKey={GOOGLE_TILES_KEY} apiRef={apiRef} onProgress={handleProgress} onReady={handleReady} onError={handleGoogleError} />
      ) : (
        <TerrainCity key="terrain" apiRef={apiRef} onProgress={handleProgress} onReady={handleReady} />
      )}
      <Hud
        mode={mode}
        canSwitch={hasKey}
        onSwitchMode={switchMode}
        progress={progress}
        ready={ready}
        notice={notice}
        onDismissNotice={() => setNotice(null)}
        onFlyTo={flyTo}
      />
    </div>
  )
}

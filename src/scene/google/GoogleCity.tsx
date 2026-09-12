import { useContext, useEffect, useRef } from 'react'
import { Canvas, useFrame, useThree } from '@react-three/fiber'
import { MathUtils, Matrix4, Vector3 } from 'three'
import { DRACOLoader } from 'three/examples/jsm/loaders/DRACOLoader.js'
import { GlobeControls, TilesAttributionOverlay, TilesPlugin, TilesRenderer, TilesRendererContext } from '3d-tiles-renderer/r3f'
import { GoogleCloudAuthPlugin } from '3d-tiles-renderer/core/plugins'
import { GLTFExtensionsPlugin, TileCompressionPlugin, TilesFadePlugin, UpdateOnChangePlugin } from '3d-tiles-renderer/three/plugins'
import type { GlobeControls as GlobeControlsImpl } from '3d-tiles-renderer/three'
// Frame constants are not re-exported from the package index; the source module is.
import { CAMERA_FRAME } from '3d-tiles-renderer/src/three/renderer/math/Ellipsoid.js'
import type { SceneApiRef } from '../../sceneApi'
import { cameraGeoPose, DEFAULT_VIEWPOINT, easeInOutCubic, INTRO_START, type Viewpoint } from '../../viewpoints'

interface Props {
  apiKey: string
  apiRef: SceneApiRef
  onProgress: (fraction: number) => void
  onReady: () => void
  onError: (message: string) => void
}

// Performance knobs. The canvas renders on demand (camera moved, tile arrived, fade running)
// instead of sixty times a second, so an idle city costs nothing.
//
// Screen-space error, in pixels, a tile may show before it refines. Google recommends 20 for
// the photorealistic tileset; the tile count grows roughly with (resolution / errorTarget)².
const ERROR_TARGET = 20
// Retina at 2x draws four times the pixels of 1x for little visible gain on photogrammetry.
const MAX_DPR = 1.5
// Keep more tiles resident so flying between viewpoints and back does not re-download them.
const CACHE_MAX_BYTES = 1.0e9
const CACHE_MIN_BYTES = 0.6e9
// If the tileset never reports fully loaded (a stuck request), unlock the HUD anyway.
const READY_TIMEOUT_MS = 20000

// By default the camera starts over the City Bowl so only those tiles stream. `?intro` on the
// URL restores the flight in from high over the Atlantic for the demo.
const WANT_INTRO = new URLSearchParams(window.location.search).has('intro')
const START_VIEWPOINT = WANT_INTRO ? INTRO_START : DEFAULT_VIEWPOINT

const dracoLoader = new DRACOLoader()
dracoLoader.setDecoderPath('https://www.gstatic.com/draco/versioned/decoders/1.5.7/')

type GeoPose = ReturnType<typeof cameraGeoPose>

interface Flight {
  from: GeoPose
  to: GeoPose
  start: number
  duration: number
  lift: number
}

const _matrix = new Matrix4()
const _scale = new Vector3()

// Places the camera at lat/lon poses on the globe and animates between them.
function CameraFlight({ apiRef, onProgress, onReady }: Pick<Props, 'apiRef' | 'onProgress' | 'onReady'>) {
  const tiles = useContext(TilesRendererContext)
  const camera = useThree((s) => s.camera)
  const controls = useThree((s) => s.controls) as GlobeControlsImpl | null
  const invalidate = useThree((s) => s.invalidate)
  const flight = useRef<Flight | null>(null)
  const current = useRef<GeoPose>(cameraGeoPose(START_VIEWPOINT))
  const introStarted = useRef(!WANT_INTRO)
  const reported = useRef(false)
  const lastPercent = useRef(-1)

  const applyPose = (pose: GeoPose) => {
    if (!tiles) return
    current.current = pose
    tiles.ellipsoid.getObjectFrame(
      MathUtils.degToRad(pose.lat),
      MathUtils.degToRad(pose.lon),
      pose.height,
      pose.azimuth,
      pose.elevation,
      0,
      _matrix,
      CAMERA_FRAME,
    )
    _matrix.premultiply(tiles.group.matrixWorld)
    _matrix.decompose(camera.position, camera.quaternion, _scale)
    camera.updateMatrixWorld()
  }

  // A larger in-memory tile cache: nothing may be stored on disk, so this is the only cache.
  useEffect(() => {
    if (!tiles) return
    tiles.lruCache.maxBytesSize = CACHE_MAX_BYTES
    tiles.lruCache.minBytesSize = CACHE_MIN_BYTES
  }, [tiles])

  useEffect(() => {
    if (!tiles) return
    const api = {
      jumpTo(v: Viewpoint) {
        flight.current = null
        applyPose(cameraGeoPose(v))
        invalidate()
      },
      flyTo(v: Viewpoint, durationMs = 3200) {
        const to = cameraGeoPose(v)
        const from = { ...current.current }
        const travel = Math.hypot((to.lat - from.lat) * 111000, (to.lon - from.lon) * 92000, to.height - from.height)
        flight.current = { from, to, start: performance.now(), duration: durationMs, lift: Math.min(travel * 0.25, 20000) }
        invalidate()
      },
    }
    apiRef.current = api
    tiles.group.updateMatrixWorld(true)
    api.jumpTo(START_VIEWPOINT)
    return () => {
      if (apiRef.current === api) apiRef.current = null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tiles, camera, apiRef, invalidate])

  useEffect(() => {
    const id = window.setTimeout(() => {
      if (!reported.current) {
        reported.current = true
        onReady()
      }
    }, READY_TIMEOUT_MS)
    return () => window.clearTimeout(id)
  }, [onReady])

  useFrame(() => {
    if (!tiles) return

    const f = flight.current
    if (f) {
      const t = MathUtils.clamp((performance.now() - f.start) / f.duration, 0, 1)
      const s = easeInOutCubic(t)
      applyPose({
        lat: MathUtils.lerp(f.from.lat, f.to.lat, s),
        lon: MathUtils.lerp(f.from.lon, f.to.lon, s),
        height: MathUtils.lerp(f.from.height, f.to.height, s) + Math.sin(Math.PI * s) * f.lift,
        azimuth: lerpAngle(f.from.azimuth, f.to.azimuth, s),
        elevation: MathUtils.lerp(f.from.elevation, f.to.elevation, s),
      })
      if (controls) {
        controls.enabled = false
        controls.adjustCamera(camera)
      }
      if (t >= 1) {
        flight.current = null
        if (controls) controls.enabled = true
      }
      // The canvas renders on demand; keep frames coming while the flight runs.
      invalidate()
    }

    // Whole percents only, so the HUD does not re-render on every tile.
    const progress = tiles.loadProgress
    const percent = Math.floor(progress * 100)
    if (percent !== lastPercent.current) {
      lastPercent.current = percent
      onProgress(progress)
    }

    const settled = progress >= 0.999 && tiles.root && tiles.visibleTiles.size > 0
    if (!introStarted.current && tiles.root && (settled || performance.now() > 12000)) {
      introStarted.current = true
      apiRef.current?.flyTo(DEFAULT_VIEWPOINT, 6500)
    }
    if (!reported.current && introStarted.current && !flight.current && settled) {
      reported.current = true
      onReady()
    }
  })

  return null
}

// Console hook promised in README.md: renderer memory and draw counts plus tile statistics.
function TileStats() {
  const tiles = useContext(TilesRendererContext)
  const gl = useThree((s) => s.gl)
  useEffect(() => {
    if (!tiles) return
    window.__cityStats = () => ({
      ...gl.info.memory,
      ...gl.info.render,
      ...tiles.stats,
      visibleTiles: tiles.visibleTiles.size,
      loadProgress: tiles.loadProgress,
    })
    return () => {
      delete window.__cityStats
    }
  }, [tiles, gl])
  return null
}

function lerpAngle(a: number, b: number, t: number) {
  let d = (b - a) % (Math.PI * 2)
  if (d > Math.PI) d -= Math.PI * 2
  if (d < -Math.PI) d += Math.PI * 2
  return a + d * t
}

export function GoogleCity({ apiKey, apiRef, onProgress, onReady, onError }: Props) {
  return (
    <Canvas
      flat
      frameloop="demand"
      dpr={[1, MAX_DPR]}
      gl={{ antialias: true, powerPreference: 'high-performance' }}
      camera={{ fov: 48, near: 1, far: 1e8, position: [0, 0, 2e7] }}
    >
      <color attach="background" args={['#0b1524']} />
      {/* Google's mesh carries baked lighting; an ambient of pi shows the textures at true brightness. */}
      <ambientLight intensity={Math.PI * 0.95} />
      <directionalLight position={[1e7, 1e7, 1e7]} intensity={0.35} />

      <TilesRenderer
        key={apiKey}
        errorTarget={ERROR_TARGET}
        onLoadError={(e) => {
          if (e.tile === null) onError(e.error.message || 'Google tileset failed to load')
        }}
      >
        <TilesPlugin plugin={GoogleCloudAuthPlugin} args={[{ apiToken: apiKey, autoRefreshToken: true, useRecommendedSettings: false }]} />
        <TilesPlugin plugin={GLTFExtensionsPlugin} args={[{ dracoLoader }]} />
        <TilesPlugin plugin={TileCompressionPlugin} />
        <TilesPlugin plugin={UpdateOnChangePlugin} />
        <TilesPlugin plugin={TilesFadePlugin} />

        <GlobeControls enableDamping={true} />
        <CameraFlight apiRef={apiRef} onProgress={onProgress} onReady={onReady} />
        <TileStats />
        <TilesAttributionOverlay style={{ left: 'auto', right: 12, bottom: 12, fontSize: 11, opacity: 0.85 }} />
      </TilesRenderer>
    </Canvas>
  )
}

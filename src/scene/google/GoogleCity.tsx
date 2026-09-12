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
  const flight = useRef<Flight | null>(null)
  const current = useRef<GeoPose>(cameraGeoPose(INTRO_START))
  const introStarted = useRef(false)
  const reported = useRef(false)

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

  useEffect(() => {
    if (!tiles) return
    const api = {
      jumpTo(v: Viewpoint) {
        flight.current = null
        applyPose(cameraGeoPose(v))
      },
      flyTo(v: Viewpoint, durationMs = 3200) {
        const to = cameraGeoPose(v)
        const from = { ...current.current }
        const travel = Math.hypot((to.lat - from.lat) * 111000, (to.lon - from.lon) * 92000, to.height - from.height)
        flight.current = { from, to, start: performance.now(), duration: durationMs, lift: Math.min(travel * 0.25, 20000) }
      },
    }
    apiRef.current = api
    tiles.group.updateMatrixWorld(true)
    api.jumpTo(INTRO_START)
    return () => {
      if (apiRef.current === api) apiRef.current = null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tiles, camera, apiRef])

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
    }

    onProgress(tiles.loadProgress)
    if (!introStarted.current && (tiles.loadProgress >= 0.999 || performance.now() > 12000) && tiles.root) {
      introStarted.current = true
      apiRef.current?.flyTo(DEFAULT_VIEWPOINT, 6500)
    }
    if (!reported.current && introStarted.current && tiles.loadProgress >= 0.999) {
      reported.current = true
      onReady()
    }
  })

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
    <Canvas flat dpr={[1, 2]} gl={{ antialias: true, powerPreference: 'high-performance' }} camera={{ fov: 48, near: 1, far: 1e8, position: [0, 0, 2e7] }}>
      <color attach="background" args={['#0b1524']} />
      {/* Google's mesh carries baked lighting; an ambient of pi shows the textures at true brightness. */}
      <ambientLight intensity={Math.PI * 0.95} />
      <directionalLight position={[1e7, 1e7, 1e7]} intensity={0.35} />

      <TilesRenderer
        key={apiKey}
        errorTarget={12}
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
        <TilesAttributionOverlay style={{ left: 'auto', right: 12, bottom: 12, fontSize: 11, opacity: 0.85 }} />
      </TilesRenderer>
    </Canvas>
  )
}

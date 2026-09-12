import { useCallback, useEffect, useState } from 'react'
import { Canvas } from '@react-three/fiber'
import { Vector3 } from 'three'
import { deg2rad } from '../../geo'
import type { SceneApiRef } from '../../sceneApi'
import { AltitudeFog } from './AltitudeFog'
import { CameraRig } from './CameraRig'
import { DebugStats } from './DebugStats'
import type { HeightField } from './heightfield'
import { Ocean } from './Ocean'
import { SkyDome } from './SkyDome'
import { TerrainLayer } from './TerrainLayer'

interface Props {
  apiRef: SceneApiRef
  onProgress: (fraction: number) => void
  onReady: () => void
}

// Late-afternoon sun from the north-west, matching the shading baked into the imagery.
const SUN_AZIMUTH = 325
const SUN_ELEVATION = 38
const SUN_DIR = new Vector3(
  Math.sin(deg2rad(SUN_AZIMUTH)) * Math.cos(deg2rad(SUN_ELEVATION)),
  Math.sin(deg2rad(SUN_ELEVATION)),
  -Math.cos(deg2rad(SUN_AZIMUTH)) * Math.cos(deg2rad(SUN_ELEVATION)),
).normalize()

const SKY_ZENITH = '#2e6db8'
const SKY_HORIZON = '#c8d8e6'
const FOG_COLOR = '#c3d3e2'
const FOG_LOW = 2.8e-5
const FOG_HIGH = 0.9e-5

export function TerrainCity({ apiRef, onProgress, onReady }: Props) {
  const [heightField, setHeightField] = useState<HeightField | null>(null)
  const [coreReady, setCoreReady] = useState(false)

  const handleProgress = useCallback((loaded: number, total: number) => onProgress(loaded / total), [onProgress])
  const handleCoreReady = useCallback(() => setCoreReady(true), [])

  // Do not keep the viewer waiting on a slow connection: start the intro regardless after a while.
  useEffect(() => {
    const id = window.setTimeout(() => setCoreReady(true), 9000)
    return () => window.clearTimeout(id)
  }, [])

  return (
    <Canvas
      flat
      dpr={[1, 2]}
      gl={{ antialias: true, logarithmicDepthBuffer: true, powerPreference: 'high-performance' }}
      camera={{ fov: 48, near: 10, far: 600000, position: [0, 40000, 60000] }}
    >
      <color attach="background" args={[FOG_COLOR]} />
      <fogExp2 attach="fog" args={[FOG_COLOR, FOG_LOW]} />
      <AltitudeFog lowDensity={FOG_LOW} highDensity={FOG_HIGH} />

      <SkyDome sunDir={SUN_DIR} zenith={SKY_ZENITH} horizon={SKY_HORIZON} ground={FOG_COLOR} />
      <hemisphereLight args={['#dbe7f5', '#66705a', 1.9]} />
      <directionalLight position={SUN_DIR.clone().multiplyScalar(100000)} intensity={1.8} color="#fff3e0" />

      <TerrainLayer onHeightField={setHeightField} onProgress={handleProgress} onCoreReady={handleCoreReady} onReady={onReady} />
      <Ocean sunDir={SUN_DIR} skyColor={SKY_HORIZON} heightField={heightField} />
      <CameraRig heightField={heightField} apiRef={apiRef} introReady={coreReady} />
      <DebugStats />
    </Canvas>
  )
}

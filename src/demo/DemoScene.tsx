import { Suspense, useCallback, useRef, useState } from 'react'
import { Canvas, useFrame } from '@react-three/fiber'
import { Group, Vector3 } from 'three'
import { deg2rad } from '../geo'
import { AltitudeFog } from '../scene/terrain/AltitudeFog'
import type { HeightField } from '../scene/terrain/heightfield'
import { Ocean } from '../scene/terrain/Ocean'
import { SkyDome } from '../scene/terrain/SkyDome'
import { TerrainLayer } from '../scene/terrain/TerrainLayer'
import { CinematicCamera } from './CinematicCamera'
import { FireBeat } from './beats/FireBeat'
import { KaijuBeat } from './beats/KaijuBeat'
import { KoebergBeat } from './beats/KoebergBeat'
import { Target, type TargetHandle } from './beats/Target'
import { TsunamiBeat } from './beats/TsunamiBeat'
import { CAMERA_KEYS, DURATION } from './script'
import type { DemoState } from './state'

interface Props {
  state: DemoState
  labelContainer: HTMLElement | null
  onProgress: (fraction: number) => void
  onReady: () => void
}

// Same look as the terrain preview: late-afternoon sun from the north-west, haze near the ground.
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

/** Advances the show clock inside the render loop. */
function Clock({ state }: { state: DemoState }) {
  useFrame((_, delta) => {
    if (!state.playing) return
    state.t += Math.min(delta, 0.1)
    if (state.t >= DURATION) {
      state.t = DURATION
      state.playing = false
      state.done = true
    }
  })
  return null
}

// One scene: the keyless Cape Town terrain with every hazard placed at its real coordinates.
export function DemoScene({ state, labelContainer, onProgress, onReady }: Props) {
  const [heightField, setHeightField] = useState<HeightField | null>(null)
  const terrain = useRef<Group>(null)
  const target = useRef<TargetHandle>(null)
  const handleProgress = useCallback((loaded: number, total: number) => onProgress(loaded / total), [onProgress])
  const noop = useCallback(() => {}, [])

  return (
    <Canvas
      flat
      dpr={[1, 1.5]}
      gl={{ antialias: true, logarithmicDepthBuffer: true, powerPreference: 'high-performance' }}
      camera={{ fov: 48, near: 10, far: 600000, position: [0, 40000, 60000] }}
    >
      <color attach="background" args={[FOG_COLOR]} />
      <fogExp2 attach="fog" args={[FOG_COLOR, FOG_LOW]} />
      <AltitudeFog lowDensity={FOG_LOW} highDensity={FOG_HIGH} />
      <SkyDome sunDir={SUN_DIR} zenith={SKY_ZENITH} horizon={SKY_HORIZON} ground={FOG_COLOR} />
      <hemisphereLight args={['#dbe7f5', '#66705a', 1.9]} />
      <directionalLight position={SUN_DIR.clone().multiplyScalar(100000)} intensity={1.8} color="#fff3e0" />

      <group ref={terrain}>
        <TerrainLayer onHeightField={setHeightField} onProgress={handleProgress} onCoreReady={noop} onReady={onReady} />
      </group>
      <Ocean sunDir={SUN_DIR} skyColor={SKY_HORIZON} heightField={heightField} />

      <Suspense fallback={null}>
        <KoebergBeat state={state} heightField={heightField} />
      </Suspense>
      <Suspense fallback={null}>
        <FireBeat state={state} terrain={terrain} />
      </Suspense>
      <TsunamiBeat state={state} terrain={terrain} />
      <Target ref={target} heightField={heightField} labelContainer={labelContainer} />
      <KaijuBeat state={state} heightField={heightField} target={target} />

      <Clock state={state} />
      <CinematicCamera state={state} heightField={heightField} keys={CAMERA_KEYS} />
    </Canvas>
  )
}

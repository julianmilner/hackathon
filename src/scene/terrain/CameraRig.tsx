import { useEffect, useMemo, useRef } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import { MathUtils, Vector3 } from 'three'
import { MapControls } from 'three/examples/jsm/controls/MapControls.js'
import { deg2rad, latToMercY, lonToMercX, toLatLon, toLocal } from '../../geo'
import type { SceneApiRef } from '../../sceneApi'
import { cameraOffset, DEFAULT_VIEWPOINT, easeInOutCubic, INTRO_START, type Viewpoint } from '../../viewpoints'
import type { HeightField } from './heightfield'
import { groundHeight } from './tileGeometry'

interface Props {
  heightField: HeightField | null
  apiRef: SceneApiRef
  // When this turns true the intro flight from high above the Atlantic begins.
  introReady: boolean
}

interface Flight {
  fromPos: Vector3
  fromTarget: Vector3
  toPos: Vector3
  toTarget: Vector3
  start: number
  duration: number
  lift: number
}

const MIN_CLEARANCE = 40
const _v = new Vector3()

export function CameraRig({ heightField, apiRef, introReady }: Props) {
  const camera = useThree((s) => s.camera)
  const gl = useThree((s) => s.gl)
  const flight = useRef<Flight | null>(null)
  const introStarted = useRef(false)
  const hfRef = useRef<HeightField | null>(null)
  useEffect(() => {
    hfRef.current = heightField
  }, [heightField])

  const controls = useMemo(() => {
    const c = new MapControls(camera, gl.domElement)
    c.enableDamping = true
    c.dampingFactor = 0.08
    c.screenSpacePanning = false
    c.zoomToCursor = true
    c.minDistance = 250
    c.maxDistance = 150000
    c.minPolarAngle = 0.02
    c.maxPolarAngle = deg2rad(83)
    c.maxTargetRadius = 90000
    c.rotateSpeed = 0.6
    return c
  }, [camera, gl])

  useEffect(() => () => controls.dispose(), [controls])

  // Ground height at a lat/lon, from the height field when present.
  const groundAt = (v: Viewpoint) => {
    const hf = hfRef.current
    if (!hf) return v.groundHeight
    return Math.max(groundHeight(hf, lonToMercX(v.lon), latToMercY(v.lat)), 0)
  }

  const poseFor = (v: Viewpoint) => {
    const { x, z } = toLocal(v.lat, v.lon)
    const target = new Vector3(x, groundAt(v), z)
    const o = cameraOffset(v)
    const pos = new Vector3(target.x + o.east, target.y + o.up, target.z - o.north)
    return { target, pos }
  }

  useEffect(() => {
    const api = {
      jumpTo(v: Viewpoint) {
        flight.current = null
        const { target, pos } = poseFor(v)
        controls.target.copy(target)
        camera.position.copy(pos)
        camera.lookAt(target)
        controls.update()
      },
      flyTo(v: Viewpoint, durationMs = 3200) {
        const { target, pos } = poseFor(v)
        const travel = camera.position.distanceTo(pos)
        flight.current = {
          fromPos: camera.position.clone(),
          fromTarget: controls.target.clone(),
          toPos: pos,
          toTarget: target,
          start: performance.now(),
          duration: durationMs,
          lift: Math.min(travel * 0.25, 20000),
        }
      },
    }
    apiRef.current = api
    api.jumpTo(INTRO_START)
    return () => {
      if (apiRef.current === api) apiRef.current = null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [controls, camera, apiRef])

  useEffect(() => {
    if (introReady && !introStarted.current) {
      introStarted.current = true
      apiRef.current?.flyTo(DEFAULT_VIEWPOINT, 6500)
    }
  }, [introReady, apiRef])

  useFrame(() => {
    const f = flight.current
    if (f) {
      const t = MathUtils.clamp((performance.now() - f.start) / f.duration, 0, 1)
      const s = easeInOutCubic(t)
      camera.position.lerpVectors(f.fromPos, f.toPos, s)
      camera.position.y += Math.sin(Math.PI * s) * f.lift
      controls.target.lerpVectors(f.fromTarget, f.toTarget, s)
      camera.lookAt(controls.target)
      controls.enabled = false
      if (t >= 1) {
        flight.current = null
        controls.enabled = true
        controls.update()
      }
    } else {
      controls.update()
    }

    // Never let the camera dip into the mountains.
    const hf = hfRef.current
    if (hf) {
      const ll = toLatLon(camera.position.x, camera.position.z)
      const floor = Math.max(hf.sampleLatLon(ll.lat, ll.lon), 0) + MIN_CLEARANCE
      if (camera.position.y < floor) {
        camera.position.y = floor
        _v.copy(controls.target)
        camera.lookAt(_v)
      }
    }
  })

  return null
}

import { useEffect, useMemo, useRef } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import { Vector3 } from 'three'
import { MapControls } from 'three/examples/jsm/controls/MapControls.js'
import { deg2rad, latToMercY, lonToMercX, toLatLon, toLocal } from '../geo'
import type { HeightField } from '../scene/terrain/heightfield'
import { groundHeight } from '../scene/terrain/tileGeometry'
import { evaluatePath, makeScratch, unwrapHeadings, type CameraPose } from './path'
import type { CameraKey } from './script'
import type { DemoState } from './state'

interface Props {
  state: DemoState
  heightField: HeightField | null
  keys: CameraKey[]
}

const MIN_CLEARANCE = 30

// Helicopter camera: follows the storyboard spline while the show plays, hands over to
// map controls before and after so the presenter can look around. Shake decays here.
export function CinematicCamera({ state, heightField, keys }: Props) {
  const camera = useThree((s) => s.camera)
  const gl = useThree((s) => s.gl)
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
    c.minDistance = 60
    c.maxDistance = 150000
    c.minPolarAngle = 0.02
    c.maxPolarAngle = deg2rad(85)
    c.rotateSpeed = 0.6
    return c
  }, [camera, gl])
  useEffect(() => () => controls.dispose(), [controls])

  const headings = useMemo(() => unwrapHeadings(keys), [keys])
  const scratch = useMemo(() => makeScratch(), [])
  const pose = useMemo<CameraPose>(() => ({ target: new Vector3(), position: new Vector3() }), [])
  const placedOnTerrain = useRef(false)
  const wasPlaying = useRef(false)

  const groundAt = (lat: number, lon: number) => {
    const hf = hfRef.current
    return hf ? Math.max(groundHeight(hf, lonToMercX(lon), latToMercY(lat)), 0) : 0
  }

  const resolve = (key: CameraKey, out: Vector3) => {
    const subject = key.subject ? state.subjects[key.subject] : undefined
    if (subject) {
      out.copy(subject)
      out.y += key.alt ?? 0
      return
    }
    const { x, z } = toLocal(key.at.lat, key.at.lon)
    out.set(x, groundAt(key.at.lat, key.at.lon) + (key.alt ?? 0), z)
  }

  useFrame((_, delta) => {
    const s = state
    // Park on the opening shot until Play, re-evaluating until the terrain height is known.
    const parking = !s.playing && !s.done && !placedOnTerrain.current
    if (s.playing || parking) {
      evaluatePath(keys, headings, s.playing ? s.t : 0, resolve, pose, scratch)
      camera.position.copy(pose.position)
      controls.target.copy(pose.target)
      controls.enabled = false
      if (parking && hfRef.current) placedOnTerrain.current = true
      wasPlaying.current = s.playing
    } else {
      if (wasPlaying.current) {
        // Show just ended: let the controls take over from the final pose.
        wasPlaying.current = false
        controls.enabled = true
        controls.update()
      }
      controls.enabled = true
      controls.update()
    }

    // Never dip into the mountains.
    const hf = hfRef.current
    if (hf) {
      const ll = toLatLon(camera.position.x, camera.position.z)
      const floor = Math.max(hf.sampleLatLon(ll.lat, ll.lon), 0) + MIN_CLEARANCE
      if (camera.position.y < floor) camera.position.y = floor
    }

    // Shake: beats raise it, the camera decays it.
    if (s.shake > 0.001) {
      const dist = camera.position.distanceTo(controls.target)
      const a = s.shake * s.shake * dist * 0.012
      camera.position.x += (Math.random() - 0.5) * a
      camera.position.y += (Math.random() - 0.5) * a * 0.7
      camera.position.z += (Math.random() - 0.5) * a
      s.shake = Math.max(0, s.shake - delta / 0.7)
    }
    camera.lookAt(controls.target)
  })

  return null
}

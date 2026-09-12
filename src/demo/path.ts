import { MathUtils, Vector3 } from 'three'
import type { CameraKey } from './script'

export interface CameraPose {
  target: Vector3
  position: Vector3
}

/** Resolve a key's target to a world-space point (x east, y up, z south). */
export type TargetResolver = (key: CameraKey, out: Vector3) => void

// Components interpolated per key: target x, y, z, heading (unwrapped), tilt, distance.
const C = 6
const EPS = 1e-4

function hermite(v1: number, v2: number, m1: number, m2: number, u: number) {
  const u2 = u * u
  const u3 = u2 * u
  return (2 * u3 - 3 * u2 + 1) * v1 + (u3 - 2 * u2 + u) * m1 + (-2 * u3 + 3 * u2) * v2 + (u3 - u2) * m2
}

/** Headings made continuous so the camera never spins the long way round. */
export function unwrapHeadings(keys: CameraKey[]) {
  const out = new Float64Array(keys.length)
  for (let i = 0; i < keys.length; i++) {
    let h = keys[i].heading
    if (i > 0) {
      while (h - out[i - 1] > 180) h -= 360
      while (h - out[i - 1] < -180) h += 360
    }
    out[i] = h
  }
  return out
}

/**
 * Evaluate the camera path at time t: a non-uniform Catmull-Rom spline through the keys,
 * per component, with tangents zeroed where a component holds still so the camera eases
 * into and out of every pause instead of drifting through it.
 */
export function evaluatePath(keys: CameraKey[], headings: Float64Array, t: number, resolve: TargetResolver, out: CameraPose, scratch: Float64Array[]) {
  const n = keys.length
  if (n === 0) return
  const tt = MathUtils.clamp(t, keys[0].t, keys[n - 1].t)
  let i = 0
  while (i < n - 2 && tt > keys[i + 1].t) i++
  const i0 = Math.max(i - 1, 0)
  const i1 = i
  const i2 = Math.min(i + 1, n - 1)
  const i3 = Math.min(i + 2, n - 1)
  const dur = Math.max(keys[i2].t - keys[i1].t, 1e-3)
  const u = MathUtils.clamp((tt - keys[i1].t) / dur, 0, 1)

  const P = scratch
  const idx = [i0, i1, i2, i3]
  for (let k = 0; k < 4; k++) {
    const key = keys[idx[k]]
    resolve(key, _v)
    P[k][0] = _v.x
    P[k][1] = _v.y
    P[k][2] = _v.z
    P[k][3] = headings[idx[k]]
    P[k][4] = key.tilt
    P[k][5] = key.distance
  }

  for (let c = 0; c < C; c++) {
    const v0 = P[0][c], v1 = P[1][c], v2 = P[2][c], v3 = P[3][c]
    let m1 = 0
    let m2 = 0
    if (Math.abs(v2 - v1) > EPS) {
      // Catmull-Rom tangents scaled to this segment's duration; zero where the neighbour holds.
      m1 = i0 === i1 || Math.abs(v1 - v0) < EPS ? 0 : ((v2 - v0) / (keys[i2].t - keys[i0].t)) * dur
      m2 = i3 === i2 || Math.abs(v3 - v2) < EPS ? 0 : ((v3 - v1) / (keys[i3].t - keys[i1].t)) * dur
      if (i0 === i1) m1 = v2 - v1
      if (i3 === i2) m2 = v2 - v1
    }
    _r[c] = hermite(v1, v2, m1, m2, u)
  }

  out.target.set(_r[0], _r[1], _r[2])
  const h = MathUtils.degToRad(_r[3])
  const tl = MathUtils.degToRad(MathUtils.clamp(_r[4], 1, 89))
  const d = Math.max(_r[5], 1)
  const east = -Math.sin(h) * Math.sin(tl) * d
  const north = -Math.cos(h) * Math.sin(tl) * d
  const up = Math.cos(tl) * d
  out.position.set(out.target.x + east, out.target.y + up, out.target.z - north)
}

export function makeScratch() {
  return [new Float64Array(C), new Float64Array(C), new Float64Array(C), new Float64Array(C)]
}

const _v = new Vector3()
const _r = new Float64Array(C)

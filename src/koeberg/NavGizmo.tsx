import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import { MathUtils, Quaternion, Spherical, Vector3 } from 'three'
import type { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import type { View } from './Rig'

// Blender-style viewport gizmo: an axis widget you drag to orbit and click to snap to an axis
// view, with zoom, pan and home buttons underneath. The gizmo is plain SVG over the canvas and
// moves the OrbitControls camera directly; the Rig's per-frame controls.update() picks it up.

interface Props {
  controls: OrbitControls | null
  // Animated move to a view (reuses the Rig's flight).
  onSnap: (view: View) => void
  onHome: () => void
  // Fired on any gizmo interaction so guided camera moves stand down.
  onInteract?: () => void
}

interface Axis {
  id: string
  dir: Vector3
  color: string
  label?: string
  // Camera views from underground are blocked by the polar limit.
  disabled?: boolean
}

const AXES: Axis[] = [
  { id: '+x', dir: new Vector3(1, 0, 0), color: '#ff3352', label: 'X' },
  { id: '+y', dir: new Vector3(0, 1, 0), color: '#8bdc00', label: 'Y' },
  { id: '+z', dir: new Vector3(0, 0, 1), color: '#2890ff', label: 'Z' },
  { id: '-x', dir: new Vector3(-1, 0, 0), color: '#ff3352' },
  { id: '-y', dir: new Vector3(0, -1, 0), color: '#8bdc00', disabled: true },
  { id: '-z', dir: new Vector3(0, 0, -1), color: '#2890ff' },
]

const SIZE = 96
const R = 34 // orbit radius of the axis balls, in px
const SNAP_MS = 500
const MIN_POLAR = 0.02

const _q = new Quaternion()
const _v = new Vector3()
const _sph = new Spherical()
const _right = new Vector3()
const _fwd = new Vector3()

type Tool = 'orbit' | 'zoom' | 'pan'

// View looking at the current target from the given world axis, at the current distance.
function axisView(controls: OrbitControls, dir: Vector3): View {
  const cam = controls.object
  const target = controls.target
  const dist = cam.position.distanceTo(target)
  const pos = dir.clone()
  if (Math.abs(dir.y) > 0.5) {
    // Keep the current heading when looking straight down so the view does not spin.
    _v.subVectors(cam.position, target).setY(0)
    if (_v.lengthSq() < 1e-6) _v.set(0, 0, 1)
    _v.normalize()
    pos.set(0, 1, 0).multiplyScalar(Math.cos(MIN_POLAR * 1.5)).addScaledVector(_v, Math.sin(MIN_POLAR * 1.5))
  } else {
    // Sit a little above the horizon so the site is visible over the terrace.
    pos.y = Math.tan(MathUtils.degToRad(8))
    pos.normalize()
  }
  pos.multiplyScalar(dist).add(target)
  return {
    id: 'axis',
    name: 'Axis',
    position: [pos.x, pos.y, pos.z],
    target: [target.x, target.y, target.z],
    durationMs: SNAP_MS,
  }
}

export function NavGizmo({ controls, onSnap, onHome, onInteract }: Props) {
  const [q, setQ] = useState<[number, number, number, number]>([0, 0, 0, 1])
  const [active, setActive] = useState<Tool | null>(null)
  const drag = useRef<{ tool: Tool; x: number; y: number; moved: boolean; pointerId: number; axis: Axis | null } | null>(null)
  // Axis ball under the pointer at pointerdown; pointer capture retargets later events to the svg.
  const hit = useRef<Axis | null>(null)

  // Mirror the camera orientation into React state whenever it changes.
  useEffect(() => {
    if (!controls) return
    let raf = 0
    const last = new Quaternion(0, 0, 0, 0)
    const tick = () => {
      const cq = controls.object.quaternion
      if (Math.abs(cq.dot(last)) < 0.999999) {
        last.copy(cq)
        setQ([cq.x, cq.y, cq.z, cq.w])
      }
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [controls])

  // Blender-style keys: 1 front, 3 right, 7 top, Ctrl flips, Home returns to the preset view.
  useEffect(() => {
    if (!controls) return
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null
      if (t && /^(INPUT|SELECT|TEXTAREA)$/.test(t.tagName)) return
      const flip = e.ctrlKey || e.metaKey ? -1 : 1
      let dir: Vector3 | null = null
      if (e.key === '1') dir = new Vector3(0, 0, flip)
      else if (e.key === '3') dir = new Vector3(flip, 0, 0)
      else if (e.key === '7') dir = new Vector3(0, 1, 0)
      else if (e.key === 'Home') {
        e.preventDefault()
        onInteract?.()
        onHome()
        return
      }
      if (!dir) return
      e.preventDefault()
      onInteract?.()
      onSnap(axisView(controls, dir))
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [controls, onSnap, onHome, onInteract])

  const applyDrag = (tool: Tool, dx: number, dy: number) => {
    if (!controls || !controls.enabled) return
    const cam = controls.object
    const target = controls.target
    _v.subVectors(cam.position, target)
    if (tool === 'orbit') {
      _sph.setFromVector3(_v)
      _sph.theta -= dx * 0.012
      _sph.phi = MathUtils.clamp(_sph.phi - dy * 0.012, Math.max(controls.minPolarAngle, MIN_POLAR), controls.maxPolarAngle)
      _v.setFromSpherical(_sph)
      cam.position.copy(target).add(_v)
    } else if (tool === 'zoom') {
      const dist = MathUtils.clamp(_v.length() * Math.exp(dy * 0.01), controls.minDistance, controls.maxDistance)
      cam.position.copy(target).addScaledVector(_v.normalize(), dist)
    } else {
      // Pan along the ground, matching screenSpacePanning = false on the controls.
      const k = _v.length() * 0.0016
      _right.set(1, 0, 0).applyQuaternion(cam.quaternion).setY(0).normalize()
      _fwd.set(0, 0, -1).applyQuaternion(cam.quaternion).setY(0)
      if (_fwd.lengthSq() < 1e-6) _fwd.set(0, 1, 0).applyQuaternion(cam.quaternion).setY(0)
      _fwd.normalize()
      const move = _right.multiplyScalar(-dx * k).addScaledVector(_fwd, dy * k)
      cam.position.add(move)
      target.add(move)
    }
    cam.lookAt(target)
  }

  const startDrag = (tool: Tool, e: ReactPointerEvent) => {
    if (e.button !== 0) return
    e.preventDefault()
    e.currentTarget.setPointerCapture(e.pointerId)
    drag.current = { tool, x: e.clientX, y: e.clientY, moved: false, pointerId: e.pointerId, axis: hit.current }
    hit.current = null
    setActive(tool)
    onInteract?.()
  }

  const moveDrag = (e: ReactPointerEvent) => {
    const d = drag.current
    if (!d || d.pointerId !== e.pointerId) return
    const dx = e.clientX - d.x
    const dy = e.clientY - d.y
    if (!d.moved && Math.hypot(dx, dy) < 3) return
    d.moved = true
    d.x = e.clientX
    d.y = e.clientY
    applyDrag(d.tool, dx, dy)
  }

  const endDrag = (e: ReactPointerEvent) => {
    const d = drag.current
    if (!d || d.pointerId !== e.pointerId) return
    drag.current = null
    setActive(null)
    const axis = d.axis
    if (!d.moved && axis && !axis.disabled && controls) onSnap(axisView(controls, axis.dir))
  }

  if (!controls) return null

  // Axis directions in camera space: x right, y up, z towards the viewer.
  _q.set(q[0], q[1], q[2], q[3]).invert()
  const balls = AXES.map((a) => {
    _v.copy(a.dir).applyQuaternion(_q)
    return { a, x: SIZE / 2 + _v.x * R, y: SIZE / 2 - _v.y * R, depth: _v.z }
  }).sort((p, r) => p.depth - r.depth)

  return (
    <div className="k-gizmo" aria-label="Viewport navigation">
      <svg
        className={'k-gizmo-axes' + (active === 'orbit' ? ' is-active' : '')}
        width={SIZE}
        height={SIZE}
        viewBox={`0 0 ${SIZE} ${SIZE}`}
        onPointerDown={(e) => startDrag('orbit', e)}
        onPointerMove={moveDrag}
        onPointerUp={(e) => endDrag(e)}
        onPointerCancel={(e) => endDrag(e)}
      >
        <title>Drag to orbit, click an axis to look along it</title>
        <circle className="k-gizmo-bg" cx={SIZE / 2} cy={SIZE / 2} r={SIZE / 2 - 1} />
        {balls.map(({ a, x, y, depth }) => {
          const near = (depth + 1) / 2 // 0 far, 1 near
          const r = 7 + near * 2.5
          const positive = !!a.label
          return (
            <g
              key={a.id}
              className={'k-gizmo-axis' + (a.disabled ? ' is-disabled' : '')}
              opacity={a.disabled ? 0.35 : 0.55 + near * 0.45}
              onPointerDown={() => { hit.current = a }}
            >
              {positive && <line x1={SIZE / 2} y1={SIZE / 2} x2={x} y2={y} stroke={a.color} strokeWidth={2} />}
              <circle cx={x} cy={y} r={r} fill={positive ? a.color : 'rgba(12,18,30,0.75)'} stroke={a.color} strokeWidth={positive ? 0 : 2} />
              {positive && <text x={x} y={y + 0.5} textAnchor="middle" dominantBaseline="middle">{a.label}</text>}
            </g>
          )
        })}
      </svg>
      <div className="k-gizmo-tools">
        <button
          type="button"
          className={active === 'zoom' ? 'is-active' : ''}
          title="Drag to zoom (or use the wheel)"
          onPointerDown={(e) => startDrag('zoom', e)}
          onPointerMove={moveDrag}
          onPointerUp={(e) => endDrag(e)}
          onPointerCancel={(e) => endDrag(e)}
        >
          <svg viewBox="0 0 20 20" aria-hidden="true">
            <circle cx="8.5" cy="8.5" r="5.5" fill="none" stroke="currentColor" strokeWidth="1.8" />
            <path d="M12.5 12.5 L17 17" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
            <path d="M6 8.5h5M8.5 6v5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
          </svg>
        </button>
        <button
          type="button"
          className={active === 'pan' ? 'is-active' : ''}
          title="Drag to pan (or right-drag the view)"
          onPointerDown={(e) => startDrag('pan', e)}
          onPointerMove={moveDrag}
          onPointerUp={(e) => endDrag(e)}
          onPointerCancel={(e) => endDrag(e)}
        >
          <svg viewBox="0 0 20 20" aria-hidden="true">
            <path d="M10 2v16M2 10h16" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
            <path d="M7.5 4.5 10 2l2.5 2.5M7.5 15.5 10 18l2.5-2.5M4.5 7.5 2 10l2.5 2.5M15.5 7.5 18 10l-2.5 2.5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
        <button type="button" title="Back to the chosen view (Home)" onClick={() => { onInteract?.(); onHome() }}>
          <svg viewBox="0 0 20 20" aria-hidden="true">
            <path d="M3 10.5 10 4l7 6.5M5.5 9v7.5h9V9" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
      </div>
    </div>
  )
}

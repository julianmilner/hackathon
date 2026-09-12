import { useEffect, useMemo, useRef } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import { Object3D, Vector3 } from 'three'

export interface LabelItem {
  id: string
  text: string
  sub?: string
  // Local position, or a function returning one (null hides the label this frame).
  position: [number, number, number] | (() => Vector3 | null)
  minDist?: number
  maxDist?: number
  className?: string
}

interface Props {
  items: LabelItem[]
  container: HTMLElement | null
  // Object whose local frame the positions are given in.
  parent: Object3D | null
  activeId?: string | null
}

const world = new Vector3()

// Plain HTML labels projected onto the canvas each frame. No drei dependency.
export function Labels({ items, container, parent, activeId }: Props) {
  const camera = useThree((s) => s.camera)
  const size = useThree((s) => s.size)
  const nodes = useRef(new Map<string, HTMLDivElement>())
  const key = useMemo(() => items.map((i) => i.id).join('|'), [items])

  useEffect(() => {
    if (!container) return
    const map = nodes.current
    for (const item of items) {
      const el = document.createElement('div')
      el.className = 'k-label' + (item.className ? ' ' + item.className : '')
      el.innerHTML = `<span class="k-label-dot"></span><span class="k-label-text">${item.text}${item.sub ? `<small>${item.sub}</small>` : ''}</span>`
      el.style.display = 'none'
      container.appendChild(el)
      map.set(item.id, el)
    }
    return () => {
      for (const el of map.values()) el.remove()
      map.clear()
    }
    // rebuild only when the set of ids changes
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [container, key])

  useEffect(() => {
    for (const [id, el] of nodes.current) el.classList.toggle('is-active', id === activeId)
  }, [activeId, key])

  useFrame(() => {
    if (!container) return
    for (const item of items) {
      const el = nodes.current.get(item.id)
      if (!el) continue
      const p = typeof item.position === 'function' ? item.position() : null
      if (typeof item.position === 'function') {
        if (!p) { el.style.display = 'none'; continue }
        world.copy(p)
      } else {
        world.set(item.position[0], item.position[1], item.position[2])
      }
      if (parent) parent.localToWorld(world)
      const dist = world.distanceTo(camera.position)
      if ((item.minDist && dist < item.minDist) || (item.maxDist && dist > item.maxDist)) { el.style.display = 'none'; continue }
      world.project(camera)
      if (world.z > 1 || Math.abs(world.x) > 1.1 || Math.abs(world.y) > 1.1) { el.style.display = 'none'; continue }
      const x = (world.x * 0.5 + 0.5) * size.width
      const y = (-world.y * 0.5 + 0.5) * size.height
      el.style.display = ''
      el.style.transform = `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px)`
    }
  })

  return null
}

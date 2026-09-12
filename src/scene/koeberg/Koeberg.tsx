import { useMemo, useRef } from 'react'
import { Group, Vector3 } from 'three'
import { Accident, type SimState } from './Accident'
import { useKoebergModel, useModelMode, type ViewMode } from './KoebergModel'
import { Labels, type LabelItem } from './Labels'
import { ProcessFlow, type ProcessState } from './ProcessFlow'
import { EXPLOSION_T, offsetFromSite, PLACES, PROCESS_STEPS } from './site'

export interface KoebergProps {
  mode: ViewMode
  sim: SimState
  process: ProcessState
  // Show the terrace, roads, breakwaters and pylons. Turn off when the photoreal city mesh is underneath.
  showSite?: boolean
  labelContainer?: HTMLElement | null
  activeStep?: string | null
  // Force the shells see-through (the accident timeline uses this while the failure builds inside).
  ghost?: boolean
  position?: [number, number, number]
  rotation?: [number, number, number]
}

// The whole station: model, process flow, accident timeline and labels. Drop it into any scene
// at the site position; its frame is metres, y up, x east, z south, origin at the site centroid.
export function Koeberg({ mode, sim, process, showSite = true, labelContainer = null, activeStep = null, ghost = false, position = [0, 0, 0], rotation = [0, 0, 0] }: KoebergProps) {
  const parts = useKoebergModel()
  useModelMode(parts, mode, showSite, ghost)
  const group = useRef<Group>(null)

  const processLabels = useMemo<LabelItem[]>(() => {
    const items: LabelItem[] = PROCESS_STEPS.map((s) => ({
      id: s.id,
      text: s.title.replace(/^\d+ · /, ''),
      position: parts.anchors.points[s.anchor],
      maxDist: 900,
      className: 'k-label--process',
    }))
    items.push({ id: 'stack', text: 'Vent stack', position: parts.anchors.points.stack_top, maxDist: 900, className: 'k-label--process' })
    items.push({ id: 'u2', text: 'Unit 2 containment', sub: '37 m inside, 0.9 m walls', position: parts.anchors.points.u2_dome_apex, maxDist: 1500, className: 'k-label--process' })
    return items
  }, [parts])

  const accidentLabels = useMemo<LabelItem[]>(() => {
    // Regional labels only once the release is under way; before that they clutter the site views.
    const after = (v: Vector3) => () => (sim.t >= EXPLOSION_T ? v : null)
    const items: LabelItem[] = PLACES.map((p) => {
      const o = offsetFromSite(p.lat, p.lon)
      const km = Math.hypot(o.x, o.z) / 1000
      return { id: 'place-' + p.name, text: p.name, sub: `${km.toFixed(0)} km${p.population ? ' · ' + p.population : ''}`, position: after(new Vector3(o.x, 30, o.z)), minDist: 3000, className: 'k-label--place' }
    })
    items.push({ id: 'paz', text: '5 km · Precautionary Action Zone', sub: 'evacuate within 4 h', position: after(new Vector3(0, 20, 5000)), minDist: 3000, className: 'k-label--zone' })
    items.push({ id: 'upz', text: '16 km · Urgent Protective Action Zone', sub: 'shelter, iodine, evacuate downwind sectors', position: after(new Vector3(0, 20, 16000)), minDist: 6000, className: 'k-label--zone' })
    const front = new Vector3()
    items.push({
      id: 'front',
      text: 'Plume front',
      position: () => {
        if (sim.plumeFront < 800) return null
        const a = ((sim.wind.fromDeg + 180) * Math.PI) / 180
        front.set(Math.sin(a) * sim.plumeFront, 400, -Math.cos(a) * sim.plumeFront)
        return front
      },
      minDist: 2500,
      className: 'k-label--front',
    })
    items.push({ id: 'breach', text: 'Unit 1 containment breach', position: after(new Vector3(...parts.anchors.points.u1_dome_apex)), maxDist: 2500, className: 'k-label--zone' })
    return items
  }, [parts, sim])

  const labels = mode === 'inside' ? processLabels : mode === 'accident' ? accidentLabels : []

  return (
    <group ref={group} position={position} rotation={rotation}>
      <primitive object={parts.scene} />
      <ProcessFlow parts={parts} state={process} visible={mode !== 'exterior'} />
      <Accident parts={parts} sim={sim} process={process} active={mode === 'accident'} />
      <Labels items={labels} container={labelContainer} parent={group} activeId={activeStep} />
    </group>
  )
}

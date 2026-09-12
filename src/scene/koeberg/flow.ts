import { CanvasTexture, CatmullRomCurve3, Color, Vector3 } from 'three'

// A resampled pipe path with a "temperature" (0 cold .. 1 hot) per sample, used to move and
// colour the flow particles. Sampling is even in arc length so speed looks constant.
export interface FlowPath {
  positions: Float32Array // samples * 3
  temps: Float32Array
  samples: number
  length: number
  closed: boolean
}

export function buildFlowPath(points: [number, number, number][], temps: number[], closed: boolean, samples = 400): FlowPath {
  const pts = points.map((p) => new Vector3(p[0], p[1], p[2]))
  if (closed && pts.length > 1 && pts[0].distanceTo(pts[pts.length - 1]) < 0.01) pts.pop()
  const curve = new CatmullRomCurve3(pts, closed, 'centripetal', 0.3)
  const positions = new Float32Array(samples * 3)
  const tArr = new Float32Array(samples)
  const n = closed ? pts.length : pts.length - 1
  const v = new Vector3()
  for (let i = 0; i < samples; i++) {
    const u = i / (closed ? samples : samples - 1)
    const t = curve.getUtoTmapping(u, 0)
    curve.getPoint(t, v)
    positions[i * 3] = v.x
    positions[i * 3 + 1] = v.y
    positions[i * 3 + 2] = v.z
    // interpolate temperature between control points
    const s = t * n
    const k = Math.min(Math.floor(s), temps.length - 1)
    const k2 = Math.min(k + 1, temps.length - 1)
    const f = s - k
    tArr[i] = temps[k] * (1 - f) + temps[k2 % temps.length] * f
  }
  return { positions, temps: tArr, samples, length: curve.getLength(), closed }
}

// Temperature profile of the primary loop path exported by blender/koeberg.py (18 control points):
// vessel bottom, core top, vessel outlet, hot leg x3, SG bottom, SG top, SG outlet,
// crossover x4, pump, cold leg x2, downcomer, back to the start.
export const PRIMARY_TEMPS = [0.15, 0.85, 1, 1, 1, 1, 0.95, 0.5, 0.15, 0.05, 0.05, 0.05, 0.05, 0.05, 0.05, 0.05, 0.1, 0.12]
// Secondary path (20 points): SG top -> wall -> header x6 -> HP -> MSR -> LP0..LP2 -> condenser x3 -> pump -> riser -> wall -> SG.
export const SECONDARY_TEMPS = [1, 1, 1, 1, 1, 1, 1, 1, 0.9, 0.8, 0.7, 0.6, 0.5, 0.1, 0.05, 0.05, 0.1, 0.2, 0.3, 0.4]
// Tertiary (13 points): intake -> culvert -> condenser -> outfall. Cold in, slightly warm out.
export const TERTIARY_TEMPS = [0, 0, 0, 0, 0, 0.1, 0.5, 0.8, 0.8, 0.8, 0.8, 0.8, 0.8]

export interface FlowStyle {
  cold: Color
  hot: Color
  size: number
  speed: number // m/s along the path
  density: number // particles per metre
}

export const FLOW_STYLES: Record<'primary' | 'secondary' | 'tertiary', FlowStyle> = {
  primary: { cold: new Color('#3b8bff'), hot: new Color('#ff5a1f'), size: 1.1, speed: 7, density: 0.9 },
  secondary: { cold: new Color('#4fd1c5'), hot: new Color('#ffffff'), size: 1.4, speed: 9, density: 0.5 },
  tertiary: { cold: new Color('#1fb6ff'), hot: new Color('#7fe0c0'), size: 2.2, speed: 6, density: 0.25 },
}

let spriteTexture: CanvasTexture | null = null
// Soft round sprite for additive particles.
export function particleSprite() {
  if (spriteTexture) return spriteTexture
  const c = document.createElement('canvas')
  c.width = c.height = 64
  const ctx = c.getContext('2d')!
  const g = ctx.createRadialGradient(32, 32, 0, 32, 32, 32)
  g.addColorStop(0, 'rgba(255,255,255,1)')
  g.addColorStop(0.35, 'rgba(255,255,255,0.7)')
  g.addColorStop(1, 'rgba(255,255,255,0)')
  ctx.fillStyle = g
  ctx.fillRect(0, 0, 64, 64)
  spriteTexture = new CanvasTexture(c)
  return spriteTexture
}

let smokeTexture: CanvasTexture | null = null
// Blotchy sprite for smoke and the plume.
export function smokeSprite() {
  if (smokeTexture) return smokeTexture
  const c = document.createElement('canvas')
  c.width = c.height = 128
  const ctx = c.getContext('2d')!
  for (let i = 0; i < 14; i++) {
    const x = 64 + (Math.random() - 0.5) * 50
    const y = 64 + (Math.random() - 0.5) * 50
    const r = 22 + Math.random() * 22
    const g = ctx.createRadialGradient(x, y, 0, x, y, r)
    g.addColorStop(0, 'rgba(255,255,255,0.22)')
    g.addColorStop(1, 'rgba(255,255,255,0)')
    ctx.fillStyle = g
    ctx.fillRect(0, 0, 128, 128)
  }
  smokeTexture = new CanvasTexture(c)
  return smokeTexture
}

import {
  AdditiveBlending,
  BufferAttribute,
  BufferGeometry,
  Color,
  DataTexture,
  DoubleSide,
  DynamicDrawUsage,
  FloatType,
  Group,
  LinearFilter,
  Matrix4,
  Mesh,
  NearestFilter,
  NormalBlending,
  Object3D,
  PointLight,
  Points,
  RGBAFormat,
  ShaderMaterial,
  UnsignedByteType,
  Vector2,
  Vector3,
  WebGLRenderer,
} from 'three'
import { sampleHeightField, type HeightField, type HeightFieldOptions } from '../tsunami/HeightField'
import { flameFragment, groundFragment, groundVertex, particleVertex, smokeFragment } from './shaders'

export interface FireOptions {
  /** Side length of the square simulation area in metres. */
  size?: number
  /** Cells per side. 256 over 2.5 km gives 10 m cells. */
  resolution?: number
  /** Simulated seconds per real second. */
  timeScale?: number
  /** Cells whose sampled height is below this carry no fuel (sea, suburb). Local metres. */
  fuelMinHeight?: number
  /** Cells steeper than this (degrees) are bare rock with almost no fuel. */
  fuelMaxSlope?: number
  /** Rate of spread on flat ground, no wind, dry fuel (m/s). Fynbos is roughly 0.2 to 0.4. */
  spreadRate?: number
  /** Seconds a cell burns before it is spent. */
  burnTime?: number
  /** Wind response: factor = exp(windGain * speed * cos(angle to wind)). */
  windGain?: number
  /** Slope response: factor = exp(slopeGain * rise / run). Fire runs uphill. */
  slopeGain?: number
  /** Ember spotting chance per burning cell per second, scaled by wind above 5 m/s. */
  spotting?: number
  flameCount?: number
  smokeCount?: number
  /** Add a flickering point light above the fire. */
  light?: boolean
  seed?: number
}

export interface FireParams {
  /** Ignition point in local metres (x east, z south). */
  x: number
  z: number
  /** Ignition radius in metres. */
  radius: number
  /** Direction the wind blows from, degrees clockwise from north (315 = north-westerly). */
  windFrom: number
  /** Wind speed in m/s. */
  windSpeed: number
  /** 0 = tinder dry, 1 = sodden. Scales the rate of spread. */
  humidity: number
}

/** Rhodes Memorial fire, April 2021: a north-westerly berg wind drove it towards UCT and Vredehoek. */
export const defaultFire: FireParams = { x: 0, z: 0, radius: 15, windFrom: 315, windSpeed: 8, humidity: 0.25 }

/** Return 0..1 fuel for a cell given its local position, height and slope in degrees. */
export type FuelFunction = (x: number, z: number, height: number, slopeDeg: number) => number

const UNBURNT = 0
const BURNING = 1
const BURNT = 2

// di, dj, distance in cells. j grows northwards (towards -z), matching the height field rows.
const NEIGHBOURS: ReadonlyArray<readonly [number, number, number]> = [
  [1, 0, 1], [-1, 0, 1], [0, 1, 1], [0, -1, 1],
  [1, 1, Math.SQRT2], [1, -1, Math.SQRT2], [-1, 1, Math.SQRT2], [-1, -1, Math.SQRT2],
]

/**
 * Wildfire that spreads across the terrain height field, faster uphill and downwind.
 * Spread is a cellular automaton on the CPU (65k cells is cheap, and the verdict code can
 * read arrival times directly). Rendering is a scorch/ember sheet draped over the terrain
 * plus GPU flame and smoke particles.
 *
 * Usage:
 *   const sim = new FireSimulation(renderer, { size: 2500, resolution: 256, fuelMinHeight: 80 })
 *   sim.setFrame(localFrame)                      // ENU frame at the demo pin (identity in the sandbox)
 *   scene.add(sim.group)
 *   sim.sampleTerrain(tilesGroup)                 // once the tiles have loaded
 *   sim.ignite({ x: 400, z: -200, windFrom: 315, windSpeed: 10, humidity: 0.2 })
 *   sim.update(deltaSeconds)                      // every frame
 *   sim.arrivalTime(pinX, pinZ)                   // simulated seconds until the front reached the pin
 */
export class FireSimulation {
  readonly group: Group
  readonly overlay: Mesh
  readonly light: PointLight | null
  readonly options: Required<FireOptions>
  readonly overlayMaterial: ShaderMaterial

  terrain: HeightField | null = null
  params: FireParams = { ...defaultFire }
  /** Simulated seconds since the first ignition; negative when idle. */
  time = -1
  running = false

  private renderer: WebGLRenderer
  /** RGBA bytes per cell: r burn intensity, g char, b fuel, a pre-heat. Layers such as Fynbos read it. */
  readonly stateTexture: DataTexture
  private terrainTexture: DataTexture
  private heights: Float32Array
  private slope: Float32Array
  private fuel0: Float32Array
  private fuel: Float32Array
  private heat: Float32Array
  private threshold: Float32Array
  private state: Uint8Array
  private ignitedAt: Float32Array
  private burning: number[] = []
  private windDi = 0
  private windDj = 0
  private windLocal = new Vector3()
  private stepDt = 1
  private accumulator = 0
  private clock = 0
  private flameCarry = 0
  private smokeCarry = 0
  private rnd: () => number
  private fuelFn: FuelFunction | null = null
  private flames: ParticleSystem
  private smoke: ParticleSystem
  private viewport = new Vector2()

  constructor(renderer: WebGLRenderer, options: FireOptions = {}) {
    this.renderer = renderer
    this.options = {
      size: 2500,
      resolution: 256,
      timeScale: 20,
      fuelMinHeight: 0,
      fuelMaxSlope: 55,
      spreadRate: 0.25,
      burnTime: 240,
      windGain: 0.15,
      slopeGain: 2,
      spotting: 0.002,
      flameCount: 3000,
      smokeCount: 3000,
      light: true,
      seed: 1,
      ...options,
    }
    const { resolution, size, flameCount, smokeCount } = this.options
    const n = resolution * resolution
    this.rnd = seeded(this.options.seed)
    this.heights = new Float32Array(n)
    this.slope = new Float32Array(n)
    this.fuel0 = new Float32Array(n)
    this.fuel = new Float32Array(n)
    this.heat = new Float32Array(n)
    this.threshold = new Float32Array(n)
    this.state = new Uint8Array(n)
    this.ignitedAt = new Float32Array(n).fill(-1)

    this.terrainTexture = new DataTexture(new Float32Array(n * 4), resolution, resolution, RGBAFormat, FloatType)
    this.terrainTexture.minFilter = NearestFilter
    this.terrainTexture.magFilter = NearestFilter
    this.terrainTexture.needsUpdate = true

    this.stateTexture = new DataTexture(new Uint8Array(n * 4), resolution, resolution, RGBAFormat, UnsignedByteType)
    this.stateTexture.minFilter = LinearFilter
    this.stateTexture.magFilter = LinearFilter
    this.stateTexture.needsUpdate = true

    this.overlayMaterial = new ShaderMaterial({
      vertexShader: groundVertex,
      fragmentShader: groundFragment,
      uniforms: {
        uTerrain: { value: this.terrainTexture },
        uState: { value: this.stateTexture },
        uTime: { value: 0 },
        uLift: { value: 0.6 },
        uCharColor: { value: new Color('#161210') },
        uEmberColor: { value: new Color('#ff5a10') },
        uFlameColor: { value: new Color('#ffc94a') },
      },
      transparent: true,
      depthWrite: false,
      side: DoubleSide,
      polygonOffset: true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -2,
    })
    this.overlay = new Mesh(buildGridGeometry(size, resolution), this.overlayMaterial)
    this.overlay.frustumCulled = false
    this.overlay.renderOrder = 5

    this.flames = new ParticleSystem(
      flameCount,
      new ShaderMaterial({
        vertexShader: particleVertex,
        fragmentShader: flameFragment,
        uniforms: {
          uTime: { value: 0 },
          uWind: { value: new Vector3() },
          uRise: { value: 7 },
          uSizeStart: { value: 6 },
          uSizeEnd: { value: 14 },
          uViewportHeight: { value: 1080 },
          uColorHot: { value: new Color('#fff3c4') },
          uColorMid: { value: new Color('#ff7a1a') },
          uColorCool: { value: new Color('#7a1400') },
        },
        transparent: true,
        depthWrite: false,
        blending: AdditiveBlending,
      }),
    )
    this.flames.points.renderOrder = 20

    this.smoke = new ParticleSystem(
      smokeCount,
      new ShaderMaterial({
        vertexShader: particleVertex,
        fragmentShader: smokeFragment,
        uniforms: {
          uTime: { value: 0 },
          uWind: { value: new Vector3() },
          uRise: { value: 4.5 },
          uSizeStart: { value: 10 },
          uSizeEnd: { value: 90 },
          uViewportHeight: { value: 1080 },
          uColorYoung: { value: new Color('#8a5a3a') },
          uColorOld: { value: new Color('#3a3a40') },
          uOpacity: { value: 0.42 },
        },
        transparent: true,
        depthWrite: false,
        blending: NormalBlending,
      }),
    )
    this.smoke.points.renderOrder = 21

    this.light = this.options.light ? new PointLight('#ff7a2a', 0, 0, 2) : null
    if (this.light) this.light.visible = false

    this.group = new Group()
    this.group.name = 'fire'
    this.group.matrixAutoUpdate = false
    this.group.add(this.overlay, this.flames.points, this.smoke.points)
    if (this.light) this.group.add(this.light)

    this.setWind(this.params.windFrom, this.params.windSpeed)
    this.setTerrain(flatGround(size, resolution))
  }

  /** Place the simulation: `frame` maps local x-east / y-up / z-south metres to world. */
  setFrame(frame: Matrix4) {
    this.group.matrix.copy(frame)
    this.group.updateMatrixWorld(true)
  }

  /** Sample terrain from any object in the scene using the group's frame. */
  sampleTerrain(target: Object3D, overrides: Partial<HeightFieldOptions> = {}) {
    this.group.updateMatrixWorld(true)
    const wasVisible = this.group.visible
    this.group.visible = false
    const field = sampleHeightField(this.renderer, target, this.group.matrixWorld, {
      size: this.options.size,
      resolution: this.options.resolution,
      // no sea handling: cells without geometry sit at height 0 and carry no fuel
      seaLevel: 0,
      seaDepth: 0,
      seaFloor: 'keep',
      maxHeight: 1500,
      minHeight: -300,
      ...overrides,
    })
    this.group.visible = wasVisible
    this.setTerrain(field)
    return field
  }

  setTerrain(field: HeightField) {
    if (field.resolution !== this.options.resolution) {
      throw new Error(`Height field resolution ${field.resolution} does not match simulation ${this.options.resolution}`)
    }
    this.terrain = field
    this.heights.set(field.heights)
    const data = this.terrainTexture.image.data as Float32Array
    for (let i = 0; i < field.heights.length; i++) data[i * 4] = field.heights[i]
    this.terrainTexture.needsUpdate = true
    this.computeSlope()
    this.deriveFuel()
    this.reset()
  }

  /** Override the default fuel rule (height and slope based). Pass null to restore it. */
  setFuel(fn: FuelFunction | null) {
    this.fuelFn = fn
    this.deriveFuel()
    this.reset()
  }

  /** Put the fire out and clear all scorch. Keeps the terrain and fuel. */
  reset() {
    this.state.fill(UNBURNT)
    this.heat.fill(0)
    this.ignitedAt.fill(-1)
    this.fuel.set(this.fuel0)
    this.burning = []
    this.time = -1
    this.running = false
    this.accumulator = 0
    this.flameCarry = 0
    this.smokeCarry = 0
    this.flames.clear()
    this.smoke.clear()
    if (this.light) this.light.visible = false
    this.uploadState()
  }

  /** Change the wind at any time. Direction is where the wind blows from, degrees clockwise from north. */
  setWind(windFrom: number, windSpeed: number) {
    this.params.windFrom = windFrom
    this.params.windSpeed = windSpeed
    const toward = ((windFrom + 180) * Math.PI) / 180
    this.windDi = Math.sin(toward)
    this.windDj = Math.cos(toward)
    this.windLocal.set(Math.sin(toward), 0, -Math.cos(toward)).multiplyScalar(windSpeed)
    ;(this.flames.material.uniforms.uWind.value as Vector3).copy(this.windLocal).multiplyScalar(0.35)
    ;(this.smoke.material.uniforms.uWind.value as Vector3).copy(this.windLocal).multiplyScalar(0.9)
  }

  /**
   * Light a fire. Parameters are typically chosen by the model from the hazard data.
   * Can be called again while burning to add a second ignition or change the wind.
   */
  ignite(params: Partial<FireParams> = {}) {
    this.params = { ...this.params, ...params }
    this.setWind(this.params.windFrom, this.params.windSpeed)
    if (this.time < 0) this.time = 0
    this.running = true

    const { size, resolution } = this.options
    const dx = size / resolution
    const { x, z, radius } = this.params
    const ci = Math.floor((x / size + 0.5) * resolution)
    const cj = Math.floor((0.5 - z / size) * resolution)
    if (ci < 0 || cj < 0 || ci >= resolution || cj >= resolution) return
    const r = Math.max(0, Math.ceil(radius / dx))
    for (let dj = -r; dj <= r; dj++) {
      for (let di = -r; di <= r; di++) {
        if (Math.hypot(di * dx, dj * dx) > Math.max(radius, dx * 0.5)) continue
        const i = ci + di
        const j = cj + dj
        if (i < 0 || j < 0 || i >= resolution || j >= resolution) continue
        const n = j * resolution + i
        if (this.state[n] !== UNBURNT) continue
        // make sure an ignition on thin fuel still takes
        this.fuel0[n] = Math.max(this.fuel0[n], 0.6)
        this.fuel[n] = this.fuel0[n]
        this.igniteCell(n)
      }
    }
    this.uploadState()
  }

  /** Advance the simulation by `dt` real seconds. Cheap when idle. */
  update(dt: number) {
    dt = Math.min(dt, 0.1)
    this.clock += dt
    this.overlayMaterial.uniforms.uTime.value = this.clock
    this.renderer.getDrawingBufferSize(this.viewport)
    for (const sys of [this.flames, this.smoke]) {
      sys.material.uniforms.uTime.value = this.clock
      sys.material.uniforms.uViewportHeight.value = this.viewport.y
    }
    if (!this.running) return

    this.accumulator += dt * this.options.timeScale
    let steps = 0
    while (this.accumulator >= this.stepDt && steps < 200) {
      this.step()
      this.accumulator -= this.stepDt
      steps++
    }
    if (steps === 200) this.accumulator = 0
    if (steps > 0) this.uploadState()

    this.emit(dt)
    this.updateLight()
    this.flames.commit()
    this.smoke.commit()
    if (this.burning.length === 0) this.running = false // burnt out; scorch stays until reset()
  }

  /** Number of cells currently alight. */
  get burningCells() {
    return this.burning.length
  }

  /** Area burnt or burning, in hectares. */
  get burntAreaHa() {
    const dx = this.options.size / this.options.resolution
    let count = 0
    for (let i = 0; i < this.state.length; i++) if (this.state[i] !== UNBURNT) count++
    return (count * dx * dx) / 10_000
  }

  /** Real seconds since construction; drives shader animation in the layers. */
  get elapsed() {
    return this.clock
  }

  /** Bilinear terrain height at a local point (metres). Returns 0 outside the area. */
  heightAt(x: number, z: number) {
    const { size, resolution: R } = this.options
    const fx = (x / size + 0.5) * R - 0.5
    const fz = (0.5 - z / size) * R - 0.5
    const i0 = Math.max(0, Math.min(R - 1, Math.floor(fx)))
    const j0 = Math.max(0, Math.min(R - 1, Math.floor(fz)))
    const i1 = Math.min(R - 1, i0 + 1)
    const j1 = Math.min(R - 1, j0 + 1)
    const tx = Math.max(0, Math.min(1, fx - i0))
    const tz = Math.max(0, Math.min(1, fz - j0))
    const h = this.heights
    const top = h[j0 * R + i0] * (1 - tx) + h[j0 * R + i1] * tx
    const bottom = h[j1 * R + i0] * (1 - tx) + h[j1 * R + i1] * tx
    return top * (1 - tz) + bottom * tz
  }

  /**
   * Random points on fuel-bearing cells, weighted by fuel, for scattering vegetation.
   * Returns [x, y, z, fuel] per point in the local frame. Deterministic for a given seed.
   */
  scatter(count: number, seed = this.options.seed + 1) {
    const { size, resolution: R } = this.options
    const dx = size / R
    const rnd = seeded(seed)
    const cells: number[] = []
    for (let i = 0; i < this.fuel0.length; i++) if (this.fuel0[i] > 0.15) cells.push(i)
    const out = new Float32Array(count * 4)
    if (cells.length === 0) return out.subarray(0, 0)
    let n = 0
    let guard = count * 20
    while (n < count && guard-- > 0) {
      const c = cells[(rnd() * cells.length) | 0]
      if (rnd() > this.fuel0[c]) continue
      const i = c % R
      const j = (c - i) / R
      const x = ((i + 0.5) / R - 0.5) * size + (rnd() - 0.5) * dx
      const z = (0.5 - (j + 0.5) / R) * size + (rnd() - 0.5) * dx
      out[n * 4] = x
      out[n * 4 + 1] = this.heightAt(x, z)
      out[n * 4 + 2] = z
      out[n * 4 + 3] = this.fuel0[c]
      n++
    }
    return out.subarray(0, n * 4)
  }

  /** Simulated seconds after the first ignition at which the front reached a local point, or null. */
  arrivalTime(x: number, z: number): number | null {
    const n = this.cellAt(x, z)
    if (n < 0) return null
    const t = this.ignitedAt[n]
    return t >= 0 ? t : null
  }

  /** Terrain height and fuel at a local point; useful for placing pins and debugging fuel rules. */
  probe(x: number, z: number) {
    const n = this.cellAt(x, z)
    if (n < 0) return null
    return { height: this.heights[n], slope: this.slope[n], fuel: this.fuel0[n], state: this.state[n] }
  }

  dispose() {
    this.terrainTexture.dispose()
    this.stateTexture.dispose()
    this.overlayMaterial.dispose()
    this.overlay.geometry.dispose()
    this.flames.dispose()
    this.smoke.dispose()
    if (this.light) this.light.dispose()
  }

  // --- simulation -----------------------------------------------------------------------------

  private step() {
    const { resolution: R, size, burnTime, spreadRate, windGain, slopeGain, spotting } = this.options
    const dx = size / R
    const { windSpeed, humidity } = this.params
    const dry = 1 - 0.85 * humidity
    const heights = this.heights
    const next: number[] = []
    const ignitions: number[] = []

    for (const c of this.burning) {
      const age = this.time - this.ignitedAt[c]
      this.fuel[c] = Math.max(0, this.fuel0[c] * (1 - age / burnTime))
      if (age >= burnTime) {
        this.state[c] = BURNT
        this.fuel[c] = 0
        continue
      }
      next.push(c)
      const intensity = this.intensity(c)
      if (intensity < 0.05) continue

      const ci = c % R
      const cj = (c - ci) / R
      const Tc = heights[c]
      for (const [di, dj, len] of NEIGHBOURS) {
        const ni = ci + di
        const nj = cj + dj
        if (ni < 0 || nj < 0 || ni >= R || nj >= R) continue
        const n = nj * R + ni
        if (this.state[n] !== UNBURNT || this.fuel0[n] <= 0) continue
        const dist = dx * len
        const along = (di * this.windDi + dj * this.windDj) / len
        const windFactor = Math.exp(windGain * windSpeed * along)
        const rise = Math.max(-1.2, Math.min(1.2, (heights[n] - Tc) / dist))
        const slopeFactor = Math.exp(slopeGain * rise)
        const rate = spreadRate * dry * this.fuel0[n] * windFactor * slopeFactor * intensity // m/s
        this.heat[n] += (rate * this.stepDt) / dist
        if (this.heat[n] >= this.threshold[n]) ignitions.push(n)
      }

      // embers carried downwind start spot fires ahead of the front
      if (spotting > 0 && windSpeed > 5 && intensity > 0.5) {
        const p = (spotting * this.stepDt * (windSpeed - 5)) / 10
        if (this.rnd() < p) {
          const d = 3 + this.rnd() * 8
          const ti = Math.round(ci + this.windDi * d + (this.rnd() - 0.5) * 3)
          const tj = Math.round(cj + this.windDj * d + (this.rnd() - 0.5) * 3)
          if (ti >= 0 && tj >= 0 && ti < R && tj < R) {
            const n = tj * R + ti
            if (this.state[n] === UNBURNT && this.fuel0[n] > 0.2) ignitions.push(n)
          }
        }
      }
    }

    this.burning = next
    for (const n of ignitions) if (this.state[n] === UNBURNT) this.igniteCell(n)
    this.time += this.stepDt
  }

  private igniteCell(n: number) {
    this.state[n] = BURNING
    this.ignitedAt[n] = this.time
    this.heat[n] = this.threshold[n]
    this.burning.push(n)
  }

  /** 0..1 burn intensity of a burning cell: quick flare, then a long decay. */
  private intensity(c: number) {
    const f = (this.time - this.ignitedAt[c]) / this.options.burnTime
    const shape = f < 0.12 ? f / 0.12 : Math.max(0, 1 - (f - 0.12) / 0.88)
    return shape * Math.sqrt(this.fuel0[c])
  }

  private cellAt(x: number, z: number) {
    const { size, resolution } = this.options
    const i = Math.floor((x / size + 0.5) * resolution)
    const j = Math.floor((0.5 - z / size) * resolution)
    if (i < 0 || j < 0 || i >= resolution || j >= resolution) return -1
    return j * resolution + i
  }

  private computeSlope() {
    const { resolution: R, size } = this.options
    const dx = size / R
    const h = this.heights
    for (let j = 0; j < R; j++) {
      for (let i = 0; i < R; i++) {
        const i0 = Math.max(0, i - 1)
        const i1 = Math.min(R - 1, i + 1)
        const j0 = Math.max(0, j - 1)
        const j1 = Math.min(R - 1, j + 1)
        const gx = (h[j * R + i1] - h[j * R + i0]) / ((i1 - i0) * dx)
        const gz = (h[j1 * R + i] - h[j0 * R + i]) / ((j1 - j0) * dx)
        this.slope[j * R + i] = (Math.atan(Math.hypot(gx, gz)) * 180) / Math.PI
      }
    }
  }

  private deriveFuel() {
    const { resolution: R, size, fuelMinHeight, fuelMaxSlope } = this.options
    const hits = this.terrain?.hits
    const patches = valueNoise(R, 10, this.rnd)
    for (let j = 0; j < R; j++) {
      for (let i = 0; i < R; i++) {
        const n = j * R + i
        const h = this.heights[n]
        const s = this.slope[n]
        let f: number
        if (this.fuelFn) {
          const x = ((i + 0.5) / R - 0.5) * size
          const z = (0.5 - (j + 0.5) / R) * size
          f = this.fuelFn(x, z, h, s)
        } else if (hits && !hits[n]) f = 0
        else if (h < fuelMinHeight) f = 0
        else if (s > fuelMaxSlope) f = 0.08
        else f = 0.5 + 0.5 * patches[n]
        this.fuel0[n] = Math.max(0, Math.min(1, f))
        this.threshold[n] = 0.75 + 0.5 * this.rnd()
      }
    }
    this.fuel.set(this.fuel0)
  }

  private uploadState() {
    const d = this.stateTexture.image.data as Uint8Array
    for (let i = 0; i < this.state.length; i++) {
      const s = this.state[i]
      const f0 = this.fuel0[i]
      const intensity = s === BURNING ? this.intensity(i) : 0
      const char = f0 > 0 && s !== UNBURNT ? 1 - this.fuel[i] / f0 : 0
      const preheat = s === UNBURNT && f0 > 0 ? Math.min(1, this.heat[i] / this.threshold[i]) : 0
      d[i * 4] = intensity * 255
      d[i * 4 + 1] = char * 255
      d[i * 4 + 2] = this.fuel[i] * 255
      d[i * 4 + 3] = preheat * 255
    }
    this.stateTexture.needsUpdate = true
  }

  // --- visuals --------------------------------------------------------------------------------

  private emit(dt: number) {
    const count = this.burning.length
    if (count === 0) return
    const { flameCount, smokeCount } = this.options
    this.flameCarry += Math.min((flameCount * dt) / 0.9, count * 2.5 + 1)
    this.smokeCarry += Math.min((smokeCount * dt) / 12, count * 0.5 + 0.5)
    this.flameCarry = this.emitInto(this.flames, this.flameCarry, 0.6, 0.6)
    this.smokeCarry = this.emitInto(this.smoke, this.smokeCarry, 8, 8)
  }

  private emitInto(sys: ParticleSystem, budget: number, lifeMin: number, lifeRange: number) {
    const { size, resolution: R } = this.options
    const dx = size / R
    const B = this.burning
    let n = Math.floor(budget)
    while (n-- > 0) {
      const c = B[(this.rnd() * B.length) | 0]
      const intensity = this.intensity(c)
      if (this.rnd() > intensity) continue
      const i = c % R
      const j = (c - i) / R
      const x = ((i + 0.5) / R - 0.5) * size + (this.rnd() - 0.5) * dx
      const z = (0.5 - (j + 0.5) / R) * size + (this.rnd() - 0.5) * dx
      const ok = sys.spawn(
        this.clock,
        x,
        this.heights[c] + 1,
        z,
        lifeMin + this.rnd() * lifeRange,
        (0.7 + 0.6 * this.rnd()) * (0.5 + 0.5 * intensity),
        this.rnd(),
      )
      if (!ok) break
    }
    return budget - Math.floor(budget)
  }

  private updateLight() {
    if (!this.light) return
    const B = this.burning
    if (B.length === 0) {
      this.light.visible = false
      return
    }
    const { size, resolution: R } = this.options
    const stride = Math.max(1, Math.floor(B.length / 200))
    let sx = 0, sy = 0, sz = 0, sw = 0
    for (let k = 0; k < B.length; k += stride) {
      const c = B[k]
      const w = this.intensity(c) + 0.01
      const i = c % R
      const j = (c - i) / R
      sx += w * ((i + 0.5) / R - 0.5) * size
      sz += w * (0.5 - (j + 0.5) / R) * size
      sy += w * this.heights[c]
      sw += w
    }
    const flicker = 0.85 + 0.15 * Math.sin(this.clock * 21) * Math.sin(this.clock * 7.3)
    const strength = Math.min(1, B.length / 120)
    this.light.position.set(sx / sw, sy / sw + 30, sz / sw)
    this.light.intensity = 150_000 * strength * flicker
    this.light.visible = true
  }
}

/** Pool of GPU-animated point sprites. Oldest particles are overwritten first. */
class ParticleSystem {
  readonly points: Points
  readonly material: ShaderMaterial
  private geometry = new BufferGeometry()
  private start: Float32Array
  private birth: Float32Array
  private life: Float32Array
  private seed: Float32Array
  private scale: Float32Array
  private expires: Float32Array
  private cursor = 0
  private dirty = false

  constructor(readonly count: number, material: ShaderMaterial) {
    this.material = material
    this.start = new Float32Array(count * 3)
    this.birth = new Float32Array(count).fill(-1e9)
    this.life = new Float32Array(count).fill(1)
    this.seed = new Float32Array(count)
    this.scale = new Float32Array(count).fill(1)
    this.expires = new Float32Array(count)
    const attr = (array: Float32Array, size: number) => new BufferAttribute(array, size).setUsage(DynamicDrawUsage)
    this.geometry.setAttribute('position', attr(this.start, 3))
    this.geometry.setAttribute('aBirth', attr(this.birth, 1))
    this.geometry.setAttribute('aLife', attr(this.life, 1))
    this.geometry.setAttribute('aSeed', attr(this.seed, 1))
    this.geometry.setAttribute('aScale', attr(this.scale, 1))
    this.points = new Points(this.geometry, material)
    this.points.frustumCulled = false
  }

  /** Returns false when every slot is still alive. */
  spawn(now: number, x: number, y: number, z: number, life: number, scale: number, seed: number) {
    const i = this.cursor
    if (this.expires[i] > now) return false
    this.cursor = (i + 1) % this.count
    this.start[i * 3] = x
    this.start[i * 3 + 1] = y
    this.start[i * 3 + 2] = z
    this.birth[i] = now
    this.life[i] = life
    this.seed[i] = seed
    this.scale[i] = scale
    this.expires[i] = now + life
    this.dirty = true
    return true
  }

  clear() {
    this.birth.fill(-1e9)
    this.expires.fill(0)
    this.dirty = true
  }

  commit() {
    if (!this.dirty) return
    for (const name of ['position', 'aBirth', 'aLife', 'aSeed', 'aScale']) {
      ;(this.geometry.getAttribute(name) as BufferAttribute).needsUpdate = true
    }
    this.dirty = false
  }

  dispose() {
    this.geometry.dispose()
    this.material.dispose()
  }
}

/** One vertex per cell centre, indexed grid, uv (i+0.5)/res, x east, z south. Matches the height field. */
function buildGridGeometry(size: number, res: number) {
  const positions = new Float32Array(res * res * 3)
  const uvs = new Float32Array(res * res * 2)
  for (let j = 0; j < res; j++) {
    for (let i = 0; i < res; i++) {
      const k = j * res + i
      positions[k * 3] = ((i + 0.5) / res - 0.5) * size
      positions[k * 3 + 1] = 0
      positions[k * 3 + 2] = (0.5 - (j + 0.5) / res) * size
      uvs[k * 2] = (i + 0.5) / res
      uvs[k * 2 + 1] = (j + 0.5) / res
    }
  }
  const index = new Uint32Array((res - 1) * (res - 1) * 6)
  let n = 0
  for (let j = 0; j < res - 1; j++) {
    for (let i = 0; i < res - 1; i++) {
      const a = j * res + i
      const b = a + 1
      const c = a + res
      const d = c + 1
      index[n++] = a; index[n++] = c; index[n++] = b
      index[n++] = b; index[n++] = c; index[n++] = d
    }
  }
  const geometry = new BufferGeometry()
  geometry.setAttribute('position', new BufferAttribute(positions, 3))
  geometry.setAttribute('uv', new BufferAttribute(uvs, 2))
  geometry.setIndex(new BufferAttribute(index, 1))
  return geometry
}

function flatGround(size: number, resolution: number): HeightField {
  return {
    size,
    resolution,
    heights: new Float32Array(resolution * resolution),
    hits: new Uint8Array(resolution * resolution).fill(1),
    min: 0,
    max: 0,
  }
}

function seeded(seed: number) {
  let s = seed >>> 0
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0
    return s / 0xffffffff
  }
}

/** Smooth 0..1 value noise over a res x res grid with the given period in cells. */
function valueNoise(res: number, period: number, rnd: () => number) {
  const lattice = Math.ceil(res / period) + 2
  const grid = new Float32Array(lattice * lattice)
  for (let i = 0; i < grid.length; i++) grid[i] = rnd()
  const out = new Float32Array(res * res)
  const smooth = (t: number) => t * t * (3 - 2 * t)
  for (let j = 0; j < res; j++) {
    const fy = j / period
    const y0 = Math.floor(fy)
    const ty = smooth(fy - y0)
    for (let i = 0; i < res; i++) {
      const fx = i / period
      const x0 = Math.floor(fx)
      const tx = smooth(fx - x0)
      const a = grid[y0 * lattice + x0]
      const b = grid[y0 * lattice + x0 + 1]
      const c = grid[(y0 + 1) * lattice + x0]
      const d = grid[(y0 + 1) * lattice + x0 + 1]
      out[j * res + i] = (a * (1 - tx) + b * tx) * (1 - ty) + (c * (1 - tx) + d * tx) * ty
    }
  }
  return out
}

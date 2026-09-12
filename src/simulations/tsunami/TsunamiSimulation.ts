import {
  BufferAttribute,
  BufferGeometry,
  Color,
  DataTexture,
  DoubleSide,
  FloatType,
  Group,
  Matrix4,
  Mesh,
  NearestFilter,
  Object3D,
  OrthographicCamera,
  PlaneGeometry,
  RGBAFormat,
  Scene,
  ShaderMaterial,
  Vector2,
  Vector3,
  WebGLRenderer,
  WebGLRenderTarget,
} from 'three'
import {
  copyFragment,
  fullscreenVertex,
  heightFragment,
  surfaceFragment,
  surfaceVertex,
  velocityFragment,
} from './shaders'
import { sampleHeightField, type HeightField, type HeightFieldOptions } from './HeightField'

export type SourceEdge = 'west' | 'east' | 'south' | 'north'

export interface TsunamiOptions {
  /** Side length of the square simulation area in metres. */
  size?: number
  /** Cells per side. 256 is smooth on a laptop; 400 over 2 km gives 5 m cells. */
  resolution?: number
  /** Calm sea surface height in the local frame (metres). */
  seaLevel?: number
  /** Depth given to sea cells (metres). */
  seaDepth?: number
  /** Which edge of the area the wave enters from. */
  sourceEdge?: SourceEdge
  /** Simulated seconds per real second. */
  timeScale?: number
  gravity?: number
  drag?: number
  friction?: number
  /** Cap on flow speed (m/s). Real inland tsunami flow is 5-12 m/s; higher values overtop buildings. */
  maxSpeed?: number
  /** Rate (m/s) at which thin water above sea level drains away after the wave passes. */
  drainRate?: number
  /** Visual exaggeration of water above sea level (1 = physical, 1.3 is already a lot). Rendering only. */
  heightScale?: number
  /** 1 hides undisturbed water over the sea floor so a scene's own ocean shows through; 0 draws the whole patch. */
  calmFade?: number
}

export interface WaveParams {
  /** Peak wave height above sea level at the source edge (metres). */
  amplitude: number
  /** Seconds of sea drawing back before the wave arrives. 0 disables. */
  drawbackTime: number
  /** Seconds for the wave to rise to full height. */
  riseTime: number
  /** Seconds the wave holds at full height. */
  holdTime: number
  /** Decay time constant after the hold (seconds). */
  fallTime: number
}

export const defaultWave: WaveParams = {
  amplitude: 12,
  drawbackTime: 12,
  riseTime: 4,
  holdTime: 45,
  fallTime: 60,
}

const SOURCE_EDGE_CODE: Record<SourceEdge, number> = { west: 1, east: 2, south: 3, north: 4 }

/**
 * GPU shallow-water tsunami that flows around whatever is in the terrain height field.
 *
 * Usage:
 *   const sim = new TsunamiSimulation(renderer, { size: 2000, resolution: 400, seaLevel: 30 })
 *   sim.group.matrix.copy(localFrame)           // ENU frame at the demo pin (identity in the sandbox)
 *   scene.add(sim.group)
 *   sim.sampleTerrain(tilesGroup)                // once the tiles have loaded
 *   sim.trigger({ amplitude: 8, ... })
 *   sim.update(deltaSeconds)                     // every frame
 */
export class TsunamiSimulation {
  readonly group: Group
  readonly mesh: Mesh
  readonly options: Required<TsunamiOptions>
  readonly surfaceMaterial: ShaderMaterial

  terrain: HeightField | null = null
  wave: WaveParams = { ...defaultWave }
  /** Simulated seconds since trigger(); negative when idle. */
  time = -1
  running = false

  private renderer: WebGLRenderer
  private stateA: WebGLRenderTarget
  private stateB: WebGLRenderTarget
  private terrainTexture: DataTexture
  private quadScene = new Scene()
  private quadCamera = new OrthographicCamera(-1, 1, 1, -1, 0, 1)
  private quad: Mesh
  private velocityMaterial: ShaderMaterial
  private heightMaterial: ShaderMaterial
  private copyMaterial: ShaderMaterial
  private stepDt = 0.1
  private accumulator = 0

  constructor(renderer: WebGLRenderer, options: TsunamiOptions = {}) {
    this.renderer = renderer
    this.options = {
      size: 1200,
      resolution: 256,
      seaLevel: 0,
      seaDepth: 10,
      sourceEdge: 'west',
      timeScale: 4,
      gravity: 9.81,
      drag: 0.005,
      friction: 0.004,
      maxSpeed: 14,
      drainRate: 0.01,
      heightScale: 1.0,
      calmFade: 0,
      ...options,
    }
    const { resolution, size } = this.options
    const texel = new Vector2(1 / resolution, 1 / resolution)
    const dx = size / resolution

    const rtOptions = {
      type: FloatType,
      format: RGBAFormat,
      minFilter: NearestFilter,
      magFilter: NearestFilter,
      depthBuffer: false,
      stencilBuffer: false,
    }
    this.stateA = new WebGLRenderTarget(resolution, resolution, rtOptions)
    this.stateB = new WebGLRenderTarget(resolution, resolution, rtOptions)

    this.terrainTexture = new DataTexture(
      new Float32Array(resolution * resolution * 4),
      resolution,
      resolution,
      RGBAFormat,
      FloatType,
    )
    this.terrainTexture.minFilter = NearestFilter
    this.terrainTexture.magFilter = NearestFilter
    this.terrainTexture.needsUpdate = true

    this.velocityMaterial = new ShaderMaterial({
      vertexShader: fullscreenVertex,
      fragmentShader: velocityFragment,
      uniforms: {
        uState: { value: null },
        uTerrain: { value: this.terrainTexture },
        uTexel: { value: texel },
        uDt: { value: this.stepDt },
        uDx: { value: dx },
        uGravity: { value: this.options.gravity },
        uDrag: { value: this.options.drag },
        uFriction: { value: this.options.friction },
        uMaxSpeed: { value: 20 },
      },
      depthTest: false,
      depthWrite: false,
    })
    this.heightMaterial = new ShaderMaterial({
      vertexShader: fullscreenVertex,
      fragmentShader: heightFragment,
      uniforms: {
        uState: { value: null },
        uTerrain: { value: this.terrainTexture },
        uTexel: { value: texel },
        uDt: { value: this.stepDt },
        uDx: { value: dx },
        uWaveLevel: { value: this.options.seaLevel },
        uSourceEdge: { value: SOURCE_EDGE_CODE[this.options.sourceEdge] },
        uSourceWidth: { value: 3 / resolution },
        uSourceSpeed: { value: 0 },
        uSeaLevel: { value: this.options.seaLevel },
        uSpongeWidth: { value: 8 / resolution },
        uDrain: { value: this.options.drainRate },
      },
      depthTest: false,
      depthWrite: false,
    })
    this.copyMaterial = new ShaderMaterial({
      vertexShader: fullscreenVertex,
      fragmentShader: copyFragment,
      uniforms: { uSource: { value: null } },
      depthTest: false,
      depthWrite: false,
    })
    this.quad = new Mesh(new PlaneGeometry(2, 2), this.copyMaterial)
    this.quad.frustumCulled = false
    this.quadScene.add(this.quad)

    this.surfaceMaterial = new ShaderMaterial({
      vertexShader: surfaceVertex,
      fragmentShader: surfaceFragment,
      uniforms: {
        uState: { value: this.stateA.texture },
        uTerrain: { value: this.terrainTexture },
        uTexel: { value: texel },
        uDx: { value: dx },
        uSeaLevel: { value: this.options.seaLevel },
        uHeightScale: { value: this.options.heightScale },
        uSunDir: { value: new Vector3(0.4, 1, 0.3).normalize() },
        uShallowColor: { value: new Color('#3aa7c4') },
        uDeepColor: { value: new Color('#0b3556') },
        uMudColor: { value: new Color('#8d8360') },
        uFoamColor: { value: new Color('#eef6f8') },
        uTime: { value: 0 },
        uCalmFade: { value: this.options.calmFade },
      },
      transparent: true,
      depthWrite: true,
      side: DoubleSide,
    })
    this.mesh = new Mesh(buildSurfaceGeometry(size, resolution), this.surfaceMaterial)
    this.mesh.frustumCulled = false
    this.mesh.renderOrder = 10

    this.group = new Group()
    this.group.name = 'tsunami'
    this.group.matrixAutoUpdate = false
    this.group.add(this.mesh)

    this.setTerrain(flatSea(size, resolution, this.options.seaLevel - this.options.seaDepth))
  }

  /** Place the simulation: `frame` maps local x-east / y-up / z-south metres to world. */
  setFrame(frame: Matrix4) {
    this.group.matrix.copy(frame)
    this.group.updateMatrixWorld(true)
  }

  /** Sample terrain (ground plus roofs) from any object in the scene using the group's frame. */
  sampleTerrain(target: Object3D, overrides: Partial<HeightFieldOptions> = {}) {
    this.group.updateMatrixWorld(true)
    const wasVisible = this.group.visible
    this.group.visible = false
    const field = sampleHeightField(this.renderer, target, this.group.matrixWorld, {
      size: this.options.size,
      resolution: this.options.resolution,
      seaLevel: this.options.seaLevel,
      seaDepth: this.options.seaDepth,
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
    const data = this.terrainTexture.image.data as Float32Array
    for (let i = 0; i < field.heights.length; i++) data[i * 4] = field.heights[i]
    this.terrainTexture.needsUpdate = true
    this.reset()
  }

  /** Fill the sea to sea level and clear all motion. Keeps the terrain. */
  reset() {
    const { resolution, seaLevel } = this.options
    const heights = this.terrain?.heights
    const init = new Float32Array(resolution * resolution * 4)
    for (let i = 0; i < resolution * resolution; i++) {
      const T = heights ? heights[i] : seaLevel - this.options.seaDepth
      init[i * 4] = Math.max(0, seaLevel - T)
    }
    const tex = new DataTexture(init, resolution, resolution, RGBAFormat, FloatType)
    tex.minFilter = NearestFilter
    tex.magFilter = NearestFilter
    tex.needsUpdate = true
    this.copyMaterial.uniforms.uSource.value = tex
    this.renderPass(this.copyMaterial, this.stateA)
    this.renderPass(this.copyMaterial, this.stateB)
    tex.dispose()
    this.surfaceMaterial.uniforms.uState.value = this.stateA.texture
    this.time = -1
    this.running = false
    this.accumulator = 0
    this.heightMaterial.uniforms.uWaveLevel.value = seaLevel
    this.heightMaterial.uniforms.uSourceSpeed.value = 0
    this.updateStepSize()
  }

  /** Start a wave. Parameters are typically chosen by the model from the hazard data. */
  trigger(params: Partial<WaveParams> = {}) {
    this.wave = { ...defaultWave, ...params }
    this.time = 0
    this.running = true
    this.updateStepSize()
  }

  /** Wave height above sea level at the source edge for a simulated time. */
  waveLevel(t: number) {
    const { amplitude, drawbackTime, riseTime, holdTime, fallTime } = this.wave
    if (t < 0) return 0
    if (t < drawbackTime) return -0.35 * amplitude * Math.sin((Math.PI * t) / drawbackTime)
    t -= drawbackTime
    if (t < riseTime) {
      const s = t / riseTime
      return amplitude * s * s * (3 - 2 * s)
    }
    t -= riseTime
    if (t < holdTime) return amplitude
    t -= holdTime
    return amplitude * Math.exp(-t / Math.max(fallTime, 0.01))
  }

  /** Advance the simulation by `dt` real seconds. Cheap when idle. */
  update(dt: number) {
    this.surfaceMaterial.uniforms.uTime.value += dt
    if (!this.running) return
    this.accumulator += Math.min(dt, 0.1) * this.options.timeScale
    let steps = 0
    while (this.accumulator >= this.stepDt && steps < 12) {
      this.step()
      this.accumulator -= this.stepDt
      steps++
    }
    if (steps === 12) this.accumulator = 0
  }

  /** Read the current state texture back to the CPU (slow; debugging and tests only). */
  readState(): Float32Array {
    const { resolution } = this.options
    const out = new Float32Array(resolution * resolution * 4)
    this.renderer.readRenderTargetPixels(this.stateA, 0, 0, resolution, resolution, out)
    return out
  }

  dispose() {
    this.stateA.dispose()
    this.stateB.dispose()
    this.terrainTexture.dispose()
    this.velocityMaterial.dispose()
    this.heightMaterial.dispose()
    this.copyMaterial.dispose()
    this.surfaceMaterial.dispose()
    this.mesh.geometry.dispose()
    this.quad.geometry.dispose()
  }

  private step() {
    const { seaLevel, seaDepth, gravity } = this.options
    const level = this.waveLevel(this.time)
    const depth = Math.max(0.5, seaDepth + level)
    // linear long-wave theory: particle speed = wave height * sqrt(g / depth)
    const speed = Math.max(0, level) * Math.sqrt(gravity / depth)
    this.heightMaterial.uniforms.uWaveLevel.value = seaLevel + level
    this.heightMaterial.uniforms.uSourceSpeed.value = speed

    this.velocityMaterial.uniforms.uState.value = this.stateA.texture
    this.renderPass(this.velocityMaterial, this.stateB)
    this.heightMaterial.uniforms.uState.value = this.stateB.texture
    this.renderPass(this.heightMaterial, this.stateA)
    this.surfaceMaterial.uniforms.uState.value = this.stateA.texture
    this.time += this.stepDt
  }

  private renderPass(material: ShaderMaterial, target: WebGLRenderTarget) {
    const prev = this.renderer.getRenderTarget()
    const prevAutoClear = this.renderer.autoClear
    this.quad.material = material
    this.renderer.autoClear = false
    this.renderer.setRenderTarget(target)
    this.renderer.render(this.quadScene, this.quadCamera)
    this.renderer.setRenderTarget(prev)
    this.renderer.autoClear = prevAutoClear
  }

  private updateStepSize() {
    const { size, resolution, gravity, seaDepth } = this.options
    const dx = size / resolution
    const maxDepth = seaDepth + Math.max(this.wave.amplitude, 1) + 5
    this.stepDt = (0.35 * dx) / Math.sqrt(gravity * maxDepth)
    this.velocityMaterial.uniforms.uDt.value = this.stepDt
    this.heightMaterial.uniforms.uDt.value = this.stepDt
    this.velocityMaterial.uniforms.uMaxSpeed.value = Math.min(this.options.maxSpeed, (0.5 * dx) / this.stepDt)
  }
}

/** One vertex per cell centre, indexed grid, uv (i+0.5)/res, x east, z south. */
function buildSurfaceGeometry(size: number, res: number) {
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

function flatSea(size: number, resolution: number, floor: number): HeightField {
  return {
    size,
    resolution,
    heights: new Float32Array(resolution * resolution).fill(floor),
    hits: new Uint8Array(resolution * resolution),
    min: floor,
    max: floor,
  }
}

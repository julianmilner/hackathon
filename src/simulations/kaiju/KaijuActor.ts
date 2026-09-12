import {
  AnimationAction,
  AnimationMixer,
  Box3,
  DoubleSide,
  Group,
  LoopOnce,
  LoopRepeat,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  Object3D,
  RingGeometry,
  WebGLRenderer,
} from 'three'
import { GLTFLoader, type GLTF } from 'three/addons/loaders/GLTFLoader.js'
import { sampleHeightField, type HeightField, type HeightFieldOptions } from '../tsunami/HeightField'
import {
  KAIJU_CLIPS,
  KaijuBehaviour,
  type GroundSampler,
  type KaijuBehaviourOptions,
  type KaijuClipName,
  type KaijuEvent,
  type KaijuPoint,
} from './KaijuBehaviour'
import { sampleHeight } from './terrain'

export interface KaijuActorOptions extends Partial<Omit<KaijuBehaviourOptions, 'spawn' | 'target' | 'height'>> {
  /** URL of the glTF produced by tools/blender/kaiju.py. */
  url?: string
  /** Height-field settings for sampleTerrain(); defaults match the tsunami. */
  terrain?: Partial<Omit<HeightFieldOptions, 'seaLevel'>>
  spawn?: KaijuPoint
  target?: KaijuPoint
  /** Standing height in metres. Default 300: comically large, taller than Muizenberg Peak's lower slopes. */
  height?: number
  /** Draw expanding splash / dust rings on footsteps and hits. */
  rings?: boolean
}

interface Ring {
  mesh: Mesh<RingGeometry, MeshBasicMaterial>
  age: number
  life: number
  from: number
  to: number
}

const FADE = 0.3

/**
 * three.js side of the kaiju: loads the model, mirrors the behaviour's clip choice on an
 * AnimationMixer, places the rig in the local frame and adds the cheap flourishes (splash
 * rings, glow pulse on roar). Follows the module contract in src/simulations/README.md:
 *
 *   const kaiju = new KaijuActor({ spawn: { x: -500, z: 0 }, target: { x: 120, z: -40 }, height: 60 }, renderer)
 *   kaiju.setFrame(localFrame)          // ENU frame at the demo pin (identity in the sandbox)
 *   scene.add(kaiju.group)
 *   kaiju.setTerrain(tsunami.terrain!)  // share the tsunami's height field, or sampleTerrain(tilesGroup)
 *   kaiju.rise()                        // the trigger: when the tsunami has peaked
 *   kaiju.update(deltaSeconds)          // every frame
 */
export class KaijuActor {
  /** Local-frame root. Set its matrix with setFrame(); identity means local == world. */
  readonly group = new Group()
  /** Moved and turned by the behaviour; holds the scaled model. */
  readonly rig = new Group()
  readonly behaviour: KaijuBehaviour
  /** Resolves once the model is loaded and animations are ready. */
  readonly ready: Promise<void>
  model: Group | null = null
  mixer: AnimationMixer | null = null
  terrain: HeightField | null = null

  private readonly renderer: WebGLRenderer | null
  private readonly terrainOptions: Partial<Omit<HeightFieldOptions, 'seaLevel'>>
  private readonly actions = new Map<KaijuClipName, AnimationAction>()
  private current: AnimationAction | null = null
  private clipSerial = -1
  private glow: MeshStandardMaterial[] = []
  private glowBase: number[] = []
  private pulse = 0
  private rings: Ring[] = []
  private readonly ringGeometry = new RingGeometry(0.72, 1, 48)
  private readonly drawRings: boolean
  private readonly unsubscribe: () => void
  private disposed = false

  constructor(options: KaijuActorOptions = {}, renderer?: WebGLRenderer) {
    const {
      url = `${import.meta.env.BASE_URL}models/kaiju.glb`,
      spawn = { x: -500, z: 0 },
      target = { x: 0, z: 0 },
      height = 300,
      rings = true,
      terrain = {},
      ...behaviour
    } = options
    this.behaviour = new KaijuBehaviour({ spawn, target, height, ...behaviour })
    this.drawRings = rings
    this.renderer = renderer ?? null
    this.terrainOptions = terrain
    this.group.name = 'kaiju'
    this.group.matrixAutoUpdate = false
    this.rig.visible = false
    this.group.add(this.rig)
    this.unsubscribe = this.behaviour.on((e) => this.handleEvent(e))
    this.ready = new GLTFLoader().loadAsync(url).then((gltf) => {
      if (!this.disposed) this.install(gltf)
    })
  }

  /** Local frame (x east, y up, z south, metres) to world, as for the tsunami. */
  setFrame(frame: Matrix4) {
    this.group.matrix.copy(frame)
    this.group.updateMatrixWorld(true)
  }

  /** Walk on the same height field the tsunami sampled from the city. */
  setTerrain(field: HeightField) {
    this.terrain = field
    this.behaviour.ground = (x, z) => sampleHeight(field, x, z)
  }

  /**
   * Sample a top-down height field of `target` (the tiles group or a stand-in) in the local
   * frame, exactly as the tsunami does. Needs the renderer passed to the constructor. When the
   * tsunami runs in the same scene, prefer setTerrain(tsunami.terrain) and skip the second pass.
   */
  sampleTerrain(target: Object3D, overrides: Partial<HeightFieldOptions> = {}) {
    if (!this.renderer) throw new Error('KaijuActor.sampleTerrain needs the renderer passed to the constructor')
    const field = sampleHeightField(this.renderer, target, this.group.matrix, {
      size: 1200,
      resolution: 256,
      seaDepth: 10,
      ...this.terrainOptions,
      seaLevel: this.behaviour.options.seaLevel,
      ...overrides,
    })
    this.setTerrain(field)
    return field
  }

  setGround(sampler: GroundSampler) {
    this.behaviour.ground = sampler
  }

  on(listener: (event: KaijuEvent) => void) {
    return this.behaviour.on(listener)
  }

  rise(target?: KaijuPoint) {
    this.behaviour.rise(target)
  }

  attack() {
    this.behaviour.attack()
  }

  roar() {
    this.behaviour.roar()
  }

  stomp() {
    this.behaviour.stomp()
  }

  retreat() {
    this.behaviour.retreat()
  }

  reset() {
    this.behaviour.reset()
    this.current?.stop()
    this.current = null
    this.clipSerial = -1
    this.rig.visible = false
  }

  update(dt: number) {
    const b = this.behaviour
    b.update(dt)

    this.rig.visible = b.active && this.model !== null
    if (b.active) {
      this.rig.position.set(b.pose.x, b.pose.y, b.pose.z)
      this.rig.rotation.y = b.pose.heading
    }

    this.syncClip()
    this.mixer?.update(dt)

    this.pulse = Math.max(0, this.pulse - dt / 1.6)
    for (let i = 0; i < this.glow.length; i++) {
      this.glow[i].emissiveIntensity = this.glowBase[i] * (1 + 3 * this.pulse)
    }
    this.updateRings(dt)
  }

  dispose() {
    this.disposed = true
    this.unsubscribe()
    this.mixer?.stopAllAction()
    for (const r of this.rings) {
      r.mesh.removeFromParent()
      r.mesh.material.dispose()
    }
    this.rings = []
    this.ringGeometry.dispose()
    this.model?.traverse((o) => {
      const m = o as Mesh
      if (m.isMesh) {
        m.geometry.dispose()
        const mats = Array.isArray(m.material) ? m.material : [m.material]
        mats.forEach((mat) => mat.dispose())
      }
    })
    this.group.removeFromParent()
  }

  // ---- internals ------------------------------------------------------------------------

  private install(gltf: GLTF) {
    const model = gltf.scene
    const box = new Box3().setFromObject(model)
    const modelHeight = Math.max(1e-3, box.max.y - box.min.y)
    const s = this.behaviour.options.height / modelHeight
    model.scale.setScalar(s)
    model.position.y = -box.min.y * s // feet on the rig origin

    model.traverse((o) => {
      const m = o as Mesh
      if (!m.isMesh) return
      m.castShadow = true
      m.frustumCulled = false // skinned bounds are computed in rest pose
      const mats = Array.isArray(m.material) ? m.material : [m.material]
      for (const mat of mats) {
        const std = mat as MeshStandardMaterial
        if (std.isMeshStandardMaterial && (std.name === 'KaijuGlow' || std.name === 'KaijuEye')) {
          if (!this.glow.includes(std)) {
            this.glow.push(std)
            this.glowBase.push(std.emissiveIntensity)
          }
        }
      }
    })

    this.mixer = new AnimationMixer(model)
    for (const clip of gltf.animations) {
      const name = clip.name as KaijuClipName
      const spec = KAIJU_CLIPS[name]
      if (!spec) continue
      const action = this.mixer.clipAction(clip)
      action.clampWhenFinished = true
      action.setLoop(spec.loop ? LoopRepeat : LoopOnce, Infinity)
      this.actions.set(name, action)
    }

    this.rig.add(model)
    this.model = model
    this.clipSerial = -1
  }

  private syncClip() {
    if (!this.mixer) return
    const c = this.behaviour.clip
    if (c.serial === this.clipSerial) {
      if (this.current) this.current.timeScale = c.timeScale
      return
    }
    this.clipSerial = c.serial
    const next = this.actions.get(c.name)
    if (!next) return
    next.reset()
    next.timeScale = c.timeScale
    if (c.timeScale < 0) next.time = next.getClip().duration
    next.fadeIn(FADE).play()
    if (this.current && this.current !== next) this.current.fadeOut(FADE)
    this.current = next
  }

  private handleEvent(e: KaijuEvent) {
    const h = this.behaviour.options.height
    switch (e.type) {
      case 'footstep':
        this.spawnRing(e.x, e.z, e.inWater, 0.06 * h, 0.45 * h, 1.1)
        break
      case 'hit':
        this.spawnRing(e.x, e.z, e.inWater, 0.1 * h, e.kind === 'stomp' ? 1.0 * h : 0.8 * h, 1.4)
        this.pulse = Math.max(this.pulse, 0.5)
        break
      case 'roar':
        this.pulse = 1
        break
      case 'state':
        if (e.state === 'hidden') this.rig.visible = false
        break
    }
  }

  private spawnRing(x: number, z: number, inWater: boolean, from: number, to: number, life: number) {
    if (!this.drawRings) return
    const material = new MeshBasicMaterial({
      color: inWater ? 0xeaf6ff : 0xd9c9a3,
      transparent: true,
      opacity: 0.85,
      depthWrite: false,
      side: DoubleSide,
    })
    const mesh = new Mesh(this.ringGeometry, material)
    mesh.rotation.x = -Math.PI / 2
    const y = inWater ? this.behaviour.options.seaLevel + 0.4 : this.behaviour.ground(x, z) + 0.6
    mesh.position.set(x, y, z)
    mesh.scale.set(from, from, 1)
    mesh.renderOrder = 10
    this.group.add(mesh)
    this.rings.push({ mesh, age: 0, life, from, to })
  }

  private updateRings(dt: number) {
    for (let i = this.rings.length - 1; i >= 0; i--) {
      const r = this.rings[i]
      r.age += dt
      const k = Math.min(1, r.age / r.life)
      const e = 1 - (1 - k) * (1 - k)
      const radius = r.from + (r.to - r.from) * e
      r.mesh.scale.set(radius, radius, 1)
      r.mesh.material.opacity = 0.85 * (1 - k)
      if (k >= 1) {
        r.mesh.removeFromParent()
        r.mesh.material.dispose()
        this.rings.splice(i, 1)
      }
    }
  }
}

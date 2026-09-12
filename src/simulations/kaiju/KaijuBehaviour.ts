/**
 * Behaviour script for the kaiju: a small state machine with no three.js dependency, so it
 * can be reasoned about, tested and reused by any renderer.
 *
 * Coordinates are the local demo frame in metres (x east, y up, z south), the same frame the
 * tsunami uses. Time is in seconds. The behaviour owns clip timing so that gameplay events
 * (footsteps, hits, roars) fire deterministically; the renderer only mirrors `clip`.
 *
 * Lifecycle:
 *   hidden -> rise() -> rising -> walking -> (arrives) -> attacking / roaring / stomping ... -> idle
 *   any active state -> retreat() -> retreating -> submerging -> hidden
 */

export type KaijuState =
  | 'hidden'
  | 'rising'
  | 'walking'
  | 'attacking'
  | 'roaring'
  | 'stomping'
  | 'idle'
  | 'retreating'
  | 'submerging'

export type KaijuClipName = 'Idle' | 'Walk' | 'Rise' | 'Attack' | 'Roar' | 'Stomp'

export interface KaijuClipEvent {
  /** Normalised time 0..1 within the clip. */
  at: number
  type: 'footstep' | 'hit' | 'roar'
  side?: 'left' | 'right'
}

/** Clip lengths and event times as authored by tools/blender/kaiju.py (CLIPS, CLIP_EVENTS). */
export const KAIJU_CLIPS: Record<KaijuClipName, { duration: number; loop: boolean; events: KaijuClipEvent[] }> = {
  Idle: { duration: 3, loop: true, events: [] },
  Walk: {
    duration: 1.5,
    loop: true,
    events: [
      { at: 0.3, type: 'footstep', side: 'left' },
      { at: 0.8, type: 'footstep', side: 'right' },
    ],
  },
  Rise: { duration: 3, loop: false, events: [] },
  Attack: { duration: 2, loop: false, events: [{ at: 0.45, type: 'hit' }] },
  Roar: { duration: 2.5, loop: false, events: [{ at: 0.3, type: 'roar' }] },
  Stomp: { duration: 1.5, loop: false, events: [{ at: 0.58, type: 'hit' }] },
}

export interface KaijuPoint {
  x: number
  z: number
}

export type GroundSampler = (x: number, z: number) => number

export interface KaijuBehaviourOptions {
  /** Where the kaiju surfaces, normally out at sea. */
  spawn: KaijuPoint
  /** What it walks to and attacks, normally the clicked house. */
  target: KaijuPoint
  /** Standing height in metres. Drives the stride, speed and attack-range defaults. */
  height: number
  /** Walking speed in metres per second. Default 0.22 * height. */
  speed?: number
  /** Maximum turn rate in radians per second. */
  turnRate?: number
  /** Distance from the target at which it stops and attacks. Default 0.6 * height, so the swipe lands on it. */
  attackRange?: number
  /** Calm sea level in the local frame; footsteps below it are splashes, above it dust. */
  seaLevel?: number
  /** What it performs on arrival, in order, before idling. */
  arrivalSequence?: Exclude<KaijuClipName, 'Idle' | 'Walk' | 'Rise'>[]
  /** Seconds between spontaneous roars and stomps while idling at the target. 0 disables. */
  idleTauntInterval?: number
}

export interface KaijuPose {
  x: number
  z: number
  /** Height of the feet in the local frame, including any submersion. */
  y: number
  /** Smoothed ground height under the feet. */
  ground: number
  /** Yaw in radians. 0 faces +z (south), pi/2 faces +x (east). Equals rotation.y for a +Z-facing model. */
  heading: number
  /** How far the feet are below the ground while rising or submerging (metres). */
  sink: number
}

export interface KaijuClipStatus {
  name: KaijuClipName
  /** Playback rate relative to the authored clip. Negative plays backwards. */
  timeScale: number
  /** Normalised progress 0..1 through the clip; wraps for loops. */
  progress: number
  /** Increments each time a new clip starts, so a renderer knows when to crossfade. */
  serial: number
}

export type KaijuEvent =
  | { type: 'state'; state: KaijuState; previous: KaijuState }
  | { type: 'footstep'; x: number; z: number; side: 'left' | 'right'; inWater: boolean; strength: number }
  | { type: 'hit'; x: number; z: number; kind: 'attack' | 'stomp'; inWater: boolean }
  | { type: 'roar'; x: number; z: number }
  | { type: 'arrived'; x: number; z: number }
  | { type: 'gone' }

const ONE_SHOT_STATES: Record<'Attack' | 'Roar' | 'Stomp', KaijuState> = {
  Attack: 'attacking',
  Roar: 'roaring',
  Stomp: 'stomping',
}

function easeOutCubic(t: number) {
  const u = 1 - Math.min(1, Math.max(0, t))
  return 1 - u * u * u
}

function easeInCubic(t: number) {
  const u = Math.min(1, Math.max(0, t))
  return u * u * u
}

function wrapAngle(a: number) {
  while (a > Math.PI) a -= 2 * Math.PI
  while (a < -Math.PI) a += 2 * Math.PI
  return a
}

export class KaijuBehaviour {
  readonly options: Required<KaijuBehaviourOptions>
  state: KaijuState = 'hidden'
  readonly pose: KaijuPose
  readonly clip: KaijuClipStatus = { name: 'Idle', timeScale: 1, progress: 0, serial: 0 }
  /** Height of the terrain under a point. Set this once the height field is sampled. */
  ground: GroundSampler = () => 0

  private listeners = new Set<(event: KaijuEvent) => void>()
  private clipTime = 0
  private queue: Exclude<KaijuClipName, 'Idle' | 'Walk' | 'Rise'>[] = []
  private destination: KaijuPoint
  private idleTimer = 0
  private tauntIndex = 0
  private groundInitialised = false

  constructor(options: KaijuBehaviourOptions) {
    const height = options.height
    this.options = {
      speed: 0.22 * height,
      turnRate: 0.6,
      attackRange: 0.6 * height,
      seaLevel: 0,
      arrivalSequence: ['Attack', 'Roar', 'Attack', 'Stomp', 'Roar'],
      idleTauntInterval: 6,
      ...options,
    }
    this.destination = { ...this.options.target }
    this.pose = { x: options.spawn.x, z: options.spawn.z, y: 0, ground: 0, heading: 0, sink: height }
  }

  on(listener: (event: KaijuEvent) => void) {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  /** Distance from the feet to the current destination, in metres. */
  get distanceToDestination() {
    return Math.hypot(this.destination.x - this.pose.x, this.destination.z - this.pose.z)
  }

  get active() {
    return this.state !== 'hidden'
  }

  // ---- commands -------------------------------------------------------------------------

  /** Surface at the spawn point and walk to the target. */
  rise(target?: KaijuPoint) {
    if (target) this.options.target = { ...target }
    this.destination = { ...this.options.target }
    this.pose.x = this.options.spawn.x
    this.pose.z = this.options.spawn.z
    this.pose.sink = this.options.height
    this.pose.heading = this.headingTo(this.destination)
    this.groundInitialised = false
    this.queue = []
    this.setState('rising')
    this.play('Rise')
  }

  /** Change where it is walking to. */
  setTarget(target: KaijuPoint) {
    this.options.target = { ...target }
    if (this.state !== 'retreating' && this.state !== 'submerging') this.destination = { ...target }
  }

  attack() {
    this.perform('Attack')
  }

  roar() {
    this.perform('Roar')
  }

  stomp() {
    this.perform('Stomp')
  }

  /** Play a one-shot now if it is standing, or queue it if one is already playing. */
  perform(name: 'Attack' | 'Roar' | 'Stomp') {
    switch (this.state) {
      case 'hidden':
      case 'rising':
      case 'retreating':
      case 'submerging':
        return
      case 'attacking':
      case 'roaring':
      case 'stomping':
        this.queue.push(name)
        return
      default:
        this.setState(ONE_SHOT_STATES[name])
        this.play(name)
    }
  }

  /** Walk back to the spawn point and sink out of sight. */
  retreat() {
    if (!this.active || this.state === 'submerging') return
    this.queue = []
    this.destination = { ...this.options.spawn }
    if (this.state === 'rising') this.pose.sink = 0
    this.setState('retreating')
    this.play('Walk')
  }

  /** Vanish immediately and go back to the spawn point. */
  reset() {
    this.queue = []
    this.pose.x = this.options.spawn.x
    this.pose.z = this.options.spawn.z
    this.pose.sink = this.options.height
    this.idleTimer = 0
    this.setState('hidden')
  }

  // ---- simulation -----------------------------------------------------------------------

  update(dt: number) {
    if (!this.active || dt <= 0) return
    const { height, speed, attackRange } = this.options
    const spec = KAIJU_CLIPS[this.clip.name]

    // Walk cadence follows speed so the feet do not slide: two steps per cycle.
    if (this.clip.name === 'Walk') {
      const step = 0.2 * height // stubby mascot legs take short steps
      this.clip.timeScale = spec.duration / ((2 * step) / Math.max(speed, 0.01))
    }

    const previousProgress = this.clip.progress
    this.clipTime += dt * this.clip.timeScale
    if (spec.loop) {
      this.clipTime = ((this.clipTime % spec.duration) + spec.duration) % spec.duration
    } else {
      this.clipTime = Math.min(spec.duration, Math.max(0, this.clipTime))
    }
    this.clip.progress = this.clipTime / spec.duration
    if (this.clip.timeScale > 0) this.fireClipEvents(spec, previousProgress, this.clip.progress)

    const finished = !spec.loop && (this.clip.timeScale > 0 ? this.clipTime >= spec.duration : this.clipTime <= 0)

    switch (this.state) {
      case 'rising':
        this.pose.sink = height * (1 - easeOutCubic(this.clip.progress))
        if (finished) {
          this.pose.sink = 0
          this.setState('walking')
          this.play('Walk')
        }
        break
      case 'walking':
      case 'retreating': {
        this.move(dt)
        const arriveAt = this.state === 'walking' ? attackRange : 0.5 * height
        if (this.distanceToDestination <= arriveAt) {
          if (this.state === 'walking') {
            this.emit({ type: 'arrived', x: this.pose.x, z: this.pose.z })
            this.queue = [...this.options.arrivalSequence]
            this.nextFromQueue()
          } else {
            this.setState('submerging')
            this.play('Rise', -1)
          }
        }
        break
      }
      case 'submerging':
        this.pose.sink = height * easeInCubic(1 - this.clip.progress)
        if (finished) {
          this.setState('hidden')
          this.emit({ type: 'gone' })
        }
        break
      case 'attacking':
      case 'roaring':
      case 'stomping':
        // keep facing the target while performing
        this.turnTowards(this.options.target, dt)
        if (finished) this.nextFromQueue()
        break
      case 'idle':
        this.turnTowards(this.options.target, dt)
        this.idleTimer += dt
        if (this.options.idleTauntInterval > 0 && this.idleTimer >= this.options.idleTauntInterval) {
          this.idleTimer = 0
          this.perform(this.tauntIndex++ % 2 === 0 ? 'Roar' : 'Stomp')
        }
        break
    }

    // Follow the terrain with a little smoothing so height-field steps do not jolt the body.
    const g = this.ground(this.pose.x, this.pose.z)
    if (!this.groundInitialised) {
      this.pose.ground = g
      this.groundInitialised = true
    } else {
      this.pose.ground += (g - this.pose.ground) * Math.min(1, dt * 4)
    }
    this.pose.y = this.pose.ground - this.pose.sink
  }

  // ---- internals ------------------------------------------------------------------------

  private play(name: KaijuClipName, timeScale = 1) {
    const spec = KAIJU_CLIPS[name]
    this.clip.name = name
    this.clip.timeScale = timeScale
    this.clip.serial += 1
    this.clipTime = timeScale < 0 ? spec.duration : 0
    this.clip.progress = this.clipTime / spec.duration
  }

  private nextFromQueue() {
    const next = this.queue.shift()
    if (next) {
      this.setState(ONE_SHOT_STATES[next])
      this.play(next)
      return
    }
    const dist = Math.hypot(this.options.target.x - this.pose.x, this.options.target.z - this.pose.z)
    if (dist > this.options.attackRange * 1.05) {
      this.destination = { ...this.options.target }
      this.setState('walking')
      this.play('Walk')
    } else {
      this.idleTimer = 0
      this.setState('idle')
      this.play('Idle')
    }
  }

  private headingTo(p: KaijuPoint) {
    return Math.atan2(p.x - this.pose.x, p.z - this.pose.z)
  }

  private turnTowards(p: KaijuPoint, dt: number) {
    const desired = this.headingTo(p)
    const diff = wrapAngle(desired - this.pose.heading)
    const maxTurn = this.options.turnRate * dt
    this.pose.heading = wrapAngle(this.pose.heading + Math.max(-maxTurn, Math.min(maxTurn, diff)))
  }

  private move(dt: number) {
    this.turnTowards(this.destination, dt)
    const step = Math.min(this.options.speed * dt, this.distanceToDestination)
    this.pose.x += Math.sin(this.pose.heading) * step
    this.pose.z += Math.cos(this.pose.heading) * step
  }

  private fireClipEvents(spec: (typeof KAIJU_CLIPS)[KaijuClipName], from: number, to: number) {
    for (const ev of spec.events) {
      const crossed = spec.loop && to < from ? ev.at > from || ev.at <= to : ev.at > from && ev.at <= to
      if (crossed) this.fireClipEvent(ev)
    }
  }

  private fireClipEvent(ev: KaijuClipEvent) {
    const { height, seaLevel } = this.options
    const h = this.pose.heading
    const forward = { x: Math.sin(h), z: Math.cos(h) }
    const left = { x: Math.cos(h), z: -Math.sin(h) }
    switch (ev.type) {
      case 'footstep': {
        const s = ev.side === 'left' ? 1 : -1
        const x = this.pose.x + left.x * s * 0.22 * height + forward.x * 0.05 * height
        const z = this.pose.z + left.z * s * 0.22 * height + forward.z * 0.05 * height
        this.emit({ type: 'footstep', x, z, side: ev.side ?? 'left', inWater: this.ground(x, z) < seaLevel, strength: 1 })
        break
      }
      case 'hit': {
        const kind = this.clip.name === 'Stomp' ? 'stomp' : 'attack'
        const reach = kind === 'stomp' ? 0.25 * height : 0.4 * height // body slam lands just past the face
        const x = this.pose.x + forward.x * reach
        const z = this.pose.z + forward.z * reach
        this.emit({ type: 'hit', x, z, kind, inWater: this.ground(x, z) < seaLevel })
        break
      }
      case 'roar':
        this.emit({ type: 'roar', x: this.pose.x, z: this.pose.z })
        break
    }
  }

  private setState(next: KaijuState) {
    if (next === this.state) return
    const previous = this.state
    this.state = next
    this.emit({ type: 'state', state: next, previous })
  }

  private emit(event: KaijuEvent) {
    this.listeners.forEach((l) => l(event))
  }
}

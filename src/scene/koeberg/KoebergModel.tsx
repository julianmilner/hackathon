import { useEffect, useMemo } from 'react'
import { useLoader } from '@react-three/fiber'
import { FileLoader, Group, Mesh, MeshStandardMaterial, Object3D, Quaternion, Vector3 } from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'

export const MODEL_URL = `${import.meta.env.BASE_URL}models/koeberg.glb`
export const ANCHORS_URL = `${import.meta.env.BASE_URL}models/koeberg.anchors.json`

export interface Anchors {
  points: Record<string, [number, number, number]>
  paths: Record<string, [number, number, number][]>
  meta: {
    lat: number
    lon: number
    units: { u1: [number, number, number]; u2: [number, number, number] }
    containment: { outer_radius_m: number; cylinder_top_m: number; apex_m: number; wall_m: number }
  }
}

export interface Shard {
  mesh: Mesh
  restPosition: Vector3
  restQuaternion: Quaternion
}

// A mesh with its solid material and a ghosted copy for the cutaway view.
export interface Part {
  mesh: Mesh
  solid: MeshStandardMaterial
  xray: MeshStandardMaterial
}

export interface ModelParts {
  scene: Group
  anchors: Anchors
  exterior: Part[]
  interior: Part[]
  site: Mesh[]
  shards: Shard[]
  cores: Part[]
  rotors: Mesh[]
  culverts: Part[]
  byName: Map<string, Object3D>
}

const xrayCache = new WeakMap<MeshStandardMaterial, MeshStandardMaterial>()
function xrayOf(m: MeshStandardMaterial) {
  let x = xrayCache.get(m)
  if (!x) {
    x = m.clone()
    x.transparent = true
    x.opacity = 0.14
    x.depthWrite = false
    x.roughness = 0.35
    x.name = m.name + '_xray'
    xrayCache.set(m, x)
  }
  return x
}

// Loads the GLB built by blender/koeberg.py and sorts its nodes by role.
export function useKoebergModel(): ModelParts {
  const gltf = useLoader(GLTFLoader, MODEL_URL)
  const anchorsText = useLoader(FileLoader, ANCHORS_URL) as string
  const anchors = useMemo(() => JSON.parse(anchorsText) as Anchors, [anchorsText])

  const parts = useMemo<ModelParts>(() => {
    const scene = gltf.scene
    const exterior: Part[] = []
    const interior: Part[] = []
    const site: Mesh[] = []
    const shards: Shard[] = []
    const cores: Part[] = []
    const rotors: Mesh[] = []
    const culverts: Part[] = []
    const byName = new Map<string, Object3D>()
    scene.traverse((o) => {
      byName.set(o.name, o)
      if (!(o instanceof Mesh)) return
      const mat = o.material as MeshStandardMaterial
      const part: Part = { mesh: o, solid: mat, xray: xrayOf(mat) }
      const n = o.name
      if (n.startsWith('shard_')) {
        o.castShadow = true
        o.receiveShadow = true
        shards.push({ mesh: o, restPosition: o.position.clone(), restQuaternion: o.quaternion.clone() })
        exterior.push(part)
      } else if (n.startsWith('ext_')) {
        o.castShadow = true
        o.receiveShadow = true
        exterior.push(part)
      } else if (n.startsWith('int_')) {
        o.castShadow = false
        o.receiveShadow = false
        interior.push(part)
        if (o.userData.core) cores.push(part)
        if (o.userData.rotor) rotors.push(o)
        if (o.userData.culvert) culverts.push(part)
      } else if (n.startsWith('site_')) {
        o.receiveShadow = true
        o.castShadow = n.includes('breakwater') || n.includes('pylon') || n.includes('fence') || n.includes('lamp') || n.includes('carport')
        site.push(o)
      }
    })
    // The glowing core reads better with its own emissive material instance.
    for (const c of cores) {
      const m = c.solid.clone()
      m.emissiveIntensity = 2.5
      c.mesh.material = m
      c.solid = m
    }
    return { scene, anchors, exterior, interior, site, shards, cores, rotors, culverts, byName }
  }, [gltf, anchors])

  return parts
}

export type ViewMode = 'exterior' | 'inside' | 'accident'

// Applies a view mode: solid exterior, or ghosted exterior with the interior showing.
export function useModelMode(parts: ModelParts, mode: ViewMode, showSite: boolean, forceGhost = false) {
  useEffect(() => {
    const ghost = mode === 'inside' || forceGhost
    for (const p of parts.exterior) {
      p.mesh.material = ghost ? p.xray : p.solid
      p.mesh.castShadow = !ghost
      p.mesh.renderOrder = ghost ? 5 : 0
    }
    for (const p of parts.interior) {
      p.mesh.visible = mode !== 'exterior'
      const deck = Boolean(p.mesh.userData.deck)
      p.mesh.material = deck && ghost ? p.xray : p.solid
      if (deck && ghost) p.mesh.material.opacity = 0.3
    }
    for (const p of parts.culverts) {
      // Underground seawater tunnels: only meaningful when the shells are see-through.
      p.mesh.visible = ghost
    }
    for (const m of parts.site) m.visible = showSite
  }, [parts, mode, showSite, forceGhost])
}

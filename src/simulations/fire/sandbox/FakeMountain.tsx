import { forwardRef, useMemo } from 'react'
import {
  BoxGeometry,
  Color,
  DoubleSide,
  Float32BufferAttribute,
  Group,
  InstancedMesh,
  Matrix4,
  MeshStandardMaterial,
  PlaneGeometry,
  Quaternion,
  Vector3,
} from 'three'
import { FUEL_MIN_HEIGHT, ROCK_HEIGHT, SIZE, groundHeight, groundSlope } from './mountain'

function seeded(seed: number) {
  let s = seed >>> 0
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0
    return s / 0xffffffff
  }
}

interface FakeMountainProps {
  onGroundClick?: (x: number, z: number) => void
}

/** Procedural stand-in for the Google mesh: a fynbos-covered ridge with a suburb of boxes below it. */
export const FakeMountain = forwardRef<Group, FakeMountainProps>(function FakeMountain({ onGroundClick }, ref) {
  const ground = useMemo(() => {
    const seg = 220
    const geo = new PlaneGeometry(SIZE, SIZE, seg, seg)
    geo.rotateX(-Math.PI / 2)
    const pos = geo.attributes.position
    const colors = new Float32Array(pos.count * 3)
    const urban = new Color('#b5a999')
    const fynbosLight = new Color('#7a7a42')
    const fynbosDark = new Color('#4d5a2d')
    const rock = new Color('#7d766c')
    const c = new Color()
    const rnd = seeded(3)
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i)
      const z = pos.getZ(i)
      const h = groundHeight(x, z)
      pos.setY(i, h)
      const slope = groundSlope(x, z)
      const fynbos = fynbosLight.clone().lerp(fynbosDark, rnd())
      c.copy(urban).lerp(fynbos, Math.min(1, Math.max(0, (h - FUEL_MIN_HEIGHT + 10) / 40)))
      const rocky = Math.max(
        Math.min(1, Math.max(0, (slope - 38) / 10)),
        Math.min(1, Math.max(0, (h - ROCK_HEIGHT) / 60)),
      )
      c.lerp(rock, rocky)
      colors[i * 3] = c.r
      colors[i * 3 + 1] = c.g
      colors[i * 3 + 2] = c.b
    }
    geo.setAttribute('color', new Float32BufferAttribute(colors, 3))
    geo.computeVertexNormals()
    const mat = new MeshStandardMaterial({ vertexColors: true, roughness: 0.95, side: DoubleSide })
    return { geo, mat }
  }, [])

  const houses = useMemo(() => {
    const rnd = seeded(11)
    const pitch = 38
    const placements: { x: number; z: number; h: number; w: number; d: number; color: Color }[] = []
    const palette = ['#d9cfc1', '#c9bfb2', '#e3d8c8', '#b8ada0', '#a89d90']
    for (let x = -1150; x <= 1150; x += pitch) {
      for (let z = 120; z <= 1150; z += pitch) {
        const jx = x + (rnd() - 0.5) * 10
        const jz = z + (rnd() - 0.5) * 10
        if (groundHeight(jx, jz) > FUEL_MIN_HEIGHT - 8 || rnd() < 0.3) continue
        placements.push({
          x: jx,
          z: jz,
          h: 6 + rnd() * 5,
          w: 9 + rnd() * 5,
          d: 9 + rnd() * 5,
          color: new Color(palette[Math.floor(rnd() * palette.length)]),
        })
      }
    }
    const mesh = new InstancedMesh(
      new BoxGeometry(1, 1, 1),
      new MeshStandardMaterial({ roughness: 0.85, metalness: 0.02 }),
      placements.length,
    )
    const m = new Matrix4()
    const q = new Quaternion()
    const p = new Vector3()
    const s = new Vector3()
    placements.forEach((b, i) => {
      const base = groundHeight(b.x, b.z) - 1
      p.set(b.x, base + (b.h + 1) / 2, b.z)
      s.set(b.w, b.h + 1, b.d)
      m.compose(p, q, s)
      mesh.setMatrixAt(i, m)
      mesh.setColorAt(i, b.color)
    })
    mesh.instanceMatrix.needsUpdate = true
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true
    return mesh
  }, [])

  return (
    <group ref={ref} name="fake-mountain">
      <mesh
        geometry={ground.geo}
        material={ground.mat}
        onClick={(e) => {
          e.stopPropagation()
          onGroundClick?.(e.point.x, e.point.z)
        }}
      />
      <primitive object={houses} />
    </group>
  )
})

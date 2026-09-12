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
import { CITY_SIZE, SEA_LEVEL, groundHeight } from './city'

interface Block {
  x: number
  z: number
  w: number
  d: number
  h: number
  color: Color
}

function seeded(seed: number) {
  let s = seed >>> 0
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0
    return s / 0xffffffff
  }
}

function makeBlocks(): Block[] {
  const rnd = seeded(7)
  const blocks: Block[] = []
  const blockSize = 44
  const street = 14
  const pitch = blockSize + street
  const palette = ['#c9c1b5', '#b7aea3', '#d6cfc4', '#a89f95', '#e0d8cb', '#8f8a84']
  for (let x = -180; x < 540; x += pitch) {
    for (let z = -540; z < 540; z += pitch) {
      if (rnd() < 0.14) continue // parks and open lots
      // the row nearest the sea is a promenade of low pavilions
      const nearSea = x < -100
      const count = nearSea ? 1 : 1 + Math.floor(rnd() * 2)
      for (let k = 0; k < count; k++) {
        const w = count === 1 ? blockSize : blockSize * (k === 0 ? 0.55 : 0.4)
        const d = blockSize * (0.6 + rnd() * 0.4)
        const cx = x + (count === 1 ? blockSize / 2 : k === 0 ? w / 2 : blockSize - w / 2)
        const cz = z + blockSize / 2 + (rnd() - 0.5) * (blockSize - d)
        let h = nearSea ? 9 + rnd() * 6 : 10 + rnd() * 22
        if (!nearSea && rnd() < 0.08) h = 45 + rnd() * 30 // a few towers
        blocks.push({ x: cx, z: cz, w, d, h, color: new Color(palette[Math.floor(rnd() * palette.length)]) })
      }
    }
  }
  return blocks
}

/** Procedural stand-in for the Google mesh: displaced ground plus instanced building boxes. */
export const FakeCity = forwardRef<Group>(function FakeCity(_, ref) {
  const ground = useMemo(() => {
    const seg = 160
    const geo = new PlaneGeometry(CITY_SIZE, CITY_SIZE, seg, seg)
    geo.rotateX(-Math.PI / 2)
    const pos = geo.attributes.position
    const colors = new Float32Array(pos.count * 3)
    const sand = new Color('#c8b98a')
    const grass = new Color('#6f8a4f')
    const seabed = new Color('#3b5b6b')
    const c = new Color()
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i)
      const z = pos.getZ(i)
      const h = groundHeight(x, z)
      pos.setY(i, h)
      if (h < SEA_LEVEL) c.copy(seabed)
      else c.copy(sand).lerp(grass, Math.min(1, Math.max(0, (h - 1) / 6)))
      colors[i * 3] = c.r
      colors[i * 3 + 1] = c.g
      colors[i * 3 + 2] = c.b
    }
    geo.setAttribute('color', new Float32BufferAttribute(colors, 3))
    geo.computeVertexNormals()
    const mat = new MeshStandardMaterial({ vertexColors: true, roughness: 0.95, side: DoubleSide })
    return { geo, mat }
  }, [])

  const buildings = useMemo(() => {
    const blocks = makeBlocks()
    const mesh = new InstancedMesh(
      new BoxGeometry(1, 1, 1),
      new MeshStandardMaterial({ roughness: 0.8, metalness: 0.05 }),
      blocks.length,
    )
    const m = new Matrix4()
    const q = new Quaternion()
    const p = new Vector3()
    const s = new Vector3()
    blocks.forEach((b, i) => {
      const base = groundHeight(b.x, b.z) - 1 // sink slightly so no gap on slopes
      p.set(b.x, base + (b.h + 1) / 2, b.z)
      s.set(b.w, b.h + 1, b.d)
      m.compose(p, q, s)
      mesh.setMatrixAt(i, m)
      mesh.setColorAt(i, b.color)
    })
    mesh.instanceMatrix.needsUpdate = true
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true
    mesh.castShadow = false
    return mesh
  }, [])

  return (
    <group ref={ref} name="fake-city">
      <mesh geometry={ground.geo} material={ground.mat} />
      <primitive object={buildings} />
    </group>
  )
})

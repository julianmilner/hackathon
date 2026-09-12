import { BufferAttribute, BufferGeometry } from 'three'
import { mercXToLon, mercYToLat, metresPerMercatorUnit, toLocal, type TileId } from '../../geo'
import type { HeightField } from './heightfield'

// Open water is pushed below the water surface so the ocean shader has something to sit
// above and coastlines slope gently. Which pixels count as water comes from the cleaned
// land mask, not a raw height threshold (see heightfield.ts).
export const SEA_FLOOR = -6

export function groundHeight(hf: HeightField, mx: number, my: number) {
  return hf.isLand(mx, my) ? hf.sample(mx, my) : SEA_FLOOR
}

// Fraction of a tile's area that is land, from a coarse grid of samples.
export function landFraction(hf: HeightField, tile: TileId, samples = 8) {
  const scale = 2 ** tile.z
  let land = 0
  for (let j = 0; j < samples; j++) {
    const my = (tile.y + (j + 0.5) / samples) / scale
    for (let i = 0; i < samples; i++) {
      if (hf.isLand((tile.x + (i + 0.5) / samples) / scale, my)) land++
    }
  }
  return land / (samples * samples)
}

// Builds a `segments` x `segments` grid for one slippy-map imagery tile, draped over
// the height field, positioned in the local metre frame. UVs match the tile image.
export function buildTileGeometry(hf: HeightField, tile: TileId, segments: number): BufferGeometry {
  const n = segments + 1
  const count = n * n
  const positions = new Float32Array(count * 3)
  const normals = new Float32Array(count * 3)
  const uvs = new Float32Array(count * 2)
  const scale = 2 ** tile.z
  const step = hf.pixelStep

  let v = 0
  for (let j = 0; j < n; j++) {
    const my = (tile.y + j / segments) / scale
    const lat = mercYToLat(my)
    const metresPerUnit = metresPerMercatorUnit(lat)
    for (let i = 0; i < n; i++, v++) {
      const mx = (tile.x + i / segments) / scale
      const lon = mercXToLon(mx)
      const { x, z } = toLocal(lat, lon)
      const y = groundHeight(hf, mx, my)

      positions[v * 3] = x
      positions[v * 3 + 1] = y
      positions[v * 3 + 2] = z

      // Central differences on the height field. Mercator is conformal, so one
      // pixel step covers the same ground distance in both directions.
      const dx = (groundHeight(hf, mx + step, my) - groundHeight(hf, mx - step, my)) / (2 * step * metresPerUnit)
      const dz = (groundHeight(hf, mx, my + step) - groundHeight(hf, mx, my - step)) / (2 * step * metresPerUnit)
      const inv = 1 / Math.hypot(dx, 1, dz)
      normals[v * 3] = -dx * inv
      normals[v * 3 + 1] = inv
      normals[v * 3 + 2] = -dz * inv

      uvs[v * 2] = i / segments
      uvs[v * 2 + 1] = 1 - j / segments
    }
  }

  const indices = new Uint32Array(segments * segments * 6)
  let k = 0
  for (let j = 0; j < segments; j++) {
    for (let i = 0; i < segments; i++) {
      const a = j * n + i
      const b = (j + 1) * n + i
      const c = (j + 1) * n + i + 1
      const d = j * n + i + 1
      indices[k++] = a
      indices[k++] = b
      indices[k++] = d
      indices[k++] = b
      indices[k++] = c
      indices[k++] = d
    }
  }

  const geometry = new BufferGeometry()
  geometry.setAttribute('position', new BufferAttribute(positions, 3))
  geometry.setAttribute('normal', new BufferAttribute(normals, 3))
  geometry.setAttribute('uv', new BufferAttribute(uvs, 2))
  geometry.setIndex(new BufferAttribute(indices, 1))
  geometry.computeBoundingSphere()
  return geometry
}

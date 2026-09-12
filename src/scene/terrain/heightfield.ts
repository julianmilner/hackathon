import { terrainTileUrl } from '../../config'
import { latToMercY, lonToMercX } from '../../geo'
import { runPool } from './pool'

// A stitched Terrarium height field covering a rectangular block of tiles at one zoom.
// Sampling is by normalised Web Mercator coordinate so any imagery zoom can read it.
export interface HeightField {
  z: number
  x0: number
  y0: number
  width: number
  height: number
  data: Float32Array
  // 1 where the cleaned mask says land, 0 for open water. See buildLandMask.
  land: Uint8Array
  // Height in metres at a normalised mercator coordinate, bilinear, clamped to edges.
  sample(mx: number, my: number): number
  sampleLatLon(lat: number, lon: number): number
  // Nearest-pixel land lookup at a normalised mercator coordinate.
  isLand(mx: number, my: number): boolean
  // Size of one height pixel in mercator units.
  pixelStep: number
}

const TILE_PX = 256

// SRTM-derived data reads exactly 0 over open sea but carries patches of 1 to 5 m offshore
// up to a few hundred metres across, while real quays and promenades are only 1 to 3 m. A
// height threshold cannot tell them apart, so the land mask is cleaned in two steps:
// 1. a one-pixel morphological opening of the low ground (below STRONG_HEIGHT) breaks the
//    thin bridges that attach offshore patches to the coast; higher ground is never eroded;
// 2. connected components: any island that never rises above ISLET_MAX_HEIGHT, or is tiny,
//    becomes water. Everything attached to the mainland survives, as does Robben Island.
const LAND_THRESHOLD = 0.3
const STRONG_HEIGHT = 6
const OPENING_RADIUS = 1
const ISLET_MAX_HEIGHT = 8
const ISLET_MIN_PIXELS = 12

export async function loadHeightField(
  z: number,
  x0: number,
  x1: number,
  y0: number,
  y1: number,
  onTile?: () => void,
): Promise<HeightField> {
  const tilesX = x1 - x0 + 1
  const tilesY = y1 - y0 + 1
  const width = tilesX * TILE_PX
  const height = tilesY * TILE_PX
  const data = new Float32Array(width * height)

  const jobs: Array<() => Promise<void>> = []
  for (let ty = y0; ty <= y1; ty++) {
    for (let tx = x0; tx <= x1; tx++) {
      jobs.push(async () => {
        const pixels = await fetchTerrarium(z, tx, ty)
        const ox = (tx - x0) * TILE_PX
        const oy = (ty - y0) * TILE_PX
        for (let j = 0; j < TILE_PX; j++) {
          const row = (oy + j) * width + ox
          const src = j * TILE_PX * 4
          for (let i = 0; i < TILE_PX; i++) {
            const k = src + i * 4
            data[row + i] = pixels[k] * 256 + pixels[k + 1] + pixels[k + 2] / 256 - 32768
          }
        }
        onTile?.()
      })
    }
  }
  await runPool(jobs, 12)

  const land = buildLandMask(data, width, height)

  const scale = 2 ** z * TILE_PX
  const pixelStep = 1 / scale
  const maxX = width - 1
  const maxY = height - 1
  const offsetX = x0 * TILE_PX + 0.5
  const offsetY = y0 * TILE_PX + 0.5

  const sample = (mx: number, my: number) => {
    const px = Math.min(Math.max(mx * scale - offsetX, 0), maxX)
    const py = Math.min(Math.max(my * scale - offsetY, 0), maxY)
    const ix = Math.floor(px)
    const iy = Math.floor(py)
    const fx = px - ix
    const fy = py - iy
    const ix1 = Math.min(ix + 1, maxX)
    const iy1 = Math.min(iy + 1, maxY)
    const h00 = data[iy * width + ix]
    const h10 = data[iy * width + ix1]
    const h01 = data[iy1 * width + ix]
    const h11 = data[iy1 * width + ix1]
    return (h00 * (1 - fx) + h10 * fx) * (1 - fy) + (h01 * (1 - fx) + h11 * fx) * fy
  }

  const isLand = (mx: number, my: number) => {
    const px = Math.min(Math.max(Math.round(mx * scale - offsetX), 0), maxX)
    const py = Math.min(Math.max(Math.round(my * scale - offsetY), 0), maxY)
    return land[py * width + px] === 1
  }

  return {
    z,
    x0,
    y0,
    width,
    height,
    data,
    land,
    pixelStep,
    sample,
    sampleLatLon: (lat, lon) => sample(lonToMercX(lon), latToMercY(lat)),
    isLand,
  }
}

function buildLandMask(data: Float32Array, width: number, height: number): Uint8Array {
  const raw = new Uint8Array(width * height)
  for (let i = 0; i < raw.length; i++) raw[i] = data[i] > LAND_THRESHOLD ? 1 : 0

  // Opening of the raw mask, with strong (higher) ground added back untouched.
  const eroded = separableFilter(raw, width, height, OPENING_RADIUS, Math.min)
  const land = separableFilter(eroded, width, height, OPENING_RADIUS, Math.max)
  for (let i = 0; i < land.length; i++) if (data[i] >= STRONG_HEIGHT) land[i] = 1

  // Flood-fill each land component (4-connected), then demote low or tiny islets.
  const visited = new Uint8Array(land.length)
  const stack = new Int32Array(land.length)
  const members: number[] = []
  for (let start = 0; start < land.length; start++) {
    if (!land[start] || visited[start]) continue
    let top = 0
    stack[top++] = start
    visited[start] = 1
    members.length = 0
    let maxHeight = -Infinity
    while (top > 0) {
      const i = stack[--top]
      members.push(i)
      if (data[i] > maxHeight) maxHeight = data[i]
      const x = i % width
      if (x > 0 && land[i - 1] && !visited[i - 1]) { visited[i - 1] = 1; stack[top++] = i - 1 }
      if (x < width - 1 && land[i + 1] && !visited[i + 1]) { visited[i + 1] = 1; stack[top++] = i + 1 }
      if (i >= width && land[i - width] && !visited[i - width]) { visited[i - width] = 1; stack[top++] = i - width }
      if (i + width < land.length && land[i + width] && !visited[i + width]) { visited[i + width] = 1; stack[top++] = i + width }
    }
    if (maxHeight < ISLET_MAX_HEIGHT || members.length < ISLET_MIN_PIXELS) {
      for (const i of members) land[i] = 0
    }
  }
  return land
}

// Horizontal then vertical pass of a min or max window; edges clamp.
function separableFilter(src: Uint8Array, width: number, height: number, radius: number, op: (a: number, b: number) => number) {
  const tmp = new Uint8Array(src.length)
  const out = new Uint8Array(src.length)
  for (let y = 0; y < height; y++) {
    const row = y * width
    for (let x = 0; x < width; x++) {
      let v = src[row + x]
      for (let d = 1; d <= radius; d++) {
        v = op(v, src[row + Math.max(x - d, 0)])
        v = op(v, src[row + Math.min(x + d, width - 1)])
      }
      tmp[row + x] = v
    }
  }
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let v = tmp[y * width + x]
      for (let d = 1; d <= radius; d++) {
        v = op(v, tmp[Math.max(y - d, 0) * width + x])
        v = op(v, tmp[Math.min(y + d, height - 1) * width + x])
      }
      out[y * width + x] = v
    }
  }
  return out
}

async function fetchTerrarium(z: number, x: number, y: number): Promise<Uint8ClampedArray> {
  const res = await fetch(terrainTileUrl(z, x, y))
  if (!res.ok) throw new Error(`Terrain tile ${z}/${x}/${y} failed: ${res.status}`)
  const bitmap = await createImageBitmap(await res.blob())
  const canvas = new OffscreenCanvas(TILE_PX, TILE_PX)
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('2D canvas unavailable')
  ctx.drawImage(bitmap, 0, 0)
  bitmap.close()
  return ctx.getImageData(0, 0, TILE_PX, TILE_PX).data
}

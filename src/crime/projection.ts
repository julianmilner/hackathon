import type { Extent, Geometry, Position } from './types'

export interface Projection {
  width: number
  height: number
  project: (lonLat: Position) => Position
}

const M_PER_DEG_LAT = 110_574
const M_PER_DEG_LON = 111_320

/**
 * Equirectangular metre grid over an extent, identical to the grid used by
 * scripts/crime/build_crime_raster.py, so that one projected unit is one
 * raster cell and vector outlines line up with the heatmap pixels.
 */
export function rasterProjection(extent: Extent, cellM: number): Projection {
  const [west, south, east, north] = extent
  const cosLat = Math.cos((((south + north) / 2) * Math.PI) / 180)
  const width = Math.ceil(((east - west) * cosLat * M_PER_DEG_LON) / cellM)
  const height = Math.ceil(((north - south) * M_PER_DEG_LAT) / cellM)
  return {
    width,
    height,
    project: ([lon, lat]) => [((lon - west) * cosLat * M_PER_DEG_LON) / cellM, ((north - lat) * M_PER_DEG_LAT) / cellM],
  }
}

function ringToPath(ring: Position[], project: Projection['project']): string {
  let d = ''
  for (let i = 0; i < ring.length; i++) {
    const [x, y] = project(ring[i])
    d += `${i === 0 ? 'M' : 'L'}${x.toFixed(1)} ${y.toFixed(1)}`
  }
  return d + 'Z'
}

export function geometryToPath(geometry: Geometry, projection: Projection): string {
  const polygons = geometry.type === 'Polygon' ? [geometry.coordinates] : geometry.coordinates
  return polygons.map((rings) => rings.map((ring) => ringToPath(ring, projection.project)).join('')).join('')
}

export function geometryBounds(geometry: Geometry): Extent {
  let west = Infinity
  let south = Infinity
  let east = -Infinity
  let north = -Infinity
  const polygons = geometry.type === 'Polygon' ? [geometry.coordinates] : geometry.coordinates
  for (const rings of polygons) {
    for (const [lon, lat] of rings[0]) {
      if (lon < west) west = lon
      if (lon > east) east = lon
      if (lat < south) south = lat
      if (lat > north) north = lat
    }
  }
  return [west, south, east, north]
}

export function extentsIntersect(a: Extent, b: Extent): boolean {
  return a[0] <= b[2] && a[2] >= b[0] && a[1] <= b[3] && a[3] >= b[1]
}

export interface LabelCandidate {
  id: string
  point: Position
}

export interface PlacedLabel {
  id: string
  x: number
  y: number
}

/**
 * Greedy label placement in priority order: a label is kept only if its text
 * box stays inside the map and does not overlap one already placed.
 */
export function placeLabels(
  candidates: LabelCandidate[],
  width: number,
  height: number,
  charWidth = 6.4,
  lineHeight = 13,
): PlacedLabel[] {
  const boxes: { x0: number; y0: number; x1: number; y1: number }[] = []
  const placed: PlacedLabel[] = []
  for (const { id, point } of candidates) {
    const x = point[0] + 4
    const y = point[1] - 4
    const box = { x0: x - 2, y0: y - lineHeight, x1: x + id.length * charWidth + 2, y1: y + 3 }
    if (box.x0 < 0 || box.y0 < 0 || box.x1 > width || box.y1 > height) continue
    if (boxes.some((b) => box.x0 < b.x1 && box.x1 > b.x0 && box.y0 < b.y1 && box.y1 > b.y0)) continue
    boxes.push(box)
    placed.push({ id, x, y })
  }
  return placed
}

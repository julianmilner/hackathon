// Geographic helpers shared by both renderers.
//
// Local frame used by the terrain view: metres, three.js Y up, +X east, +Z south
// (so north is -Z). The origin sits over the City Bowl so precision stays high
// where the demo spends its time.

export interface LatLon {
  lat: number
  lon: number
}

export interface TileId {
  z: number
  x: number
  y: number
}

export const ORIGIN: LatLon = { lat: -33.93, lon: 18.45 }

const EARTH_RADIUS = 6371008.8
export const WEB_MERCATOR_CIRCUMFERENCE = 40075016.686

export const deg2rad = (d: number) => (d * Math.PI) / 180
export const rad2deg = (r: number) => (r * 180) / Math.PI

export const METRES_PER_DEG_LAT = (Math.PI / 180) * EARTH_RADIUS
export const METRES_PER_DEG_LON = METRES_PER_DEG_LAT * Math.cos(deg2rad(ORIGIN.lat))

export function toLocal(lat: number, lon: number) {
  return {
    x: (lon - ORIGIN.lon) * METRES_PER_DEG_LON,
    z: -(lat - ORIGIN.lat) * METRES_PER_DEG_LAT,
  }
}

export function toLatLon(x: number, z: number): LatLon {
  return {
    lat: ORIGIN.lat - z / METRES_PER_DEG_LAT,
    lon: ORIGIN.lon + x / METRES_PER_DEG_LON,
  }
}

// Web Mercator, normalised to 0..1 across the world.
export function lonToMercX(lon: number) {
  return (lon + 180) / 360
}

export function latToMercY(lat: number) {
  const phi = deg2rad(lat)
  return (1 - Math.log(Math.tan(phi) + 1 / Math.cos(phi)) / Math.PI) / 2
}

export function mercXToLon(x: number) {
  return x * 360 - 180
}

export function mercYToLat(y: number) {
  return rad2deg(Math.atan(Math.sinh(Math.PI * (1 - 2 * y))))
}

// Ground metres covered by one full mercator unit (0..1) at a latitude.
export function metresPerMercatorUnit(lat: number) {
  return WEB_MERCATOR_CIRCUMFERENCE * Math.cos(deg2rad(lat))
}

export function latLonToTile(lat: number, lon: number, z: number): TileId {
  const n = 2 ** z
  return {
    z,
    x: Math.floor(lonToMercX(lon) * n),
    y: Math.floor(latToMercY(lat) * n),
  }
}

// All descendants of `tile` at zoom `targetZ`.
export function childTiles(tile: TileId, targetZ: number): TileId[] {
  const factor = 2 ** (targetZ - tile.z)
  const out: TileId[] = []
  for (let dy = 0; dy < factor; dy++) {
    for (let dx = 0; dx < factor; dx++) {
      out.push({ z: targetZ, x: tile.x * factor + dx, y: tile.y * factor + dy })
    }
  }
  return out
}

export function tileCentreLatLon(tile: TileId): LatLon {
  const n = 2 ** tile.z
  return {
    lat: mercYToLat((tile.y + 0.5) / n),
    lon: mercXToLon((tile.x + 0.5) / n),
  }
}

import { deg2rad, METRES_PER_DEG_LAT, METRES_PER_DEG_LON } from './geo'

// A viewpoint is a point on the ground the camera looks at, plus where the camera
// sits relative to it. `heading` is the compass direction the camera looks (0 = north,
// 90 = east). `tilt` is the angle from straight down (0 = top-down, 90 = horizon).
export interface Viewpoint {
  id: string
  name: string
  lat: number
  lon: number
  // Approximate ground height at the target, used when no height field is available.
  groundHeight: number
  heading: number
  tilt: number
  distance: number
}

export const VIEWPOINTS: Viewpoint[] = [
  { id: 'city-bowl', name: 'City Bowl', lat: -33.928, lon: 18.42, groundHeight: 30, heading: 168, tilt: 62, distance: 3600 },
  { id: 'waterfront', name: 'V&A Waterfront', lat: -33.906, lon: 18.421, groundHeight: 5, heading: 200, tilt: 64, distance: 1900 },
  { id: 'table-mountain', name: 'Table Mountain', lat: -33.962, lon: 18.405, groundHeight: 1000, heading: 178, tilt: 66, distance: 5200 },
  { id: 'camps-bay', name: 'Camps Bay', lat: -33.952, lon: 18.382, groundHeight: 20, heading: 105, tilt: 66, distance: 3200 },
  { id: 'hout-bay', name: 'Hout Bay', lat: -34.045, lon: 18.355, groundHeight: 5, heading: 35, tilt: 64, distance: 4200 },
  { id: 'cape-point', name: 'Cape Point', lat: -34.352, lon: 18.49, groundHeight: 80, heading: 165, tilt: 62, distance: 6500 },
  { id: 'peninsula', name: 'The Peninsula', lat: -34.06, lon: 18.44, groundHeight: 0, heading: 172, tilt: 52, distance: 62000 },
]

export const DEFAULT_VIEWPOINT = VIEWPOINTS[0]

// Where the intro flight starts: high over the Atlantic, north-west of the city.
export const INTRO_START: Viewpoint = {
  id: 'intro',
  name: 'Intro',
  lat: -33.93,
  lon: 18.43,
  groundHeight: 0,
  heading: 160,
  tilt: 42,
  distance: 75000,
}

export function findViewpoint(id: string) {
  return VIEWPOINTS.find((v) => v.id === id)
}

// Camera offset from the target in metres: east, north and up.
export function cameraOffset(v: Viewpoint) {
  const h = deg2rad(v.heading)
  const t = deg2rad(v.tilt)
  return {
    east: -Math.sin(h) * Math.sin(t) * v.distance,
    north: -Math.cos(h) * Math.sin(t) * v.distance,
    up: Math.cos(t) * v.distance,
  }
}

// Camera pose on the globe for the Google renderer.
export function cameraGeoPose(v: Viewpoint) {
  const o = cameraOffset(v)
  return {
    lat: v.lat + o.north / METRES_PER_DEG_LAT,
    lon: v.lon + o.east / METRES_PER_DEG_LON,
    height: v.groundHeight + o.up,
    azimuth: deg2rad(v.heading),
    elevation: -deg2rad(90 - v.tilt),
  }
}

export const easeInOutCubic = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2)

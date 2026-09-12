// Storyboard for the one-minute "what if Koeberg blew up" show. Every place is a real
// coordinate; every time is seconds after Play. Camera keys are read by CinematicCamera,
// beat times by the beat components, captions by the HUD.
import { KOEBERG } from '../scene/koeberg/site'

export interface LatLon {
  lat: number
  lon: number
}

export const PLACES = {
  koeberg: { lat: KOEBERG.lat, lon: KOEBERG.lon } as LatLon,
  // Roamwork coworking, 2nd floor The Harrington, 50 Harrington Street, District Six.
  roamwork: { lat: -33.92845, lon: 18.42635 } as LatLon,
  // Devil's Peak slopes above Vredehoek and Zonnebloem.
  fireCentre: { lat: -33.944, lon: 18.433 } as LatLon,
  fireIgnitions: [
    { lat: -33.9425, lon: 18.437 },
    { lat: -33.94, lon: 18.429 },
  ] as LatLon[],
  // Table Bay off the Foreshore; the wave enters from the north edge of this patch.
  tsunamiCentre: { lat: -33.921, lon: 18.425 } as LatLon,
  kaijuSpawn: { lat: -33.9, lon: 18.428 } as LatLon,
  foreshore: { lat: -33.912, lon: 18.428 } as LatLon,
  cbd: { lat: -33.921, lon: 18.427 } as LatLon,
  melkbos: { lat: -33.74, lon: 18.44 } as LatLon,
  tableBayWide: { lat: -33.86, lon: 18.44 } as LatLon,
}

export const BEATS = {
  /** Camera reaches Koeberg; the accident timeline jumps to just before the detonation. */
  koebergArrive: 3,
  explosion: 6,
  fire: 13,
  tsunami: 25,
  kaiju: 37,
  end: 60,
}

export const DURATION = BEATS.end

export interface CameraKey {
  t: number
  /** Static target on the ground. Also the fallback when `subject` is not active yet. */
  at: LatLon
  /** Name of a moving subject in DemoState.subjects to look at instead of `at`. */
  subject?: string
  /** Metres added above the ground (or above the subject's point). */
  alt?: number
  /** Compass direction the camera looks, degrees (0 north, 90 east). */
  heading: number
  /** Angle from straight down, degrees (0 top-down, 90 horizon). */
  tilt: number
  /** Camera distance from the target, metres. */
  distance: number
}

const P = PLACES

// A helicopter that never stops moving: wide over Table Bay, swoop onto Koeberg for the blast,
// pull back to watch the plume head south, drop onto the burning mountain, swing over the bay
// for the wave, then find the kaiju and follow it to Harrington Street.
export const CAMERA_KEYS: CameraKey[] = [
  { t: 0, at: P.tableBayWide, heading: 5, tilt: 58, distance: 38000 },
  { t: 3, at: P.koeberg, alt: 25, heading: 60, tilt: 72, distance: 750 },
  { t: 6, at: P.koeberg, alt: 30, heading: 95, tilt: 71, distance: 650 },
  { t: 9, at: P.koeberg, alt: 40, heading: 150, tilt: 66, distance: 1600 },
  { t: 12, at: P.melkbos, heading: 172, tilt: 60, distance: 9000 },
  { t: 14, at: P.fireIgnitions[0], heading: 205, tilt: 66, distance: 3400 },
  { t: 19, at: P.fireCentre, heading: 250, tilt: 63, distance: 2400 },
  { t: 23.5, at: P.roamwork, alt: 20, heading: 215, tilt: 60, distance: 2000 },
  { t: 25.5, at: P.foreshore, heading: 185, tilt: 68, distance: 3600 },
  { t: 31, at: P.cbd, heading: 150, tilt: 62, distance: 2600 },
  { t: 36, at: P.roamwork, alt: 20, heading: 110, tilt: 60, distance: 1700 },
  { t: 38, at: P.kaijuSpawn, subject: 'kaiju', alt: 140, heading: 195, tilt: 74, distance: 1500 },
  { t: 46, at: P.kaijuSpawn, subject: 'kaiju', alt: 150, heading: 235, tilt: 72, distance: 1300 },
  { t: 52.5, at: P.roamwork, alt: 60, heading: 300, tilt: 68, distance: 950 },
  { t: 60, at: P.roamwork, alt: 80, heading: 340, tilt: 66, distance: 1100 },
]

export interface Caption {
  t: number
  text: string
  sub?: string
}

export const CAPTIONS: Caption[] = [
  { t: 0, text: 'Cape Town. A Saturday afternoon.', sub: 'Roamwork, 50 Harrington Street, District Six' },
  { t: 3, text: 'Koeberg Nuclear Power Station', sub: '30 km north of the city · two 970 MW reactors' },
  { t: 6, text: 'Hydrogen detonation breaches Unit 1', sub: 'A chemical blast, not a nuclear one. The containment is gone.' },
  { t: 9.5, text: 'The plume drifts south', sub: 'Northerly wind, 8 m/s: straight down the coast towards the CBD' },
  { t: 13, text: 'Fallout sparks a fire on Devil’s Peak', sub: 'Fynbos above Vredehoek catches' },
  { t: 19, text: 'The south-easter fans it towards District Six', sub: 'Faster uphill, faster downwind' },
  { t: 25, text: 'Table Bay draws back…', sub: 'then an 18 m wave hits the Foreshore' },
  { t: 31, text: 'Water pours into the City Bowl', sub: 'Harrington Street is 400 m from the harbour' },
  { t: 37, text: 'Something rises from Table Bay', sub: '' },
  { t: 45, text: 'A 300 m Claude kaiju, heading for Harrington Street', sub: 'It has a meeting at Roamwork' },
  { t: 53, text: 'Roamwork District Six: destroyed', sub: 'Coworkspace 6 will not be taking bookings' },
  { t: 60, text: 'Verdict: work from home today.', sub: 'Radiation, wildfire, tsunami, kaiju. In that order.' },
]

export function captionAt(t: number): Caption {
  let c = CAPTIONS[0]
  for (const cap of CAPTIONS) if (t >= cap.t) c = cap
  return c
}

/** Timeline markers for the HUD. */
export const MARKERS = [
  { t: BEATS.koebergArrive, label: 'Koeberg' },
  { t: BEATS.fire, label: 'Fire' },
  { t: BEATS.tsunami, label: 'Tsunami' },
  { t: BEATS.kaiju, label: 'Kaiju' },
  { t: BEATS.end, label: 'Verdict' },
]

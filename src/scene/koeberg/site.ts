// Koeberg Nuclear Power Station: facts, places and presets shared by the scene and the HUD.
// Sources: Eskom fact sheet NU 0001 rev 14; Wikipedia; NNR emergency planning zones;
// French 900 MWe CP1 containment data (37 m inner diameter, 0.9 m walls).

export const KOEBERG = {
  name: 'Koeberg Nuclear Power Station',
  lat: -33.67644,
  lon: 18.43205,
  // The site terrace sits about 8 m above sea level.
  platformAboveSea: 8,
  // Emergency planning zones around the reactors (metres).
  paz: 5000,   // Precautionary Action Zone: evacuate within 4 hours
  upz: 16000,  // Urgent Protective Action Zone: any sector evacuable within 16 hours
}

const EARTH_RADIUS = 6371008.8
const M_PER_DEG_LAT = (Math.PI / 180) * EARTH_RADIUS
const M_PER_DEG_LON = M_PER_DEG_LAT * Math.cos((KOEBERG.lat * Math.PI) / 180)

// Metres east and south of the site for a lat/lon (three.js x and z).
export function offsetFromSite(lat: number, lon: number) {
  return {
    x: (lon - KOEBERG.lon) * M_PER_DEG_LON,
    z: -(lat - KOEBERG.lat) * M_PER_DEG_LAT,
  }
}

export interface Place {
  name: string
  lat: number
  lon: number
  population?: string
}

export const PLACES: Place[] = [
  { name: 'Melkbosstrand', lat: -33.7247, lon: 18.4402, population: '~12 000' },
  { name: 'Atlantis', lat: -33.5667, lon: 18.4833, population: '~70 000' },
  { name: 'Bloubergstrand', lat: -33.8, lon: 18.46 },
  { name: 'Table View', lat: -33.82, lon: 18.49, population: '~50 000' },
  { name: 'Milnerton', lat: -33.87, lon: 18.5 },
  { name: 'Durbanville', lat: -33.83, lon: 18.65 },
  { name: 'Cape Town CBD', lat: -33.9249, lon: 18.4241, population: '4.7 million in the metro' },
  { name: 'Robben Island', lat: -33.806, lon: 18.366 },
  { name: 'Malmesbury', lat: -33.46, lon: 18.73 },
  { name: 'Stellenbosch', lat: -33.93, lon: 18.86 },
]

export interface WindPreset {
  id: string
  name: string
  // Meteorological convention: the direction the wind blows FROM, degrees clockwise from north.
  fromDeg: number
  speed: number // m/s
  note: string
}

export const WIND_PRESETS: WindPreset[] = [
  { id: 'north', name: 'Northerly, 8 m/s', fromDeg: 0, speed: 8, note: 'Worst case for the city: the plume runs straight down the coast over Melkbosstrand, Table View and Milnerton to the CBD, 28 km away.' },
  { id: 'nw', name: 'Winter north-wester, 12 m/s', fromDeg: 320, speed: 12, note: 'Cold-front weather. The plume crosses the northern suburbs towards Durbanville and the Boland; rain would wash fallout onto the ground.' },
  { id: 'se', name: 'Summer south-easter, 10 m/s', fromDeg: 135, speed: 10, note: 'The Cape Doctor. Most of the release goes out over the Atlantic; this is why the site was chosen.' },
]

export interface Fact {
  label: string
  value: string
  detail: string
}

export const FACTS: Fact[] = [
  { label: 'Output', value: '2 × 970 MW', detail: 'Two Framatome three-loop pressurised water reactors, on the grid since 1984 and 1985. About 4–5 % of South Africa’s electricity.' },
  { label: 'Fuel', value: '4.4 % U-235', detail: 'Uranium dioxide pellets in pencil-thick zirconium rods, bundled into 157 assemblies per core. Too dilute to explode like a weapon.' },
  { label: 'Primary loop', value: '155 bar · 290–325 °C', detail: 'Kept liquid by the pressuriser. Three coolant pumps push water through the core and three steam generators, 21 m tall each.' },
  { label: 'Secondary loop', value: '1 HP + 3 LP turbines', detail: 'Steam spins the 1 500 rpm turbo-generator, 14 m long, the largest in the southern hemisphere.' },
  { label: 'Cooling', value: '80 t/s of seawater', detail: 'Cold Atlantic water pumped from the intake basin through the condensers and back out the outfall, 40 tonnes a second per unit.' },
  { label: 'Containment', value: '37 m · 0.9 m walls', detail: 'Prestressed concrete cylinder with a steel liner, designed for a magnitude 7 earthquake and 0.3 g ground acceleration.' },
]

export interface ProcessStep {
  id: string
  title: string
  body: string
  anchor: string // anchor name in koeberg.anchors.json
}

export const PROCESS_STEPS: ProcessStep[] = [
  { id: 'core', title: '1 · Fission in the core', body: 'Neutrons split U-235 nuclei. Each fission releases heat and two or three more neutrons; water slows them so the chain reaction continues. Boron and control rods set the rate.', anchor: 'u1_core' },
  { id: 'sg', title: '2 · Steam generators', body: 'Water at 155 bar leaves the vessel at about 325 °C and runs through thousands of U-tubes. It never boils and never leaves the containment.', anchor: 'u1_sg0' },
  { id: 'rcp', title: '3 · Coolant pumps', body: 'Three pumps, one per loop, return the cooled water to the core at about 290 °C. Losing them is the start of every serious accident.', anchor: 'u1_rcp0' },
  { id: 'prz', title: '4 · Pressuriser', body: 'Electric heaters and a cold spray hold the loop at 155 bar so the water stays liquid.', anchor: 'u1_pressuriser' },
  { id: 'hp', title: '5 · Turbines', body: 'Steam from the generators drives one high-pressure and three low-pressure turbines at 1 500 rpm.', anchor: 'u1_lp1' },
  { id: 'gen', title: '6 · Generator', body: '970 MW per unit, stepped up through transformers into the indoor 400 kV switchyard and the national grid.', anchor: 'u1_gen' },
  { id: 'cond', title: '7 · Condensers', body: 'Spent steam condenses against tubes carrying cold seawater and is pumped back to the steam generators.', anchor: 'u1_condenser1' },
  { id: 'sea', title: '8 · Seawater', body: '40 tonnes a second per unit, drawn from the breakwater basin and returned to the Atlantic a few degrees warmer.', anchor: 'pumphouse_intake' },
]

export interface AccidentPhase {
  t0: number // sim seconds
  title: string
  storyTime: string
  body: string
}

// Playback is in "sim seconds"; the story clock is the real-world time each phase represents.
export const EXPLOSION_T = 22
export const ACCIDENT_PHASES: AccidentPhase[] = [
  { t0: 0, title: 'Normal operation', storyTime: 'T + 0', body: 'Both units at full power. Reactor trip, decay heat removal and containment are the three lines of defence.' },
  { t0: 2, title: 'Station blackout', storyTime: 'T + 0 h', body: 'The grid connection is lost and the standby diesels fail. Control rods drop and fission stops in two seconds, but the fuel keeps making 7 % of full power from radioactive decay: about 200 MW of heat with nowhere to go.' },
  { t0: 8, title: 'Coolant boils off', storyTime: 'T + 1–2 h', body: 'With no pumps, the steam generators dry out and the primary loop heats and vents through the relief valves. Water level in the vessel falls until the top of the core is uncovered.' },
  { t0: 14, title: 'Core melt and hydrogen', storyTime: 'T + 3–5 h', body: 'Zirconium cladding at 1 200 °C reacts with steam: Zr + 2 H₂O → ZrO₂ + 2 H₂. The reaction feeds itself, fuel melts at 2 800 °C and hundreds of kilograms of hydrogen collect under the dome.' },
  { t0: EXPLOSION_T, title: 'Hydrogen detonation', storyTime: 'T + ~5 h', body: 'A spark ignites the hydrogen. This is a chemical explosion, not a nuclear one. It breaches the containment and lofts volatile fission products: xenon, iodine-131, caesium-137, tellurium.' },
  { t0: EXPLOSION_T + 6, title: 'The plume', storyTime: 'T + 5–8 h', body: 'Hot gases rise a few hundred metres and drift with the wind. Iodine-131 is the acute hazard (thyroid); caesium-137 stays in the soil for decades. Within 5 km: evacuate. 5–16 km: shelter, iodine tablets, evacuate downwind sectors.' },
  { t0: EXPLOSION_T + 26, title: 'Fallout over the city', storyTime: 'T + 8–24 h', body: 'A Chernobyl- or Fukushima-scale release would make a downwind band tens of kilometres long uninhabitable for years. Cape Town has three roads out: the N1, the N2 and the coast road via Gordon’s Bay.' },
]

// Where the camera should be for each phase (view ids resolved by the app; 'plume' and 'region' follow the wind).
export const PHASE_VIEWS: Record<number, string> = {
  0: 'photo',
  2: 'turbine',
  8: 'inside',
  14: 'u1dome',
  [EXPLOSION_T]: 'domes',
  [EXPLOSION_T + 6]: 'plume',
  [EXPLOSION_T + 26]: 'region',
}

export function phaseAt(t: number): AccidentPhase {
  let p = ACCIDENT_PHASES[0]
  for (const ph of ACCIDENT_PHASES) if (t >= ph.t0) p = ph
  return p
}

// Wind FROM a compass bearing -> unit vector the plume travels along, in three.js x/z (x east, z south).
export function plumeDirection(fromDeg: number) {
  const toDeg = fromDeg + 180
  const a = (toDeg * Math.PI) / 180
  return { x: Math.sin(a), z: -Math.cos(a) }
}

export type Position = [number, number]

export type Geometry =
  | { type: 'Polygon'; coordinates: Position[][] }
  | { type: 'MultiPolygon'; coordinates: Position[][][] }

export interface PrecinctProperties {
  name: string
  includes: string[]
  district: string
  population: number | null
  rate_reliable: boolean
  counts: Record<string, number>
  previous: Record<string, number>
  rates: Record<string, number | null>
}

export interface PrecinctFeature {
  type: 'Feature'
  id: string
  properties: PrecinctProperties
  geometry: Geometry
}

export interface CrimeMetadata {
  period: { start: string; end: string; label: string; previous_label: string }
  categories: Record<string, string>
  police_action_categories: string[]
  population_year: number
  min_population_for_rate: number
  sources: Record<string, string>
  generated: string
}

export interface CrimeCollection {
  type: 'FeatureCollection'
  metadata: CrimeMetadata
  features: PrecinctFeature[]
}

export interface StationFeature {
  type: 'Feature'
  properties: { name: string }
  geometry: { type: 'Point'; coordinates: Position }
}

export interface StationCollection {
  type: 'FeatureCollection'
  features: StationFeature[]
}

/** [west, south, east, north] in degrees. */
export type Extent = [number, number, number, number]

export type Measure = 'density' | 'rate'

export interface HeatLayer {
  file: string
  category: string
  measure: Measure
  /** Value encoded as pixel 255; higher values are clipped to it. */
  vmax: number
  total_cases: number
}

export interface HeatIndex {
  extent: Extent
  width: number
  height: number
  cell_m: number
  sigma_m: number
  encoding: string
  min_pop_density: number
  period: CrimeMetadata['period']
  categories: Record<string, string>
  measures: Record<Measure, { label: string; short: string }>
  formula: string
  sources: Record<string, string>
  generated: string
  layers: Record<string, HeatLayer>
}

import { useEffect, useMemo, useRef, useState, type MouseEvent } from 'react'
import type { CrimeCollection, HeatIndex, HeatLayer, Measure, Position, PrecinctFeature, StationCollection } from './types'
import { extentsIntersect, geometryBounds, geometryToPath, placeLabels, rasterProjection } from './projection'
import { HEAT_RAMP, buildHeatLut, decodePixel, formatChange, formatNumber, heatGradient } from './scale'
import './crime-heatmap.css'

const LABEL_COUNT = 14
/** The SVG overlay is drawn in raster cells; this is the cell count of a typical on-screen width. */
const DISPLAY_WIDTH_PX = 1100
const LUT = buildHeatLut(HEAT_RAMP)

interface Pointer {
  x: number
  y: number
  col: number
  row: number
}

/** ?category=murder&measure=rate pre-selects a view, so a state can be linked to. */
const initialParams = new URLSearchParams(window.location.search)

function dataUrl(file: string): string {
  return `${import.meta.env.BASE_URL}data/${file}`
}

/** Fetch a grayscale layer PNG and return its pixel values, one byte per cell. */
async function loadGrid(url: string, width: number, height: number): Promise<Uint8Array> {
  const image = await new Promise<HTMLImageElement>((resolve, reject) => {
    const element = new Image()
    element.onload = () => resolve(element)
    element.onerror = () => reject(new Error(`could not load ${url}`))
    element.src = url
  })
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const context = canvas.getContext('2d', { willReadFrequently: true })
  if (!context) throw new Error('canvas 2d context unavailable')
  context.drawImage(image, 0, 0)
  const rgba = context.getImageData(0, 0, width, height).data
  const grid = new Uint8Array(width * height)
  for (let i = 0; i < grid.length; i++) grid[i] = rgba[i * 4]
  return grid
}

export default function CrimeHeatmap() {
  const [index, setIndex] = useState<HeatIndex | null>(null)
  const [precincts, setPrecincts] = useState<CrimeCollection | null>(null)
  const [stations, setStations] = useState<StationCollection | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [category, setCategory] = useState(() => initialParams.get('category') ?? 'all17')
  const [measure, setMeasure] = useState<Measure>(() => (initialParams.get('measure') === 'rate' ? 'rate' : 'density'))
  const [loaded, setLoaded] = useState<{ key: string; grid: Uint8Array } | null>(null)
  const [showOutlines, setShowOutlines] = useState(true)
  const [showTable, setShowTable] = useState(false)
  const [hovered, setHovered] = useState<string | null>(null)
  const [pointer, setPointer] = useState<Pointer | null>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    let cancelled = false
    Promise.all([
      fetch(dataUrl('heat/index.json')),
      fetch(dataUrl('wc-crime-precincts.geojson')),
      fetch(dataUrl('wc-police-stations.geojson')),
    ])
      .then(async (responses) => {
        if (responses.some((response) => !response.ok)) {
          throw new Error('crime data is missing; run the scripts in scripts/crime/')
        }
        const [heat, polygons, points] = (await Promise.all(responses.map((response) => response.json()))) as [
          HeatIndex,
          CrimeCollection,
          StationCollection,
        ]
        if (cancelled) return
        setIndex(heat)
        setPrecincts(polygons)
        setStations(points)
      })
      .catch((reason: unknown) => {
        if (!cancelled) setError(reason instanceof Error ? reason.message : String(reason))
      })
    return () => {
      cancelled = true
    }
  }, [])

  const layerKey = `${category}-${measure}`
  const layer: HeatLayer | null = index?.layers[layerKey] ?? null

  useEffect(() => {
    if (!index || !layer) return
    let cancelled = false
    const key = `${layer.category}-${layer.measure}`
    loadGrid(dataUrl(`heat/${layer.file}`), index.width, index.height)
      .then((values) => {
        if (!cancelled) setLoaded({ key, grid: values })
      })
      .catch((reason: unknown) => {
        if (!cancelled) setError(reason instanceof Error ? reason.message : String(reason))
      })
    return () => {
      cancelled = true
    }
  }, [index, layer])

  // Keep the previous layer on screen, dimmed, until the next one has decoded.
  const grid = loaded?.grid ?? null
  const loadingLayer = layer !== null && loaded?.key !== layerKey

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas || !grid || !index) return
    const context = canvas.getContext('2d')
    if (!context) return
    const image = context.createImageData(index.width, index.height)
    const out = image.data
    for (let i = 0; i < grid.length; i++) {
      const p = grid[i] * 4
      const o = i * 4
      out[o] = LUT[p]
      out[o + 1] = LUT[p + 1]
      out[o + 2] = LUT[p + 2]
      out[o + 3] = LUT[p + 3]
    }
    context.putImageData(image, 0, 0)
  }, [grid, index])

  const projection = useMemo(() => (index ? rasterProjection(index.extent, index.cell_m) : null), [index])
  const uiScale = projection ? projection.width / DISPLAY_WIDTH_PX : 1

  const visible = useMemo(() => {
    if (!precincts || !index) return []
    return precincts.features.filter((feature) => extentsIntersect(geometryBounds(feature.geometry), index.extent))
  }, [precincts, index])

  const paths = useMemo(() => {
    const result = new Map<string, string>()
    if (!projection) return result
    for (const feature of visible) result.set(feature.id, geometryToPath(feature.geometry, projection))
    return result
  }, [visible, projection])

  const stationPoints = useMemo(() => {
    const result = new Map<string, Position>()
    if (!projection) return result
    for (const feature of stations?.features ?? []) {
      result.set(feature.properties.name, projection.project(feature.geometry.coordinates))
    }
    return result
  }, [stations, projection])

  const precinctValue = (feature: PrecinctFeature): number => {
    if (measure === 'rate') return feature.properties.rate_reliable ? feature.properties.rates[category] ?? 0 : 0
    return feature.properties.counts[category] ?? 0
  }

  const ranked = useMemo(
    () => [...visible].sort((a, b) => precinctValue(b) - precinctValue(a)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [visible, category, measure],
  )

  if (error) {
    return (
      <main className="crime-heatmap">
        <h1>Crime heatmap</h1>
        <p className="chm-status" role="alert">
          Could not load the crime data: {error}
        </p>
      </main>
    )
  }

  if (!index || !precincts || !projection) {
    return (
      <main className="crime-heatmap">
        <h1>Crime heatmap</h1>
        <p className="chm-status" aria-live="polite">
          Loading SAPS precinct data…
        </p>
      </main>
    )
  }

  const categoryLabel = index.categories[category] ?? category
  const measureInfo = index.measures[measure]
  const hoveredFeature = hovered ? visible.find((feature) => feature.id === hovered) ?? null : null

  const labelIds = [...(hoveredFeature ? [hoveredFeature.id] : []), ...ranked.slice(0, LABEL_COUNT).map((f) => f.id)]
  const labels = placeLabels(
    labelIds.flatMap((id) => {
      const point = stationPoints.get(id)
      return point ? [{ id, point }] : []
    }),
    projection.width,
    projection.height,
    6.4 * uiScale,
    13 * uiScale,
  )

  const updatePointer = (event: MouseEvent<SVGSVGElement>) => {
    const rect = event.currentTarget.getBoundingClientRect()
    const x = event.clientX - rect.left
    const y = event.clientY - rect.top
    setPointer({
      x,
      y,
      col: Math.min(index.width - 1, Math.max(0, Math.floor((x / rect.width) * index.width))),
      row: Math.min(index.height - 1, Math.max(0, Math.floor((y / rect.height) * index.height))),
    })
  }

  const pixel = pointer && grid ? grid[pointer.row * index.width + pointer.col] : null
  const pointValue = pixel !== null && layer ? decodePixel(pixel, layer.vmax) : null

  const legendTicks = layer
    ? [0, 0.25, 0.5, 0.75, 1].map((t) => ({ t, value: layer.vmax * t * t }))
    : []

  return (
    <main className="crime-heatmap">
      <header className="chm-header">
        <p className="chm-eyebrow">SAPS station statistics · {index.period.label}</p>
        <h1>Crime heatmap: Cape Town and surrounds</h1>
        <p className="chm-subtitle">
          {categoryLabel}, {measureInfo.label.toLowerCase()}. Blended from precinct counts down to census blocks; move
          over the map to read the value at any point.
        </p>
      </header>

      <div className="chm-filters" role="group" aria-label="Heatmap filters">
        <label className="chm-field">
          <span>Crime type</span>
          <select value={category} onChange={(event) => setCategory(event.target.value)}>
            {Object.entries(index.categories).map(([key, label]) => (
              <option key={key} value={key}>
                {label}
              </option>
            ))}
          </select>
        </label>

        <div className="chm-field">
          <span>Measure</span>
          <div className="chm-toggle">
            <button type="button" aria-pressed={measure === 'density'} onClick={() => setMeasure('density')}>
              Cases per km²
            </button>
            <button type="button" aria-pressed={measure === 'rate'} onClick={() => setMeasure('rate')}>
              Per 100 000 residents
            </button>
          </div>
        </div>

        <div className="chm-field">
          <span>Overlay</span>
          <div className="chm-toggle">
            <button type="button" aria-pressed={showOutlines} onClick={() => setShowOutlines(!showOutlines)}>
              Precinct outlines
            </button>
            <button type="button" aria-pressed={showTable} onClick={() => setShowTable(!showTable)}>
              Table
            </button>
          </div>
        </div>
      </div>

      <div className="chm-map" style={{ aspectRatio: `${index.width} / ${index.height}` }}>
        <canvas
          ref={canvasRef}
          className={loadingLayer ? 'chm-raster is-loading' : 'chm-raster'}
          width={index.width}
          height={index.height}
          role="img"
          aria-label={`Heatmap of ${categoryLabel}, ${measureInfo.label.toLowerCase()}`}
        />
        <svg
          className={showOutlines ? 'chm-overlay' : 'chm-overlay is-hidden'}
          viewBox={`0 0 ${projection.width} ${projection.height}`}
          onMouseMove={updatePointer}
          onMouseLeave={() => {
            setHovered(null)
            setPointer(null)
          }}
        >
          <g className="chm-precincts">
            {visible.map((feature) => (
              <path
                key={feature.id}
                d={paths.get(feature.id)}
                vectorEffect="non-scaling-stroke"
                onMouseEnter={() => setHovered(feature.id)}
              >
                <title>{feature.properties.name}</title>
              </path>
            ))}
          </g>
          {hoveredFeature && <path className="chm-hover" d={paths.get(hoveredFeature.id)} vectorEffect="non-scaling-stroke" />}
          <g className="chm-labels" aria-hidden="true" style={{ fontSize: 11 * uiScale, strokeWidth: 3 * uiScale }}>
            {labels.map((label) => (
              <text key={label.id} x={label.x} y={label.y}>
                {label.id}
              </text>
            ))}
          </g>
        </svg>

        {pointer && layer && (
          <div
            className="chm-tooltip"
            role="status"
            style={{
              left: pointer.x,
              top: pointer.y,
              transform: pointer.x > 320 ? 'translate(calc(-100% - 12px), 12px)' : 'translate(12px, 12px)',
            }}
          >
            <PointReadout
              value={pointValue}
              clipped={pixel === 255}
              measure={measure}
              layer={layer}
              index={index}
              feature={hoveredFeature}
              category={category}
              metadata={precincts.metadata}
            />
          </div>
        )}
      </div>

      {layer && (
        <div className="chm-legend" aria-label="Colour scale">
          <div className="chm-legend-bar" style={{ background: heatGradient(HEAT_RAMP) }} />
          <div className="chm-legend-ticks">
            {legendTicks.map(({ t, value }) => (
              <span key={t} style={{ left: `${t * 100}%` }}>
                {t === 1 ? '≥ ' : ''}
                {formatNumber(value, value < 10 ? 1 : 0)}
              </span>
            ))}
          </div>
          <p className="chm-legend-note">
            {measureInfo.label}. The scale is square-root stretched so quieter areas keep detail; the top is the
            {measure === 'density' ? ' busiest 0.3%' : ' highest 1%'} of cells.
            {measure === 'rate' && ` Areas with fewer than ${formatNumber(index.min_pop_density)} residents per km² are left blank.`}
          </p>
        </div>
      )}

      {showTable && (
        <table className="chm-table">
          <caption>
            {categoryLabel}, {index.period.label}, by police precinct
          </caption>
          <thead>
            <tr>
              <th scope="col">Precinct</th>
              <th scope="col">District</th>
              <th scope="col" className="num">
                Residents ({precincts.metadata.population_year})
              </th>
              <th scope="col" className="num">
                Cases
              </th>
              <th scope="col" className="num">
                Per 100 000
              </th>
              <th scope="col" className="num">
                Change on {index.period.previous_label}
              </th>
            </tr>
          </thead>
          <tbody>
            {ranked.map((feature) => {
              const p = feature.properties
              const rate = p.rates[category]
              return (
                <tr key={feature.id} className={feature.id === hovered ? 'is-hovered' : undefined}>
                  <th scope="row">{p.name}</th>
                  <td>{p.district}</td>
                  <td className="num">{p.population === null ? '–' : formatNumber(p.population)}</td>
                  <td className="num">{formatNumber(p.counts[category])}</td>
                  <td className="num">{rate === null || !p.rate_reliable ? '–' : formatNumber(rate)}</td>
                  <td className="num">{formatChange(p.counts[category], p.previous[category])}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      )}

      <footer className="chm-footer">
        <p>
          <strong>How a point gets its value.</strong> {index.formula}
        </p>
        <p>
          SAPS publishes counts per precinct only, so the street-level texture comes from where people live, not from
          incident addresses. Cape Town Central has few residents and many visitors, so its per-resident rate runs high.
          Makhaza is folded into Harare, which it was carved from in 2024. Tafalehashe (opened 2026) has no boundary yet
          and is omitted.
        </p>
        <p>
          Sources: {index.sources.crime}. {index.sources.boundaries}. {index.sources.population}.
        </p>
      </footer>
    </main>
  )
}

interface PointReadoutProps {
  value: number | null
  clipped: boolean
  measure: Measure
  layer: HeatLayer
  index: HeatIndex
  feature: PrecinctFeature | null
  category: string
  metadata: CrimeCollection['metadata']
}

function PointReadout({ value, clipped, measure, layer, index, feature, category, metadata }: PointReadoutProps) {
  const unit = measure === 'density' ? 'cases per km² per year' : 'cases per 100 000 residents'
  const blank = measure === 'rate' && value === 0
  return (
    <>
      <p className="chm-tooltip-title">{feature ? `${feature.properties.name} precinct` : 'Outside any precinct'}</p>
      <p className="chm-tooltip-value">
        {blank ? (
          <span>Too few residents nearby for a rate</span>
        ) : (
          <>
            <strong>
              {clipped ? '≥ ' : ''}
              {value === null ? '–' : formatNumber(value, value < 10 ? 1 : 0)}
            </strong>{' '}
            {unit}
          </>
        )}
      </p>
      <p className="chm-tooltip-hint">Within about {formatNumber(index.sigma_m * 2)} m of this point, distance-weighted.</p>
      {feature && (
        <dl>
          <dt>Precinct cases, 12 months</dt>
          <dd>{formatNumber(feature.properties.counts[category])}</dd>
          <dt>Precinct per 100 000</dt>
          <dd>
            {feature.properties.rate_reliable && feature.properties.rates[category] !== null
              ? formatNumber(feature.properties.rates[category] as number)
              : '–'}
          </dd>
          <dt>Change on {metadata.period.previous_label}</dt>
          <dd>{formatChange(feature.properties.counts[category], feature.properties.previous[category])}</dd>
          <dt>Residents ({metadata.population_year})</dt>
          <dd>{feature.properties.population === null ? 'unknown' : formatNumber(feature.properties.population)}</dd>
        </dl>
      )}
      {layer.total_cases > 0 && !feature && (
        <p className="chm-tooltip-note">No residents are recorded here, so no cases are allocated to it.</p>
      )}
    </>
  )
}

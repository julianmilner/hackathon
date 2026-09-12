/**
 * Sequential "heat" ramp for the dark surface: OKLCH lightness rises
 * monotonically from 0.33 to 0.92 while the hue walks plum -> red -> orange ->
 * yellow, so the lowest class recedes into the navy background and the highest
 * glows. Multi-hue is the documented exception for semantic heat; the legend
 * always accompanies it. Seven classes is the ceiling before neighbours blur.
 */
export const HEAT_RAMP = ['#51223f', '#8b223e', '#c2272d', '#e65001', '#fb8304', '#ffb849', '#ffe47c']

/** Fade-in length, as a fraction of the encoded range, so zero blends into the surface. */
const FADE = 0.1

function hexToRgb(hex: string): [number, number, number] {
  return [parseInt(hex.slice(1, 3), 16), parseInt(hex.slice(3, 5), 16), parseInt(hex.slice(5, 7), 16)]
}

/**
 * 256-entry RGBA lookup for the raster layers. Index is the encoded pixel
 * value (square root of value / vmax); colours interpolate linearly between the
 * ramp stops and alpha fades in over the lowest tenth so "nothing" is
 * transparent rather than a hard plum edge.
 */
export function buildHeatLut(ramp: string[] = HEAT_RAMP): Uint8ClampedArray {
  const stops = ramp.map(hexToRgb)
  const lut = new Uint8ClampedArray(256 * 4)
  for (let i = 0; i < 256; i++) {
    const t = i / 255
    const pos = t * (stops.length - 1)
    const k = Math.min(Math.floor(pos), stops.length - 2)
    const f = pos - k
    for (let c = 0; c < 3; c++) lut[i * 4 + c] = stops[k][c] * (1 - f) + stops[k + 1][c] * f
    lut[i * 4 + 3] = i === 0 ? 0 : Math.round(255 * Math.min(1, t / FADE))
  }
  return lut
}

/** Decode an encoded pixel back to its value. */
export function decodePixel(pixel: number, vmax: number): number {
  const t = pixel / 255
  return vmax * t * t
}

/** CSS gradient matching the lookup table, for the legend bar. */
export function heatGradient(ramp: string[] = HEAT_RAMP): string {
  return `linear-gradient(90deg, ${ramp.map((c, i) => `${c} ${(i / (ramp.length - 1)) * 100}%`).join(', ')})`
}

/** Thin-space thousands separator and a full stop for decimals, e.g. 12 345.6. */
export function formatNumber(value: number, digits = 0): string {
  const fixed = Math.abs(value).toFixed(digits)
  const [whole, fraction] = fixed.split('.')
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, '\u202f')
  return `${value < 0 ? '-' : ''}${grouped}${fraction ? `.${fraction}` : ''}`
}

export function formatChange(current: number, previous: number): string {
  if (previous === 0) return current === 0 ? '0%' : 'new'
  const change = ((current - previous) / previous) * 100
  const sign = change > 0 ? '+' : ''
  return `${sign}${change.toFixed(0)}%`
}

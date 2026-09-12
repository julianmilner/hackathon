import type { HeightField } from '../tsunami/HeightField'

function clamp(v: number, lo: number, hi: number) {
  return v < lo ? lo : v > hi ? hi : v
}

/**
 * Bilinear height lookup in the local frame (x east, z south, metres) on the height field the
 * tsunami samples from the city mesh. Points outside the field clamp to the nearest edge.
 * Cell layout follows HeightField: row 0 is the +z (south) edge, column 0 the -x (west) edge.
 */
export function sampleHeight(field: HeightField, x: number, z: number): number {
  const { resolution: n, size, heights } = field
  const fx = (x / size + 0.5) * n - 0.5
  const fz = (0.5 - z / size) * n - 0.5
  const i0 = clamp(Math.floor(fx), 0, n - 1)
  const j0 = clamp(Math.floor(fz), 0, n - 1)
  const i1 = Math.min(i0 + 1, n - 1)
  const j1 = Math.min(j0 + 1, n - 1)
  const tx = clamp(fx - i0, 0, 1)
  const tz = clamp(fz - j0, 0, 1)
  const h00 = heights[j0 * n + i0]
  const h10 = heights[j0 * n + i1]
  const h01 = heights[j1 * n + i0]
  const h11 = heights[j1 * n + i1]
  return (h00 * (1 - tx) + h10 * tx) * (1 - tz) + (h01 * (1 - tx) + h11 * tx) * tz
}

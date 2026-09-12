// Stand-in for the Devil's Peak / Vredehoek slope: a ridge across the north of the area
// falling to a suburb in the south. Local frame: x east, z south, metres, origin mid-slope.

export const SIZE = 2500
/** Ground below this is suburb and carries no fuel. */
export const FUEL_MIN_HEIGHT = 70
/** Ground above this is bare rock. */
export const ROCK_HEIGHT = 560

const gauss = (t: number) => Math.exp(-t * t)

export function groundHeight(x: number, z: number): number {
  const ridge = 500 * gauss((z + 650) / 480) * (0.5 + 0.5 * gauss((x + 200) / 950))
  const peak = 160 * gauss(Math.hypot(x + 380, z + 620) / 240)
  const shoulder = 120 * gauss(Math.hypot(x - 650, z + 350) / 380)
  const base = 18 + 0.045 * Math.max(0, 200 - z)
  const bumps = 5 * Math.sin(x * 0.012) * Math.cos(z * 0.014) + 2.5 * Math.sin(x * 0.043 + z * 0.029)
  return base + ridge + peak + shoulder + bumps
}

/** Slope in degrees from central differences. */
export function groundSlope(x: number, z: number, step = 8): number {
  const gx = (groundHeight(x + step, z) - groundHeight(x - step, z)) / (2 * step)
  const gz = (groundHeight(x, z + step) - groundHeight(x, z - step)) / (2 * step)
  return (Math.atan(Math.hypot(gx, gz)) * 180) / Math.PI
}

/** A lower slope above the suburb on the north-east side, like Rhodes Memorial above Rondebosch. */
export const IGNITION_POINT = { x: 500, z: -150 }

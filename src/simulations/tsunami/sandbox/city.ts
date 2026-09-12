/** Sea to the west, beach around x = -250, gently rising land with a few hills. */
export function groundHeight(x: number, z: number) {
  const beach = -250
  let h: number
  if (x < beach) h = ((x - beach) / 350) * 12 // seabed: 0 at the beach down to -12 at the west edge
  else h = ((x - beach) / 850) * 14 // land rises to +14 at the east edge
  h += 1.8 * Math.sin(z * 0.011 + 0.4) * Math.max(0, (x - beach) / 400)
  h += 2.5 * Math.exp(-((x - 350) ** 2 + (z - 250) ** 2) / (2 * 120 ** 2)) // a small hill
  return h
}

export const CITY_SIZE = 1200
export const SEA_LEVEL = 0

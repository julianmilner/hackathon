import { useFrame } from '@react-three/fiber'
import { FogExp2, MathUtils } from 'three'

interface Props {
  // Fog density when the camera is near the ground and when it is high above the city.
  lowDensity: number
  highDensity: number
}

// Haze sits near the ground, so thin the fog as the camera climbs. Keeps street-level
// views atmospheric without washing out the whole peninsula from altitude.
export function AltitudeFog({ lowDensity, highDensity }: Props) {
  useFrame(({ scene, camera }) => {
    const fog = scene.fog
    if (!(fog instanceof FogExp2)) return
    const t = MathUtils.smoothstep(camera.position.y, 1500, 30000)
    fog.density = MathUtils.lerp(lowDensity, highDensity, t)
  })
  return null
}

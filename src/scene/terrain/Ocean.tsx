import { useEffect, useMemo } from 'react'
import { useFrame } from '@react-three/fiber'
import {
  Color,
  DataTexture,
  DoubleSide,
  LinearFilter,
  PlaneGeometry,
  RedFormat,
  ShaderMaterial,
  UniformsLib,
  UniformsUtils,
  UnsignedByteType,
  Vector3,
  Vector4,
} from 'three'
import { OUTER_RING, REGION } from '../../config'
import { METRES_PER_DEG_LAT, METRES_PER_DEG_LON, ORIGIN } from '../../geo'
import type { HeightField } from './heightfield'

export const SEA_LEVEL = 0.6


const vertexShader = /* glsl */ `
  #include <common>
  #include <fog_pars_vertex>
  #include <logdepthbuf_pars_vertex>
  varying vec3 vWorldPos;
  void main() {
    vec4 worldPos = modelMatrix * vec4(position, 1.0);
    vWorldPos = worldPos.xyz;
    vec4 mvPosition = viewMatrix * worldPos;
    gl_Position = projectionMatrix * mvPosition;
    #include <fog_vertex>
    #include <logdepthbuf_vertex>
  }
`

const fragmentShader = /* glsl */ `
  #include <common>
  #include <fog_pars_fragment>
  #include <logdepthbuf_pars_fragment>
  uniform vec3 uDeepColor;
  uniform vec3 uSkyColor;
  uniform vec3 uSunColor;
  uniform vec3 uSunDir;
  uniform float uTime;
  uniform float uAlpha;
  uniform sampler2D uShore;
  uniform bool uHasShore;
  uniform vec3 uSeaFloorColor;
  // x: origin lon, y: origin lat, z: metres per degree lon, w: metres per degree lat
  uniform vec4 uGeo;
  // x: region mercator x0, y: region mercator y0, z: 1/width, w: 1/height (mercator units)
  uniform vec4 uRegion;
  // Same for the far ring of coarse imagery around the region.
  uniform vec4 uRing;
  varying vec3 vWorldPos;

  float hash(vec2 p) {
    return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
  }

  float vnoise(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    vec2 u = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x), u.y);
  }

  float waves(vec2 p, float t) {
    return vnoise(p * 0.012 + vec2(t * 0.05, t * 0.03)) * 0.6
         + vnoise(p * 0.05 + vec2(-t * 0.09, t * 0.07)) * 0.3
         + vnoise(p * 0.19 + vec2(t * 0.16, -t * 0.12)) * 0.1;
  }

  void main() {
    #include <logdepthbuf_fragment>
    vec3 toCamera = cameraPosition - vWorldPos;
    float dist = length(toCamera);
    vec3 V = toCamera / dist;

    // Gentle, non-repeating surface detail that fades out with distance.
    float amp = smoothstep(25000.0, 1500.0, dist) * 0.9;
    vec2 p = vWorldPos.xz;
    float e = 6.0;
    float h0 = waves(p, uTime);
    float hx = waves(p + vec2(e, 0.0), uTime);
    float hz = waves(p + vec2(0.0, e), uTime);
    vec3 N = normalize(vec3(-(hx - h0) / e * amp, 1.0, -(hz - h0) / e * amp));

    float NdV = max(dot(N, V), 0.0);
    float fresnel = 0.03 + 0.97 * pow(1.0 - NdV, 5.0);
    vec3 R = reflect(-V, N);
    float RdS = max(dot(R, uSunDir), 0.0);
    float spec = pow(RdS, 700.0);
    float glow = pow(RdS, 16.0);

    vec3 color = mix(uDeepColor, uSkyColor, fresnel * 0.8);
    color += uSunColor * (spec * 0.9 + glow * 0.06);

    // Wherever imagery lies underneath, the water is translucent so the imagery's own
    // coastline and shallows show through; inside the detailed region the cleaned land mask
    // also feathers it out over land. Beyond the far ring there is nothing underneath, so
    // blend against the imagery's average sea colour to keep the tone continuous.
    float alpha = uAlpha;
    float lon = uGeo.x + vWorldPos.x / uGeo.z;
    float lat = uGeo.y - vWorldPos.z / uGeo.w;
    float phi = radians(lat);
    float mx = (lon + 180.0) / 360.0;
    float my = (1.0 - log(tan(phi) + 1.0 / cos(phi)) / PI) / 2.0;
    vec2 uv = vec2((mx - uRegion.x) * uRegion.z, (my - uRegion.y) * uRegion.w);
    vec2 ringUv = vec2((mx - uRing.x) * uRing.z, (my - uRing.y) * uRing.w);
    bool inside = all(greaterThanEqual(uv, vec2(0.0))) && all(lessThanEqual(uv, vec2(1.0)));
    bool inRing = all(greaterThanEqual(ringUv, vec2(0.0))) && all(lessThanEqual(ringUv, vec2(1.0)));
    if (inside && uHasShore) {
      float land = texture2D(uShore, uv).r;
      alpha *= 1.0 - smoothstep(0.2, 0.8, land);
    } else if (!inRing) {
      color = mix(uSeaFloorColor, color, uAlpha);
      alpha = 1.0;
    }

    gl_FragColor = vec4(color, alpha);
    #include <fog_fragment>
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`

interface Props {
  sunDir: Vector3
  skyColor: string
  heightField: HeightField | null
  deepColor?: string
  alpha?: number
}

export function Ocean({ sunDir, skyColor, heightField, deepColor = '#0e4a7a', alpha = 0.66 }: Props) {
  const material = useMemo(() => {
    const regionWidth = (REGION.x1 - REGION.x0 + 1) / 2 ** REGION.z
    const regionHeight = (REGION.y1 - REGION.y0 + 1) / 2 ** REGION.z
    const ringWidth = (OUTER_RING.x1 - OUTER_RING.x0 + 1) / 2 ** OUTER_RING.z
    const ringHeight = (OUTER_RING.y1 - OUTER_RING.y0 + 1) / 2 ** OUTER_RING.z
    return new ShaderMaterial({
      vertexShader,
      fragmentShader,
      transparent: true,
      depthWrite: false,
      side: DoubleSide,
      fog: true,
      uniforms: UniformsUtils.merge([
        UniformsLib.fog,
        {
          uDeepColor: { value: new Color(deepColor) },
          uSkyColor: { value: new Color(skyColor) },
          uSunColor: { value: new Color('#fff1d6') },
          uSunDir: { value: sunDir.clone().normalize() },
          uTime: { value: 0 },
          uAlpha: { value: alpha },
          uShore: { value: null },
          uHasShore: { value: false },
          uSeaFloorColor: { value: new Color('#102c32') },
          uGeo: { value: new Vector4(ORIGIN.lon, ORIGIN.lat, METRES_PER_DEG_LON, METRES_PER_DEG_LAT) },
          uRegion: {
            value: new Vector4(REGION.x0 / 2 ** REGION.z, REGION.y0 / 2 ** REGION.z, 1 / regionWidth, 1 / regionHeight),
          },
          uRing: {
            value: new Vector4(OUTER_RING.x0 / 2 ** OUTER_RING.z, OUTER_RING.y0 / 2 ** OUTER_RING.z, 1 / ringWidth, 1 / ringHeight),
          },
        },
      ]),
    })
  }, [sunDir, skyColor, deepColor, alpha])

  // Build the shore mask from the height field once it arrives.
  useEffect(() => {
    if (!heightField) return
    const texture = buildShoreMask(heightField)
    material.uniforms.uShore.value = texture
    material.uniforms.uHasShore.value = true
    return () => {
      material.uniforms.uShore.value = null
      material.uniforms.uHasShore.value = false
      texture.dispose()
    }
  }, [heightField, material])

  const geometry = useMemo(() => new PlaneGeometry(600000, 600000, 1, 1), [])

  useFrame((_, delta) => {
    material.uniforms.uTime.value += delta
  })

  return (
    <mesh
      geometry={geometry}
      material={material}
      rotation-x={-Math.PI / 2}
      position-y={SEA_LEVEL}
      renderOrder={1}
      frustumCulled={false}
    />
  )
}

// The cleaned land mask, softened with a 3x3 box blur so the shoreline feathers over
// roughly two elevation pixels (about 60 m) instead of stepping.
function buildShoreMask(hf: HeightField) {
  const w = hf.width
  const h = hf.height
  const { land } = hf
  const data = new Uint8Array(w * h)
  for (let y = 0; y < h; y++) {
    const y0 = Math.max(y - 1, 0) * w
    const y1 = y * w
    const y2 = Math.min(y + 1, h - 1) * w
    for (let x = 0; x < w; x++) {
      const x0 = Math.max(x - 1, 0)
      const x2 = Math.min(x + 1, w - 1)
      const sum =
        land[y0 + x0] + land[y0 + x] + land[y0 + x2] +
        land[y1 + x0] + land[y1 + x] + land[y1 + x2] +
        land[y2 + x0] + land[y2 + x] + land[y2 + x2]
      data[y1 + x] = Math.round((sum / 9) * 255)
    }
  }
  const texture = new DataTexture(data, w, h, RedFormat, UnsignedByteType)
  texture.minFilter = LinearFilter
  texture.magFilter = LinearFilter
  texture.flipY = false
  texture.needsUpdate = true
  return texture
}

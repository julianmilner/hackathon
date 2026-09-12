import { useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import { BackSide, Color, Mesh, ShaderMaterial, SphereGeometry, Vector3 } from 'three'

const vertexShader = /* glsl */ `
  varying vec3 vWorldPos;
  void main() {
    vec4 worldPos = modelMatrix * vec4(position, 1.0);
    vWorldPos = worldPos.xyz;
    gl_Position = projectionMatrix * viewMatrix * worldPos;
  }
`

const fragmentShader = /* glsl */ `
  uniform vec3 uZenith;
  uniform vec3 uHorizon;
  uniform vec3 uGround;
  uniform vec3 uSunColor;
  uniform vec3 uSunDir;
  varying vec3 vWorldPos;

  void main() {
    vec3 dir = normalize(vWorldPos - cameraPosition);
    float h = dir.y;

    float t = pow(clamp(h, 0.0, 1.0), 0.42);
    vec3 sky = mix(uHorizon, uZenith, t);

    float sunAmount = max(dot(dir, uSunDir), 0.0);
    sky += uSunColor * (pow(sunAmount, 1400.0) * 1.4 + pow(sunAmount, 10.0) * 0.16 + pow(sunAmount, 2.0) * 0.03);

    // Below the horizon fade towards the fog colour so the ground plane edge is hidden.
    vec3 below = mix(uHorizon, uGround, smoothstep(0.0, -0.12, h));
    vec3 color = h >= 0.0 ? sky : below;

    gl_FragColor = vec4(color, 1.0);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`

interface Props {
  sunDir: Vector3
  zenith: string
  horizon: string
  ground: string
}

export function SkyDome({ sunDir, zenith, horizon, ground }: Props) {
  const mesh = useRef<Mesh>(null)
  const material = useMemo(
    () =>
      new ShaderMaterial({
        vertexShader,
        fragmentShader,
        side: BackSide,
        depthWrite: false,
        depthTest: false,
        fog: false,
        uniforms: {
          uZenith: { value: new Color(zenith) },
          uHorizon: { value: new Color(horizon) },
          uGround: { value: new Color(ground) },
          uSunColor: { value: new Color('#fff4de') },
          uSunDir: { value: sunDir.clone().normalize() },
        },
      }),
    [sunDir, zenith, horizon, ground],
  )
  const geometry = useMemo(() => new SphereGeometry(1, 32, 16), [])

  // Keep the dome centred on the camera so it always reads as infinitely far away.
  useFrame(({ camera }) => {
    mesh.current?.position.copy(camera.position)
  })

  return <mesh ref={mesh} geometry={geometry} material={material} scale={250000} renderOrder={-10} frustumCulled={false} />
}

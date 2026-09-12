// GLSL for the fire module. The spread itself runs on the CPU (see FireSimulation.ts);
// these shaders only draw the result:
//   groundVertex / groundFragment – a sheet draped over the terrain height field that shows
//                                   scorch, embers and the glowing front
//   particleVertex + flameFragment / smokeFragment – one Points system each for flames and smoke,
//                                   animated entirely on the GPU from spawn position and birth time
//
// State texture layout (RGBA bytes, 0..1): r = burn intensity, g = char (fuel consumed),
//                                          b = fuel remaining, a = pre-heat ahead of the front
// Terrain texture layout (RGBA float):     r = ground height (m, local y)

const noiseChunk = /* glsl */ `
float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float noise(vec2 p) {
  vec2 i = floor(p); vec2 f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1, 0)), f.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), f.x), f.y);
}
`

export const groundVertex = /* glsl */ `
precision highp float;
#include <common>
#include <logdepthbuf_pars_vertex>
uniform sampler2D uTerrain;
uniform float uLift;
varying vec2 vUv;
varying vec3 vWorldPos;
void main() {
  vUv = uv;
  float T = texture2D(uTerrain, uv).r;
  vec4 world = modelMatrix * vec4(position.x, T + uLift, position.z, 1.0);
  vWorldPos = world.xyz;
  gl_Position = projectionMatrix * viewMatrix * world;
  #include <logdepthbuf_vertex>
}
`

export const groundFragment = /* glsl */ `
precision highp float;
#include <logdepthbuf_pars_fragment>
uniform sampler2D uState;
uniform float uTime;
uniform vec3 uCharColor;
uniform vec3 uEmberColor;
uniform vec3 uFlameColor;
varying vec2 vUv;
varying vec3 vWorldPos;
${noiseChunk}
void main() {
  #include <logdepthbuf_fragment>
  vec4 s = texture2D(uState, vUv);
  float intensity = s.r;
  float char = s.g;
  float preheat = s.a;
  float n = noise(vWorldPos.xz * 0.12);
  float n2 = noise(vWorldPos.xz * 0.45 + vec2(uTime * 0.8, -uTime * 0.5));

  // scorch darkens as fuel is consumed; the noise gives it a ragged edge
  float charA = smoothstep(0.05, 0.6, char * (0.75 + 0.5 * n)) * 0.88;

  // ember bed flickers while the cell burns, white-hot where intensity peaks
  float flicker = 0.7 + 0.3 * sin(uTime * 9.0 + n * 4.0 + n2 * 9.0);
  float glow = smoothstep(0.03, 0.7, intensity) * flicker;
  float hot = smoothstep(0.55, 1.0, intensity) * (0.4 + 0.6 * n2);
  vec3 color = mix(uCharColor, uEmberColor, glow);
  color = mix(color, uFlameColor, hot * glow);

  // fuel just ahead of the front warms up before it catches
  float lead = smoothstep(0.55, 1.0, preheat) * 0.35 * (0.6 + 0.4 * n2);
  color = mix(color, uEmberColor, lead);

  float alpha = max(max(charA, glow * 0.95), lead);
  if (alpha < 0.02) discard;
  gl_FragColor = vec4(color, alpha);
  #include <colorspace_fragment>
}
`

// `position` is the spawn point in the local frame. Motion is a function of age, so the
// CPU only touches a particle's attributes when it is (re)spawned.
export const particleVertex = /* glsl */ `
precision highp float;
#include <common>
#include <logdepthbuf_pars_vertex>
attribute float aBirth;
attribute float aLife;
attribute float aSeed;
attribute float aScale;
uniform float uTime;
uniform vec3 uWind;            // local m/s carried by this system
uniform float uRise;           // m/s upward
uniform float uSizeStart;      // metres
uniform float uSizeEnd;
uniform float uViewportHeight; // drawing buffer pixels
varying float vAge;
varying float vSeed;
void main() {
  float age = (uTime - aBirth) / max(aLife, 0.001);
  vAge = age;
  vSeed = aSeed;
  if (age < 0.0 || age > 1.0) {
    gl_Position = vec4(0.0, 0.0, 2.0, 1.0);
    gl_PointSize = 0.0;
    return;
  }
  float t = age * aLife;
  vec3 p = position + uWind * t + vec3(0.0, uRise * t, 0.0);
  float wobble = 1.0 + age * 3.0;
  p.x += sin(aSeed * 6.283 + t * 2.0) * wobble;
  p.z += cos(aSeed * 5.1 + t * 1.7) * wobble;
  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  float size = aScale * mix(uSizeStart, uSizeEnd, age);
  gl_PointSize = size * projectionMatrix[1][1] * uViewportHeight * 0.5 / max(-mv.z, 1.0);
  gl_Position = projectionMatrix * mv;
  #include <logdepthbuf_vertex>
}
`

export const flameFragment = /* glsl */ `
precision highp float;
#include <logdepthbuf_pars_fragment>
uniform vec3 uColorHot;
uniform vec3 uColorMid;
uniform vec3 uColorCool;
varying float vAge;
varying float vSeed;
void main() {
  #include <logdepthbuf_fragment>
  vec2 q = gl_PointCoord - 0.5;
  float d = length(q) * 2.0;
  if (d > 1.0) discard;
  float soft = smoothstep(1.0, 0.15, d);
  vec3 c = vAge < 0.35
    ? mix(uColorHot, uColorMid, vAge / 0.35)
    : mix(uColorMid, uColorCool, (vAge - 0.35) / 0.65);
  float a = soft * (1.0 - vAge) * (0.6 + 0.4 * sin(vSeed * 40.0 + vAge * 30.0));
  gl_FragColor = vec4(c, a);
  #include <colorspace_fragment>
}
`

export const smokeFragment = /* glsl */ `
precision highp float;
#include <logdepthbuf_pars_fragment>
uniform vec3 uColorYoung;
uniform vec3 uColorOld;
uniform float uOpacity;
varying float vAge;
varying float vSeed;
${noiseChunk}
void main() {
  #include <logdepthbuf_fragment>
  vec2 q = gl_PointCoord - 0.5;
  float d = length(q) * 2.0;
  if (d > 1.0) discard;
  float soft = smoothstep(1.0, 0.1, d);
  float n = noise(gl_PointCoord * 4.0 + vSeed * 13.0);
  vec3 c = mix(uColorYoung, uColorOld, smoothstep(0.0, 0.5, vAge));
  float a = soft * uOpacity * sin(3.14159 * vAge) * (0.6 + 0.6 * n);
  gl_FragColor = vec4(c, a);
  #include <colorspace_fragment>
}
`

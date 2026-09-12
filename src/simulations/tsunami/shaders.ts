// GLSL for the tsunami module. Three passes run on the GPU each substep:
//   1. velocityPass  – accelerate water down the surface gradient (terrain + depth)
//   2. heightPass    – move water between cells with upwind fluxes, apply the wave source
// plus the water surface shaders that draw the result, and a tiny shader used to
// sample any three.js object into a top-down height field.
//
// State texture layout (RGBA float), staggered grid:
//   r = water depth h (m) at the cell centre
//   g = u (m/s) on the cell's east face  (between this cell and the +uv.x neighbour)
//   b = v (m/s) on the cell's north face (between this cell and the +uv.y neighbour)
// Face velocities avoid the checkerboard instability of a collocated grid.
// Terrain texture layout (RGBA float): r = ground height (m, local y). Roofs are part of the ground.

export const fullscreenVertex = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}
`

export const copyFragment = /* glsl */ `
precision highp float;
uniform sampler2D uSource;
varying vec2 vUv;
void main() { gl_FragColor = texture2D(uSource, vUv); }
`

export const velocityFragment = /* glsl */ `
precision highp float;
uniform sampler2D uState;
uniform sampler2D uTerrain;
uniform vec2 uTexel;
uniform float uDt;
uniform float uDx;
uniform float uGravity;
uniform float uDrag;
uniform float uFriction;
uniform float uMaxSpeed;
varying vec2 vUv;
const float EPS = 0.01;
const float OVERTOP = 1.0;   // metres of surface above a dry cell's ground before water spills onto it

// Update the velocity on the face between cell A (this) and neighbour B in the +axis direction.
float faceVelocity(float vel, float ha, float Ta, float hb, float Tb, bool atEdge) {
  if (atEdge) return 0.0;                      // closed domain boundary
  if (ha < EPS && hb < EPS) return 0.0;        // both dry
  float etaA = Ta + ha;
  float etaB = Tb + hb;
  if (hb < EPS && Tb + OVERTOP > etaA) return 0.0;   // dry wall on the B side
  if (ha < EPS && Ta + OVERTOP > etaB) return 0.0;   // dry wall on the A side
  vel -= uDt * uGravity * (etaB - etaA) / uDx;
  float depth = max(0.5 * (ha + hb), 0.05);
  vel *= max(0.0, 1.0 - uDrag * uDt);
  vel /= 1.0 + uDt * uFriction * abs(vel) / depth;   // quadratic bed friction, strong when shallow
  return clamp(vel, -uMaxSpeed, uMaxSpeed);
}

void main() {
  vec4 c = texture2D(uState, vUv);
  float Tc = texture2D(uTerrain, vUv).r;
  vec2 uvR = vUv + vec2(uTexel.x, 0.0);
  vec2 uvU = vUv + vec2(0.0, uTexel.y);
  vec4 r = texture2D(uState, uvR); float Tr = texture2D(uTerrain, uvR).r;
  vec4 u = texture2D(uState, uvU); float Tu = texture2D(uTerrain, uvU).r;
  float newU = faceVelocity(c.g, c.r, Tc, r.r, Tr, uvR.x > 1.0);
  float newV = faceVelocity(c.b, c.r, Tc, u.r, Tu, uvU.y > 1.0);
  gl_FragColor = vec4(c.r, newU, newV, c.a);
}
`

export const heightFragment = /* glsl */ `
precision highp float;
uniform sampler2D uState;
uniform sampler2D uTerrain;
uniform vec2 uTexel;
uniform float uDt;
uniform float uDx;
uniform float uWaveLevel;   // absolute surface height forced in the source strip
uniform float uSourceEdge;  // 0 none, 1 west (uv.x=0), 2 east, 3 south (uv.y=0), 4 north
uniform float uSourceWidth; // strip width in uv units
uniform float uSourceSpeed; // inflow speed (m/s) in the strip, directed inland
uniform float uSeaLevel;
uniform float uSpongeWidth; // absorbing band along the non-source edges, in uv units
uniform float uDrain;       // m/s lost by thin water above sea level (drains, soaks in, runs off roofs)
varying vec2 vUv;

// Upwind flux through a face with velocity vf, depth ha on the - side and hb on the + side.
float flux(float vf, float ha, float hb) { return vf > 0.0 ? vf * ha : vf * hb; }

void main() {
  vec4 c = texture2D(uState, vUv);
  float Tc = texture2D(uTerrain, vUv).r;
  vec2 oX = vec2(uTexel.x, 0.0);
  vec2 oY = vec2(0.0, uTexel.y);
  vec4 l = texture2D(uState, vUv - oX);
  vec4 r = texture2D(uState, vUv + oX);
  vec4 d = texture2D(uState, vUv - oY);
  vec4 u = texture2D(uState, vUv + oY);

  float fR = flux(c.g, c.r, r.r);   // east face of this cell
  float fL = flux(l.g, l.r, c.r);   // east face of the left neighbour
  float fU = flux(c.b, c.r, u.r);
  float fD = flux(d.b, d.r, c.r);

  float h = c.r - uDt / uDx * (fR - fL + fU - fD);
  if (Tc > uSeaLevel + 0.2) h -= uDt * uDrain * (1.0 - smoothstep(0.0, 0.6, h));
  h = max(h, 0.0);
  vec2 vel = c.gb;

  // Wave source: a strip along one edge whose surface is forced to the wave level.
  bool inStrip = false;
  vec2 dir = vec2(0.0);
  if (uSourceEdge > 0.5 && uSourceEdge < 1.5) { inStrip = vUv.x < uSourceWidth;        dir = vec2( 1.0, 0.0); }
  if (uSourceEdge > 1.5 && uSourceEdge < 2.5) { inStrip = vUv.x > 1.0 - uSourceWidth;  dir = vec2(-1.0, 0.0); }
  if (uSourceEdge > 2.5 && uSourceEdge < 3.5) { inStrip = vUv.y < uSourceWidth;        dir = vec2(0.0,  1.0); }
  if (uSourceEdge > 3.5)                       { inStrip = vUv.y > 1.0 - uSourceWidth;  dir = vec2(0.0, -1.0); }
  if (inStrip) {
    h = max(0.0, uWaveLevel - Tc);
    vel = dir * uSourceSpeed;
  } else if (uSpongeWidth > 0.0) {
    // Absorbing boundary: relax toward the calm state near the other three edges so the
    // wave flows out of the patch instead of reflecting and piling up in the corners.
    float dEdge = 1.0;
    if (uSourceEdge < 0.5 || uSourceEdge > 1.5) dEdge = min(dEdge, vUv.x);
    if (uSourceEdge < 1.5 || uSourceEdge > 2.5) dEdge = min(dEdge, 1.0 - vUv.x);
    if (uSourceEdge < 2.5 || uSourceEdge > 3.5) dEdge = min(dEdge, vUv.y);
    if (uSourceEdge < 3.5)                      dEdge = min(dEdge, 1.0 - vUv.y);
    float k = 1.0 - smoothstep(0.0, uSpongeWidth, dEdge);   // 1 at the edge, 0 inside
    k = k * k * 0.25;
    float calm = max(0.0, uSeaLevel - Tc);
    h = mix(h, calm, k);
    vel *= 1.0 - k;
  }
  gl_FragColor = vec4(h, vel, c.a);
}
`

export const surfaceVertex = /* glsl */ `
precision highp float;
uniform sampler2D uState;
uniform sampler2D uTerrain;
uniform vec2 uTexel;
uniform float uDx;
uniform float uSeaLevel;
varying vec3 vWorldPos;
varying vec3 vNormal;
varying float vDepth;
varying float vSpeed;
varying float vGround;
const float EPS = 0.02;

float wetSurface(vec2 uv, float fallback) {
  vec4 s = texture2D(uState, uv);
  if (s.r < EPS) return fallback;
  return texture2D(uTerrain, uv).r + s.r;
}

void main() {
  vec4 s = texture2D(uState, uv);
  float T = texture2D(uTerrain, uv).r;
  float h = s.r;
  float eta = T + h;
  // cell-centre velocity: average of the two faces on each axis
  vec2 vel = 0.5 * (s.gb + vec2(texture2D(uState, uv - vec2(uTexel.x, 0.0)).g,
                                texture2D(uState, uv - vec2(0.0, uTexel.y)).b));
  vGround = T;

  if (h < EPS) {
    // Dry vertex: borrow the lowest wet neighbour so the sheet tucks under building
    // walls and the shoreline instead of climbing them. Fully dry areas sink underground.
    float best = 1e9; float bd = 0.0; vec2 bv = vec2(0.0);
    vec2 offs[4];
    offs[0] = vec2(uTexel.x, 0.0); offs[1] = vec2(-uTexel.x, 0.0);
    offs[2] = vec2(0.0, uTexel.y); offs[3] = vec2(0.0, -uTexel.y);
    for (int i = 0; i < 4; i++) {
      vec4 n = texture2D(uState, uv + offs[i]);
      if (n.r >= EPS) {
        float e = texture2D(uTerrain, uv + offs[i]).r + n.r;
        if (e < best) { best = e; bd = n.r; bv = n.gb; }
      }
    }
    if (best < 1e8) { eta = best; h = bd; vel = bv; }
    else { eta = min(T, uSeaLevel) - 3.0; h = 0.0; }
  }

  float eL = wetSurface(uv - vec2(uTexel.x, 0.0), eta);
  float eR = wetSurface(uv + vec2(uTexel.x, 0.0), eta);
  float eD = wetSurface(uv - vec2(0.0, uTexel.y), eta);
  float eU = wetSurface(uv + vec2(0.0, uTexel.y), eta);
  // uv.y runs toward -z, hence the sign on the second slope term
  vec3 n = normalize(vec3(-(eR - eL) / (2.0 * uDx), 1.0, (eU - eD) / (2.0 * uDx)));

  vec3 local = vec3(position.x, eta, position.z);
  vec4 world = modelMatrix * vec4(local, 1.0);
  vWorldPos = world.xyz;
  vNormal = normalize(mat3(modelMatrix) * n);
  vDepth = h;
  vSpeed = length(vel);
  gl_Position = projectionMatrix * viewMatrix * world;
}
`

export const surfaceFragment = /* glsl */ `
precision highp float;
uniform vec3 uSunDir;
uniform vec3 uShallowColor;
uniform vec3 uDeepColor;
uniform vec3 uMudColor;
uniform vec3 uFoamColor;
uniform float uSeaLevel;
uniform float uTime;
varying vec3 vWorldPos;
varying vec3 vNormal;
varying float vDepth;
varying float vSpeed;
varying float vGround;

float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float noise(vec2 p) {
  vec2 i = floor(p); vec2 f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1, 0)), f.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), f.x), f.y);
}

void main() {
  if (vDepth < 0.005) discard;
  vec3 n = normalize(vNormal);
  vec3 v = normalize(cameraPosition - vWorldPos);
  vec3 l = normalize(uSunDir);

  float deep = smoothstep(0.0, 6.0, vDepth);
  vec3 base = mix(uShallowColor, uDeepColor, deep);
  // inundation water is muddy: tint where it sits over land or moves fast
  float inland = smoothstep(uSeaLevel - 0.5, uSeaLevel + 1.5, vGround);
  float churn = smoothstep(3.0, 8.0, vSpeed);
  base = mix(base, uMudColor, clamp(inland * 0.55 + churn * 0.3, 0.0, 0.8));

  float diff = 0.35 + 0.65 * max(dot(n, l), 0.0);
  vec3 hv = normalize(l + v);
  float spec = pow(max(dot(n, hv), 0.0), 90.0) * 0.6;
  float fresnel = pow(1.0 - max(dot(n, v), 0.0), 3.0);

  // Foam where the flow is breaking (Froude number near or above 1) and along the thin leading edge
  float froude = vSpeed / sqrt(9.81 * max(vDepth, 0.05));
  float nz = noise(vWorldPos.xz * 0.25 + vec2(uTime * 0.5, -uTime * 0.35));
  float foam = smoothstep(0.7, 1.6, froude) * 0.9 + smoothstep(0.35, 0.0, vDepth) * inland * 0.7;
  foam = clamp(foam * (0.5 + 0.9 * nz), 0.0, 1.0);

  vec3 color = base * diff + spec + fresnel * 0.15;
  color = mix(color, uFoamColor, foam);
  float alpha = mix(0.45, 0.9, deep) + foam * 0.3 + fresnel * 0.2;
  gl_FragColor = vec4(color, clamp(alpha, 0.0, 0.96));
  #include <colorspace_fragment>
}
`

// Renders local-frame height (y) of whatever geometry is drawn, alpha = 1 marks a hit.
export const heightSampleVertex = /* glsl */ `
uniform mat4 uInvFrame;
varying float vH;
void main() {
  vec4 p = vec4(position, 1.0);
  #ifdef USE_INSTANCING
    p = instanceMatrix * p;
  #endif
  vec4 world = modelMatrix * p;
  vH = (uInvFrame * world).y;
  gl_Position = projectionMatrix * viewMatrix * world;
}
`

export const heightSampleFragment = /* glsl */ `
precision highp float;
varying float vH;
void main() { gl_FragColor = vec4(vH, 0.0, 0.0, 1.0); }
`

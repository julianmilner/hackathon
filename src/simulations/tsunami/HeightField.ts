import {
  Color,
  Material,
  Matrix4,
  Mesh,
  NearestFilter,
  Object3D,
  OrthographicCamera,
  RGBAFormat,
  FloatType,
  ShaderMaterial,
  Vector3,
  WebGLRenderer,
  WebGLRenderTarget,
} from 'three'
import { heightSampleFragment, heightSampleVertex } from './shaders'

export interface HeightFieldOptions {
  /** Side length of the square sample area in metres (local frame). */
  size: number
  /** Cells per side. */
  resolution: number
  /** Highest / lowest local height that can be captured. */
  maxHeight?: number
  minHeight?: number
  /** Calm sea surface height in the local frame. */
  seaLevel: number
  /** Depth assigned to sea cells so there is water volume to move. */
  seaDepth: number
  /**
   * 'flat'  – any cell without geometry, or with geometry within `shoreTolerance` of the sea
   *           level or below it, becomes a flat sea floor at seaLevel - seaDepth. Use this for
   *           the Google mesh, which has a water surface but no sea floor.
   * 'keep'  – keep sampled heights; only cells without geometry become sea floor.
   */
  seaFloor?: 'flat' | 'keep'
  shoreTolerance?: number
}

export interface HeightField {
  resolution: number
  size: number
  /** resolution*resolution heights, row-major with row 0 at uv.y = 0 (+z / south edge). */
  heights: Float32Array
  /** 1 where geometry was hit, 0 where the sea floor was substituted. */
  hits: Uint8Array
  min: number
  max: number
}

/**
 * Sample `target` into a top-down height field expressed in the local frame `frame`
 * (a matrix mapping local x-east / y-up / z-south metres to world). Works on any three.js
 * object, including a streamed 3D Tiles group, by temporarily swapping every mesh material
 * for a shader that writes local height. Call it once the tiles you care about are loaded.
 */
export function sampleHeightField(
  renderer: WebGLRenderer,
  target: Object3D,
  frame: Matrix4,
  options: HeightFieldOptions,
): HeightField {
  const {
    size,
    resolution,
    maxHeight = 600,
    minHeight = -200,
    seaLevel,
    seaDepth,
    seaFloor = 'flat',
    shoreTolerance = 1.5,
  } = options

  const rt = new WebGLRenderTarget(resolution, resolution, {
    type: FloatType,
    format: RGBAFormat,
    minFilter: NearestFilter,
    magFilter: NearestFilter,
    depthBuffer: true,
    stencilBuffer: false,
  })

  const invFrame = new Matrix4().copy(frame).invert()
  const material = new ShaderMaterial({
    vertexShader: heightSampleVertex,
    fragmentShader: heightSampleFragment,
    uniforms: { uInvFrame: { value: invFrame } },
  })

  // Orthographic camera looking down local -y with screen-up = local -z,
  // so pixel column 0 is x = -size/2 and pixel row 0 is z = +size/2.
  const half = size / 2
  const camera = new OrthographicCamera(-half, half, half, -half, 1, maxHeight - minHeight + 2)
  const camLocal = new Matrix4().lookAt(
    new Vector3(0, maxHeight + 1, 0),
    new Vector3(0, 0, 0),
    new Vector3(0, 0, -1),
  )
  camLocal.setPosition(0, maxHeight + 1, 0)
  camera.matrixAutoUpdate = false
  camera.matrixWorldAutoUpdate = false
  camera.matrixWorld.multiplyMatrices(frame, camLocal)
  camera.matrixWorldInverse.copy(camera.matrixWorld).invert()
  camera.updateProjectionMatrix()

  const saved = new Map<Mesh, Material | Material[]>()
  target.updateMatrixWorld(true)
  target.traverse((o) => {
    const m = o as Mesh
    if (m.isMesh) {
      saved.set(m, m.material)
      m.material = material
    }
  })

  const prevTarget = renderer.getRenderTarget()
  const prevAutoClear = renderer.autoClear
  const prevClearAlpha = renderer.getClearAlpha()
  const prevClearColor = renderer.getClearColor(new Color())

  renderer.setRenderTarget(rt)
  renderer.setClearColor(0x000000, 0)
  renderer.autoClear = true
  renderer.clear()
  renderer.render(target, camera)

  const pixels = new Float32Array(resolution * resolution * 4)
  renderer.readRenderTargetPixels(rt, 0, 0, resolution, resolution, pixels)

  renderer.setRenderTarget(prevTarget)
  renderer.setClearColor(prevClearColor, prevClearAlpha)
  renderer.autoClear = prevAutoClear
  saved.forEach((mat, mesh) => (mesh.material = mat))
  material.dispose()
  rt.dispose()

  const heights = new Float32Array(resolution * resolution)
  const hits = new Uint8Array(resolution * resolution)
  const floor = seaLevel - seaDepth
  let min = Infinity
  let max = -Infinity
  for (let i = 0; i < heights.length; i++) {
    const hit = pixels[i * 4 + 3] > 0.5
    let h = hit ? pixels[i * 4] : floor
    if (hit && seaFloor === 'flat' && h < seaLevel + shoreTolerance) h = floor
    heights[i] = h
    hits[i] = hit ? 1 : 0
    if (h < min) min = h
    if (h > max) max = h
  }
  return { resolution, size, heights, hits, min, max }
}

/** Build a height field from a function of local (x, z) metres. Useful for tests and sandboxes. */
export function heightFieldFromFunction(
  size: number,
  resolution: number,
  fn: (x: number, z: number) => number,
): HeightField {
  const heights = new Float32Array(resolution * resolution)
  const hits = new Uint8Array(resolution * resolution).fill(1)
  let min = Infinity
  let max = -Infinity
  for (let j = 0; j < resolution; j++) {
    for (let i = 0; i < resolution; i++) {
      const x = ((i + 0.5) / resolution - 0.5) * size
      const z = (0.5 - (j + 0.5) / resolution) * size
      const h = fn(x, z)
      heights[j * resolution + i] = h
      if (h < min) min = h
      if (h > max) max = h
    }
  }
  return { resolution, size, heights, hits, min, max }
}

import { useEffect, useRef } from 'react'
import { useThree } from '@react-three/fiber'
import { Group, LinearMipmapLinearFilter, Mesh, MeshStandardMaterial, SRGBColorSpace, Texture, TextureLoader } from 'three'
import { CONTEXT_LEVEL, DETAIL_BLOCK, imageryTileUrl, OUTER_DEM, OUTER_RING, REGION, RING_BLOCK, TILE_CONCURRENCY } from '../../config'
import { childTiles, type TileId } from '../../geo'
import { loadHeightField, type HeightField } from './heightfield'
import { runPool } from './pool'
import { buildTileGeometry, landFraction } from './tileGeometry'

interface Props {
  onHeightField: (hf: HeightField) => void
  onProgress: (loaded: number, total: number) => void
  // Fires once the whole region is covered at coarse resolution: safe to start the intro.
  onCoreReady: () => void
  onReady: () => void
}

interface Job {
  tile: TileId
  segments: number
  // Which height field this tile drapes over.
  dem: 'inner' | 'outer'
  // For high-detail children: the zoom-12 parent they replace once all siblings are in.
  parentKey: string | null
  // For coarse stand-ins over the detail blocks: retired when their children arrive.
  placeholderKey: string | null
}

interface Placeholder {
  mesh: Mesh | null
  remaining: number
  retired: boolean
  // Some children were skipped as open water, so this stand-in stays to show the sea.
  keep: boolean
}

interface Block {
  x0: number
  x1: number
  y0: number
  y1: number
  imageryZoom: number
  segments: number
}

const key = (t: TileId) => `${t.x}/${t.y}`

function inBlock(block: Block, x: number, y: number) {
  return x >= block.x0 && x <= block.x1 && y >= block.y0 && y <= block.y1
}

function blockFor(x: number, y: number): Block | null {
  return inBlock(DETAIL_BLOCK, x, y) ? DETAIL_BLOCK : inBlock(RING_BLOCK, x, y) ? RING_BLOCK : null
}

// Coarse first pass: zoom-12 stand-ins over the city, the rest of the region at zoom 12,
// and the far zoom-11 ring. Everything needed for the intro view.
function planCoarse(): Job[] {
  const placeholders: Job[] = []
  const context: Job[] = []
  for (let y = REGION.y0; y <= REGION.y1; y++) {
    for (let x = REGION.x0; x <= REGION.x1; x++) {
      const tile: TileId = { z: REGION.z, x, y }
      if (blockFor(x, y)) {
        placeholders.push({ tile, segments: CONTEXT_LEVEL.segments, dem: 'inner', parentKey: null, placeholderKey: key(tile) })
      } else {
        context.push({ tile, segments: CONTEXT_LEVEL.segments, dem: 'inner', parentKey: null, placeholderKey: null })
      }
    }
  }
  const outer: Job[] = []
  const innerX0 = REGION.x0 >> 1
  const innerX1 = REGION.x1 >> 1
  const innerY0 = REGION.y0 >> 1
  const innerY1 = REGION.y1 >> 1
  for (let y = OUTER_RING.y0; y <= OUTER_RING.y1; y++) {
    for (let x = OUTER_RING.x0; x <= OUTER_RING.x1; x++) {
      if (x >= innerX0 && x <= innerX1 && y >= innerY0 && y <= innerY1) continue
      outer.push({ tile: { z: OUTER_RING.z, x, y }, segments: OUTER_RING.segments, dem: 'outer', parentKey: null, placeholderKey: null })
    }
  }
  return [...placeholders, ...context, ...outer]
}

// Detail pass, planned once elevation is known so tiles over open water can be skipped:
// the City Bowl at zoom 15, then the surrounding suburbs at zoom 14.
function planDetail(hf: HeightField, placeholders: Map<string, Placeholder>): Job[] {
  const detail: Job[] = []
  const ring: Job[] = []
  for (let y = REGION.y0; y <= REGION.y1; y++) {
    for (let x = REGION.x0; x <= REGION.x1; x++) {
      const block = blockFor(x, y)
      if (!block) continue
      const parent: TileId = { z: REGION.z, x, y }
      const target = block === DETAIL_BLOCK ? detail : ring
      const placeholder = placeholders.get(key(parent))
      for (const tile of childTiles(parent, block.imageryZoom)) {
        if (landFraction(hf, tile) === 0) {
          if (placeholder) placeholder.keep = true
          continue
        }
        if (placeholder) placeholder.remaining++
        target.push({ tile, segments: block.segments, dem: 'inner', parentKey: key(parent), placeholderKey: null })
      }
    }
  }
  return [...detail, ...ring]
}

export function TerrainLayer({ onHeightField, onProgress, onCoreReady, onReady }: Props) {
  const group = useRef<Group>(null)
  const gl = useThree((s) => s.gl)

  useEffect(() => {
    const root = group.current
    if (!root) return
    let cancelled = false
    const started = performance.now()
    const elapsed = () => `${((performance.now() - started) / 1000).toFixed(1)}s`
    const meshes = new Set<Mesh>()
    const loader = new TextureLoader()
    const anisotropy = gl.capabilities.getMaxAnisotropy()

    const coarse = planCoarse()
    const innerDemTiles = (REGION.x1 - REGION.x0 + 1) * (REGION.y1 - REGION.y0 + 1)
    const outerDemTiles = (OUTER_DEM.x1 - OUTER_DEM.x0 + 1) * (OUTER_DEM.y1 - OUTER_DEM.y0 + 1)
    // Detail tile count is only known after elevation loads; start with the upper bound.
    let total = innerDemTiles + outerDemTiles + coarse.length + 4 * 64 + 12 * 16
    let loaded = 0
    const tick = () => {
      loaded++
      if (!cancelled) onProgress(loaded, total)
    }

    const placeholders = new Map<string, Placeholder>()
    for (const job of coarse) {
      if (job.placeholderKey) placeholders.set(job.placeholderKey, { mesh: null, remaining: 0, retired: false, keep: false })
    }

    const disposeMesh = (mesh: Mesh) => {
      root.remove(mesh)
      meshes.delete(mesh)
      mesh.geometry.dispose()
      const material = mesh.material as MeshStandardMaterial
      material.map?.dispose()
      material.dispose()
    }

    const addMesh = (job: Job, texture: Texture, hf: HeightField) => {
      const placeholder = job.placeholderKey ? placeholders.get(job.placeholderKey) : null
      if (placeholder?.retired) {
        texture.dispose()
        return
      }
      texture.colorSpace = SRGBColorSpace
      texture.anisotropy = anisotropy
      texture.minFilter = LinearMipmapLinearFilter
      texture.generateMipmaps = true

      const mesh = new Mesh(buildTileGeometry(hf, job.tile, job.segments), new MeshStandardMaterial({ map: texture, roughness: 1, metalness: 0 }))
      if (placeholder) {
        // Sit just under the detail tiles that will replace this one so they win the depth test.
        mesh.position.y = -2
        placeholder.mesh = mesh
      }
      mesh.updateMatrix()
      mesh.matrixAutoUpdate = false
      meshes.add(mesh)
      root.add(mesh)
    }

    const childArrived = (job: Job) => {
      if (!job.parentKey) return
      const p = placeholders.get(job.parentKey)
      if (p && --p.remaining === 0 && !p.keep) {
        p.retired = true
        if (p.mesh) disposeMesh(p.mesh)
      }
    }

    // Elevation streams from a different host, so it overlaps with the imagery downloads.
    const innerHf = loadHeightField(REGION.z, REGION.x0, REGION.x1, REGION.y0, REGION.y1, tick)
    const outerHf = loadHeightField(OUTER_DEM.z, OUTER_DEM.x0, OUTER_DEM.x1, OUTER_DEM.y0, OUTER_DEM.y1, tick)
    innerHf.then((hf) => {
      if (!cancelled) {
        console.info(`[terrain] elevation ready in ${elapsed()}`)
        onHeightField(hf)
      }
    })

    // Downloads run through the pool; mesh building is chained separately so a slot frees the
    // moment the bytes arrive rather than waiting for elevation.
    const runPass = async (jobs: Job[]) => {
      const builds: Promise<void>[] = []
      await runPool(
        jobs.map((job) => async () => {
          let texture: Texture | null = null
          try {
            texture = await loader.loadAsync(imageryTileUrl(job.tile.z, job.tile.x, job.tile.y))
          } catch (err) {
            console.warn(`Imagery tile ${job.tile.z}/${job.tile.x}/${job.tile.y} failed`, err)
          }
          builds.push(
            (job.dem === 'inner' ? innerHf : outerHf)
              .then((hf) => {
                if (cancelled || !texture) {
                  texture?.dispose()
                  return
                }
                addMesh(job, texture, hf)
                childArrived(job)
              })
              .catch((err) => console.warn('Tile build failed', err))
              .finally(tick),
          )
        }),
        TILE_CONCURRENCY,
      )
      await Promise.all(builds)
    }

    const run = async () => {
      await runPass(coarse)
      if (cancelled) return
      console.info(`[terrain] coarse pass ready in ${elapsed()}`)
      onCoreReady()

      const hf = await innerHf
      const detail = planDetail(hf, placeholders)
      total = innerDemTiles + outerDemTiles + coarse.length + detail.length
      onProgress(loaded, total)
      await runPass(detail)
      if (cancelled) return
      console.info(`[terrain] all ${coarse.length + detail.length} imagery tiles ready in ${elapsed()}`)
      onReady()
    }
    run().catch((err) => console.error('Terrain load failed', err))

    return () => {
      cancelled = true
      for (const mesh of Array.from(meshes)) disposeMesh(mesh)
    }
  }, [gl, onHeightField, onProgress, onCoreReady, onReady])

  return <group ref={group} />
}

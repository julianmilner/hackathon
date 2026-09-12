// Runtime configuration for the city renderers.

export const GOOGLE_TILES_KEY: string = import.meta.env.VITE_GOOGLE_MAPS_TILES_KEY ?? ''

// Free, keyless sources for the terrain preview.
// Elevation: Mapzen Terrarium tiles hosted on AWS Open Data (SRTM-derived). S3 speaks
// HTTP/1.1 only, so alternating between its two hostnames doubles the connection budget.
const TERRAIN_HOSTS = ['s3.amazonaws.com/elevation-tiles-prod', 'elevation-tiles-prod.s3.amazonaws.com']
export const terrainTileUrl = (z: number, x: number, y: number) =>
  `https://${TERRAIN_HOSTS[(x + y) & 1]}/terrarium/${z}/${x}/${y}.png`

// Imagery: Esri World Imagery. Attribution is shown in the HUD. Both hostnames serve the
// same tiles over HTTP/1.1, so alternating between them doubles the browser's connection budget.
const IMAGERY_HOSTS = ['server.arcgisonline.com', 'services.arcgisonline.com']
export const imageryTileUrl = (z: number, x: number, y: number) =>
  `https://${IMAGERY_HOSTS[(x + y) & 1]}/ArcGIS/rest/services/World_Imagery/MapServer/tile/${z}/${y}/${x}`

// The terrain preview covers this block of zoom-12 tiles: roughly Atlantis in the north to
// Cape Point in the south, and the Atlantic to Stellenbosch. Elevation is fetched at zoom 12
// for the whole block. The block is aligned to zoom-11 tile edges so the outer ring fits.
export const REGION = { z: 12, x0: 2256, x1: 2265, y0: 2454, y1: 2465 }

// A coarse far ring of zoom-11 imagery (about 180 km by 190 km) around REGION so wide views
// fade into haze instead of ending at a hard edge. Tiles inside REGION are skipped.
export const OUTER_RING = { z: 11, x0: 1125, x1: 1135, y0: 1224, y1: 1235, segments: 128 }
// Elevation for the ring, at zoom 10 (about 130 m per pixel, plenty at that distance).
export const OUTER_DEM = { z: 10, x0: 562, x1: 567, y0: 612, y1: 617 }

// Imagery detail levels, expressed as blocks of zoom-12 parent tiles.
// Detail: City Bowl, Atlantic Seaboard, Table Mountain, Southern Suburbs start.
export const DETAIL_BLOCK = { x0: 2257, x1: 2258, y0: 2458, y1: 2459, imageryZoom: 15, segments: 32 }
// Ring: the surrounding suburbs, Table Bay, Hout Bay and the Cape Flats edge.
export const RING_BLOCK = { x0: 2256, x1: 2259, y0: 2457, y1: 2460, imageryZoom: 14, segments: 64 }
// Everything else in REGION.
export const CONTEXT_LEVEL = { imageryZoom: 12, segments: 128 }

export const TILE_CONCURRENCY = 12

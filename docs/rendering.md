# Rendering the city

Notes behind the 2026-09-12 decision to render Cape Town with three.js, NASA's 3DTilesRendererJS and Google Photorealistic 3D Tiles. Read this before touching the map layer.

## What we get

- The same textured photogrammetry mesh as Google Earth, streamed as 3D Tiles into an ordinary three.js scene.
- At street level you can recognise individual houses, roofs, pools, the City Bowl, the V&A Waterfront and the Bo-Kaap.
- Space-to-street navigation through the library's globe controls, and full freedom to add custom meshes, shaders, particles and post-processing for simulations.
- react-three-fiber components, so it fits the existing Vite and React starter.
- Coverage of Cape Town is near certain (Google's own South Africa showcase flies into Cape Town), but Google only publishes a searchable coverage map. Confirm by searching "Cape Town" at https://developers.google.com/maps/documentation/javascript/3d/coverage before building on it.

## Why three.js and not the alternatives

One rendering engine only. Every option below has its own camera and coordinate system, and combining two is where hackathon weekends go to die.

| Option | Recognisable houses | Custom simulations | Verdict |
|---|---|---|---|
| three.js + 3DTilesRendererJS | Yes, Google mesh | Yes, raw three.js scene | Chosen |
| CesiumJS | Yes, Google mesh in one call | Constrained to Cesium's shader and primitive system; running three.js alongside means syncing two cameras | Rejected |
| MapLibre + deck.gl | Yes via deck.gl overlay | Custom deck.gl layers, two engines glued together | Rejected |
| MapLibre alone, Mapbox 3D, Cesium OSM Buildings | No, grey extruded boxes | Limited | Rejected |
| leafmap (Python) | No, MapLibre extrusions under the hood; exports a finished HTML page | None; no three.js at all | Data preparation only |
| City of Cape Town open data | Aerial imagery, LiDAR and footprints but no textured mesh | n/a | Data source only |
| Self-made Gaussian splats | One street as a stunt, not a city | n/a | Rejected |

## How to load it

```bash
npm install three 3d-tiles-renderer @react-three/fiber
```

The library ships a `GoogleCloudAuthPlugin` that takes a Google Map Tiles API key, `GlobeControls` for navigation, and an attribution overlay. The react-three-fiber README in the repo has a complete Google Photorealistic example; start from that rather than the vanilla example.

- Enable the **Map Tiles API** on a Google Cloud project and create an API key restricted to `localhost`.
- Put the key in `.env.local` as `VITE_GOOGLE_MAPS_TILES_KEY`. Never commit it.
- The key's *website restriction* must list `http://localhost:5173/*` (and any other origin the demo runs from). Google checks the referrer before anything else, so a key restricted to a different site answers HTTP 403 `API_KEY_HTTP_REFERRER_BLOCKED` even when the Map Tiles API is enabled. Port wildcards such as `http://localhost:*/*` are accepted when saving the key but never match, so list each port explicitly. You can check a key from the terminal with `curl -H "Referer: http://localhost:5173/" "https://tile.googleapis.com/v1/3dtiles/root.json?key=..."`.

The implementation lives in `src/scene/google/GoogleCity.tsx`: `TilesRenderer` with the `GoogleCloudAuthPlugin` (from `3d-tiles-renderer/core/plugins`), `GLTFExtensionsPlugin` with a DRACO decoder from Google's CDN, `TileCompressionPlugin`, `UpdateOnChangePlugin`, `TilesFadePlugin`, `GlobeControls` and the attribution overlay. The camera is placed with `ellipsoid.getObjectFrame(..., CAMERA_FRAME)` from lat/lon poses in `src/viewpoints.ts`, and flights interpolate lat, lon, height, azimuth and elevation. A root-tileset `load-error` hands over to the terrain preview.

## Cost

- Google bills per root tileset request, not per tile. One root request allows at least three hours of tile streaming.
- Free tier: 1,000 root tileset requests per month. Tile requests and session tokens do not count against quota.
- A weekend of building and demoing will not leave the free tier.

## Constraints and gotchas

- **Earth-centred coordinates.** The mesh arrives in ECEF coordinates, so Cape Town sits on a curved surface thousands of kilometres from the origin. Place every custom object with the library's lat/lon helpers, never with raw x, y, z. This is the gotcha that bites people on day one.
- **Precision jitter.** Because of the origin distance you can see jitter at street level. Use the library's reframing helpers from the start.
- **Attribution.** Google attribution must remain visible. Use the library's attribution overlay; do not hide it.
- **No offline caching.** Tiles cannot be stored or served from disk. The demo needs a live connection.
- **Overlays.** Do not paint imagery over the mesh that hides it. Transparent heatmaps, rings, pins, lines and water surfaces are fine.
- **One mesh, not buildings.** Clicking returns a lat/lon on the surface, not a building. Use OpenStreetMap (Overpass) or a reverse geocoder for the address and footprint.
- **Quality varies by suburb.** City Bowl, Atlantic Seaboard, Southern Suburbs and the CBD are sharp. Informal settlements and the outskirts can be lower resolution or flatter. Test the Cape Flats pins early and choose demo pins in well-covered areas.
- **Performance.** Heavy geometry, and every simulation effect adds draw calls. Fine on a MacBook with a good connection, stutters on hotel Wi-Fi. Pre-fly demo pins so tiles are cached in memory, and record a fallback video.

## Simulations

Aim for convincing, not physically exact. The model chooses the parameters from real data; the shaders do the visuals.

### Tsunami (standalone module built 2026-09-12)

Lives in `src/simulations/tsunami/`, sandbox at `/tsunami.html`, details in its `README.md`. Both
agreed stages are implemented in one GPU shallow-water simulation rather than a separate sheet
shader: a staggered-grid solver (velocity pass plus height pass on ping-pong float render targets)
over a height field sampled top-down from whatever is in the scene. Roofs are tall cells, so the
water funnels up streets, wraps corners and pools behind buildings. The wave is forced along one
edge with a model-chosen profile (drawback, rise, hold, decay); the other edges absorb.

The water surface is one vertex per cell, depth-tested against the city mesh, coloured by depth,
muddy over land, with Froude-number foam at the breaking front. Dry vertices next to wet ones
borrow the water level so the sheet tucks under building walls. Thin water above sea level drains
slowly so the flood recedes.

Run in the browser, not baked in Blender: the flow depends on the streamed Google mesh, which only
exists at runtime on the client, and the model chooses the wave parameters per pin.

- **Fynbos.** `tools/blender/fynbos.py` generates low-poly proteas, restios and ericas plus a charred
  remnant of each (800 triangles for all six) into `public/models/fynbos.glb`. `Fynbos.ts` scatters
  them as instanced meshes over the fuel cells, scaled up so they read from the demo distance. Each
  instance samples the fire state texture in its vertex shader: the live plant wilts and collapses
  as its cell chars, the remnant grows in its place, and both glow with embers while the cell is
  alight. One draw call per variant, so 30k plants cost almost nothing.

Integration to do: place the group with the tiles' ENU helper, set `seaLevel` to the local
ellipsoid height of the sea (about 30 m at Cape Town), sample terrain after the tiles have loaded.
Not done: debris and floating objects, damage tint on the inundated mesh.

### Earthquake

Camera shake plus a ground-crack shader. Do not simulate buildings collapsing.

### Fire (standalone module built 2026-09-12)

Lives in `src/simulations/fire/`, sandbox at `/fire.html`. Same module shape as the tsunami: a
`FireSimulation` class owning a group in a local east-north-up frame, `sampleTerrain()` using the
shared height-field sampler, `ignite()` with model-chosen parameters, `update(dt)` each frame.

- **Spread** is a cellular automaton on the CPU over the same 256 by 256 height field. Each burning
  cell heats its eight neighbours at a rate that grows exponentially with wind alignment and
  uphill slope; a cell catches when accumulated heat passes a randomised threshold. Embers spot
  ahead of the front above 5 m/s. Fuel comes from height and slope (nothing below `fuelMinHeight`,
  bare rock on steep cells) and can be overridden per cell. CPU rather than GPU because 65k cells
  is trivial and the verdict can read `arrivalTime(x, z)` for the pin directly.
- **Visuals** are a scorch and ember sheet draped over the height field (char darkens as fuel is
  consumed, the front glows and flickers, fuel just ahead warms up), two GPU point-sprite systems
  for flames and wind-carried smoke, and a flickering point light over the fire.
- **Model parameters:** ignition point, wind direction and speed, humidity. The default scenario is
  the April 2021 Rhodes Memorial fire with a north-westerly berg wind.

Integration to do: place the group with the tiles' ENU helper, sample terrain after the tiles
have loaded at high detail, set `fuelMinHeight` to the contour where the suburb ends. Optional
polish is injecting the same scorch lookup into the tile materials so char sits on the photoreal
texture instead of a draped sheet.

### Kaiju (Claude-themed; standalone module built 2026-09-12)

Lives in `src/simulations/kaiju/`, sandbox at `/kaiju.html`. A second beat after the tsunami:
while the water holds, a comically large three-hundred-metre kaiju in the Claude palette (Claude-mascot face with big dark eyes and a smile, terracotta hide,
cream belly, glowing cream plates and a glowing Claude starburst on its chest) surfaces in False Bay,
wades ashore on the same height field the tsunami sampled, and smashes the pinned house. In the
sandbox, "Tsunami, then kaiju" plays the whole sequence on the stand-in city.

- **Model.** Generated entirely by `tools/blender/kaiju.py` and committed as
  `public/models/kaiju.glb` (about 0.5 MB, 5k vertices, 25 bones). Six in-place clips: Idle, Walk,
  Rise, Attack, Roar, Stomp. Clip table, rebuild command and a contact sheet of preview renders in
  `tools/blender/kaiju.md`.
- **Code.** `KaijuBehaviour` is a renderer-free state machine (hidden, rising, walking, attacking,
  roaring, stomping, idle, retreating, submerging) that owns clip timing and emits footstep, hit
  and roar events. `KaijuActor` follows the module contract: a group in the local frame,
  `sampleTerrain()` or `setTerrain(tsunami.terrain)`, `rise(target)` as the trigger, `update(dt)`,
  `reset()`, `dispose()`. It loads the GLB, crossfades clips, follows the terrain, draws splash and
  dust rings and pulses the glow on a roar. `<Kaiju />` is the react-three-fiber wrapper.
- **Integration to do.** Place the group with the tiles' ENU helper, share the tsunami's height
  field, call `rise(pin)` once the wave has peaked, route `onEvent` into camera shake and sound.
  Walk cadence follows speed so the feet do not slide. Clip lengths and event times are mirrored
  in `KAIJU_CLIPS` and must change together with the Blender script.
- **Constraints.** The house does not break, for the same reason buildings do not collapse in the
  tsunami; damage is the hit ring, camera shake and whatever tint the tsunami applies. One kaiju
  at a time.

## Data preparation

Two scripts in `scripts/crime/`. `build_crime_geojson.py` reads the SAPS quarterly workbooks, fetches Western Cape Government precinct polygons and 2021 population, computes twelve-month counts and per-100 000 rates per precinct, and exports GeoJSON into `public/data/`. `build_crime_raster.py` blends those counts into continuous heat layers (`public/data/heat/*.png` plus `index.json`) and writes the preview image in `docs/assets/`. The app only ever reads these files; `crime.html` shows the interactive 2D version. To drape crime over the 3D city, load a layer PNG as a texture across the `index.json` extent and colour it with the lookup in `src/crime/scale.ts`.

## Keyless terrain preview (fallback renderer, 2026-09-12)

`src/scene/terrain/` renders the peninsula without any key, in the same three.js and react-three-fiber stack, so the demo never shows a blank screen and the team can build overlays before the Google key is sorted. It is a *preview*: recognisable terrain and imagery, no buildings.

- **Elevation:** Mapzen Terrarium PNG tiles from AWS Open Data (`s3.amazonaws.com/elevation-tiles-prod`, SRTM-derived, free, CORS open). Zoom 12 (about 30 m per pixel) over the metro block, zoom 10 for a far ring. Decoded once into a stitched `Float32Array` height field with bilinear sampling by Web Mercator coordinate (`heightfield.ts`).
- **Imagery:** Esri World Imagery tiles (free, attribution shown in the HUD). Zoom 15 over the City Bowl, Atlantic Seaboard and Table Mountain, zoom 14 over the surrounding suburbs, zoom 12 across the rest of the metro and zoom 11 for a 180 km ring so wide views fade into haze instead of ending at an edge. Tiles over open water are skipped. Both Esri and S3 speak HTTP/1.1 only, so requests alternate between two hostnames per source to double the browser's connection budget; a coarse pass covers everything in about 2 s and the detail streams in behind the intro flight (about 15 s in total).
- **Frame:** a local metre frame, +X east, +Z south, Y up, centred on lat -33.93, lon 18.45 (`src/geo.ts`, `toLocal`). Curvature is ignored; over 100 km the error is a few hundred metres at the edges and invisible. Anything to be draped over this view (heat rasters, precinct outlines, pins) projects with `toLocal` and samples `HeightField.sampleLatLon` for ground height.
- **Coastline:** SRTM reads 0 over the sea but carries offshore patches of 1 to 10 m, and real quays are only 1 to 3 m, so the land mask is cleaned by connected components (islets below 8 m are demoted to water). Water pixels are pushed to -6 m and a translucent shader ocean at +0.6 m sits over them, so the imagery's own coastline, beaches and shallows define the shore while the mask feathers the water out over land.
- **Look:** unlit-style lighting (hemisphere plus a soft north-west sun matching the shading baked into the imagery), gradient sky dome, exponential fog that thins as the camera climbs, logarithmic depth buffer, MSAA. Named viewpoints and the intro flight are shared with the Google renderer.
- **Limits:** no buildings, so it cannot carry tsunami stage two. Esri's terms require the attribution line to stay visible. Elevation resolution is 30 m, so cliffs are softer than the real thing.

## Ideas that strengthen the "I recognise this" moment

- Show the nearest Street View image next to the clicked point. People recognise a street corner faster at eye level.
- Fly from space to the pin over about three seconds with camera easing on every click.

## Sources

- 3DTilesRendererJS: https://github.com/NASA-AMMOS/3DTilesRendererJS
- react-three-fiber components: https://github.com/NASA-AMMOS/3DTilesRendererJS/blob/master/src/r3f/README.md
- Photorealistic 3D Tiles overview: https://developers.google.com/maps/documentation/tile/3d-tiles-overview
- Coverage map: https://developers.google.com/maps/documentation/javascript/3d/coverage
- Map Tiles API usage and billing: https://developers.google.com/maps/documentation/tile/usage-and-billing
- Google showcase, South Africa: https://www.youtube.com/watch?v=1oSPdpPD1uk
- Leafmap MapLibre overview (data preparation only): https://leafmap.org/maplibre/overview/
- MapLibre 3D Tiles discussion: https://github.com/maplibre/maplibre-gl-js/discussions/3378

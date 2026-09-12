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

The implementation lives in `src/scene/google/GoogleCity.tsx`: `TilesRenderer` with the `GoogleCloudAuthPlugin` (from `3d-tiles-renderer/core/plugins`), `GLTFExtensionsPlugin` with a DRACO decoder from Google's CDN, `TileCompressionPlugin`, `UpdateOnChangePlugin`, `TilesFadePlugin`, `GlobeControls` and the attribution overlay. The camera is placed with `ellipsoid.getObjectFrame(..., CAMERA_FRAME)` from lat/lon poses in `src/viewpoints.ts`, and flights interpolate lat, lon, height, azimuth and elevation. A root-tileset `load-error` hands over to the terrain preview. The canvas renders on demand (`frameloop="demand"`): the library's react-three-fiber wrappers call `invalidate()` when tiles load, fade or the controls move, and `CameraFlight` does so while a flight runs, so an idle city costs no GPU time. The camera starts over the City Bowl so only those tiles stream; add `?intro` to the URL for the flight in from over the Atlantic. Tuning knobs at the top of the file: `errorTarget` 20 (Google's recommendation; the tile count grows roughly with (resolution / errorTarget)²), device pixel ratio capped at 1.5, and a 1 GB in-memory tile cache so revisiting a viewpoint does not re-download. `__cityStats()` in the console reports draw calls, triangles and visible tiles, and `node scripts/city-smoke.mjs [url]` loads the app in headless Chrome, samples those statistics for 30 s and saves a screenshot.

**Gotcha, 2026-09-12:** `TilesPlugin` compares its `args` prop shallowly and rebuilds the plugin whenever the reference changes. Passing `args={[{ apiToken }]}` inline recreates the `GoogleCloudAuthPlugin` on every React re-render (each HUD progress update), each new instance starts with no session token, and the library's auth wrapper then parses every tile response as JSON, so tiles fail with "glTF is not valid JSON" and nothing renders. Keep plugin `args` stable: a `useMemo` keyed on the API key for the auth plugin, module-level constants for the rest.

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
- **Performance.** Heavy geometry, and every simulation effect adds draw calls. Fine on a MacBook with a good connection, stutters on hotel Wi-Fi. Pre-fly demo pins so tiles are cached in memory, and record a fallback video. The photoreal canvas renders on demand and starts over the City Bowl (see the knobs in `GoogleCity.tsx`); any layer that animates every frame must call `invalidate()` from its `useFrame` callback, and brings back the per-frame cost while it runs.

## Simulations

Aim for convincing, not physically exact. The model chooses the parameters from real data; the shaders do the visuals.

### Tsunami (agreed scope, 2026-09-12)

Build in two stages. Stage one must work before stage two starts.

1. **Sheet version.** A water mesh over the bay with a vertex shader for swell and the wave front and a fragment shader for colour, transparency and foam. Depth-tested against the city mesh so streets fill and buildings poke out. Sample a terrain height field by raycasting down onto the loaded tiles, so water level per cell is wave height minus ground height and the wave stalls on rising ground. About two hundred lines of shader plus tuning.
2. **Flow between buildings.** A shallow-water simulation on the GPU with ping-pong render targets. The sampled height field already contains roofs, so buildings become tall cells the water cannot enter and it funnels up streets, wraps corners and pools behind buildings. A five-metre grid over a two-kilometre area is a 400 by 400 texture, fine on a laptop GPU. Roughly a day of work; start only once the click-to-verdict loop is done.

Damage is shown with debris particles, floating cars and foam where the water is deep and fast, plus a damage tint on the inundated mesh.

**Out of scope:** knocking buildings over. The Google mesh is one continuous surface with no separable buildings. Proxy boxes from OpenStreetMap footprints look wrong against the photoreal city, and shader deformation stretches the textures. Do not spend time here. If a collapse shot is ever wanted, shader deformation of a single hero building is the only photoreal option.

Practicalities: fly the camera in and wait for tiles before sampling heights; the mesh has no sea floor, so the sea is a plane we add; keep the water area to a few square kilometres and drop reflections if frames drop; budget a few hours of tuning on the demo laptop.

### Earthquake

Camera shake plus a ground-crack shader. Do not simulate buildings collapsing.

### Fire

Particle system and a spreading emissive mask driven by wind direction and slope.

## Koeberg power station model

A procedural model of Koeberg lives in `blender/koeberg.py` (Blender 5, headless) and is exported to `public/models/koeberg.glb` with `public/models/koeberg.anchors.json` (component positions and loop paths, already in three.js coordinates). React components are in `src/scene/koeberg/`; the standalone page is `koeberg.html`.

- **Dimensions** come from imagery measurement (Esri World Imagery, 0.25 m/px), the French 900 MWe CP1 containment (37 m inner diameter, 0.9 m walls) and Eskom fact sheet NU 0001 (13 m reactor vessel, three 21 m steam generators, 1 HP + 3 LP turbines, 14 m generators, 40 t/s seawater per unit). The plant axis runs 22° west of north.
- **Frame:** metres, x east, y up, z south, origin at 33.67644°S 18.43205°E, terrace at y = 0 (about 8 m above sea level). Drop `<Koeberg>` into the city scene at that lat/lon with `showSite={false}` so the terrace, roads, breakwaters and pylons are hidden and the Google mesh shows through. Node names are prefixed `ext_`, `int_`, `site_`, `shard_` for this.
- **Modes:** `exterior`; `inside` ghosts the shells and animates particles along the primary, secondary and tertiary loops with labels; `accident` runs a 90-second station-blackout timeline (pumps stop, core melt, hydrogen detonation that shatters the pre-fractured Unit 1 dome, smoke, then a regional plume). The footprint is a Gaussian plume (Pasquill-Gifford class D, 300 m release height, 30 km depletion length) with three bands plus the 5 km and 16 km emergency planning zones. It is indicative, not a dose model. In the accident the camera is guided: each phase flies to the view that shows it (turbine hall as the pumps stop, inside Unit 1 as the core heats, the dome for the blast, then wind-aware plume and region shots), the shells go see-through while the failure builds inside, and dragging the camera or picking a view hands control to the user with a button to resume following.
- **Map integration notes:** the footprint and zone rings are flat planes at the site height, so over the photoreal mesh they will cut through Table Mountain; draw them with `depthTest` off or conform them to the height field. The regional plume particles are placed analytically from story time, so scrubbing the timeline works. The flow, accident and label components call `invalidate()` from their `useFrame` callbacks, so they keep animating inside the city canvas, which renders on demand.
- **Navigation (2026-09-12):** Blender-style. `src/koeberg/NavGizmo.tsx` draws an SVG axis gizmo over the canvas: drag it to orbit, click an axis ball to fly to that axis view (the underside is disabled by the polar limit), with zoom, pan and Home buttons beneath. Keys 1, 3, 7 snap to front, right and top, Ctrl flips, Home returns to the last preset view. OrbitControls is mapped so middle-drag orbits and Shift + drag pans. Any gizmo interaction hands the accident camera to the user, like dragging the canvas.
- **Iteration loop:** Blender renders previews to a folder (`--renders`), and a Playwright script screenshots the page with URL parameters (`?view=domes&mode=accident&t=24&play=0`). The page exposes `window.__koeberg` with `setMode`, `setView`, `setTime`, `setWind`.

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

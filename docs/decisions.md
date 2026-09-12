# Decisions

Record a decision when it changes the work other people or agents should do. Keep entries brief.

## Template

```md
## YYYY-MM-DD — Decision title

**Decision:** What we chose.

**Why:** The evidence or trade-off behind it.

**Consequences:** What this enables, limits, or changes next.
```

## 2026-09-12 — Use lightweight shared project documentation

**Decision:** Maintain the documents in `docs/` and use `CLAUDE.md` as the agent-facing operating guide.

**Why:** The team needs a fast way to align people and agents before a project idea exists.

**Consequences:** Update the relevant document when a shared product, design, technical, or demo decision becomes stable.

## 2026-09-12 — Start with Vite, React, and TypeScript

**Decision:** Use a minimal Vite-powered React application with TypeScript and ESLint.

**Why:** It provides a fast, familiar web-demo foundation while keeping the initial dependency surface small.

**Consequences:** The team can start with `npm run dev`; add routing, APIs, UI libraries, and tests only when the chosen idea requires them.

## 2026-09-12 — Render Cape Town with Google Photorealistic 3D Tiles in three.js

**Decision:** Use three.js with NASA's 3DTilesRendererJS (and its react-three-fiber components) as the single rendering engine, streaming Google Photorealistic 3D Tiles with a Google Map Tiles API key. Use leafmap or geopandas in a notebook for data preparation only, exporting GeoJSON into the repo. No CesiumJS, MapLibre or deck.gl in the app.

**Why:** Google Photorealistic 3D Tiles are the only browser source that gives a recognisable, textured photogrammetry mesh of Cape Town (individual houses, roofs, Table Mountain, the Waterfront). MapLibre, leafmap and Cesium OSM Buildings produce grey extruded boxes. We also need to build custom simulations (tsunami, fire, earthquake) on top of the city, which is an ordinary problem in a raw three.js scene but constrained inside Cesium's engine or deck.gl layers. Google bills per root tileset request with 1,000 free per month, so the hackathon costs nothing. Full notes in `docs/rendering.md`.

**Consequences:** This supersedes the earlier CesiumJS choice made the same day. The demo needs an internet connection and a Google Map Tiles API key (not committed). Google attribution must stay visible and tiles cannot be cached offline. The mesh is one blob, so clicking returns a coordinate only; building identity comes from OpenStreetMap or a reverse geocoder. Custom objects must be placed with the library's lat/lon helpers because the mesh lives in Earth-centred coordinates. Pre-fly demo pins so tiles are loaded, and keep a recorded fallback for bad Wi-Fi.

## 2026-09-12 — Tsunami shows water flowing between buildings, not buildings collapsing

**Decision:** The tsunami effect is a two-stage build: a depth-tested water sheet first, then a GPU shallow-water simulation that uses the sampled mesh heights as obstacles so water flows between buildings. Damage is debris, floating objects and a tint on the flooded mesh. Collapsing buildings are out of scope.

**Why:** Flow between buildings is achievable in about a day on top of the height field we already need, and it is the moment judges will remember. The Google mesh has no separable buildings, so collapse can only be faked with grey proxy boxes or stretched textures, both of which undo the photoreal look we chose the renderer for.

**Consequences:** Stage two starts only after the click-to-verdict loop works. Nobody spends time on building destruction. Details in `docs/rendering.md`.

## 2026-09-12 — Crime data comes from SAPS station statistics joined to Western Cape precinct boundaries

**Decision:** Crime is measured per SAPS police precinct. Counts come from the five quarterly SAPS "WEB" workbooks (July 2025 to June 2026 is the current twelve-month window, with the prior twelve months kept for change). Polygons and station points come from the Western Cape Government GIS service (`SpatialDataWarehouse/SAPS_PoliceStations`), and rates per 100 000 residents use the 2021 GeoTerraImage population summed per precinct from the same server. The headline measure is the SAPS "17 community-reported serious crimes" total; drug and firearm detections are kept but labelled as police action. Everything is exported once to `public/data/wc-crime-precincts.geojson`; the app never touches the workbooks or the GIS server.

**Why:** Precincts are the finest level SAPS publishes. Station counts alone would light up the biggest townships purely on population, so per-capita rates are needed, and the Western Cape GIS layer is the only source that carries both boundaries and population with matching precinct names. Keeping the join in a script means the demo works offline and a new quarter is one command.

**Consequences:** Boundaries date from 2019/2020, so Makhaza (opened 2024) is folded into Harare, and Tafalehashe (opened 2026, six months of data) is omitted until SAPS publishes its boundary. Precincts with under 5 000 residents, such as Table Bay Harbour, are flagged and not coloured on the rate view. Per-resident rates in Cape Town Central are extreme because the population is residential only; the UI says so. Colour classes are quantiles on a seven-step heat ramp, so the map shows relative standing, not absolute thresholds. The 2D heatmap lives on its own Vite page (`crime.html`) so `App.tsx` stays with the 3D city.

## 2026-09-12 — Crime is shown as a blended surface, not a precinct choropleth

**Decision:** The heatmap is a continuous raster. Each precinct's twelve-month count is spread over the census enumeration areas inside it in proportion to 2021 residents (block-sized in the city, median 0.08 km²), rasterised at 50 m, and every cell becomes the Gaussian-weighted sum of surrounding cases, w(d) = exp(−d²/2σ²) with σ = 400 m. Two measures ship per category: cases per km² per year, and cases per 100 000 residents using residents smoothed with the same kernel (blank under 200 people/km²). Layers are 8-bit grayscale PNGs with square-root encoding and an `index.json`; colouring and point sampling happen in the browser.

**Why:** Per-precinct fills read as flat blocks and hide where inside a precinct crime concentrates. SAPS gives no incident addresses, so resident distribution is the most defensible proxy for where community-reported crime happens, and it is available at block level from the same GIS server as the boundaries. A kernel gives a clear, tunable answer to "how much does nearby crime affect this point", and grayscale PNGs keep twenty layers under 4 MB while doubling as the drape texture for the 3D city.

**Consequences:** The texture is a model, not observed incident locations; the page says so. Business districts with few residents (CBD, harbour) get their cases concentrated on the few residential blocks there, which makes them very hot per km². σ and cell size are build flags; changing them means rerunning `build_crime_raster.py`. The precinct choropleth and its PNG renderer were removed; the precinct table remains as the accessible twin.

## 2026-09-12 — A keyless terrain preview is the fallback renderer

**Decision:** Alongside the Google Photorealistic 3D Tiles renderer, ship a second three.js view of the peninsula built from free, keyless sources: Esri World Imagery draped over SRTM elevation (Mapzen Terrarium on AWS Open Data) with a shader ocean and haze. The app uses it whenever no key is configured or Google refuses the root tileset, and a HUD switch flips between the two when a key exists. It draws no buildings.

**Why:** When the renderer was built there was no working Google key (a key added later was blocked by its referrer restriction until a correctly restricted one was issued on 12 September 2026), and a demo that can show a blank screen is a demo that fails. The preview also lets overlays (crime rasters, pins, water) be developed and tested without spending Google quota or waiting on account admin, and the mountains, coastline and city grid are recognisable enough to carry a wide shot. It stays inside the "one rendering engine" rule: same three.js, react-three-fiber, HUD and viewpoint code, so no second camera system.

**Consequences:** The photoreal view is still the intended hero and must be verified as soon as the key works. Overlays should be written against the shared `SceneApi` and lat/lon helpers so they work on both renderers; in the terrain view they project with `toLocal` and sample the height field. Tsunami stage two (water between buildings) needs the Google mesh and cannot be demonstrated on the preview. Esri attribution must stay visible in terrain mode.

## 2026-09-12 — Koeberg is a procedural Blender model, not a photogrammetry scan

**Decision:** Build Koeberg Nuclear Power Station as a procedural Blender script (`blender/koeberg.py`) exported to GLB, with the interior (reactor vessel, steam generators, pumps, pressuriser, turbines, condensers, seawater culverts) modelled to real dimensions so the process can be shown inside a ghosted shell. The accident is a station-blackout sequence ending in a hydrogen detonation and a Gaussian-plume footprint, never a nuclear explosion.

**Why:** The Google mesh has no interior and no separable dome, so neither the process view nor the breach can come from it. A scripted model rebuilds in eight seconds, keeps every dimension traceable to a source, and exports named nodes and anchor paths that the three.js layer animates. Framing the failure as loss of cooling and a chemical explosion is what the physics allows for 4.4 % enriched fuel and is what judges will hear from anyone who knows nuclear.

**Consequences:** The station is a separate `<Koeberg>` component in the local metre frame that the city scene can place at the site coordinate; `showSite={false}` hides the terrace and breakwaters over the photoreal mesh. Footprint planes need a depth or height-field treatment over real terrain. Blender 5 is a build-time dependency for the model only; the GLB is committed.

## 2026-09-12 — The photoreal city renders on demand and starts over the City Bowl

**Decision:** The Google renderer uses react-three-fiber's `frameloop="demand"`, so a frame is drawn only when the camera moves, a tile arrives or a fade runs. The camera starts at the City Bowl viewpoint instead of flying in from 75 km over the Atlantic (the flight remains behind `?intro`). The screen-space error target is Google's recommended 20 instead of 12, the device pixel ratio is capped at 1.5, and the in-memory tile cache is raised to 1 GB.

**Why:** With several people running the app at once it was laggy and unresponsive. The canvas redrew the whole mesh sixty times a second at Retina resolution even when nothing changed, and the intro flight streamed and discarded tiles for the entire peninsula before the demo view appeared. The library is built for on-demand rendering (its wrappers already request redraws on every relevant event), so this is the cheapest fix and costs nothing visually when idle.

**Consequences:** Any layer that animates every frame (water, particles, camera shake) must call `invalidate()` from its `useFrame` callback or it will freeze; simulation authors should budget for the per-frame cost returning while such a layer runs. `node scripts/city-smoke.mjs` verifies the view in headless Chrome (tile and draw counts, console errors, screenshot). The terrain preview still renders continuously because of its animated ocean; giving it the same treatment is a follow-up.

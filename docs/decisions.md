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

## 2026-09-12 — Wildfire is the second simulation, built as a standalone module first

**Decision:** Build the Table Mountain wildfire next, as a standalone module under `src/simulations/fire/` with its own sandbox page, mirroring the tsunami module's contract (local frame group, shared height-field sampler, trigger with model-chosen parameters, per-frame update). Spread runs as a CPU cellular automaton; visuals are a draped scorch sheet plus GPU particles.

**Why:** Fire reuses the terrain sampling the tsunami already needs, is real Cape Town history (Rhodes Memorial, April 2021), and gives the persona verdict a second hazard with a concrete "the front reaches you in N minutes" payoff. A CPU automaton is a few hundred lines, deterministic and readable by the verdict code, where a GPU version would need a readback. Building standalone keeps the primary demo path untouched until the click-to-verdict loop works.

**Consequences:** Every simulation follows the contract in `src/simulations/README.md`. Integrating into the world means placing the group with the tiles' ENU helper and sampling once tiles are loaded; nothing in the module depends on the sandbox. Scorch is a draped sheet, not a tile-material tint; upgrading that is optional polish.

## 2026-09-12 — Simulations run in the browser as standalone modules, not Blender bakes

**Decision:** Every hazard simulation is a three.js module under `src/simulations/<name>/` with its own sandbox page and a stand-in scene, following the contract in `src/simulations/README.md`. The tsunami is a GPU shallow-water solver over a height field sampled from the live scene. No Blender or offline fluid bakes.

**Why:** The effect we want is water interacting with the real city: flowing between buildings, stalling on slopes, pooling. That needs the geometry, and the Google mesh only exists at runtime in the client. A Blender bake is a fixed animation of a fixed mesh that cannot react to a pin the judge chooses, cannot be depth-tested against streamed tiles, and would cost hours per shot. Building standalone with a stand-in city lets the simulation and the map module progress in parallel and keeps the primary demo path untouched.

**Consequences:** Map and simulation meet at one seam: a local east-north-up frame plus `sampleTerrain(tilesGroup)` once tiles have loaded. React is pinned to 19.2 because react-three-fiber does not yet accept 19.3. Sandboxes are extra Vite entries, registered in `vite.config.ts`.


## 2026-09-12 — Kaiju is a procedural Blender model, sequenced after the tsunami

**Decision:** The kaiju beat uses a model generated entirely by `tools/blender/kaiju.py` (mesh, rig, weights and six clips) in the Claude palette, exported to a committed GLB and driven by a renderer-free behaviour state machine. It surfaces once the tsunami has peaked and attacks the pinned house without breaking it.

**Why:** A downloaded kaiju brings licence questions and a rig we cannot retime; a scripted model is reproducible, half a megabyte, and can be re-proportioned in minutes, the same approach as the fynbos. The Claude colours make it read as ours at a glance. Sequencing it after the tsunami reuses the terrain height field and turns two effects into one story.

**Consequences:** Nobody hand-edits the GLB; change the script and rebuild. Clip lengths and event times are duplicated in `KaijuBehaviour.ts` and must move together. Building destruction stays out of scope.

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

## 2026-09-12 — The kaiju is Clawd, the Claude mascot, not a Claude-coloured Godzilla

**Decision:** The monster is a faithful Clawd (the Claude Code mascot: squat terracotta rounded blob, two small dark eyes, two stubby block feet, nothing else) at three hundred metres. The Godzilla-style body stays in the script behind `--style kaiju`.

**Why:** A recognisable mascot lands the joke instantly with a Claude-aware audience, where a Claude-coloured lizard needed explaining. Keeping the same rig and clips meant the swap cost an hour and nothing structural in the behaviour script changed.

**Consequences:** No arms, so the attack is a body slam and the hit lands just past the face. Nothing glows, so the actor's roar glow pulse is a no-op for this style. Stride and footstep spacing in `KaijuBehaviour.ts` are tuned for stubby legs.

## 2026-09-12 — Koeberg is a procedural Blender model, not a photogrammetry scan

**Decision:** Build Koeberg Nuclear Power Station as a procedural Blender script (`blender/koeberg.py`) exported to GLB, with the interior (reactor vessel, steam generators, pumps, pressuriser, turbines, condensers, seawater culverts) modelled to real dimensions so the process can be shown inside a ghosted shell. The accident is a station-blackout sequence ending in a hydrogen detonation and a Gaussian-plume footprint, never a nuclear explosion.

**Why:** The Google mesh has no interior and no separable dome, so neither the process view nor the breach can come from it. A scripted model rebuilds in eight seconds, keeps every dimension traceable to a source, and exports named nodes and anchor paths that the three.js layer animates. Framing the failure as loss of cooling and a chemical explosion is what the physics allows for 4.4 % enriched fuel and is what judges will hear from anyone who knows nuclear.

**Consequences:** The station is a separate `<Koeberg>` component in the local metre frame that the city scene can place at the site coordinate; `showSite={false}` hides the terrace and breakwaters over the photoreal mesh. Footprint planes need a depth or height-field treatment over real terrain. Blender 5 is a build-time dependency for the model only; the GLB is committed.

## 2026-09-12 — The presenter's link is a GitHub Pages build of the `deploy` branch

**Decision:** Publish the static Vite build to GitHub Pages (`https://julianmilner.github.io/hackathon/`) from a GitHub Actions workflow that runs on pushes to `main` and `deploy`. `deploy` is a stable branch the team merges into deliberately; the working branches are not deployed on every push.

**Why:** The presenter needed a shareable link while the working tree was mid-change and did not build. A separate branch keeps the public link on a known-good build, and Pages costs nothing and needs no server, which fits an all-in-the-browser app.

**Consequences:** The site is served from a `/hackathon/` prefix, so hard-coded absolute asset paths break; `vite.config.ts` sets `base` in the `pages` build mode and code must use `import.meta.env.BASE_URL`. The Google Map Tiles key is baked into the public bundle (as any browser key is) and its referrer allowlist must include the Pages origin for the photoreal view to work there; otherwise the terrain preview is what the audience sees.

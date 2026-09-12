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

## 2026-09-12 — Simulations run in the browser as standalone modules, not Blender bakes

**Decision:** Every hazard simulation is a three.js module under `src/simulations/<name>/` with its own sandbox page and a stand-in scene, following the contract in `src/simulations/README.md`. The tsunami is a GPU shallow-water solver over a height field sampled from the live scene. No Blender or offline fluid bakes.

**Why:** The effect we want is water interacting with the real city: flowing between buildings, stalling on slopes, pooling. That needs the geometry, and the Google mesh only exists at runtime in the client. A Blender bake is a fixed animation of a fixed mesh that cannot react to a pin the judge chooses, cannot be depth-tested against streamed tiles, and would cost hours per shot. Building standalone with a stand-in city lets the simulation and the map module progress in parallel and keeps the primary demo path untouched.

**Consequences:** Map and simulation meet at one seam: a local east-north-up frame plus `sampleTerrain(tilesGroup)` once tiles have loaded. React is pinned to 19.2 because react-three-fiber does not yet accept 19.3. Sandboxes are extra Vite entries, registered in `vite.config.ts`.


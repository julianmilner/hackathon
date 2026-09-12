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

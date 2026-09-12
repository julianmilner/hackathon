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

## 2026-09-12 — Render Cape Town with Google Photorealistic 3D Tiles in CesiumJS

**Decision:** Use CesiumJS as the 3D globe and stream Google Photorealistic 3D Tiles for the city mesh. Load the tileset through Cesium ion (`createGooglePhotorealistic3DTileset()`) so a single free ion token is the only credential; a direct Google Map Tiles API key is the fallback route.

**Why:** It is the only browser option that gives a recognisable, textured photogrammetry mesh of Cape Town (individual houses, roofs, Table Mountain, the Waterfront) from a local page. Cesium OSM Buildings and Mapbox 3D produce grey extruded boxes. Google bills per root tileset request (one request covers about three hours of streaming) with 1,000 free per month, so the hackathon costs nothing. Full notes in `docs/rendering.md`.

**Consequences:** The demo needs an internet connection and a Cesium ion token (not committed). Google attribution must stay visible and tiles cannot be cached offline. The mesh is one blob, so clicking returns a coordinate only; building identity comes from OpenStreetMap or a reverse geocoder. Pre-fly demo pins so tiles are loaded, and keep a recorded fallback for bad Wi-Fi.

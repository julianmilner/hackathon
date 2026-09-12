# Architecture

Document only choices that guide implementation. Diagrams are optional until complexity warrants one.

## Stack

- **Frontend:** Vite, React, and TypeScript
- **3D map:** three.js with 3DTilesRendererJS and react-three-fiber, streaming Google Photorealistic 3D Tiles. See `docs/rendering.md`.
- **Simulations:** standalone three.js modules under `src/simulations/<name>/`, each with a sandbox page (for example `/tsunami.html`). They own a group in a local east-north-up frame and sample terrain from whatever object they are given, so the map places them with the tiles' ENU helper and calls `sampleTerrain(tilesGroup)`. Reference implementation and integration notes in `src/simulations/tsunami/README.md`.
- **Data preparation:** leafmap or geopandas in a notebook, exporting GeoJSON into the repo. Not part of the app.
- **Generated models:** Blender scripts in `tools/blender/` export GLBs into `public/models/` (fynbos, kaiju). The GLBs are committed; Blender is only needed to change them.
- **Backend / API:**
- **Data / auth:**
- **AI models or APIs:** Claude Fable 5.1 (`claude-fable-5-1`) via the Anthropic TypeScript SDK, proposed; not yet decided.
- **Deployment:**

## System boundaries

What runs in the browser, server, and external services? What data must not leave a particular boundary?

## Key flows

- **Primary user flow:**
- **Failure behaviour:**
- **Data lifecycle:**

## Constraints and conventions

- Environment variables and secrets are never committed.
- Add the canonical install, run, test, and build commands to `README.md`.
- Prefer simple, inspectable integrations suitable for a live demo.

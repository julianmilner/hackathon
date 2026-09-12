# Architecture

Document only choices that guide implementation. Diagrams are optional until complexity warrants one.

## Stack

- **Frontend:** Vite, React, and TypeScript
- **3D map:** three.js with 3DTilesRendererJS and react-three-fiber, streaming Google Photorealistic 3D Tiles. Simulations (tsunami, fire, earthquake) are custom three.js layers in the same scene. See `docs/rendering.md`.
- **Data preparation:** leafmap or geopandas in a notebook, exporting GeoJSON into the repo. Not part of the app.
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

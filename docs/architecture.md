# Architecture

Document only choices that guide implementation. Diagrams are optional until complexity warrants one.

## Stack

- **Frontend:** Vite, React, and TypeScript
- **3D map:** three.js with 3DTilesRendererJS and react-three-fiber, streaming Google Photorealistic 3D Tiles (`src/scene/google/`). A keyless terrain preview (`src/scene/terrain/`: Esri imagery over SRTM elevation, shader ocean, haze) is the fallback when the key is missing or rejected, and the two share the HUD, viewpoints (`src/viewpoints.ts`) and a `SceneApi` (`flyTo`, `jumpTo`). `src/App.tsx` renders `src/CityApp.tsx`, which picks the renderer. Simulations (tsunami, fire, earthquake) are custom three.js layers in the same scene. See `docs/rendering.md`.
- **Data preparation:** `scripts/crime/build_crime_geojson.py` (Python, openpyxl and shapely) joins SAPS quarterly station statistics to Western Cape Government precinct polygons and 2021 population, and exports `public/data/wc-crime-precincts.geojson` plus `wc-police-stations.geojson`. `scripts/crime/build_crime_raster.py` then spreads each precinct's count over its census enumeration areas by residents, rasterises at 50 m and Gaussian-blends (σ 400 m) into grayscale PNG layers in `public/data/heat/` with an `index.json` (extent, encoding, maxima). The app only reads these files. See `README.md` for commands.
- **2D crime heatmap:** a separate Vite page, `crime.html` (`src/crime/`). It colours the raster layers on a canvas, overlays precinct outlines as SVG, and reads the value under the pointer straight from the raster. No map library. The grayscale PNGs plus `index.json` extent are the texture to drape over the 3D city, and the same decode gives a risk value for any clicked lat/lon.
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

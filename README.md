# Hackathon

Shared workspace for Julian, Louis, and Christiaan.

## Start here

1. Read [the product vision](docs/vision.md) and [the current backlog](docs/backlog.md).
2. Read [`CLAUDE.md`](CLAUDE.md) before asking an agent to make a meaningful change.
3. Run the project using the commands below.

## Working agreement

- Build the smallest end-to-end demo before expanding scope or polishing.
- Make small, focused changes and merge regularly.
- Record decisions that affect the team in [docs/decisions.md](docs/decisions.md).
- Keep the demo path working. If a change affects it, update [docs/demo.md](docs/demo.md).

## Project commands

This project uses Vite, React, and TypeScript. Node.js 22 LTS or newer is recommended.

```sh
npm install
npm run dev
npm run lint
npm run build
```

Standalone pages in dev: `/koeberg.html` is the Koeberg power station model (exterior, inside-the-process view and accident timeline). To rebuild its GLB after editing `blender/koeberg.py`:

```sh
/Applications/Blender.app/Contents/MacOS/Blender -b --python blender/koeberg.py -- \
  --glb public/models/koeberg.glb --anchors public/models/koeberg.anchors.json
```

## The 3D city

`npm run dev` opens the 3D Cape Town at `http://localhost:5173/`. Two renderers share one HUD (viewpoint chips, loading bar, attribution):

- **Photoreal** streams Google Photorealistic 3D Tiles. It needs a Google Map Tiles API key in `.env.local` (copy `.env.example`), with the **Map Tiles API** enabled on its project and the key's website restriction allowing `http://localhost:5173/*`. A key that is restricted to another referrer fails with HTTP 403 and the app drops to the terrain preview with a notice.
- **Terrain preview** needs no key: Esri World Imagery draped over SRTM elevation (Mapzen Terrarium tiles on AWS Open Data), with a shader ocean and haze. It is the fallback for a missing key, a quota problem or bad Wi-Fi, and the `Photoreal | Terrain` switch in the top-right lets you flip between them when a key is present.

Console hooks for testing: `__city.flyTo('camps-bay')`, `__city.jumpTo('table-mountain')` (ids in `src/viewpoints.ts`) and `__cityStats()` for renderer memory and draw counts.

Performance: the photoreal canvas only redraws when the camera moves or a tile arrives, and it starts over the City Bowl; add `?intro` to the URL for the flight in from the Atlantic. Smoke test in headless Chrome (30 s, prints tile and draw counts, saves a screenshot): `node scripts/city-smoke.mjs http://localhost:5173/`.

## Crime data and the 2D heatmap

The 2D crime heatmap is a standalone page at `http://localhost:5173/crime.html` while `npm run dev` is running. It reads the committed files in `public/data/` (precinct GeoJSON plus the blended raster layers in `public/data/heat/`), so the app needs nothing else.

To rebuild the data (new SAPS quarter, different categories, another kernel width) download the quarterly "WEB" workbooks from https://www.saps.gov.za/services/crimestats.php, then:

```sh
python3 -m venv .venv
.venv/bin/pip install -r scripts/crime/requirements.txt
.venv/bin/python scripts/crime/build_crime_geojson.py ~/Downloads/*Quarter_WEB.xls*   # precinct counts and rates
.venv/bin/python scripts/crime/build_crime_raster.py --sigma 400 --cell 50            # blended heat layers + preview PNG
```

The scripts download precinct boundaries, enumeration areas and population from the Western Cape Government GIS server into `data/cache/` on first run.

## Documentation

- [Product vision](docs/vision.md) — agreed problem, user, solution, and success criteria.
- [Backlog](docs/backlog.md) — prioritised work and experiments.
- [Decisions](docs/decisions.md) — consequential choices and their rationale.
- [Design system](docs/design-system.md) — product and visual rules.
- [Architecture](docs/architecture.md) — technical boundaries and major choices.
- [Demo plan](docs/demo.md) — pitch and click-path for judges.
- [Rendering](docs/rendering.md) — how the 3D city is rendered, costs, and constraints, plus the Koeberg station model.

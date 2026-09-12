# Backlog

Keep this short and ruthless. Move only the next few items into **Now**.

## Now

- [ ] Choose the project idea and complete `docs/vision.md`. Leading candidate: click anywhere on a 3D Cape Town and Claude Fable 5.1 reasons over local crime, natural-hazard, wildlife and health data to give a persona-specific survival verdict with ranked risks. The persona switch (surfer vs hiker vs taxi driver) is the demo moment.
- [ ] Confirm the photoreal view renders in the browser. A working key now lives in `.env.local` (GCP project `hackathon-agritrekker`, Map Tiles API enabled, referrers limited to localhost ports 5173–5175 and 4173); `curl` with a `http://localhost:5175/` referer returns the tileset root. Nobody has seen the Google mesh in the app yet.
- [ ] Spike: click the mesh to get lat/lon and place a marker at that point (both renderers).
- [x] 3D Cape Town shell: Google Photorealistic 3D Tiles renderer plus a keyless terrain preview fallback, shared HUD, viewpoints and intro flight. See `docs/rendering.md`.
- [x] Crime data pipeline and blended 2D heatmap (`crime.html`): SAPS station statistics joined to precinct polygons and population, spread over census blocks and Gaussian-blended into raster layers.
- [x] Set up the React and TypeScript starter; see `README.md` for commands.

## Next

- [ ] Define the smallest happy-path demo in `docs/demo.md`.
- [ ] Place `<Koeberg>` in the city scene at 33.67644°S 18.43205°E with `showSite={false}` and check its height against the Google mesh; wire the accident footprint into the hazard verdict. See the Koeberg section of `docs/rendering.md`.
- [ ] Drape the `public/data/heat/` layers over the 3D city as a transparent texture, and pass the clicked point's blended value plus its precinct's counts to the verdict prompt.

## Later / experiments

- [ ] Street View panel beside the clicked point.
- [ ] Compare mode: two pins, one head-to-head verdict.
- [ ] "Think harder" button rerunning the verdict at a higher effort level with summarised thinking shown.
- [ ] World mode using tectonic plates, earthquake catalogue and life expectancy.
- [ ] Tsunami stage one: water sheet shader depth-tested against the city mesh, stalling on rising ground, parameters chosen by the model.
- [ ] Tsunami stage two: GPU shallow-water simulation so water flows between buildings, plus debris and damage tint. Only after the click-to-verdict loop works. See `docs/rendering.md`.

## Parked

Ideas worth retaining but not spending hackathon time on:

-

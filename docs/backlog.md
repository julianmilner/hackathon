# Backlog

Keep this short and ruthless. Move only the next few items into **Now**.

## Now

- [ ] Choose the project idea and complete `docs/vision.md`. Leading candidate: click anywhere on a 3D Cape Town and Claude Fable 5.1 reasons over local crime, natural-hazard, wildlife and health data to give a persona-specific survival verdict with ranked risks. The persona switch (surfer vs hiker vs taxi driver) is the demo moment.
- [ ] Confirm Cape Town coverage on Google's 3D coverage map and create a Google Map Tiles API key with the Map Tiles API enabled.
- [ ] Spike: load the Google mesh over Cape Town in three.js with 3DTilesRendererJS, click to get lat/lon, place a marker at that point.
- [x] Set up the React and TypeScript starter; see `README.md` for commands.

## Next

- [ ] Define the smallest happy-path demo in `docs/demo.md`.

## Later / experiments

- [ ] Street View panel beside the clicked point.
- [ ] Compare mode: two pins, one head-to-head verdict.
- [ ] "Think harder" button rerunning the verdict at a higher effort level with summarised thinking shown.
- [ ] World mode using tectonic plates, earthquake catalogue and life expectancy.
- [x] Tsunami standalone module and sandbox (`/tsunami.html`): GPU shallow-water flow between buildings over a sampled height field, model-chosen wave profile. See `src/simulations/tsunami/README.md`.
- [ ] Tsunami in the world: place over the Waterfront or Muizenberg pin, set local sea level, sample the Google mesh after tiles load.
- [ ] Tsunami polish: debris and floating objects, damage tint on the flooded mesh, momentum advection if the flow looks too pressure-driven.

## Parked

Ideas worth retaining but not spending hackathon time on:

-

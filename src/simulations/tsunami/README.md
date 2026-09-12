# Tsunami simulation module

A GPU shallow-water simulation that flows around whatever is in the scene. It was built standalone
(see `sandbox/`) so it can be dropped onto the Google 3D Tiles city once the map module is ready.
Shared module contract: `src/simulations/README.md`.

Sandbox: `npm run dev` then http://localhost:5173/tsunami.html

## How it works

1. **Terrain.** `sampleHeightField()` renders the target object top-down with an orthographic camera
   into a float texture, writing local height. Every mesh's material is swapped for one frame, so it
   works on the streamed Google mesh as well as the stand-in city. Roofs are simply tall cells.
   With `seaFloor: 'flat'` (the default) anything at or below sea level becomes a flat sea floor
   `seaDepth` metres down, because the Google mesh has a sea surface but no sea floor.
2. **Solver.** Two fragment-shader passes per substep on ping-pong render targets, staggered grid:
   the velocity pass accelerates each cell face down the surface gradient (ground plus depth) with
   bed friction, and the height pass moves water with upwind fluxes. A dry cell that is higher than
   the neighbouring water surface is a wall, so water funnels up streets, wraps corners and pools
   behind buildings. A strip along `sourceEdge` forces the wave profile; the other three edges are
   absorbing so the wave leaves the patch instead of reflecting.
3. **Surface.** One vertex per cell, displaced to ground plus depth in the vertex shader. Dry vertices
   next to wet ones borrow the neighbouring water level so the sheet tucks under building walls and
   the shoreline, and the depth test against the city mesh does the rest. Colour by depth, muddy over
   land, foam where the Froude number passes one and along the thin leading edge.

## API

```ts
import { TsunamiSimulation } from '../simulations/tsunami'

const sim = new TsunamiSimulation(renderer, {
  size: 2000,          // metres, square patch
  resolution: 400,     // cells per side (5 m cells)
  seaLevel: 30,        // local height of the calm sea (see below)
  seaDepth: 10,
  sourceEdge: 'west',  // which edge the wave enters from
  timeScale: 4,        // simulated seconds per real second
})
sim.setFrame(enuMatrixAtPin)      // local x east, y up, z south -> world. Identity in the sandbox.
scene.add(sim.group)
sim.sampleTerrain(tilesGroup)     // after the tiles around the pin have loaded
sim.trigger({ amplitude: 6, drawbackTime: 8, riseTime: 12, holdTime: 40, fallTime: 40 })
sim.update(delta)                 // every frame
sim.reset(); sim.dispose()
```

`<Tsunami ref={simRef} options={...} frame={...} />` is the react-three-fiber wrapper; drive it
through the ref. `sim.readState()` reads the depth and velocity texture back for tests.

## Integrating with the Google mesh

- Place `sim.group` with the tiles library's east-north-up helper at the demo pin. The sampler and
  the water mesh both live in that local frame, so no other ECEF handling is needed. Keep the
  library's reframing on so the patch is near the world origin.
- `seaLevel` is the local height of the sea surface, not zero: Google tiles use ellipsoid heights,
  and the sea around Cape Town sits roughly 30 m above the ellipsoid. Sample one sea pixel from the
  height field, or raycast onto the water, and pass that in.
- Call `sampleTerrain()` only after flying in and letting tiles load at street detail. The sampler
  runs once and reads back a float texture, which stalls the GPU for a frame.
- Water renders with depth write and `renderOrder` 10, after the opaque tiles.
- Google attribution must stay visible; the water is a transparent overlay and does not hide the mesh.

## Tuning notes

- Defaults are tuned for drama: a 12 m wave with a long drawback, a near-vertical front, and a
  14 m/s speed cap so it slams into facades and washes over the low-rise seafront. For something
  closer to a real event use `amplitude` 3-6, `maxSpeed` 8 and `friction` 0.008. `drainRate` makes
  puddles recede after the wave; `heightScale` exaggerates water height visually (keep it under 1.3).
- When the wave hits a seafront facade it piles up to nearly twice its height, which is real
  run-up behaviour. That means a 6 m wave can wash over 10 m seafront buildings for a moment.
  Lower `amplitude` or `maxSpeed` if that looks wrong for a given pin.
- No momentum advection, so flow is a little too "pressure driven". Fine for the demo; adding
  semi-Lagrangian advection to the velocity pass is the next fidelity step if needed.
- Not done yet: debris and floating objects, damage tint on the flooded mesh.

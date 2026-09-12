# Simulations

Each hazard is a standalone module under `src/simulations/<name>/` that can be developed in its own
sandbox page and later dropped into the 3D world. Run `npm run dev` and open:

- http://localhost:5173/tsunami.html — GPU shallow-water tsunami
- http://localhost:5173/fire.html — wildfire spreading over a slope covered in fynbos
- http://localhost:5173/kaiju.html — Claude-themed kaiju that surfaces after the tsunami and attacks the house

## Module contract

Every module follows the same shape so the world can treat them alike:

- `<Name>Simulation` class owning a `group` in a **local frame**: x east, y up, z south, metres.
  In the world, `setFrame(matrix)` places it with the tiles library's east-north-up helper. In the
  sandbox the frame is the identity.
- `sampleTerrain(object)` renders a top-down height field of any three.js object (the Google tiles
  group or a stand-in) using `tsunami/HeightField.ts`. Call it once the tiles have loaded.
- A trigger (`trigger()` for the tsunami, `ignite()` for the fire, `rise()` for the kaiju) taking
  the parameters the model chooses from the hazard data.
- `update(dt)` every frame, `reset()`, `dispose()`.
- A react-three-fiber wrapper (`<Tsunami />`, `<Fire />`) that mounts the group and steps it.

The `sandbox/` folder holds the stand-in scene, the control panel and the page entry. Sandboxes
share `tsunami/sandbox/sandbox.css`. Register new pages in `vite.config.ts` so `npm run build` includes them.

## Assets

Plant models are generated, not hand-modelled. `tools/blender/fynbos.py` builds them with Blender's
Python API and exports `public/models/fynbos.glb`:

```sh
/Applications/Blender.app/Contents/MacOS/Blender -b -P tools/blender/fynbos.py -- public/models/fynbos.glb
```

Edit the script and re-run it to change species, colours or detail. The GLB is committed so nobody
needs Blender to run the app.

The kaiju is generated the same way: `tools/blender/kaiju.py` builds the mesh, rig, weights and six
animation clips and exports `public/models/kaiju.glb`. Clip table, rebuild command and a contact
sheet of preview renders are in `tools/blender/kaiju.md`.

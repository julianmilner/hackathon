# Rendering the city

Notes behind the 2026-09-12 decision to use Google Photorealistic 3D Tiles in CesiumJS. Read this before touching the map layer.

## What we get

- The same textured photogrammetry mesh as Google Earth, streamed as 3D Tiles into the browser.
- At street level you can recognise individual houses, roofs, pools, the City Bowl, the V&A Waterfront and the Bo-Kaap.
- World-to-street zoom in one library, with cinematic camera fly-to built in.
- Coverage of Cape Town is near certain (Google's own South Africa showcase flies into Cape Town), but Google only publishes a searchable coverage map. Confirm by searching "Cape Town" at https://developers.google.com/maps/documentation/javascript/3d/coverage before building on it.

## How to load it

Preferred route: Cesium ion. A free ion account and token with geocode permissions is all that is needed.

```js
Cesium.Ion.defaultAccessToken = import.meta.env.VITE_CESIUM_ION_TOKEN;

const viewer = new Cesium.Viewer("cesiumContainer", {
  globe: false,
  geocoder: Cesium.IonGeocodeProviderType.GOOGLE,
});

try {
  const tileset = await Cesium.createGooglePhotorealistic3DTileset();
  viewer.scene.primitives.add(tileset);
} catch (error) {
  console.error(`Failed to load tileset: ${error}`);
}
```

Set `globe: false` so Cesium's default terrain and imagery do not fight the Google mesh. If tiles fail to load, check that Google Photorealistic 3D Tiles are enabled on the ion account and look for authorisation errors in the console.

Fallback route: a Google Map Tiles API key with the Map Tiles API enabled, loading `https://tile.googleapis.com/v1/3dtiles/root.json?key=...` as a `Cesium3DTileset`.

Tokens and keys live in `.env.local` and are never committed.

## Cost

- Google bills per root tileset request, not per tile. One root request allows at least three hours of tile streaming.
- Free tier: 1,000 root tileset requests per month. Tile requests, session tokens and viewport requests do not count against quota.
- A weekend of building and demoing will not leave the free tier.

## Constraints and gotchas

- **Attribution.** Google attribution must remain visible. Cesium renders it in the credits area; do not hide it.
- **No offline caching.** Tiles cannot be stored or served from disk. The demo needs a live connection.
- **Overlays.** Do not paint imagery over the mesh that hides it. Transparent heatmaps, rings, pins and lines are fine.
- **One mesh, not buildings.** Clicking returns a lat/lon on the surface, not a building. Use OpenStreetMap (Overpass) or a reverse geocoder for the address and building footprint.
- **Quality varies by suburb.** City Bowl, Atlantic Seaboard, Southern Suburbs and the CBD are sharp. Informal settlements and the outskirts can be lower resolution or flatter. Test the Cape Flats pins early and choose demo pins in well-covered areas.
- **Performance.** Heavy geometry. Fine on a MacBook with a good connection, stutters on hotel Wi-Fi. Pre-fly the demo pins so tiles are cached in memory, and record a fallback video.

## Rejected alternatives

- **Cesium OSM Buildings / Mapbox 3D buildings.** Grey extruded boxes. Recognisable as blocks, not as a house.
- **City of Cape Town open data.** Aerial imagery, LiDAR and building footprints are available but no textured 3D mesh.
- **Self-made Gaussian splats.** Possible for a single street as a stunt, not for a whole city in a weekend.

## Ideas that strengthen the "I recognise this" moment

- Show the nearest Street View image next to the clicked point. People recognise a street corner faster at eye level.
- Fly from space to the pin over about three seconds with camera easing on every click.

## Sources

- Photorealistic 3D Tiles overview: https://developers.google.com/maps/documentation/tile/3d-tiles-overview
- Coverage map: https://developers.google.com/maps/documentation/javascript/3d/coverage
- Map Tiles API usage and billing: https://developers.google.com/maps/documentation/tile/usage-and-billing
- CesiumJS guide: https://cesium.com/learn/cesiumjs-learn/cesiumjs-photorealistic-3d-tiles/
- Photorealistic 3D Tiles in Cesium ion: https://cesium.com/blog/2023/10/26/photorealistic-3d-tiles-in-cesium-ion/
- Google showcase, South Africa: https://www.youtube.com/watch?v=1oSPdpPD1uk

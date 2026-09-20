---
name: maplibre-geospatial
description: >-
  Expert guidance on MapLibre GL JS, PMTiles integration, 3D DEM terrain rendering,
  WebGL camera fixes, tile caching protocols, and geospatial math for OurMaps.
  Use when modifying MapView.tsx, map rendering, custom tile protocols, elevation sampling,
  or zoom/pan camera mechanics.
---

# MapLibre & Geospatial Engineering Skill

Specialized runbook for MapLibre GL JS, PMTiles, and 3D terrain rendering in OurMaps.

---

## 1. Core Architecture & Protocol Rules

### PMTiles Protocol (`pmtiles://`)
- **IndexedDB First**: In `setupPMTilesProtocol` (`MapView.tsx`), ALWAYS query local IndexedDB / in-memory cache first. Never prioritize `navigator.onLine` over local cache (network can be "online" while backend is unreachable).
- **Tile Miss Overzooming**:
  - When an offline tile is missing, **always throw an `Error('Tile not found...')`** (or HTTP 404).
  - **NEVER return an empty or 0-byte `Uint8Array`**. Returning empty bytes signals a valid tile with 0 features, wiping out the canvas. Throwing an error allows MapLibre to overzoom and scale parent tiles (zooms 4–8) cleanly.

### 3D Terrain & DEM Protocol (`dem://`)
- **No Static Terrain in Style**: Never declare `terrain: { source: 'terrainElevation', ... }` statically in the initial style object. Boot MapLibre in 2D mode, then activate terrain dynamically via `map.setTerrain(...)`.
- **404 on Missing DEM Tiles**: Missing DEM tiles or tiles with $z > 15$ MUST throw HTTP 404.
- **No 0m Flat Dummy Tiles**: Returning 0m elevation for uncached areas collapses camera altitude in mountainous terrain (e.g. Colorado at 2,500m–4,000m), triggering frustum culling that blanks 100% of visible tiles.

---

## 2. Protected MapLibre 3D Terrain & Camera Patches

When touching `MapView.tsx`, preserve all runtime patches in `syncOfflineTerrain`:

1. **Ancestor DEM Matrix Calculation (`_getDEMTileMatrix`)**:
   - Compute difference $dz = \text{targetCanonicalZ} - \text{sourceCanonicalZ}$ directly against `sourceTile.tileID.canonical.z` using canonical `EXTENT = 8192`.
   - Never assume source DEM tile is at zoom 15.
2. **Integer Canonical Zoom in DEM Sampling (`_getDEMTileMatrix` & `_getOverscaledTileIDFromLngLatZoom`)**:
   - Floor target and source zoom levels to integers to prevent fractional-zoom modulo jump explosions ($\approx 1,100\text{m}$ altitude swings).
3. **Safe Bilinear Sampling Guard (`DEMData.prototype.sampleBilinear`)**:
   - Clamp coordinates to `[-1, dim - 1e-4]` to prevent unhandled `RangeError` at tile boundaries ($x, y \ge 256$).
4. **Camera Tug-of-War Pushback (`Camera.prototype._elevateCameraIfInsideTerrain`)**:
   - For top-down views (`pitch < 45`), return `{ elevation: minAltitude }` without modifying zoom (prevents scroll pushback at $z > 16$).
5. **Top-Down Recalculation Drift (`MercatorTransform.prototype.recalculateZoomAndCenter`)**:
   - When `pitch < 60`, bypass GPU depth framebuffer reads to prevent coordinate drift.
6. **Continuous Unfrozen Elevation During Scroll (`HandlerManager.prototype._handleMapControls`)**:
   - Set `_camera.elevationFreeze = false` during pure zoom (`pitch < 60`) to eliminate delayed perspective pops.
7. **Smooth Elevation Easing (`MercatorTransform.prototype.setElevation`)**:
   - Step elevation by at most $0.5\text{m}$ (or 25%) per frame with `map.triggerRepaint()`.
8. **Gesture Finalization Overwrite Guard (`HandlerManager.prototype._fireEvents` & `applyUpdatedTransform`)**:
   - Clear `_terrainMovement = false` and delete `_requestedCameraState` before `_fireEvents` runs at `pitch < 60`.

---

## 3. Overscaling & Tile Limits

- **Vector Tiles**: Use `<Map zoomLevelsToOverscale={4}>` to slice vector tiles up to zoom 18 and overscale to 22. Prevents tile fetch explosions and `CONTEXT_LOST_WEBGL`.
- **Pin GeoJSON Source**: Use `<Source id="pins-source" maxzoom={24}>` so `@maplibre/geojson-vt` does not drop markers past zoom 18.
- **Data Safety**: Never delete, move, or rename `data/maps/planet.pmtiles`.

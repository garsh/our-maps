# Our Maps - Antigravity Agent Context

Welcome! This file provides essential context, rules, and workflows for the Our Maps repository. Read this to avoid wasting time figuring out the architecture or deployment commands.

## Tech Stack & Architecture
- **Client (`client/`)**: A React Single Page Application (SPA) built with Vite. It uses Leaflet (`react-leaflet`) for mapping, and is configured as a Progressive Web App (PWA) using `vite-plugin-pwa`.
- **Server (`server/`)**: An Express.js backend using SQLite (via the `sqlite` and `sqlite3` packages) for the database. It handles API requests, Google OAuth validation, and real-time collaboration via `socket.io`.
- **Shared (`shared/`)**: Types and shared utilities that both client and server can depend on.

## Testing Commands
We use Vitest for unit/integration tests and Playwright for E2E tests.
Only run these tests when the user requests it.
If you think a test would be useful to confirm a particular change, ask the user to run it and print out the command to be run.
- **Client Tests**: `npm --prefix client run test`
- **Server Tests**: `npm --prefix server run test`
- **E2E Tests**: `npx playwright test --reporter=list` (Pass `--reporter=list` or `PLAYWRIGHT_HTML_REPORT=never` so Playwright exits immediately on failure instead of opening a web server for HTML reports. If running via `run_command`, check STDOUT/STDERR while running and kill if an error is reported).

## Deployment Workflow
The application is deployed using Docker Compose, which builds both the frontend and backend into a single image (`our-maps`) alongside a `caddy-proxy` container for TLS/SSL.

**Critical Deployment Rules:**
1. **Always use the `-p our-maps` flag**: The production server expects the Docker Compose project name to be exactly `our-maps`. If you omit this, Docker will derive the project name from the current folder name (e.g., `ourmaps`), which will try to spin up a completely duplicate set of containers that will crash due to port conflicts.
2. **Build and Deploy Command**: 
   ```bash
   docker compose -p our-maps up --build -d
   ```
3. **Environment & Configuration**: The `docker-compose.yml` and `Caddyfile` in this repo must be kept strictly in sync with the production environment settings (like using port `3001` and specific domain names). Do not change them to `3000` or `localhost` unless building a separate local dev override.

## Agent Development Rules
- **Map Dataset Preservation**: The map dataset file (`~/work/ourmaps/data/maps/planet.pmtiles`) and its symlinks contain the primary PMTiles vector map data. It must NEVER be deleted, moved, renamed, overwritten, or modified in any way.
- **Build Verification**: Suggest that the user run `npm run build` and confirm that the build succeeds after every change.  Do not run this command youself.
- **Database Backup**: Always create a backup of the SQLite database before making any changes to the database schema.
- **Git Commits**: Do not create or modify git commits until requested. Never git push unless requested. When requested to create commits, execute Git write commands (e.g. `git add <files>` and `git commit -m "<message>"`) as separate, unchained commands with sandbox bypass requested directly so that prefix-based auto-approval rules apply seamlessly without failing on the sandbox's read-only `.git` filesystem.
- **Dev Server Restarts**: When modifying configuration files (e.g., `package.json`, `.env` variables, or port configurations) that are not automatically watched by `nodemon` or Vite, explicitly inform the user that they must completely stop (`Ctrl+C`) and restart their `npm run dev` server for the changes to take effect. Do not run the server yourself - just tell the user.
- **Offline Map Tile Downloads**: Offline map downloads must always download full regional bounding box coverage across zoom levels 1 to 15 for the area containing pins (plus surrounding margin). This guarantees full road, street, terrain, and highway connectivity across the entire region with zero missing gaps. Do NOT propose or implement sparse, sporadic, or pin-only caching at regional zoom levels (1 to 15). Large-region downloads are intentional. Do NOT add extract concurrency caps, Docker `mem_limit`/`cpus`, or lower the 50,000,000 tile maximum (`DEFAULT_MAX_EXTRACT_TILES` / `MAX_EXTRACT_TILES`) in the name of resource exhaustion — that tile cap is the resource bound. Tile extract endpoints (`/api/maps/tiles/stream`, `/api/maps/tiles/extract-size`, and `/maps/...` aliases) must require a session so anonymous clients cannot trigger extracts.
- **Offline Mode Integrity & Architecture Rules**:
  1. **PMTiles Protocol Priority**: In `setupPMTilesProtocol` (`MapView.tsx`), ALWAYS query local IndexedDB / in-memory cache first. Never add an online fast-path before local cache, as `navigator.onLine` can be true when the server is down, which causes tile fetches to fail and blanks the canvas.
  2. **Tile Miss Overzooming**: When an offline tile is missing in `setupPMTilesProtocol`, ALWAYS throw an `Error('Tile not found...')`. NEVER return an empty or 0-byte `Uint8Array`, as returning empty data tells MapLibre the tile exists with zero features (erasing the canvas), whereas throwing an error causes MapLibre to overzoom and scale the coarse parent tile (zooms 4–8) seamlessly.
  3. **3D Terrain & Static `mapStyle`**: NEVER statically declare `terrain: { source: 'terrainElevation', ... }` inside the initial `mapStyle` specification in `MapView.tsx`. MapLibre must boot in 2D mode with `dem://` handling elevation tiles, activating terrain dynamically via `map.setTerrain(...)`. The `dem://` protocol serves cached DEM tiles for offline 3D rendering and MUST throw HTTP status 404 (`throwTileNotFound`) for uncached tiles and $z > 15$. NEVER return a 0m flat dummy tile for uncached areas, as 0m elevation collapses camera elevation in mountainous terrain (e.g. Colorado at 2,500m–4,000m), causing frustum culling to cull 100% of tiles and erasing the canvas.
  4. **Instant Offline Hydration**: In `loadMap` (`App.tsx`), always hydrate React state and dismiss the loader from local IndexedDB (`getOfflineMap`) before initiating background API calls. Offline maps must render interactively on frame 1 without network dependency.
- **MapLibre Core 3D Terrain & Camera Patches (`MapView.tsx`)**:
  Do NOT remove, weaken, or "refactor away" the following runtime monkey-patches in `syncOfflineTerrain`. They fix critical upstream bugs in MapLibre GL JS that cause blank canvases, crashing render loops, vanishing 3D buildings/pins, camera pushback, or delayed visual nudges when operating at deep zooms ($z \ge 16$ up to 22) in offline 3D terrain:
  1. **Ancestor DEM Matrix Calculation Bug (`_getDEMTileMatrix`)**:
     - *Upstream Bug*: Upstream MapLibre assumes the source DEM tile is always at `maxzoom` (15) and calculates $dz = \text{tileID.canonical.z} - \text{maxzoom}$. When offline, $z=15$ DEM tiles are often missing and ancestor DEM tiles (e.g. $z=14$) are loaded instead. Upstream overwrote $dz = 18 - 15 = 3$ (or $0$) instead of the true difference $18 - 14 = 4$. This corrupted `u_terrain_matrix`, causing 3D buildings and pin markers to sample wrong elevations miles away, sink underground, and be culled offscreen by WebGL depth testing.
     - *Fix*: Compute $dz = \text{targetCanonicalZ} - \text{sourceCanonicalZ}$ directly against `sourceTile.tileID.canonical.z` using canonical `EXTENT = 8192`.
  2. **Integer Canonical Zoom in DEM Sampling (`_getDEMTileMatrix` & `_getOverscaledTileIDFromLngLatZoom`)**:
     - *Upstream Bug*: MapLibre passes floating-point zooms (e.g. 18.59, 18.62) to `getElevationForLngLatZoom`. Doing modulo against non-integer float $2^{dz}$ causes high-frequency chaotic translation jumps across the DEM tile, swinging ground elevation wildly by over $1,100\text{m}$ between $0.01$ zoom steps.
     - *Fix*: Floor target and source zoom levels to integers in `_getDEMTileMatrix` and floor `zoom` in `_getOverscaledTileIDFromLngLatZoom`.
  3. **Safe Bilinear Sampling Guard (`DEMData.prototype.sampleBilinear`)**:
     - *Upstream Bug*: MapLibre throws an unhandled `RangeError` if $x$ or $y \ge \text{dim}$ (256). Tile boundary floating-point inaccuracies (e.g. $256.00000000000006$) crash the WebGL render loop.
     - *Fix*: Wrap `sampleBilinear` with clamping to `[-1, dim - 1e-4]`.
  4. **Camera Tug-of-War Pushback (`Camera.prototype._elevateCameraIfInsideTerrain`)**:
     - *Upstream Bug*: In top-down views (`pitch < 45`), when camera altitude approaches ground elevation at $z > 16$, MapLibre's collision avoidance pushes the camera zoom backwards to $\sim 16.98$, fighting the user's scroll input.
     - *Fix*: Return `{ elevation: minAltitude }` without modifying `zoom`.
  5. **Top-Down Recalculation Drift (`MercatorTransform.prototype.recalculateZoomAndCenter`)**:
     - *Upstream Bug*: MapLibre reads ground coordinates from the GPU depth framebuffer via `screenPointToLocation(this.centerPoint, terrain)`. Framebuffer quantization errors mutate center and zoom upon gesture completion.
     - *Fix*: When `pitch < 60`, bypass the GPU framebuffer read, query terrain elevation directly at `this.center`, and preserve exact center and zoom coordinates.
  6. **Continuous Unfrozen Elevation During Scroll (`HandlerManager.prototype._handleMapControls`)**:
     - *Upstream Bug*: MapLibre sets `elevationFreeze = true` during mouse-wheel zoom, locking elevation to the coarse zoom value and snapping to child DEM elevation 200ms later in a single 16ms frame. At deep zooms ($z \ge 18$) where camera altitude AGL is only $1.6\text{m} - 26\text{m}$, an instantaneous 2–8m elevation step alters perspective scale by 15% to 100%, producing a visual pop.
     - *Fix*: Keep `this._camera.elevationFreeze = false` during pure zoom (`pitch < 60`), allowing ground elevation to update continuously frame-by-frame with zero snap.
  7. **Smooth Elevation Easing (`MercatorTransform.prototype.setElevation`)**:
     - *Fix*: If an elevation delta $> 0.05\text{m}$ arrives while the map is idle, step by at most $0.5\text{m}$ (or 25%) per frame with `map.triggerRepaint()`, completely eliminating single-frame vertical perspective pops.
  8. **Gesture Finalization Overwrite Guard (`HandlerManager.prototype._fireEvents` & `applyUpdatedTransform`)**:
     - *Upstream Bug*: On gesture completion, MapLibre fetches a cloned transform (`_requestedCameraState`), runs `recalculateZoomAndCenter`, and executes `applyUpdatedTransform(tr)`, overwriting live camera coordinates with stale gesture-start coordinates (the delayed 200ms nudge).
     - *Fix*: Clear `_terrainMovement = false` and delete `_requestedCameraState` before stock `_fireEvents` runs at `pitch < 60`, and guard `applyUpdatedTransform` against sub-pixel idle center drift.
  9. **Vector Overscaling & Pin Maxzoom**:
     - `<Map zoomLevelsToOverscale={4}>`: Slices vector tiles to zoom 18 ($22 - 4$) and overscales to 22. Clamping vector slicing to zoom 18 prevents 50 RTT tile explosions and GPU driver timeout `CONTEXT_LOST_WEBGL` at zoom 22.
     - `<Source id="pins-source" maxzoom={24}>`: Slices pin GeoJSON up to zoom 24, preventing `@maplibre/geojson-vt` from silently dropping all pin markers above its default `maxzoom: 18`.
- **Pin Count Scale**: The system supports up to 5,000 pins and 100 layers per map, but the vast majority of real maps have fewer than 100 pins across a handful of layers. When evaluating algorithmic tradeoffs (e.g. whether to use a `Set` instead of an array scan), prefer the solution that performs better at the ≤100-pin scale. Do not over-engineer for the 5,000-pin worst case if it degrades the common case or adds meaningful complexity.
- **Handling Investigations**: If the user askes you to locate bugs or inefficiencies in the code, and you find several, then list them in an implementation plan (identified by capital letters).  Include a description, example user scenarios to trigger it (understandable to an end-user, in addition to any more technical description), and the best fix.  Also include a status for each item (planned, implemented, skipped).  Estimate a complexity of each fix (how likely it is to introduce new bugs).



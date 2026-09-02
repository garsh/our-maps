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
- **E2E Tests**: `npx playwright test`

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
- **Offline Map Tile Downloads**: Offline map downloads must always download full regional bounding box coverage across zoom levels 1 to 15 for the area containing pins (plus surrounding margin). This guarantees full road, street, terrain, and highway connectivity across the entire region with zero missing gaps. Do NOT propose or implement sparse, sporadic, or pin-only caching at regional zoom levels (1 to 15).
- **Offline Mode Integrity & Architecture Rules**:
  1. **PMTiles Protocol Priority**: In `setupPMTilesProtocol` (`MapView.tsx`), ALWAYS query local IndexedDB / in-memory cache first. Never add an online fast-path before local cache, as `navigator.onLine` can be true when the server is down, which causes tile fetches to fail and blanks the canvas.
  2. **Tile Miss Overzooming**: When an offline tile is missing in `setupPMTilesProtocol`, ALWAYS throw an `Error('Tile not found...')`. NEVER return an empty or 0-byte `Uint8Array`, as returning empty data tells MapLibre the tile exists with zero features (erasing the canvas), whereas throwing an error causes MapLibre to overzoom and scale the coarse parent tile (zooms 4–8) seamlessly.
  3. **3D Terrain & Static `mapStyle`**: NEVER statically declare `terrain: { source: 'terrainElevation', ... }` inside the initial `mapStyle` specification in `MapView.tsx`. MapLibre must boot in 2D mode with `dem://` handling elevation tiles, activating terrain dynamically via `map.setTerrain(...)`. The `dem://` protocol serves cached DEM tiles for offline 3D rendering and returns a 0m flat fallback for uncached areas to prevent missing-mesh canvas blanks.
  4. **Instant Offline Hydration**: In `loadMap` (`App.tsx`), always hydrate React state and dismiss the loader from local IndexedDB (`getOfflineMap`) before initiating background API calls. Offline maps must render interactively on frame 1 without network dependency.
- **Handling Investigations**: If the user askes you to locate bugs or inefficiencies in the code, and you find several, then list them in an implementation plan (identified by capital letters).  Include a description, example user scenarios to trigger it (understandable to an end-user, in addition to any more technical description), and the best fix.  Also include a status for each item (planned, implemented, skipped).  Estimate a complexity of each fix (how likely it is to introduce new bugs).



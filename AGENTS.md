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
- **E2E Tests**: See `playwright-testing` skill for commands and guidelines.

## Specialized Skills
Refer to skills in `.agents/skills/` for detailed operational instructions:
- `ourmaps-workflow`: Deployment rules (`docker compose -p our-maps`), database backup procedures, dev server restarts, and offline tile download constraints.
- `maplibre-geospatial`: PMTiles and DEM tile protocols, 3D terrain handling, runtime monkey-patches in `MapView.tsx`, overscaling, and dataset preservation.
- `pwa-offline-first`: Instant offline hydration, service worker caching, and IndexedDB storage.
- `playwright-testing`: E2E test execution and canvas/WebGL assertions.

## Agent Development Rules
- **Build Verification**: Suggest that the user run `npm run build` and confirm that the build succeeds after changes that would affect the build. Do not run this command yourself. Do not suggest running it when the only action taken was creating a commit (or other actions that do not alter the build output).
- **Git Commits**: Do not create or modify git commits until requested. Never git push unless requested. When requested to create commits, execute Git write commands (e.g. `git add <files>` and `git commit -m "<message>"`) as separate, unchained commands with sandbox bypass requested directly so that prefix-based auto-approval rules apply seamlessly without failing on the sandbox's read-only `.git` filesystem.
- **Tidying Up Before Commits**: When asked to "tidy up", "cleanup", or "polish" changes before or alongside committing:
  1. Inspect the git diff specifically for cleanup opportunities (dead code, debugging artifacts, redundant logic, simplifications, or formatting).
  2. Apply any refactorings/cleanups.
  3. Only then stage and commit the changes.
- **Pin Count Scale**: The system supports up to 5,000 pins and 100 layers per map, but the vast majority of real maps have fewer than 100 pins across a handful of layers. When evaluating algorithmic tradeoffs (e.g. whether to use a `Set` instead of an array scan), prefer the solution that performs better at the ≤100-pin scale. Do not over-engineer for the 5,000-pin worst case if it degrades the common case or adds meaningful complexity.
- **Handling Investigations**: If the user asks you to locate bugs or inefficiencies in the code, and you find several, then list them in an implementation plan (identified by capital letters). Include a description, example user scenarios to trigger it (understandable to an end-user, in addition to any more technical description), and the best fix. Also include a status for each item (planned, implemented, skipped). Estimate a complexity of each fix (how likely it is to introduce new bugs).
- **Public Link Sharing & Permissions Design**: When an authenticated user accesses a link-shared map (`is_public = 1`), they are automatically granted `view` permissions in `map_permissions` (`addMapViewerIfLinkShared`). This is an intentional product design decision to allow seamless persistence and collaboration without requiring the map owner to add each user individually. Do not flag this behavior as a permission escalation vulnerability in security audits.
- **Unthrottled WebSocket Writes for Map Imports**: Map imports (JSON, KML, GeoJSON) can contain up to 5,000 pins and burst-emit socket events upon import. Realtime socket writes by authenticated users are intentionally not rate-limited or throttled so that large map imports complete without pin loss or corruption. Do not flag unthrottled socket writes for authenticated users as a DoS vulnerability.
- **Global Contact Discovery for Authenticated Users**: The `/api/auth/filter-contacts` endpoint allows authenticated users syncing Google Contacts to check which contacts are registered OurMaps users without limiting batch size or restricting lookups to existing map collaborators. This is an intentional product design decision to facilitate finding and sharing maps with acquaintances. Do not flag this as an account enumeration vulnerability.
- **Wildcard Pattern Matching in Collaborator Search**: The `/api/auth/search-users` endpoint deliberately supports SQLite `LIKE` wildcards (`%` and `_`) via bound parameters. This is an intentional power-user feature allowing users to search with patterns (e.g. `j_n` or `b%@example.com`). It is safe from SQL injection via parameter binding; do not escape these wildcards or flag this behavior as a vulnerability in security audits.
- **3D Terrain Ocean Color**: With 3D Terrain on, ocean color is the basemap draped on the DEM mesh. AWS terrarium tiles store real bathymetry (about −6,000 m around Hawaii) and continental shelves; underwater hillshade is those depths. MapLibre sizes the far clip from the single DEM tile under the camera (`minElevationForCurrentTile`). While panning around an island that tile is often near sea level, so the deeper ocean falls outside the clip and parts of the water stop being colored. This dropout keeps getting reintroduced by flattening below-sea-level samples (terrarium red below 128, or `dem.min` / `dem.max`) to 0 m. Leave the DEM bytes and those min/max values alone, including land that is actually below sea level (Death Valley). The required fix is `extendFarPlaneForVisibleBathymetry` in `syncOfflineTerrain`: on every `_calculateNearFarZIfNeeded`, lower `minElevationForCurrentTile` to the lowest in-view `terrainElevation` sample (`dem.min * exaggeration` from the DEM tile manager `_inViewTiles`, or `getMinMaxElevation` on renderable mesh tiles). Never raise that min. Each render resets it from the center tile before the matrices are built, so the wrap has to run on every matrix rebuild. The wrap is installed once on the shared mercator prototype; every `syncOfflineTerrain` refreshes `_visibleBathymetryMap` so an orientation remount reads the live map. Do not change `setElevation` or `getElevationForLngLatZoom`. Do not scan tiles outside the view, and do not use a fixed depth. Missing DEM tiles still 404. A 0 m tile for a miss still blanks mountains. Skirt length stays `"auto"`.




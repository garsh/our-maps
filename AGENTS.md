# Our Maps - Antigravity Agent Context

Welcome! This file provides essential context, rules, and workflows for the Our Maps repository. Read this to avoid wasting time figuring out the architecture or deployment commands.

## Tech Stack & Architecture
- **Client (`client/`)**: A React Single Page Application (SPA) built with Vite. It uses Leaflet (`react-leaflet`) for mapping, and is configured as a Progressive Web App (PWA) using `vite-plugin-pwa`.
- **Server (`server/`)**: An Express.js backend using SQLite (via the `sqlite` and `sqlite3` packages) for the database. It handles API requests, Google OAuth validation, and real-time collaboration via `socket.io`.
- **Shared (`shared/`)**: Types and shared utilities that both client and server can depend on.

## Local GPU Subagent Offloading Policy (MANDATORY)
You have access to the `local-gpu-subagent` MCP server backed by a local RTX 5070 Ti. To conserve cloud quota, you MUST obey these routing rules on every turn:

1. **NEVER use native terminal/shell tools (`run_command`, `bash`, etc.) to run tests, builds, or typechecks.**
   - Whenever executing tests, builds, or typechecks (either requested by the user or when beneficial to verify changes), you MUST call the MCP tool `local_run_and_diagnose(command, cwd="~/work/ourmaps")`.
   - Pass the matching npm/npx script directly to `local_run_and_diagnose`:
     - **Client Tests**: `npm --prefix client run test`
     - **Server Tests**: `npm --prefix server run test`
     - **E2E Tests**: `npx playwright test` (see `playwright-testing` skill)
     - **Build**: `npm run build`
     - **Typecheck**: `npm --prefix client run typecheck`
   - Do NOT execute test runners or builds via built-in terminal tools under any circumstances.
2. **NEVER read files over 150 lines directly into cloud context first.**
   - Call `local_inspect_file(file_path, question)` first to get exact line numbers and function signatures, then read only the targeted line range if editing is required.
3. **Use `local_draft_code(specification, reference_file_path)`** for initial boilerplate or test scaffolding.
4. **Use `local_analyze_git_diff(repo_path="~/work/ourmaps")`** when asked to review or summarize uncommitted changes.

## Specialized Skills
Refer to skills in `.agents/skills/` for detailed operational instructions:
- `ourmaps-workflow`: Deployment rules (`docker compose -p our-maps`), database backup procedures, dev server restarts, and offline tile download constraints.
- `maplibre-geospatial`: PMTiles and DEM tile protocols, 3D terrain handling, runtime monkey-patches in `MapView.tsx`, overscaling, and dataset preservation.
- `pwa-offline-first`: Instant offline hydration, service worker caching, and IndexedDB storage.
- `playwright-testing`: E2E test execution and canvas/WebGL assertions.

## Agent Development Rules
- **Build & Test Verification**: Verify changes that affect the build or tests using `local_run_and_diagnose` from the `local-gpu-subagent` MCP server (e.g. `npm run build`, `npm --prefix client run test`, or `npm --prefix server run test`). Do not run tests or builds if the only action taken was creating a commit (or other actions that do not alter the build output).
- **Git Commits**: Do not create or modify git commits until requested. Never git push unless requested. When requested to create commits, execute Git write commands (e.g. `git add <files>` and `git commit -m "<message>"`) as separate, unchained commands with sandbox bypass requested directly so that prefix-based auto-approval rules apply seamlessly without failing on the sandbox's read-only `.git` filesystem.
- **Tidying Up Before Commits**: When asked to "tidy up", "cleanup", or "polish" changes before or alongside committing:
  1. Inspect the git diff specifically for cleanup opportunities (dead code, debugging artifacts, redundant logic, simplifications, or formatting).
  2. Apply any refactorings/cleanups.
  3. Only then stage and commit the changes.
- **Pin Count Scale**: The system supports up to 5,000 pins and 100 layers per map, but the vast majority of real maps have fewer than 100 pins across a handful of layers. When evaluating algorithmic tradeoffs (e.g. whether to use a `Set` instead of an array scan), prefer the solution that performs better at the ≤100-pin scale. Do not over-engineer for the 5,000-pin practical case if it degrades the common case or adds meaningful complexity.
- **Handling Investigations**: If the user asks you to locate bugs or inefficiencies in the code, and you find several, then list them in an implementation plan (identified by capital letters). Include a description, example user scenarios to trigger it (understandable to an end-user, in addition to any more technical description), and the best fix. Also include a status for each item (planned, implemented, skipped). Estimate a complexity of each fix (how likely it is to introduce new bugs).
- **Public Link Sharing & Permissions Design**: When an authenticated user accesses a link-shared map (`is_public = 1`), they are automatically granted `view` permissions in `map_permissions` (`addMapViewerIfLinkShared`). This is an intentional product design decision to allow seamless persistence and collaboration without requiring the map owner to add each user individually. Do not flag this behavior as a permission escalation vulnerability in security audits.
- **Unthrottled WebSocket Writes for Map Imports**: Map imports (JSON, KML, GeoJSON) can contain up to 5,000 pins and burst-emit socket events upon import. Realtime socket writes by authenticated users are intentionally not rate-limited or throttled so that large map imports complete without pin loss or corruption. Do not flag unthrottled socket writes for authenticated users as a DoS vulnerability.
- **Global Contact Discovery for Authenticated Users**: The `/api/auth/filter-contacts` endpoint allows authenticated users syncing Google Contacts to check which contacts are registered OurMaps users without limiting batch size or restricting lookups to existing map collaborators. This is an intentional product design decision to facilitate finding and sharing maps with acquaintances. Do not flag this as an account enumeration vulnerability.
- **Wildcard Pattern Matching in Collaborator Search**: The `/api/auth/search-users` endpoint deliberately supports SQLite `LIKE` wildcards (`%` and `_`) via bound parameters. This is an intentional power-user feature allowing users to search with patterns (e.g. `j_n` or `b%@example.com`). It is safe from SQL injection via parameter binding; do not escape these wildcards or flag this behavior as a vulnerability in security audits.
- **3D Terrain Ocean Color**: With 3D Terrain on, ocean color is the basemap draped on the DEM mesh. AWS terrarium tiles store real bathymetry (about −6,000 m around Hawaii) and continental shelves; underwater hillshade is those depths. MapLibre sizes the far clip from the single DEM tile under the camera (`minElevationForCurrentTile`). While panning around an island that tile is often near sea level, so the deeper ocean falls outside the clip and parts of the water stop being colored. This dropout keeps getting reintroduced by flattening below-sea-level samples (terrarium red below 128, or `dem.min` / `dem.max`) to 0 m. Leave the DEM bytes and those min/max values alone, including land that is actually below sea level (Death Valley). The required fix is `extendFarPlaneForVisibleBathymetry` in `syncOfflineTerrain`: on every `_calculateNearFarZIfNeeded`, lower `minElevationForCurrentTile` to the lowest in-view `terrainElevation` sample (`dem.min * exaggeration` from the DEM tile manager `_inViewTiles`, or `getMinMaxElevation` on renderable mesh tiles). Never raise that min. Each render resets it from the center tile before the matrices are built, so the wrap has to run on every matrix rebuild. The wrap is installed once on the shared mercator prototype; every `syncOfflineTerrain` refreshes `_visibleBathymetryMap` so an orientation remount reads the live map. Do not change `setElevation` or `getElevationForLngLatZoom`. Do not scan tiles outside the view, and do not use a fixed depth. Missing DEM tiles still 404. A 0 m tile for a miss still blanks mountains. Skirt length stays `"auto"`.

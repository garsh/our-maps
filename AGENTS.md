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
- **Build Verification**: Suggest that the user run `npm run build` and confirm that the build succeeds after every change. Do not run this command yourself.
- **Git Commits**: Do not create or modify git commits until requested. Never git push unless requested. When requested to create commits, execute Git write commands (e.g. `git add <files>` and `git commit -m "<message>"`) as separate, unchained commands with sandbox bypass requested directly so that prefix-based auto-approval rules apply seamlessly without failing on the sandbox's read-only `.git` filesystem.
- **Pin Count Scale**: The system supports up to 5,000 pins and 100 layers per map, but the vast majority of real maps have fewer than 100 pins across a handful of layers. When evaluating algorithmic tradeoffs (e.g. whether to use a `Set` instead of an array scan), prefer the solution that performs better at the ≤100-pin scale. Do not over-engineer for the 5,000-pin worst case if it degrades the common case or adds meaningful complexity.
- **Handling Investigations**: If the user asks you to locate bugs or inefficiencies in the code, and you find several, then list them in an implementation plan (identified by capital letters). Include a description, example user scenarios to trigger it (understandable to an end-user, in addition to any more technical description), and the best fix. Also include a status for each item (planned, implemented, skipped). Estimate a complexity of each fix (how likely it is to introduce new bugs).




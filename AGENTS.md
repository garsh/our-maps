# Our Maps - Antigravity Agent Context

Welcome! This file provides essential context, rules, and workflows for the Our Maps repository. Read this to avoid wasting time figuring out the architecture or deployment commands.

## Tech Stack & Architecture
- **Client (`client/`)**: A React Single Page Application (SPA) built with Vite. It uses Leaflet (`react-leaflet`) for mapping, and is configured as a Progressive Web App (PWA) using `vite-plugin-pwa`.
- **Server (`server/`)**: An Express.js backend using SQLite (via the `sqlite` and `sqlite3` packages) for the database. It handles API requests, Google OAuth validation, and real-time collaboration via `socket.io`.
- **Shared (`shared/`)**: Types and shared utilities that both client and server can depend on.
- **Android (`android-native/`)**: A native Kotlin/Jetpack Compose Android app that communicates with the server via REST.

## Testing Commands
We use Vitest for unit/integration tests and Playwright for E2E tests.
- **Client Tests**: `cd client && npm run test`
- **Server Tests**: `cd server && npm run test`
- **E2E Tests**: `npx playwright test` (from the project root)

## Deployment Workflow
The application is deployed using Docker Compose, which builds both the frontend and backend into a single image (`our-maps`) alongside a `caddy-proxy` container for TLS/SSL.

**Critical Deployment Rules:**
1. **Always use the `-p our-maps` flag**: The production server expects the Docker Compose project name to be exactly `our-maps`. If you omit this, Docker will derive the project name from the current folder name (e.g., `ourmaps`), which will try to spin up a completely duplicate set of containers that will crash due to port conflicts.
2. **Build and Deploy Command**: 
   ```bash
   docker compose -p our-maps up --build -d
   ```
3. **PWA Caching**: The client uses a Service Worker that caches assets heavily. If you deploy an update and view it in the browser, it will often load the old cached version. **Remind the user to perform a hard refresh (Cmd+Shift+R / Ctrl+F5) after deployments** to bypass the Service Worker cache.
4. **Environment & Configuration**: The `docker-compose.yml` and `Caddyfile` in this repo must be kept strictly in sync with the production environment settings (like using port `3001` and specific domain names). Do not change them to `3000` or `localhost` unless building a separate local dev override.

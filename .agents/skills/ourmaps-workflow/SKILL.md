---
name: ourmaps-workflow
description: >-
  Workflows, deployment safety rules, database backup procedures, and bounding-box
  offline tile download constraints for OurMaps. Use when deploying Docker containers,
  modifying SQLite database schema, managing dev servers, or altering tile extract logic.
---

# OurMaps Core Workflow & Safeguards

Critical project rules and operational runbooks for OurMaps.

---

## 1. Deployment Guardrails

- **Always use `-p our-maps`**:
  ```bash
  docker compose -p our-maps up --build -d
  ```
  Omitting `-p our-maps` causes Docker to use the directory name (e.g., `ourmaps`), creating duplicate containers that fail with port clashes on 3001/3002.
- **Port and Config Sync**: Keep `docker-compose.yml` and `Caddyfile` strictly in sync with production settings. Do not switch production ports to 3000/localhost.

---

## 2. Database Backup Requirement

- **Always create a backup of `database.sqlite` before making any changes to the database schema**:
  ```bash
  cp database.sqlite database.sqlite.bak
  ```

---

## 3. Offline Regional Bounding Box Downloads

- Regional bounding box downloads must cover zoom levels 1 to 15 for the area containing pins (plus margin).
- Guaranteed highway, road, and terrain connectivity without missing gaps.
- **Do not** add sparse/pin-only tile downloads at zooms 1–15.
- Tile cap bound is 50,000,000 tiles (`DEFAULT_MAX_EXTRACT_TILES`). Do not artificially lower or add arbitrary concurrency caps.
- Tile extract endpoints (`/api/maps/tiles/stream`, `/api/maps/tiles/extract-size`) must require an active session.

---

## 4. Dev Server & Verification Reminders

- When modifying configs (`package.json`, `.env`, port mappings), tell the user to restart `npm run dev`.
- Suggest the user run `npm run build` after code changes to confirm TypeScript and build integrity. Do not run it autonomously.
- At scale, prefer algorithms optimized for $\le 100$ pins across a handful of layers rather than over-engineering for the 5,000-pin edge case.

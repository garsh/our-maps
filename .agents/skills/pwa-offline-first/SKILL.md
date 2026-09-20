---
name: pwa-offline-first
description: >-
  Techniques and architecture for Progressive Web App (PWA) offline capabilities,
  IndexedDB caching, Service Worker lifecycle, and instant hydration in OurMaps.
  Use when modifying vite-plugin-pwa, service workers, IndexedDB map caching,
  or offline map download flows.
---

# PWA & Offline-First Engineering Skill

Architecture and best practices for OurMaps' offline-first design.

---

## 1. Instant Offline Hydration

- In `loadMap` (`App.tsx`), always hydrate React state and dismiss the loader from local IndexedDB (`getOfflineMap`) before initiating background API calls.
- Offline maps must render interactively on frame 1 without network dependency.
- Do not block UI render on network heartbeat / server checks.

---

## 2. Service Worker & Asset Caching

- Built using `vite-plugin-pwa`.
- Fast dev build flag: `VITE_NO_PWA=true` can be used during rapid local builds when service worker updates are not under test.
- Static assets (fonts, sprites) downloaded via `scripts/download-fonts.mjs` and `scripts/download-sprites.mjs` must be cached for full offline use.

---

## 3. Storage & IndexedDB Best Practices

- Store vector PMTiles chunks and map metadata in IndexedDB.
- Check quotas before downloading large regional packages.
- Handle quota exceed errors gracefully with user-friendly alerts.

---
name: playwright-testing
description: >-
  Execution guidelines and best practices for running Playwright end-to-end (E2E) tests
  in OurMaps. Use when writing, debugging, or running E2E tests, verifying map interactions,
  or testing user flows.
---

# Playwright E2E Testing Skill

Runbook for running and creating Playwright tests for OurMaps.

---

## 1. Test Execution Command

When running or recommending Playwright E2E tests:
```bash
npx playwright test --reporter=list
```
- Always use `--reporter=list` or `PLAYWRIGHT_HTML_REPORT=never` so Playwright exits immediately on failure instead of opening an interactive web server.
- Run tests only when requested or when user asks for verification. Check stdout/stderr and terminate if a fatal error occurs.

---

## 2. Canvas & WebGL Testing Guidelines

MapLibre renders on HTML5 Canvas / WebGL. Standard DOM selectors do not locate features inside the canvas:

- **Map Loaded State**: Wait for the map to finish loading or idle before asserting pins or layers:
  ```ts
  await page.waitForFunction(() => window.mapInstance?.isLoaded?.() ?? false);
  ```
  Or wait for network requests and DOM markers/panels to stabilize.
- **DOM Markers & Popups**: Check for marker overlays or popup bubbles rendered in HTML outside the WebGL canvas.
- **Mock Auth / Offline Testing**:
  - Use `ALLOW_MOCK_AUTH=true` in server development / test environment to bypass Google OAuth during test runs.
  - Test offline transitions using Playwright's `context.setOffline(true)` to verify IndexedDB fallback behavior.

import { expect, type Page } from '@playwright/test';

// Helper to suppress noisy/benign browser console errors
function setupConsoleFilter(page: Page) {
  page.on('console', (msg) => {
    const text = msg.text();
    if (
      text.includes('Unable to load glyph range') ||
      text.includes('GL Driver Message') ||
      text.includes('could not be loaded') ||
      text.includes('[vite]') ||
      text.includes('React DevTools') ||
      text.includes('Geolocation error') ||
      text.includes('[SOCKET]') ||
      text.includes('WebSocket') ||
      text.includes('websocket') ||
      text.includes('elevation-tiles-prod') ||
      text.includes('AJAXError') ||
      text.trim() === 'TypeError: Failed to fetch'
    ) {
      return;
    }
    if (msg.type() === 'error') console.log(`BROWSER ERROR: ${text}`);
    else console.log(`BROWSER: ${text}`);
  });
}

// Helper to log in with the mock account
export async function login(page: Page) {
  setupConsoleFilter(page);
  await page.goto('/login');
  await Promise.all([
    page.waitForResponse((res) => res.url().includes('/api/auth/mock-login') && res.ok()),
    page.getByRole('button', { name: /Sign in with Mock Account/i }).click(),
  ]);
  await expect(page).toHaveURL('/');
  await expect(page.getByRole('button', { name: /New Map/i })).toBeVisible({ timeout: 10000 });
}

// Helper to wait for auto-save: waits dynamically for the "Synced" badge and editable mode rather than a fixed sleep
export async function waitForAutoSave(page: Page) {
  const syncStatus = page.locator('[data-testid="sync-status"]');
  // If initiated from /map/new, wait for the map creation to persist and route to /map/:id
  if (page.url().includes('/map/new')) {
    await page.waitForURL(url => url.pathname !== '/map/new' && url.pathname.includes('/map/'), { timeout: 15000 });
  }
  // Wait for the sync status to reach 'synced' (all REST and socket deltas committed to SQLite)
  await expect(syncStatus).toHaveAttribute('data-status', 'synced', { timeout: 15000 });
  // Ensure the map has fully transitioned into editable state (socket connected, ready for further actions)
  await expect(syncStatus).toHaveAttribute('data-edit-mode', 'true', { timeout: 15000 });
}

// Helper to delete map created in test
export async function deleteCurrentMap(page: Page) {
  try {
    const url = page.url();
    const mapId = url.split('/map/')[1]?.split('?')[0];
    if (mapId && mapId !== 'new') {
      await page.evaluate(async (id: string) => {
        await fetch(`/api/maps/${id}`, {
          method: 'DELETE',
          credentials: 'include',
          headers: {
            'Content-Type': 'application/json',
          },
        });
      }, mapId);
    }
  } catch {
    // Ignore teardown cleanup errors
  }
}

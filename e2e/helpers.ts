import { test as baseTest, expect, type Page, type BrowserContext } from '@playwright/test';

interface PageMapState {
  created: Set<string>;
  deleted: Set<string>;
}

const pageMapStates = new WeakMap<Page, PageMapState>();
const configuredPages = new WeakSet<Page>();
const filteredPages = new WeakSet<Page>();

// Helper to extract a valid map ID (ignoring 'new') from a URL string
export function getMapIdFromUrl(urlStr: string): string | null {
  try {
    const url = new URL(urlStr, 'http://127.0.0.1:5173');
    const match = url.pathname.match(/^\/map\/([a-zA-Z0-9_-]+)/);
    if (match && match[1] && match[1] !== 'new') {
      return match[1];
    }
  } catch {
    const parts = urlStr.split('/map/')[1]?.split('?')[0]?.split('/')[0];
    if (parts && parts !== 'new') {
      return parts;
    }
  }
  return null;
}

function getOrCreateMapState(page: Page): PageMapState {
  let state = pageMapStates.get(page);
  if (!state) {
    state = {
      created: new Set<string>(),
      deleted: new Set<string>(),
    };
    pageMapStates.set(page, state);
  }
  return state;
}

// Track map creations and navigations on the page
export function setupMapTracking(page: Page): PageMapState {
  const state = getOrCreateMapState(page);
  if (configuredPages.has(page)) {
    return state;
  }
  configuredPages.add(page);

  // 1. Intercept POST /api/maps requests (captures ID before response or navigation)
  page.on('request', (req) => {
    try {
      if (req.method() === 'POST' && req.url().includes('/api/maps')) {
        const url = new URL(req.url());
        if (url.pathname === '/api/maps' || url.pathname === '/api/maps/') {
          const postData = req.postDataJSON();
          if (postData?.id && typeof postData.id === 'string' && !state.deleted.has(postData.id)) {
            state.created.add(postData.id);
          }
        }
      }
    } catch {
      // Ignore JSON parse or URL parse errors
    }
  });

  // 2. Intercept POST /api/maps responses (confirms created ID)
  page.on('response', async (res) => {
    try {
      if (res.request().method() === 'POST' && res.url().includes('/api/maps') && res.ok()) {
        const url = new URL(res.url());
        if (url.pathname === '/api/maps' || url.pathname === '/api/maps/') {
          const body = await res.json().catch(() => null);
          if (body?.id && typeof body.id === 'string' && !state.deleted.has(body.id)) {
            state.created.add(body.id);
          }
        }
      }
    } catch {
      // Ignore
    }
  });

  // 3. Track URL navigations to /map/:id
  page.on('framenavigated', (frame) => {
    try {
      if (frame === page.mainFrame()) {
        const id = getMapIdFromUrl(frame.url());
        if (id && id !== 'new' && !state.deleted.has(id)) {
          state.created.add(id);
        }
      }
    } catch {
      // Ignore
    }
  });

  return state;
}

// Sends a DELETE request using in-page fetch with fallback to context request
export async function deleteMap(page: Page, context: BrowserContext, mapId: string): Promise<void> {
  let deleted = false;
  if (!page.isClosed()) {
    try {
      deleted = await page.evaluate(async (id: string) => {
        try {
          const res = await fetch(`/api/maps/${id}`, {
            method: 'DELETE',
            credentials: 'include',
            headers: {
              'Content-Type': 'application/json',
            },
          });
          return res.ok || res.status === 404;
        } catch {
          return false;
        }
      }, mapId);
    } catch {
      // In-page evaluate failed (e.g. navigation in progress or page closed)
    }
  }

  if (!deleted) {
    try {
      await context.request.delete(`/api/maps/${mapId}`);
    } catch {
      // Ignore teardown cleanup errors
    }
  }
}

// Cleans up all maps tracked for a page
export async function cleanupMapsForPage(page: Page, context?: BrowserContext): Promise<void> {
  const state = getOrCreateMapState(page);
  try {
    if (!page.isClosed()) {
      const currentId = getMapIdFromUrl(page.url());
      if (currentId && currentId !== 'new' && !state.deleted.has(currentId)) {
        state.created.add(currentId);
      }
    }
  } catch {
    // Ignore URL retrieval errors
  }

  if (state.created.size === 0) return;

  const idsToDelete = Array.from(state.created);
  state.created.clear();

  const ctx = context || page.context();
  for (const mapId of idsToDelete) {
    state.deleted.add(mapId);
    await deleteMap(page, ctx, mapId);
  }
}

// Helper to suppress noisy/benign browser console errors
function setupConsoleFilter(page: Page) {
  if (filteredPages.has(page)) return;
  filteredPages.add(page);

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
  setupMapTracking(page);
  await page.goto('/login');
  await Promise.all([
    page.waitForResponse((res) => res.url().includes('/api/auth/mock-login') && res.ok()),
    page.getByRole('button', { name: /Sign in with Mock Account/i }).click(),
  ]);
  await expect(page).toHaveURL('/');
  await expect(page.getByRole('button', { name: /New Map/i })).toBeVisible({ timeout: 15000 });
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

// Helper to delete map created in test (callable explicitly in test or left to automatic teardown)
export async function deleteCurrentMap(page: Page, mapId?: string) {
  try {
    const id = mapId || getMapIdFromUrl(page.url());
    if (id && id !== 'new') {
      const state = getOrCreateMapState(page);
      state.deleted.add(id);
      state.created.delete(id);
      await deleteMap(page, page.context(), id);
    }
  } catch {
    // Ignore teardown cleanup errors
  }
}

// Teardown hook that runs after each test (both on pass and fail)
baseTest.afterEach(async ({ page, context }) => {
  await cleanupMapsForPage(page, context);
});

// Custom test fixture with automatic map tracking and teardown
export const test = baseTest.extend<{ _autoMapCleanup: void }>({
  page: async ({ page, context }, use) => {
    setupConsoleFilter(page);
    setupMapTracking(page);
    try {
      await use(page);
    } finally {
      await cleanupMapsForPage(page, context);
    }
  },
});

export { expect };

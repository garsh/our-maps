import { test, expect } from '@playwright/test';

// Helper to login
async function login(page: any) {
  page.on('console', (msg: any) => {
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
  await page.goto('/login');
  await Promise.all([
    page.waitForResponse((res: any) => res.url().includes('/api/auth/mock-login') && res.ok()),
    page.getByRole('button', { name: /Sign in with Mock Account/i }).click(),
  ]);
  await expect(page).toHaveURL('/');
  await cleanupTestMaps(page);
}

// Helper to wait for auto-save
async function waitForAutoSave(page: any) {
  // Wait for 2s debounce + network save completion
  await page.waitForTimeout(2500);
}

// Helper to delete map created in test
async function deleteCurrentMap(page: any) {
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
  } catch (err) {
    // Ignore teardown cleanup errors
  }
}

// Helper to clean up any leftover mock test maps
async function cleanupTestMaps(page: any) {
  try {
    await page.evaluate(async () => {
      const res = await fetch('/api/maps', {
        credentials: 'include'
      });
      if (res.ok) {
        const maps = await res.json();
        for (const m of maps) {
          const isTestMap = ['Metadata City', 'Test City', 'Group City', 'Updated Map Name', 'Initial Location', 'New Location', 'Interactivity City'].some(name => 
            (m.name || '').includes(name) || (m.pins || []).some((p: any) => (p.label || '').includes(name))
          );
          if (isTestMap) {
            await fetch(`/api/maps/${m.id}`, {
              method: 'DELETE',
              credentials: 'include'
            });
          }
        }
      }
    });
  } catch {}
}

test('full map creation flow', async ({ page }) => {
  await login(page);

  // Mock Places Search API
  await page.route('**/places/search*', async route => {
    const json = [
      { 
        place_id: '123', 
        title: 'Test City', 
        address: 'Test Country', 
        lat: '35.6895', 
        lon: '139.6917',
        type: 'global' 
      }
    ];
    await route.fulfill({ json });
  });

  // Navigate to new map page
  await page.getByRole('button', { name: /New Map/i }).click();
  await page.waitForURL(/\/map\//);
  await expect(page.getByText('Loading your map...')).not.toBeVisible();

  // 2. Search for a location
  const searchInput = page.getByPlaceholder('Search...');
  await searchInput.fill('Tokyo');
  
  // 3. Add a pin from search results
  await expect(page.getByText('Test City').first()).toBeVisible();
  await page.locator('button[title="Add to Map"]').first().click();

  // Verify pin added to sidebar
  await expect(page.locator('aside')).toContainText('Test City');

  // 4. Wait for auto-save and check URL
  await waitForAutoSave(page);
  await page.waitForURL(url => url.pathname !== '/map/new' && url.pathname.includes('/map/'));
  const urlWithId = page.url();
  expect(urlWithId).toContain('/map/');
  await page.waitForTimeout(1000);

  // 5. Reload the page and verify the pin persists
  await page.reload();
  await expect(page.getByText('Loading your map...')).not.toBeVisible({ timeout: 15000 });
  await expect(page.locator('aside')).toContainText('Test City', { timeout: 15000 });
  await deleteCurrentMap(page);
});

test('updating an existing map', async ({ page }) => {
  test.setTimeout(40000);
  await login(page);
  await page.getByRole('button', { name: /New Map/i }).click();
  await page.waitForURL(/\/map\//);
  await expect(page.getByText('Loading your map...')).not.toBeVisible();

  // 1. Create a map first
  const searchInput = page.getByPlaceholder('Search...');
  await page.route('**/places/search*', route => route.fulfill({ json: [{ place_id: '1', title: 'Initial', address: 'Initial Address', lat: '10', lon: '10', type: 'global' }] }));
  await searchInput.fill('Initial Location');
  await expect(page.getByText('Initial').first()).toBeVisible();
  await page.locator('button[title="Add to Map"]').first().click();
  
  // Wait for initial auto-save
  await waitForAutoSave(page);
  await page.waitForURL(url => url.pathname !== '/map/new' && url.pathname.includes('/map/'));
  await page.waitForTimeout(1000);

  // 2. Change map name
  await page.getByRole('button', { name: 'More options' }).click();
  await page.getByText('Rename Map').click();
  const nameInput = page.getByLabel('New Map Name');
  await nameInput.fill('Updated Map Name');
  await page.getByRole('button', { name: 'Save' }).click();
  
  // Wait for auto-save after name change
  await waitForAutoSave(page);

  // 3. Add another pin
  await page.route('**/places/search*', route => route.fulfill({ json: [{ place_id: '2', title: 'New', address: 'New Address', lat: '20', lon: '20', type: 'global' }] }));
  await searchInput.fill('New Location');
  await expect(page.getByText('New').first()).toBeVisible();
  await page.locator('button[title="Add to Map"]').first().click();

  // Wait for final auto-save
  await waitForAutoSave(page);

  // 4. Reload and verify everything is updated
  await page.reload({ waitUntil: 'domcontentloaded' });
  await expect(page.getByText('Loading your map...')).not.toBeVisible({ timeout: 15000 });
  await expect(page.locator('h1')).toContainText('Updated Map Name', { timeout: 10000 });
  await expect(page.locator('aside')).toContainText('Initial', { timeout: 10000 });
  await expect(page.locator('aside')).toContainText('New', { timeout: 10000 });
  await deleteCurrentMap(page);
});

test('rich pin metadata persistence and display', async ({ page }) => {
  await login(page);
  await page.getByRole('button', { name: /New Map/i }).click();
  await page.waitForURL(/\/map\//);
  await expect(page.getByText('Loading your map...')).not.toBeVisible();
  
  // 1. Add a pin
  await page.route('**/places/search*', route => route.fulfill({ json: [{ place_id: '1', title: 'Metadata City', address: 'Metadata Address', lat: '10', lon: '10', type: 'global' }] }));
  await page.getByPlaceholder('Search...').fill('Metadata City');
  await expect(page.getByText('Metadata City').first()).toBeVisible();
  await page.locator('button[title="Add to Map"]').first().click();
  await waitForAutoSave(page);
  await page.waitForURL(url => url.pathname !== '/map/new' && url.pathname.includes('/map/'));
  await page.waitForTimeout(1000);

  // 2. Edit metadata
  await page.getByRole('button', { name: 'Edit' }).first().click();
  await page.getByLabel('Description').fill('This is a great place to test metadata.');

  // 3. Wait for auto-save and reload
  await waitForAutoSave(page);
  
  await page.reload({ waitUntil: 'domcontentloaded' });
  await expect(page.getByText('Loading your map...')).not.toBeVisible({ timeout: 15000 });
  await expect(page.locator('aside')).toContainText('Metadata City', { timeout: 10000 });

  // 4. Verify in sidebar
  await page.getByRole('button', { name: 'Edit' }).first().click();
  await expect(page.getByLabel('Description')).toHaveValue('This is a great place to test metadata.', { timeout: 10000 });

  await deleteCurrentMap(page);
});

test('pin grouping and persistence', async ({ page }) => {
  await login(page);
  await page.getByRole('button', { name: /New Map/i }).click();
  await page.waitForURL(/\/map\//);
  await expect(page.getByText('Loading your map...')).not.toBeVisible();
  
  // 1. Add a group/layer via menu
  await page.getByRole('button', { name: 'More options' }).click();
  await page.getByText('New Layer').click();
  await expect(page.getByText(/Layer 1 \(0\)|Group 1 \(0\)/)).toBeVisible();

  // 2. Add a pin
  await page.route('**/places/search*', route => route.fulfill({ json: [{ place_id: '1', title: 'Group City', address: 'Group Address', lat: '10', lon: '10', type: 'global' }] }));
  await page.getByPlaceholder('Search...').fill('Group City');
  await expect(page.getByText('Group City').first()).toBeVisible();
  await page.locator('button[title="Add to Map"]').first().click();
  await waitForAutoSave(page);
  await page.waitForURL(url => url.pathname !== '/map/new' && url.pathname.includes('/map/'));
  await page.waitForTimeout(1000);

  // Initially it's in Default Layer
  await expect(page.locator('aside')).toContainText('Group City');

  // 3. Wait for reload
  await page.reload({ waitUntil: 'domcontentloaded' });
  await expect(page.getByText('Loading your map...')).not.toBeVisible({ timeout: 15000 });
  await expect(page.getByText(/Layer 1 \(0\)|Group 1 \(0\)/)).toBeVisible({ timeout: 10000 });
  await expect(page.locator('aside')).toContainText('Group City', { timeout: 10000 });
  await deleteCurrentMap(page);
});

test('export and import UI', async ({ page }) => {
  await login(page);
  await page.getByRole('button', { name: /New Map/i }).click();
  await page.waitForURL(/\/map\//);
  await expect(page.getByText('Loading your map...')).not.toBeVisible();
  await expect(page.locator('h1')).toContainText('My Map', { timeout: 10000 });

  // Open options menu
  const moreOptionsBtn = page.getByRole('button', { name: 'More options' });
  await moreOptionsBtn.click();

  // Verify export items are visible in menu
  await expect(page.getByText('Export', { exact: true })).toBeVisible();
  await expect(page.getByText('Import', { exact: true })).toBeVisible();

  // Click Export to open modal
  await page.getByText('Export', { exact: true }).click();
  await expect(page.getByText('Export Map')).toBeVisible();

  // Close Export modal
  await page.getByRole('button', { name: 'Cancel' }).click();
});

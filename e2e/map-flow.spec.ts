import { test, expect } from '@playwright/test';
import { login, waitForAutoSave, deleteCurrentMap } from './helpers';

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
  await expect(page.getByText('Test City').first()).toBeVisible({ timeout: 10000 });
  await page.locator('button[title="Add to Map"]').first().click();

  // Verify pin added to sidebar
  await expect(page.locator('aside')).toContainText('Test City');

  // 4. Wait for auto-save and check URL
  await waitForAutoSave(page);
  await page.waitForURL(url => url.pathname !== '/map/new' && url.pathname.includes('/map/'));
  const urlWithId = page.url();
  expect(urlWithId).toContain('/map/');

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
  await expect(page.getByText('Initial').first()).toBeVisible({ timeout: 10000 });
  await page.locator('button[title="Add to Map"]').first().click();
  
  // Wait for initial auto-save
  await waitForAutoSave(page);
  await page.waitForURL(url => url.pathname !== '/map/new' && url.pathname.includes('/map/'));

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
  await expect(page.getByText('New').first()).toBeVisible({ timeout: 10000 });
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
  test.setTimeout(60000);
  await login(page);
  await page.getByRole('button', { name: /New Map/i }).click();
  await page.waitForURL(/\/map\//);
  await expect(page.getByText('Loading your map...')).not.toBeVisible();
  
  // 1. Add a pin
  await page.route('**/places/search*', route => route.fulfill({ json: [{ place_id: '1', title: 'Metadata City', address: 'Metadata Address', lat: '10', lon: '10', type: 'global' }] }));
  await page.getByPlaceholder('Search...').fill('Metadata City');
  await expect(page.getByText('Metadata City').first()).toBeVisible({ timeout: 10000 });
  await page.locator('button[title="Add to Map"]').first().click();
  await waitForAutoSave(page);
  await page.waitForURL(url => url.pathname !== '/map/new' && url.pathname.includes('/map/'));

  // 2. Edit metadata
  await page.getByRole('button', { name: 'Edit' }).first().click();
  const descInput = page.getByLabel('Description');
  await descInput.fill('This is a great place to test metadata.');
  await descInput.blur();
  await page.getByRole('button', { name: 'Close edit' }).first().click();

  // Wait for auto-save after metadata edit
  await waitForAutoSave(page);
  
  // 3. Reload and verify metadata persists
  await page.reload({ waitUntil: 'domcontentloaded' });
  await expect(page.getByText('Loading your map...')).not.toBeVisible({ timeout: 15000 });
  await page.getByRole('button', { name: 'Edit' }).first().click();
  await expect(page.getByLabel('Description')).toHaveValue('This is a great place to test metadata.', { timeout: 10000 });

  await deleteCurrentMap(page);
});

test('pin grouping and persistence', async ({ page }) => {
  test.setTimeout(60000);
  await login(page);

  // Mock Places Search API before navigation
  await page.route('**/places/search*', route => route.fulfill({ 
    json: [{ place_id: '1', title: 'Group City', address: 'Group Address', lat: '10', lon: '10', type: 'global' }] 
  }));

  await page.getByRole('button', { name: /New Map/i }).click();
  await page.waitForURL(/\/map\//);
  await expect(page.getByText('Loading your map...')).not.toBeVisible();
  
  // 1. Add a group/layer via menu
  await page.getByRole('button', { name: 'More options' }).click();
  await page.getByText('New Layer').click();
  await expect(page.getByText(/Layer 1 \(0\)|Group 1 \(0\)/)).toBeVisible();

  // Wait for the new map to be created and socket connected before searching.
  // Creating a layer triggers handleSave (isInitialCreating=true / editMode=false);
  // searching while editMode=false can prevent results from rendering.
  await waitForAutoSave(page);

  // 2. Add a pin
  const searchInput = page.getByPlaceholder('Search...');
  await searchInput.fill('Group City');
  await expect(page.getByText('Group City').first()).toBeVisible({ timeout: 10000 });
  await page.locator('button[title="Add to Map"]').first().click();
  await waitForAutoSave(page);
  await page.waitForURL(url => url.pathname !== '/map/new' && url.pathname.includes('/map/'));

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
  await expect(page.locator('h1')).toContainText('Unnamed Map', { timeout: 10000 });

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

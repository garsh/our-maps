import { test, expect } from '@playwright/test';

// Helper to login
async function login(page: any) {
  page.on('console', (msg: any) => console.log(`BROWSER: ${msg.text()}`));
  await page.goto('/login');
  await page.getByRole('button', { name: /Sign in with Mock Account/i }).click();
  await expect(page).toHaveURL('/');
}

// Helper to wait for auto-save
async function waitForAutoSave(page: any) {
  // Wait for debounce (2s) + small buffer
  await page.waitForTimeout(2500);
  // Wait for "All changes saved" to be the final state
  await expect(page.getByText('All changes saved')).toBeVisible({ timeout: 15000 });
}

test('full map creation flow', async ({ page }) => {
  await login(page);

  // Mock Places Search API
  await page.route('**/api/places/search*', async route => {
    const json = [
      { 
        place_id: 123, 
        display_name: 'Test City, Test Country', 
        lat: '35.6895', 
        lon: '139.6917' 
      }
    ];
    await route.fulfill({ json });
  });

  // Navigate to new map page
  await page.getByRole('button', { name: 'Create New Map' }).click();
  await expect(page.locator('h1')).toContainText('Our Maps');
  await expect(page.getByText('Loading your map...')).not.toBeVisible();

  // 2. Search for a location
  const searchInput = page.getByPlaceholder('Find pins or new places...');
  await searchInput.fill('Tokyo');
  
  // 3. Add a pin from search results
  await expect(page.getByText('GLOBAL LOCATIONS')).toBeVisible();
  await expect(page.getByText('Test City, Test Country')).toBeVisible();
  await page.getByRole('button', { name: '+ Add to Map' }).click();

  // Verify pin added to sidebar
  await expect(page.locator('aside')).toContainText('Test City');

  // 4. Wait for auto-save and check URL
  await waitForAutoSave(page);
  await page.waitForURL(/\/map\//);
  const urlWithId = page.url();
  expect(urlWithId).toContain('/map/');

  // 5. Reload the page and verify the pin persists
  await page.reload();
  await page.waitForTimeout(3000);
  await expect(page.getByText('Loading your map...')).not.toBeVisible();
  await expect(page.locator('aside')).toContainText('Test City', { timeout: 10000 });
});

test('updating an existing map', async ({ page }) => {
  await login(page);
  await page.getByRole('button', { name: 'Create New Map' }).click();
  await expect(page.getByText('Loading your map...')).not.toBeVisible();

  // 1. Create a map first
  const searchInput = page.getByPlaceholder('Find pins or new places...');
  await page.route('**/search*', route => route.fulfill({ json: [{ place_id: 1, display_name: 'Initial', lat: '10', lon: '10' }] }));
  await searchInput.fill('Initial Location');
  await expect(page.getByText('Initial')).toBeVisible();
  await page.getByRole('button', { name: '+ Add to Map' }).click();
  
  // Wait for initial auto-save
  await waitForAutoSave(page);
  await page.waitForURL(/\/map\//);
  await page.waitForTimeout(2000);

  // 2. Change map name
  const nameInput = page.getByLabel('Map Name');
  await nameInput.fill('Updated Map Name');
  await nameInput.press('Enter');
  
  // Wait for auto-save after name change
  await waitForAutoSave(page);

  // 3. Add another pin
  await page.route('**/search*', route => route.fulfill({ json: [{ place_id: 2, display_name: 'New', lat: '20', lon: '20' }] }));
  await searchInput.fill('New Location');
  await expect(page.getByText('New', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: '+ Add to Map' }).click();

  // Wait for final auto-save
  await waitForAutoSave(page);

  // 4. Reload and verify everything is updated
  await page.reload();
  await page.waitForTimeout(3000);
  await expect(page.getByText('Loading your map...')).not.toBeVisible();
  await expect(page.getByLabel('Map Name')).toHaveValue('Updated Map Name', { timeout: 10000 });
  await expect(page.locator('aside')).toContainText('Initial', { timeout: 10000 });
  await expect(page.locator('aside')).toContainText('New', { timeout: 10000 });
});

test('rich pin metadata persistence and display', async ({ page }) => {
  await login(page);
  await page.getByRole('button', { name: 'Create New Map' }).click();
  await expect(page.getByText('Loading your map...')).not.toBeVisible();
  
  // 1. Add a pin
  await page.route('**/search*', route => route.fulfill({ json: [{ place_id: 1, display_name: 'Metadata City', lat: '10', lon: '10' }] }));
  await page.getByPlaceholder('Find pins or new places...').fill('Metadata City');
  await expect(page.getByText('Metadata City')).toBeVisible();
  await page.getByRole('button', { name: '+ Add to Map' }).click();
  await waitForAutoSave(page);

  // 2. Edit metadata
  await page.getByLabel('Description').fill('This is a great place to test metadata.');
  await page.getByLabel('Image URL').fill('https://images.unsplash.com/photo-1449034446853-66c86144b0ad?w=200');

  // 3. Wait for auto-save and reload
  await waitForAutoSave(page);
  await page.waitForURL(/\/map\//);
  
  await page.reload();
  await page.waitForTimeout(3000);
  await expect(page.getByText('Loading your map...')).not.toBeVisible();
  await page.waitForSelector('.leaflet-marker-icon', { timeout: 10000 });

  // 4. Verify in sidebar
  await page.getByRole('button', { name: 'Edit' }).first().click();
  await expect(page.getByLabel('Description')).toHaveValue('This is a great place to test metadata.', { timeout: 10000 });

  // 5. Verify on map popup
  await page.locator('.leaflet-marker-icon').first().click();
  
  const popup = page.locator('.leaflet-popup-content');
  await expect(popup).toContainText('This is a great place to test metadata.', { timeout: 10000 });
  await expect(popup.locator('img')).toHaveAttribute('src', /images.unsplash.com/);
});

test('pin grouping and persistence', async ({ page }) => {
  await login(page);
  await page.getByRole('button', { name: 'Create New Map' }).click();
  await expect(page.getByText('Loading your map...')).not.toBeVisible();
  
  // 1. Add a group
  await page.getByRole('button', { name: 'New Layer' }).click();
  await expect(page.getByText('Group 1 (0)')).toBeVisible();
  await waitForAutoSave(page);

  // 2. Add a pin
  await page.route('**/search*', route => route.fulfill({ json: [{ place_id: 1, display_name: 'Group City', lat: '10', lon: '10' }] }));
  await page.getByPlaceholder('Find pins or new places...').fill('Group City');
  await expect(page.getByText('Group City')).toBeVisible();
  await page.getByRole('button', { name: '+ Add to Map' }).click();
  await waitForAutoSave(page);

  // Initially it's in Default Layer
  await expect(page.locator('#default + ul')).toContainText('Group City');

  // 3. Wait for reload
  await page.reload();
  await page.waitForTimeout(3000);
  await expect(page.getByText('Loading your map...')).not.toBeVisible();
  await expect(page.getByText('Group 1 (0)')).toBeVisible({ timeout: 10000 });
  await expect(page.locator('#default + ul')).toContainText('Group City', { timeout: 10000 });
});

test('export and import UI', async ({ page }) => {
  await login(page);
  await page.getByRole('button', { name: 'Create New Map' }).click();
  await expect(page.getByText('Loading your map...')).not.toBeVisible();
  await expect(page.getByLabel('Map Name')).toHaveValue('My Map', { timeout: 10000 });

  // Open options menu
  const moreOptionsBtn = page.getByRole('button', { name: 'More options' });
  await moreOptionsBtn.click();

  // Verify export items are visible
  await expect(page.getByText('EXPORT AS...')).toBeVisible();
  await expect(page.getByText('JSON', { exact: true })).toBeVisible();
  await expect(page.getByText('GeoJSON', { exact: true })).toBeVisible();
  await expect(page.getByText('KML', { exact: true })).toBeVisible();

  // Click again to close
  await moreOptionsBtn.click();
  await expect(page.getByText('EXPORT AS...')).not.toBeVisible();

  // Open to verify Import button
  await moreOptionsBtn.click();
  await expect(page.getByText('Import')).toBeVisible();
});

import { test, expect } from '@playwright/test';

// Helper to login
async function login(page: any) {
  page.on('console', (msg: any) => console.log(`BROWSER: ${msg.text()}`));
  await page.goto('/login');
  await page.getByRole('button', { name: /Sign in with Mock Account/i }).click();
  await expect(page).toHaveURL('/');
}

test('full map creation flow', async ({ page }) => {
  await login(page);

  // Mock Nominatim API
  await page.route('https://nominatim.openstreetmap.org/search*', async route => {
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

  // 2. Search for a location
  const searchInput = page.getByPlaceholder('Search pins or places...');
  await searchInput.fill('Tokyo');
  
  // 3. Add a pin from search results (wait for live results)
  await expect(page.getByText('GLOBAL LOCATIONS')).toBeVisible();
  await expect(page.getByText('Test City, Test Country')).toBeVisible();
  await page.getByRole('button', { name: '+ Add to Map' }).click();

  // Verify pin added to sidebar
  await expect(page.locator('aside')).toContainText('Pins (1)');
  await expect(page.locator('aside')).toContainText('Test City');

  // 4. Save the map
  await page.getByRole('button', { name: 'Save Map' }).click();
  
  // 5. Check that the URL updates
  await page.waitForURL(/\/map\//);
  await page.waitForTimeout(2000);
  await expect(page.getByText('Loading map...')).not.toBeVisible();

  // 6. Reload the page and verify the pin persists
  await page.reload();
  await page.waitForTimeout(3000);
  // Wait for loading state to finish
  await expect(page.getByText('Loading map...')).not.toBeVisible();
  await expect(page.locator('aside')).toContainText('Pins (1)', { timeout: 10000 });
  await expect(page.locator('aside')).toContainText('Test City', { timeout: 10000 });
});

test('updating an existing map', async ({ page }) => {
  await login(page);
  await page.getByRole('button', { name: 'Create New Map' }).click();

  // 1. Create a map first
  const searchInput = page.getByPlaceholder('Search pins or places...');
  await page.route('**/search*', route => route.fulfill({ json: [{ place_id: 1, display_name: 'Initial', lat: '10', lon: '10' }] }));
  await searchInput.fill('Initial Location');
  await expect(page.getByText('Initial')).toBeVisible();
  await page.getByRole('button', { name: '+ Add to Map' }).click();
  await page.getByRole('button', { name: 'Save Map' }).click();
  await page.waitForURL(/\/map\//);
  await page.waitForTimeout(2000);
  await expect(page.getByText('Loading map...')).not.toBeVisible();

  // Wait for initial load
  await expect(page.getByLabel('Map Name')).toHaveValue('My Map');
  await page.waitForTimeout(1000);

  // 2. Change map name and add another pin
  const nameInput = page.getByLabel('Map Name');
  await nameInput.fill('Updated Map Name');
  await nameInput.press('Enter');
  
  // Verify state update
  await expect(page.getByLabel('Map Name')).toHaveValue('Updated Map Name');
  await page.waitForTimeout(1000);

  await page.getByRole('button', { name: 'Save Map' }).click();
  await page.waitForTimeout(3000);
  
  await page.route('**/search*', route => route.fulfill({ json: [{ place_id: 2, display_name: 'New', lat: '20', lon: '20' }] }));
  await searchInput.fill('New Location');
  await expect(page.getByText('New', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: '+ Add to Map' }).click();

  // 3. Update the map
  await page.getByRole('button', { name: 'Save Map' }).click();
  await page.waitForTimeout(3000);

  await page.reload();
  await page.waitForTimeout(3000);
  await expect(page.getByText('Loading map...')).not.toBeVisible();
  await expect(page.getByLabel('Map Name')).toHaveValue('Updated Map Name', { timeout: 10000 });
  await expect(page.locator('aside')).toContainText('Pins (2)', { timeout: 10000 });
});

test('rich pin metadata persistence and display', async ({ page }) => {
  await login(page);
  await page.getByRole('button', { name: 'Create New Map' }).click();
  
  // 1. Add a pin
  await page.route('**/search*', route => route.fulfill({ json: [{ place_id: 1, display_name: 'Metadata City', lat: '10', lon: '10' }] }));
  await page.getByPlaceholder('Search pins or places...').fill('Metadata City');
  await expect(page.getByText('Metadata City')).toBeVisible();
  await page.getByRole('button', { name: '+ Add to Map' }).click();

  // 2. Edit metadata
  await page.getByRole('button', { name: 'Edit' }).click();
  await page.getByLabel('Description').fill('This is a great place to test metadata.');
  await page.getByLabel('Image URL').fill('https://images.unsplash.com/photo-1449034446853-66c86144b0ad?w=200');

  // 3. Save and reload
  await page.getByRole('button', { name: 'Save Map' }).click();
  await page.waitForURL(/\/map\//);
  await page.waitForTimeout(3000);
  
  await page.reload();
  await page.waitForTimeout(3000);
  await expect(page.getByText('Loading map...')).not.toBeVisible();
  await page.waitForSelector('.leaflet-marker-icon', { timeout: 10000 });

  // 4. Verify in sidebar
  await page.getByRole('button', { name: 'Edit' }).click();
  await expect(page.getByLabel('Description')).toHaveValue('This is a great place to test metadata.', { timeout: 10000 });

  // 5. Verify on map popup
  await page.locator('.leaflet-marker-icon').first().click();
  
  const popup = page.locator('.leaflet-popup-content');
  await expect(popup).toContainText('This is a great place to test metadata.', { timeout: 10000 });
  await expect(popup.locator('img')).toHaveAttribute('src', /images.unsplash.com/);
});

test('visual categorization with pin colors', async ({ page }) => {
  await login(page);
  await page.getByRole('button', { name: 'Create New Map' }).click();
  
  // 1. Add a pin
  await page.route('**/search*', route => route.fulfill({ json: [{ place_id: 1, display_name: 'Color City', lat: '10', lon: '10' }] }));
  await page.getByPlaceholder('Search pins or places...').fill('Color City');
  await expect(page.getByText('Color City')).toBeVisible();
  await page.getByRole('button', { name: '+ Add to Map' }).click();

  // 2. Change color to violet
  await page.getByRole('button', { name: 'Edit' }).click();
  await page.getByLabel('color-violet').click();

  // 3. Save and reload
  await page.getByRole('button', { name: 'Save Map' }).click();
  await page.waitForURL(/\/map\//);
  await page.waitForTimeout(3000);
  
  await page.reload();
  await page.waitForTimeout(3000);
  await expect(page.getByText('Loading map...')).not.toBeVisible();
  await page.waitForSelector('.leaflet-marker-icon', { timeout: 10000 });

  // 4. Verify marker icon URL contains violet
  const marker = page.locator('.leaflet-marker-icon').first();
  await expect(marker).toHaveAttribute('src', /marker-icon-2x-violet.png/);

  // 5. Verify sidebar indicator color
  const colorIndicator = page.locator('aside').getByText('Color City').locator('..').locator('div').first();
  await expect(colorIndicator).toHaveAttribute('data-color', 'violet');
});

test('default pin color', async ({ page }) => {
  await login(page);
  await page.getByRole('button', { name: 'Create New Map' }).click();
  
  // 1. Add a pin
  await page.route('**/search*', route => route.fulfill({ json: [{ place_id: 1, display_name: 'Color City', lat: '10', lon: '10' }] }));
  await page.getByPlaceholder('Search pins or places...').fill('Color City');
  await expect(page.getByText('Color City')).toBeVisible();
  await page.getByRole('button', { name: '+ Add to Map' }).click();

  // 2. Save and reload
  await page.getByRole('button', { name: 'Save Map' }).click();
  await page.waitForURL(/\/map\//);
  await page.waitForTimeout(3000);
  
  await page.reload();
  await page.waitForTimeout(3000);
  await expect(page.getByText('Loading map...')).not.toBeVisible();
  await page.waitForSelector('.leaflet-marker-icon', { timeout: 10000 });

  // 3. Verify marker icon URL contains blue
  const marker = page.locator('.leaflet-marker-icon').first();
  await expect(marker).toHaveAttribute('src', /marker-icon-2x-blue.png/);

  // 4. Verify sidebar indicator color
  const colorIndicator = page.locator('aside').getByText('Color City').locator('..').locator('div').first();
  await expect(colorIndicator).toHaveAttribute('data-color', 'blue');
});

test('visual categorization with pin icons', async ({ page }) => {
  await login(page);
  await page.getByRole('button', { name: 'Create New Map' }).click();
  
  // 1. Add a pin
  await page.route('**/search*', route => route.fulfill({ json: [{ place_id: 1, display_name: 'Icon City', lat: '10', lon: '10' }] }));
  await page.getByPlaceholder('Search pins or places...').fill('Icon City');
  await expect(page.getByText('Icon City')).toBeVisible();
  await page.getByRole('button', { name: '+ Add to Map' }).click();

  // 2. Change icon to hotel
  await page.getByRole('button', { name: 'Edit' }).click();
  await page.getByLabel('icon-hotel').click();

  // 3. Save and reload
  await page.getByRole('button', { name: 'Save Map' }).click();
  await page.waitForURL(/\/map\//);
  await page.waitForTimeout(3000);
  
  await page.reload();
  await page.waitForTimeout(3000);
  await expect(page.getByText('Loading map...')).not.toBeVisible();
  await page.waitForSelector('.leaflet-marker-icon', { timeout: 10000 });

  // 4. Verify marker is a custom pin
  const marker = page.locator('.leaflet-marker-icon.custom-pin').first();
  await expect(marker).toBeVisible();
  
  const svg = marker.locator('svg');
  await expect(svg).toBeVisible();

  // 5. Verify sidebar indicator shows an icon
  const iconIndicator = page.locator('aside').getByText('Icon City').locator('..').locator('div').first().locator('svg');
  await expect(iconIndicator).toBeVisible();
});

test('pin grouping and persistence', async ({ page }) => {
  await login(page);
  await page.getByRole('button', { name: 'Create New Map' }).click();
  
  // 1. Add a group
  await page.getByRole('button', { name: 'Add Group' }).click();
  await expect(page.getByText('Group 1 (0)')).toBeVisible();

  // 2. Add a pin
  await page.route('**/search*', route => route.fulfill({ json: [{ place_id: 1, display_name: 'Group City', lat: '10', lon: '10' }] }));
  await page.getByPlaceholder('Search pins or places...').fill('Group City');
  await expect(page.getByText('Group City')).toBeVisible();
  await page.getByRole('button', { name: '+ Add to Map' }).click();

  // Initially it's in Default Pins
  await expect(page.locator('h4:has-text("Default Pins") + ul')).toContainText('Group City');

  // 3. Save map to get an ID
  await page.getByRole('button', { name: 'Save Map' }).click();
  await page.waitForURL(/\/map\//);
  await page.waitForTimeout(3000);

  await page.reload();
  await page.waitForTimeout(3000);
  await expect(page.getByText('Loading map...')).not.toBeVisible();
  await expect(page.getByText('Group 1 (0)')).toBeVisible({ timeout: 10000 });
  await expect(page.locator('h4:has-text("Default Pins") + ul')).toContainText('Group City', { timeout: 10000 });
});

test('export and import UI', async ({ page }) => {
  await login(page);
  await page.getByRole('button', { name: 'Create New Map' }).click();

  // Verify Export button and dropdown
  const exportBtn = page.getByRole('button', { name: 'Export' });
  await expect(exportBtn).toBeVisible();
  await exportBtn.click();
  
  await expect(page.getByText('Full JSON (.json)')).toBeVisible();
  await expect(page.getByText('GeoJSON (.geojson)')).toBeVisible();
  await expect(page.getByText('KML (.kml)')).toBeVisible();

  // Click again to close
  await exportBtn.click();
  await expect(page.getByText('Full JSON (.json)')).not.toBeVisible();

  // Verify Import button
  await expect(page.getByRole('button', { name: 'Import' })).toBeVisible();
});

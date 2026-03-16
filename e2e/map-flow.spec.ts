import { test, expect } from '@playwright/test';

test('full map creation flow', async ({ page }) => {
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

  // 1. Open the app
  await page.goto('/');
  await expect(page.locator('h1')).toContainText('Our Maps');

  // 2. Search for a location
  const searchInput = page.getByPlaceholder('Search for a place...');
  await searchInput.fill('Tokyo');
  await page.getByRole('button', { name: 'Search' }).click();

  // 3. Add a pin from search results
  await expect(page.getByText('Test City, Test Country')).toBeVisible();
  await page.getByRole('button', { name: '+ Add Pin' }).click();

  // Verify pin added to sidebar
  await expect(page.locator('aside')).toContainText('Pins (1)');
  await expect(page.locator('aside')).toContainText('Test City');

  // 4. Save the map
  await page.getByRole('button', { name: 'Save Map' }).click();
  
  // 5. Check that the URL updates (contains mapId)
  await page.waitForURL(/\?mapId=/);
  const urlWithId = page.url();
  expect(urlWithId).toContain('mapId=');

  // 6. Reload the page and verify the pin persists
  await page.reload();
  await expect(page.locator('aside')).toContainText('Pins (1)');
  await expect(page.locator('aside')).toContainText('Test City');
});

test('updating an existing map', async ({ page }) => {
  // 1. Create a map first
  await page.goto('/');
  const searchInput = page.getByPlaceholder('Search for a place...');
  await searchInput.fill('Initial Location');
  await page.route('**/search*', route => route.fulfill({ json: [{ place_id: 1, display_name: 'Initial', lat: '10', lon: '10' }] }));
  await page.getByRole('button', { name: 'Search' }).click();
  await page.getByRole('button', { name: '+ Add Pin' }).click();
  await page.getByRole('button', { name: 'Save Map' }).click();
  await page.waitForURL(/\?mapId=/);

  // 2. Change map name and add another pin
  await page.locator('input[type="text"]').first().fill('Updated Map Name');
  
  await searchInput.fill('New Location');
  await page.route('**/search*', route => route.fulfill({ json: [{ place_id: 2, display_name: 'New', lat: '20', lon: '20' }] }));
  await page.getByRole('button', { name: 'Search' }).click();
  await page.getByRole('button', { name: '+ Add Pin' }).click();

  // 3. Update the map
  await page.getByRole('button', { name: 'Update Map' }).click();
  await page.waitForTimeout(1000); // Wait for API

  // 4. Reload and verify everything is updated
  await page.reload();
  await expect(page.locator('input[type="text"]').first()).toHaveValue('Updated Map Name');
  await expect(page.locator('aside')).toContainText('Pins (2)');
});

test('rich pin metadata persistence and display', async ({ page }) => {
  await page.goto('/');
  
  // 1. Add a pin
  await page.route('**/search*', route => route.fulfill({ json: [{ place_id: 1, display_name: 'Metadata City', lat: '10', lon: '10' }] }));
  await page.getByPlaceholder('Search for a place...').fill('Metadata City');
  await page.getByRole('button', { name: 'Search' }).click();
  await page.getByRole('button', { name: '+ Add Pin' }).click();

  // 2. Edit metadata
  await page.getByRole('button', { name: 'Edit' }).click();
  await page.getByLabel('Description').fill('This is a great place to test metadata.');
  await page.getByLabel('Image URL').fill('https://images.unsplash.com/photo-1449034446853-66c86144b0ad?w=200');

  // 3. Save and reload
  await page.getByRole('button', { name: 'Save Map' }).click();
  await page.waitForURL(/\?mapId=/);
  const mapId = new URL(page.url()).searchParams.get('mapId');
  
  await page.reload();
  await page.waitForSelector('.leaflet-marker-icon');

  // 4. Verify in sidebar
  await page.getByRole('button', { name: 'Edit' }).click();
  await expect(page.getByLabel('Description')).toHaveValue('This is a great place to test metadata.');

  // 5. Verify on map popup
  // Clicking the marker can be tricky in Playwright/Leaflet, so we'll use the sidebar click to center/open if possible, 
  // but Leaflet Markers need a direct click.
  await page.locator('.leaflet-marker-icon').first().click();
  
  const popup = page.locator('.leaflet-popup-content');
  await expect(popup).toContainText('This is a great place to test metadata.');
  await expect(popup.locator('img')).toHaveAttribute('src', /images.unsplash.com/);
});

test('visual categorization with pin colors', async ({ page }) => {
  await page.goto('/');
  
  // 1. Add a pin
  await page.route('**/search*', route => route.fulfill({ json: [{ place_id: 1, display_name: 'Color City', lat: '10', lon: '10' }] }));
  await page.getByPlaceholder('Search for a place...').fill('Color City');
  await page.getByRole('button', { name: 'Search' }).click();
  await page.getByRole('button', { name: '+ Add Pin' }).click();

  // 2. Change color to violet
  await page.getByRole('button', { name: 'Edit' }).click();
  await page.getByLabel('color-violet').click();

  // 3. Save and reload
  await page.getByRole('button', { name: 'Save Map' }).click();
  await page.waitForURL(/\?mapId=/);
  
  await page.reload();
  await page.waitForSelector('.leaflet-marker-icon');

  // 4. Verify marker icon URL contains violet
  const marker = page.locator('.leaflet-marker-icon').first();
  await expect(marker).toHaveAttribute('src', /marker-icon-2x-violet.png/);

  // 5. Verify sidebar indicator color
  const colorIndicator = page.locator('aside').getByText('Color City').locator('..').locator('div').first();
  await expect(colorIndicator).toHaveAttribute('data-color', 'violet');
});

test('default pin color', async ({ page }) => {
  await page.goto('/');
  
  // 1. Add a pin
  await page.route('**/search*', route => route.fulfill({ json: [{ place_id: 1, display_name: 'Color City', lat: '10', lon: '10' }] }));
  await page.getByPlaceholder('Search for a place...').fill('Color City');
  await page.getByRole('button', { name: 'Search' }).click();
  await page.getByRole('button', { name: '+ Add Pin' }).click();

  // 2. Save and reload
  await page.getByRole('button', { name: 'Save Map' }).click();
  await page.waitForURL(/\?mapId=/);
  
  await page.reload();
  await page.waitForSelector('.leaflet-marker-icon');

  // 3. Verify marker icon URL contains blue
  const marker = page.locator('.leaflet-marker-icon').first();
  await expect(marker).toHaveAttribute('src', /marker-icon-2x-blue.png/);

  // 4. Verify sidebar indicator color
  const colorIndicator = page.locator('aside').getByText('Color City').locator('..').locator('div').first();
  await expect(colorIndicator).toHaveAttribute('data-color', 'blue');
});

test('visual categorization with pin icons', async ({ page }) => {
  await page.goto('/');
  
  // 1. Add a pin
  await page.route('**/search*', route => route.fulfill({ json: [{ place_id: 1, display_name: 'Icon City', lat: '10', lon: '10' }] }));
  await page.getByPlaceholder('Search for a place...').fill('Icon City');
  await page.getByRole('button', { name: 'Search' }).click();
  await page.getByRole('button', { name: '+ Add Pin' }).click();

  // 2. Change icon to hotel
  await page.getByRole('button', { name: 'Edit' }).click();
  await page.getByLabel('icon-hotel').click();

  // 3. Save and reload
  await page.getByRole('button', { name: 'Save Map' }).click();
  await page.waitForURL(/\?mapId=/);
  
  await page.reload();
  await page.waitForSelector('.leaflet-marker-icon');

  // 4. Verify marker is a custom pin (L.divIcon uses .leaflet-marker-icon with the custom class)
  const marker = page.locator('.leaflet-marker-icon.custom-pin').first();
  await expect(marker).toBeVisible();
  
  // Check if it contains an SVG with the hotel path (or just that it's a divIcon)
  const svg = marker.locator('svg');
  await expect(svg).toBeVisible();

  // 5. Verify sidebar indicator shows an icon (it will have an SVG inside the color dot)
  const iconIndicator = page.locator('aside').getByText('Icon City').locator('..').locator('div').first().locator('svg');
  await expect(iconIndicator).toBeVisible();
});

test('pin grouping and persistence', async ({ page }) => {
  await page.goto('/');
  
  // 1. Add a group
  await page.getByRole('button', { name: 'Add Group' }).click();
  await expect(page.getByText('Group 1 (0)')).toBeVisible();

  // 2. Add a pin
  await page.route('**/search*', route => route.fulfill({ json: [{ place_id: 1, display_name: 'Group City', lat: '10', lon: '10' }] }));
  await page.getByPlaceholder('Search for a place...').fill('Group City');
  await page.getByRole('button', { name: 'Search' }).click();
  await page.getByRole('button', { name: '+ Add Pin' }).click();

  // Initially it's in Default Pins
  await expect(page.locator('h4:has-text("Default Pins") + ul')).toContainText('Group City');

  // 3. Save map to get an ID
  await page.getByRole('button', { name: 'Save Map' }).click();
  await page.waitForURL(/\?mapId=/);

  // Note: We can't easily drag and drop in this test without complex helper functions for dnd-kit,
  // but we can verify that groups themselves persist.
  
  await page.reload();
  await expect(page.getByText('Group 1 (0)')).toBeVisible();
  await expect(page.locator('h4:has-text("Default Pins") + ul')).toContainText('Group City');
});

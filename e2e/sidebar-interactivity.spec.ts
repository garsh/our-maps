import { test, expect } from '@playwright/test';

// Helper to login
async function login(page: any) {
  // Capture console logs from browser
  page.on('console', (msg: any) => {
    const text = msg.text();
    if (text.includes('Unable to load glyph range') || text.includes('GL Driver Message') || text.includes('could not be loaded')) {
      return;
    }
    if (msg.type() === 'error') console.log(`BROWSER ERROR: ${text}`);
    else console.log(`BROWSER: ${text}`);
  });
  
  await page.goto('/login');
  await page.getByRole('button', { name: /Sign in with Mock Account/i }).click();
  await expect(page).toHaveURL('/');
}

test('sidebar items are interactible', async ({ page }) => {
  // Mock places reverse geocode
  await page.route('**/places/reverse-geocode*', route => route.fulfill({ 
    json: { address: '123 Test St, Interactivity City, IC 12345' } 
  }));

  await login(page);

  // Navigate to new map page
  await page.getByRole('button', { name: /New Map/i }).click();
  await page.waitForURL(/\/map\//);
  
  // 1. Add a pin
  await page.route('**/places/search*', route => route.fulfill({ json: [{ place_id: '1', title: 'Interactivity City', address: '123 Test St', lat: '10', lon: '10', type: 'global' }] }));
  await page.getByPlaceholder('Search...').fill('Interactivity City');
  await expect(page.getByText('Interactivity City').first()).toBeVisible();
  await expect(page.getByText('123 Test St').first()).toBeVisible();
  await page.locator('button[title="Add to Map"]').first().click();

  // 2. Click the pin in the sidebar list
  const sidebarItem = page.locator('li[id^="pin-"]').filter({ hasText: 'Interactivity City' });
  await expect(sidebarItem).toBeVisible();
  await sidebarItem.click();
  
  // 5. Test "Edit" button in sidebar
  await sidebarItem.getByRole('button', { name: 'Edit' }).click();
  await expect(page.getByLabel('Name', { exact: true })).toBeVisible();
  
  // 6. Test "Close edit" button
  await sidebarItem.getByRole('button', { name: 'Close edit' }).click();
  await expect(page.getByLabel('Name', { exact: true })).not.toBeVisible();
  
  // 7. Cleanup test map
  try {
    const url = page.url();
    const mapId = url.split('/map/')[1]?.split('?')[0];
    if (mapId && mapId !== 'new') {
      await page.evaluate(async (id: string) => {
        const token = localStorage.getItem('token');
        await fetch(`/api/maps/${id}`, {
          method: 'DELETE',
          headers: { 'Authorization': token ? `Bearer ${token}` : '' }
        });
      }, mapId);
    }
  } catch {}
});
